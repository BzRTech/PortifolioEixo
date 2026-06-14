// Consultas espaciais e analiticas usadas pela API.
import { query } from './db.js';

const TABLES = {
  bairros:     { table: 'bairros',     bairroCol: 'nome' },
  quadras:     { table: 'quadras',     bairroCol: 'bairro' },
  lotes:       { table: 'lotes',       bairroCol: 'bairro' },
  ruas:        { table: 'ruas',        bairroCol: 'bairro' },
  edificacoes: { table: 'edificacoes', bairroCol: 'bairro' },
};

export function isValidLayer(layer) {
  return Object.prototype.hasOwnProperty.call(TABLES, layer);
}

/**
 * Retorna a camada como um GeoJSON FeatureCollection.
 * Suporta filtro por bounding-box (bbox), por bairro, limite e simplificacao.
 */
export async function getLayerGeoJSON(layer, opts = {}) {
  const cfg = TABLES[layer];
  if (!cfg) throw new Error('Camada invalida: ' + layer);

  const { bbox, bairro, limit, simplify } = opts;
  const where = [];
  const params = [];

  if (Array.isArray(bbox) && bbox.length === 4 && bbox.every((n) => Number.isFinite(n))) {
    params.push(bbox[0], bbox[1], bbox[2], bbox[3]);
    where.push(
      `geom && ST_MakeEnvelope($${params.length - 3},$${params.length - 2},$${params.length - 1},$${params.length},4326)`
    );
  }
  if (bairro) {
    params.push(bairro);
    where.push(`${cfg.bairroCol} = $${params.length}`);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limitSql = Number.isFinite(limit) && limit > 0 ? `LIMIT ${Math.floor(limit)}` : '';
  const tol = Number(simplify);
  const geomExpr =
    Number.isFinite(tol) && tol > 0
      ? `ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, ${tol}), 6)::jsonb`
      : `ST_AsGeoJSON(geom, 6)::jsonb`;

  const sql = `
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
    ) AS fc
    FROM (
      SELECT jsonb_build_object(
        'type', 'Feature',
        'id', t.id,
        'geometry', ${geomExpr},
        'properties', (to_jsonb(t) - 'geom' - 'props') || COALESCE(t.props, '{}'::jsonb)
      ) AS feature
      FROM ${cfg.table} t
      ${whereSql}
      ${limitSql}
    ) f`;

  const r = await query(sql, params);
  return r.rows[0].fc;
}

/** Lista de bairros (nomes) para popular filtros no front. */
export async function getBairros() {
  const r = await query(`
    SELECT DISTINCT b AS bairro FROM (
      SELECT nome AS b FROM bairros WHERE nome IS NOT NULL AND nome <> ''
      UNION
      SELECT bairro AS b FROM ruas WHERE bairro IS NOT NULL AND bairro <> ''
    ) x ORDER BY bairro`);
  return r.rows.map((row) => row.bairro);
}

/** Contagem de feicoes por camada (para saber o que ja foi carregado). */
export async function getCounts() {
  const r = await query(`SELECT
     (SELECT COUNT(*) FROM bairros)::int     AS bairros,
     (SELECT COUNT(*) FROM quadras)::int     AS quadras,
     (SELECT COUNT(*) FROM lotes)::int       AS lotes,
     (SELECT COUNT(*) FROM ruas)::int        AS ruas,
     (SELECT COUNT(*) FROM edificacoes)::int AS edificacoes`);
  return r.rows[0];
}

/** Extensao total (bbox) de todas as camadas, em lng/lat. */
export async function getExtent() {
  const sql = `
    SELECT ST_XMin(e) AS minx, ST_YMin(e) AS miny, ST_XMax(e) AS maxx, ST_YMax(e) AS maxy
    FROM (
      SELECT ST_Extent(geom) AS e FROM (
        SELECT geom FROM bairros      WHERE geom IS NOT NULL
        UNION ALL SELECT geom FROM ruas        WHERE geom IS NOT NULL
        UNION ALL SELECT geom FROM lotes       WHERE geom IS NOT NULL
        UNION ALL SELECT geom FROM quadras     WHERE geom IS NOT NULL
        UNION ALL SELECT geom FROM edificacoes WHERE geom IS NOT NULL
      ) g
    ) x`;
  const r = await query(sql);
  const row = r.rows[0];
  if (!row || row.minx === null) return null;
  return [Number(row.minx), Number(row.miny), Number(row.maxx), Number(row.maxy)];
}

/** Indicadores para o dashboard de gestao. */
export async function getDashboard() {
  const ruasResumo = (await query(`
    SELECT
      COUNT(*)::int                                              AS total,
      COUNT(*) FILTER (WHERE pavimentada IS TRUE)::int           AS pavimentadas,
      COUNT(*) FILTER (WHERE pavimentada IS FALSE)::int          AS nao_pavimentadas,
      COUNT(*) FILTER (WHERE pavimentada IS NULL)::int           AS sem_info,
      COALESCE(SUM(extensao_m), 0)                               AS extensao_total_m,
      COALESCE(SUM(extensao_m) FILTER (WHERE pavimentada IS TRUE), 0)  AS extensao_pav_m,
      COALESCE(SUM(extensao_m) FILTER (WHERE pavimentada IS FALSE), 0) AS extensao_naopav_m
    FROM ruas`)).rows[0];

  const pavPorBairro = (await query(`
    SELECT
      COALESCE(NULLIF(bairro, ''), '(sem bairro)')                     AS bairro,
      COUNT(*)::int                                                    AS total_ruas,
      COUNT(*) FILTER (WHERE pavimentada IS TRUE)::int                 AS pavimentadas,
      COUNT(*) FILTER (WHERE pavimentada IS FALSE)::int                AS nao_pavimentadas,
      COALESCE(SUM(extensao_m), 0)                                     AS extensao_m,
      ROUND(100.0 * COUNT(*) FILTER (WHERE pavimentada IS TRUE)
            / NULLIF(COUNT(*), 0), 1)::float                           AS pct_pavimentada
    FROM ruas
    GROUP BY 1
    ORDER BY pct_pavimentada ASC NULLS FIRST, nao_pavimentadas DESC`)).rows;

  const bairrosPopulosos = (await query(`
    SELECT nome, populacao, area_m2,
      CASE WHEN area_m2 > 0 THEN ROUND(populacao / (area_m2 / 1e6))::int ELSE NULL END AS densidade_hab_km2
    FROM bairros
    WHERE populacao IS NOT NULL
    ORDER BY populacao DESC NULLS LAST
    LIMIT 15`)).rows;

  const totais = (await query(`
    SELECT
      (SELECT COUNT(*) FROM lotes)::int                  AS total_lotes,
      (SELECT COUNT(*) FROM quadras)::int                AS total_quadras,
      (SELECT COUNT(*) FROM edificacoes)::int            AS total_edificacoes,
      (SELECT COUNT(*) FROM bairros)::int                AS total_bairros,
      (SELECT COALESCE(SUM(populacao), 0) FROM bairros)::int AS populacao_total`)).rows[0];

  const usoLotes = (await query(`
    SELECT COALESCE(NULLIF(uso, ''), 'nao informado') AS uso,
           COUNT(*)::int AS qtd,
           COALESCE(SUM(area_m2), 0) AS area_m2
    FROM lotes GROUP BY 1 ORDER BY qtd DESC`)).rows;

  // Bairros sem nenhuma rua pavimentada (mas que possuem ruas cadastradas).
  const bairrosSemPavimentacao = pavPorBairro
    .filter((b) => b.total_ruas > 0 && (b.pct_pavimentada === 0 || b.pct_pavimentada === null))
    .map((b) => b.bairro);

  return {
    ruasResumo,
    pavPorBairro,
    bairrosPopulosos,
    totais,
    usoLotes,
    bairrosSemPavimentacao,
  };
}

/** Pontos para o mapa de calor: [lat, lng, peso]. */
export async function getHeatmap(metric) {
  let sql;
  switch (metric) {
    case 'populacao':
      sql = `SELECT ST_Y(ST_PointOnSurface(geom)) AS lat,
                    ST_X(ST_PointOnSurface(geom)) AS lng,
                    COALESCE(populacao, 0)::float AS weight
             FROM bairros WHERE geom IS NOT NULL AND populacao IS NOT NULL`;
      break;
    case 'nao_pavimentadas':
      sql = `SELECT ST_Y(ST_Centroid(geom)) AS lat,
                    ST_X(ST_Centroid(geom)) AS lng,
                    GREATEST(COALESCE(extensao_m, 1), 1)::float AS weight
             FROM ruas WHERE pavimentada IS FALSE AND geom IS NOT NULL`;
      break;
    case 'edificacoes':
      sql = `SELECT ST_Y(ST_PointOnSurface(geom)) AS lat,
                    ST_X(ST_PointOnSurface(geom)) AS lng,
                    GREATEST(COALESCE(n_pavimentos, 1), 1)::float AS weight
             FROM edificacoes WHERE geom IS NOT NULL LIMIT 30000`;
      break;
    case 'lotes':
    default:
      sql = `SELECT ST_Y(ST_PointOnSurface(geom)) AS lat,
                    ST_X(ST_PointOnSurface(geom)) AS lng,
                    1::float AS weight
             FROM lotes WHERE geom IS NOT NULL LIMIT 30000`;
      break;
  }
  const r = await query(sql);
  return r.rows
    .filter((p) => p.lat !== null && p.lng !== null)
    .map((p) => [Number(p.lat), Number(p.lng), Number(p.weight)]);
}
