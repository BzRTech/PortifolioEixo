// Importacao de GeoJSON para o banco PostGIS.
// Faz o "de-para" das propriedades mais comuns (em PT-BR e EN) para as colunas
// das tabelas e preserva todas as propriedades originais no campo `props`.
import { withTransaction, query } from './db.js';

// ---------------------------------------------------------------------------
// Helpers de leitura/normalizacao de propriedades
// ---------------------------------------------------------------------------

/** Busca o primeiro valor presente entre varias chaves, ignorando caixa. */
function pick(props, keys) {
  if (!props) return undefined;
  const lower = {};
  for (const k of Object.keys(props)) lower[k.toLowerCase()] = props[k];
  for (const key of keys) {
    const v = lower[key.toLowerCase()];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (s === '') return null;
  // Trata formato pt-BR "1.234,56" -> 1234.56
  if (/,/.test(s) && /\.\d{3}(\D|$)/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toInt(v) {
  const n = toNum(v);
  return n === null ? null : Math.round(n);
}

function toStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

const PAV_SIM = new Set([
  'true', 't', 'sim', 's', '1', 'pavimentada', 'pavimentado', 'pavimentacao',
  'asfalto', 'asfaltada', 'asfaltado', 'calcamento', 'calçamento', 'bloquete',
  'paralelepipedo', 'paralelepípedo', 'concreto', 'intertravado',
]);
const PAV_NAO = new Set([
  'false', 'f', 'nao', 'não', 'n', '0', 'sem pavimentacao', 'sem pavimentação',
  'nao pavimentada', 'não pavimentada', 'terra', 'leito natural', 'chao', 'chão',
  'nenhum', 'nenhuma', 'sem',
]);

function toBool(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (PAV_SIM.has(s)) return true;
  if (PAV_NAO.has(s)) return false;
  return null;
}

// ---------------------------------------------------------------------------
// Mapeamento por camada: (props) -> { colunas... }
// ---------------------------------------------------------------------------

const MAPPERS = {
  bairros: {
    columns: ['nome', 'populacao', 'area_m2'],
    map: (p) => ({
      nome: toStr(pick(p, ['nome', 'name', 'bairro', 'nm_bairro', 'no_bairro', 'bairro_nome'])),
      populacao: toInt(pick(p, ['populacao', 'população', 'pop', 'habitantes', 'qt_pop', 'populacao_estimada', 'population'])),
      area_m2: toNum(pick(p, ['area_m2', 'area', 'shape_area', 'st_area', 'area_total'])),
    }),
  },
  quadras: {
    columns: ['codigo', 'bairro', 'area_m2'],
    map: (p) => ({
      codigo: toStr(pick(p, ['codigo', 'código', 'code', 'quadra', 'cod_quadra', 'id_quadra', 'numero'])),
      bairro: toStr(pick(p, ['bairro', 'nm_bairro', 'no_bairro', 'neighborhood'])),
      area_m2: toNum(pick(p, ['area_m2', 'area', 'shape_area', 'st_area'])),
    }),
  },
  lotes: {
    columns: ['codigo', 'quadra', 'bairro', 'uso', 'area_m2'],
    map: (p) => ({
      codigo: toStr(pick(p, ['codigo', 'código', 'code', 'lote', 'inscricao', 'inscrição', 'matricula', 'id_lote'])),
      quadra: toStr(pick(p, ['quadra', 'cod_quadra', 'id_quadra', 'block'])),
      bairro: toStr(pick(p, ['bairro', 'nm_bairro', 'no_bairro', 'neighborhood'])),
      uso: toStr(pick(p, ['uso', 'use', 'uso_solo', 'uso_do_solo', 'categoria', 'tipo_uso', 'land_use'])),
      area_m2: toNum(pick(p, ['area_m2', 'area', 'shape_area', 'st_area', 'area_lote'])),
    }),
  },
  ruas: {
    columns: ['nome', 'bairro', 'pavimentada', 'tipo_pavimento', 'extensao_m'],
    map: (p) => {
      const tipo = toStr(pick(p, ['tipo_pavimento', 'pavimento', 'tipo_pav', 'revestimento', 'surface', 'tipo']));
      let pav = toBool(pick(p, ['pavimentada', 'pavimentado', 'paviment', 'pavimentacao', 'pavimentação', 'paved', 'situacao_pavimento']));
      if (pav === null && tipo) pav = toBool(tipo); // infere a partir do tipo de pavimento
      return {
        nome: toStr(pick(p, ['nome', 'name', 'logradouro', 'rua', 'nm_rua', 'descricao', 'nm_logr'])),
        bairro: toStr(pick(p, ['bairro', 'nm_bairro', 'no_bairro', 'neighborhood'])),
        pavimentada: pav,
        tipo_pavimento: tipo,
        extensao_m: toNum(pick(p, ['extensao_m', 'extensao', 'extensão', 'comprimento', 'length', 'shape_leng', 'st_length'])),
      };
    },
  },
  edificacoes: {
    columns: ['codigo', 'uso', 'bairro', 'n_pavimentos', 'area_m2'],
    map: (p) => ({
      codigo: toStr(pick(p, ['codigo', 'código', 'code', 'id_edif', 'inscricao', 'matricula'])),
      uso: toStr(pick(p, ['uso', 'use', 'tipo_uso', 'categoria', 'finalidade'])),
      bairro: toStr(pick(p, ['bairro', 'nm_bairro', 'no_bairro', 'neighborhood'])),
      n_pavimentos: toInt(pick(p, ['n_pavimentos', 'pavimentos', 'andares', 'n_andares', 'floors', 'num_pav', 'qt_pavimentos'])),
      area_m2: toNum(pick(p, ['area_m2', 'area', 'shape_area', 'st_area', 'area_construida'])),
    }),
  },
};

const GEOM_MULTI = {
  bairros: 'MultiPolygon',
  quadras: 'MultiPolygon',
  lotes: 'MultiPolygon',
  ruas: 'MultiLineString',
  edificacoes: 'MultiPolygon',
};

export const IMPORT_LAYERS = Object.keys(MAPPERS);

/** Detecta a camada a partir do nome do arquivo. */
export function detectLayer(filename) {
  const f = filename.toLowerCase();
  if (/bairro|neighborhood|distrit/.test(f)) return 'bairros';
  if (/quadra|block/.test(f)) return 'quadras';
  if (/lote|parcel|parcela/.test(f)) return 'lotes';
  if (/rua|via|logr|street|road|eixo/.test(f)) return 'ruas';
  if (/edific|edifica|build|constru|imovel|imóvel/.test(f)) return 'edificacoes';
  return null;
}

/**
 * Importa um FeatureCollection (objeto JS) para a tabela da camada indicada.
 * @returns { inserted, skipped }
 */
export async function importFeatureCollection(layer, featureCollection, options = {}) {
  const mapper = MAPPERS[layer];
  if (!mapper) throw new Error('Camada invalida: ' + layer);

  const features = (featureCollection && featureCollection.features) || [];
  const { truncate = false, batchSize = 200, onProgress } = options;
  const cols = mapper.columns;
  const multiType = GEOM_MULTI[layer];

  let inserted = 0;
  let skipped = 0;

  await withTransaction(async (client) => {
    if (truncate) {
      await client.query(`TRUNCATE ${layer} RESTART IDENTITY`);
    }

    const rows = [];
    for (const feat of features) {
      if (!feat || !feat.geometry) { skipped++; continue; }
      const props = feat.properties || {};
      const mapped = mapper.map(props);
      const values = cols.map((c) => mapped[c]);
      rows.push({ values, props, geometry: feat.geometry });
    }

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      await insertChunk(client, layer, cols, multiType, chunk);
      inserted += chunk.length;
      if (onProgress) onProgress(inserted, rows.length);
    }
  });

  // Preenche area/extensao geografica (em metros) quando ausente.
  if (layer === 'ruas') {
    await query(`UPDATE ruas SET extensao_m = ST_Length(geom::geography)
                 WHERE extensao_m IS NULL AND geom IS NOT NULL`);
  } else {
    await query(`UPDATE ${layer} SET area_m2 = ST_Area(geom::geography)
                 WHERE area_m2 IS NULL AND geom IS NOT NULL`);
  }

  return { inserted, skipped };
}

async function insertChunk(client, table, cols, multiType, chunk) {
  const colList = [...cols, 'props', 'geom'].join(', ');
  const valuesSql = [];
  const params = [];
  let n = 0;

  for (const row of chunk) {
    const placeholders = [];
    for (const v of row.values) {
      params.push(v === undefined ? null : v);
      placeholders.push(`$${++n}`);
    }
    // props (jsonb)
    params.push(JSON.stringify(row.props || {}));
    placeholders.push(`$${++n}::jsonb`);
    // geom -> ST_Multi para uniformizar Polygon/MultiPolygon e Line/MultiLine
    params.push(JSON.stringify(row.geometry));
    placeholders.push(
      `ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($${++n}), 4326)), ${
        multiType === 'MultiLineString' ? 2 : 3
      }))`
    );
    valuesSql.push(`(${placeholders.join(', ')})`);
  }

  const sql = `INSERT INTO ${table} (${colList}) VALUES ${valuesSql.join(', ')}`;
  await client.query(sql, params);
}
