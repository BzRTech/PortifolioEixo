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

// Campos pessoais (LGPD) que nunca devem ser armazenados em `props`.
const PII_KEYS = new Set([
  'contrib', 'contribuinte', 'cpf', 'cpf_cnpj', 'cnpj', 'endcontrib', 'numcontrib',
  'baircontri', 'cidcontrib', 'cepcontrib', 'ocupante', 'cpf_ocup', 'proprietario',
  'nome_prop', 'doc', 'rg',
]);

/** Remove campos sensiveis e valores vazios, deixando o `props` enxuto. */
function cleanProps(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (PII_KEYS.has(k.toLowerCase())) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Normaliza nome de bairro para uniformizar variacoes da fonte:
 * remove o prefixo "BAIRRO ", os acentos, deixa em maiusculas e descarta os
 * conectores (DE/DA/DO/DOS/DAS). Ex.: "Distrito de Brejinho" e
 * "Distrito Brejinho" viram "DISTRITO BREJINHO"; "Brayner Colaço" -> "BRAYNER COLACO".
 */
// Apelidos manuais (de-para) para erros de digitacao da fonte que a normalizacao
// automatica nao resolve. Chave/valor ja normalizados (sem acento, MAIUSCULAS,
// sem conectores). Adicione novos casos aqui conforme aparecerem.
const BAIRRO_ALIAS = {
  'JULINANA PIRES': 'JULIANA PIRES',
};

function normBairro(v) {
  let s = toStr(v);
  if (!s) return null;
  s = s.replace(/^bairro\s+/i, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toUpperCase()
    .replace(/\b(DE|DA|DO|DOS|DAS)\b/g, ' ')          // remove conectores
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  return BAIRRO_ALIAS[s] || s;
}

const PAV_SIM = new Set([
  'true', 't', 'sim', 's', '1', 'pavimentada', 'pavimentado', 'pavimentacao',
  'asfalto', 'asfaltada', 'asfaltado', 'asfaltico', 'revestimento asfaltico',
  'revestimento asfáltico', 'calcamento', 'calçamento', 'bloquete',
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
      nome: normBairro(pick(p, ['nome', 'name', 'bairro', 'nm_bairro', 'no_bairro', 'bairro_nome'])),
      populacao: toInt(pick(p, ['populacao', 'população', 'pop', 'habitantes', 'qt_pop', 'populacao_estimada', 'population'])),
      area_m2: toNum(pick(p, ['area_m2', 'area', 'shape_area', 'st_area', 'area_total'])),
    }),
  },
  quadras: {
    columns: ['codigo', 'bairro', 'area_m2'],
    map: (p) => ({
      codigo: toStr(pick(p, ['codigo', 'código', 'code', 'quadra', 'cod_quadra', 'id_quadra', 'numero'])),
      bairro: normBairro(pick(p, ['bairro', 'nm_bairro', 'no_bairro', 'neighborhood'])),
      area_m2: toNum(pick(p, ['area_m2', 'area', 'shape_area', 'st_area'])),
    }),
  },
  lotes: {
    columns: ['codigo', 'quadra', 'bairro', 'uso', 'area_m2'],
    map: (p) => {
      const st = toStr(pick(p, ['st', 'setor']));
      const qd = toStr(pick(p, ['quadra', 'qd', 'cod_quadra', 'id_quadra', 'block']));
      const lt = toStr(pick(p, ['lt', 'lote']));
      const cod = toStr(pick(p, ['codigo', 'código', 'code', 'inscricao', 'inscrição', 'insc_geral', 'matricula', 'id_lote']));
      return {
        // Usa o codigo direto; se ausente, compoe Setor.Quadra.Lote.
        codigo: cod || ([st, qd, lt].some(Boolean) ? [st, qd, lt].filter(Boolean).join('-') : null),
        quadra: qd,
        bairro: normBairro(pick(p, ['bairro', 'nm_bairro', 'no_bairro', 'neighborhood'])),
        uso: toStr(pick(p, ['uso', 'use', 'uso_solo', 'uso_do_solo', 'categoria', 'tipo_uso', 'land_use'])),
        area_m2: toNum(pick(p, ['area_m2', 'area', 'arealote', 'area_lote', 'shape_area', 'st_area'])),
      };
    },
  },
  ruas: {
    columns: ['codigo', 'nome', 'bairro', 'pavimentada', 'tipo_pavimento', 'extensao_m'],
    map: (p) => {
      const tipo = toStr(pick(p, ['tipo_pavimento', 'pavimento', 'tipo_pav', 'revestimento', 'surface', 'tipo']));
      // Le a situacao (pavimentada/nao) de varios campos; se ausente, infere do tipo.
      let pav = toBool(pick(p, ['pavimentada', 'pavimentado', 'paviment', 'pavimentacao', 'pavimentação', 'paved', 'situacao_pavimento', 'status', 'situacao']));
      if (pav === null && tipo) pav = toBool(tipo);
      return {
        // Codigo UNITARIO da via (logradouro). As feicoes sao trechos; varios
        // trechos compartilham o mesmo codigo. NAO usar id_trecho aqui.
        codigo: toStr(pick(p, ['id_rua', 'cod_rua', 'codigo', 'cod_logradouro', 'cod_logr', 'cod_via', 'id_logradouro'])),
        nome: toStr(pick(p, ['nome', 'name', 'logradouro', 'rua', 'nm_rua', 'descricao', 'nm_logr'])),
        bairro: normBairro(pick(p, ['bairro', 'nm_bairro', 'no_bairro', 'neighborhood'])),
        pavimentada: pav,
        tipo_pavimento: tipo,
        // COMP_TRECH/COMP_RUA em metros; evita Shape_Leng (vem em graus).
        extensao_m: toNum(pick(p, ['extensao_m', 'extensao', 'extensão', 'comp_trech', 'comp_rua', 'comprimento', 'length', 'st_length'])),
      };
    },
  },
  edificacoes: {
    columns: ['codigo', 'uso', 'bairro', 'n_pavimentos', 'area_m2'],
    map: (p) => ({
      codigo: toStr(pick(p, ['codigo', 'código', 'code', 'objectid', 'id_edif', 'fid_1', 'inscricao', 'matricula'])),
      uso: toStr(pick(p, ['uso', 'use', 'tipo_uso', 'categoria', 'finalidade'])),
      bairro: normBairro(pick(p, ['bairro', 'nm_bairro', 'no_bairro', 'neighborhood'])),
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
  const { truncate = false, municipio = null, batchSize = 200, onProgress } = options;
  const cols = mapper.columns;
  const multiType = GEOM_MULTI[layer];

  let inserted = 0;
  let skipped = 0;

  await withTransaction(async (client) => {
    if (truncate) {
      // Com municipio, substitui apenas os dados daquela cidade (preserva as outras).
      if (municipio) {
        await client.query(`DELETE FROM ${layer} WHERE municipio = $1`, [municipio]);
      } else {
        await client.query(`TRUNCATE ${layer} RESTART IDENTITY`);
      }
    }

    const rows = [];
    for (const feat of features) {
      if (!feat || !feat.geometry) { skipped++; continue; }
      const rawProps = feat.properties || {};
      const mapped = mapper.map(rawProps);
      const values = cols.map((c) => mapped[c]);
      rows.push({ values, props: cleanProps(rawProps), geometry: feat.geometry });
    }

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      await insertChunk(client, layer, cols, multiType, chunk, municipio);
      inserted += chunk.length;
      if (onProgress) onProgress(inserted, rows.length);
    }
  });

  // Preenche area/extensao geografica (em metros) quando ausente (escopo do municipio).
  const scope = municipio ? 'municipio = $1' : 'TRUE';
  const scopeParams = municipio ? [municipio] : [];
  if (layer === 'ruas') {
    await query(`UPDATE ruas SET extensao_m = ST_Length(geom::geography)
                 WHERE extensao_m IS NULL AND geom IS NOT NULL AND ${scope}`, scopeParams);
  } else {
    await query(`UPDATE ${layer} SET area_m2 = ST_Area(geom::geography)
                 WHERE area_m2 IS NULL AND geom IS NOT NULL AND ${scope}`, scopeParams);
  }

  return { inserted, skipped };
}

async function insertChunk(client, table, cols, multiType, chunk, municipio) {
  const colList = [...cols, 'municipio', 'props', 'geom'].join(', ');
  const valuesSql = [];
  const params = [];
  let n = 0;

  for (const row of chunk) {
    const placeholders = [];
    for (const v of row.values) {
      params.push(v === undefined ? null : v);
      placeholders.push(`$${++n}`);
    }
    // municipio
    params.push(municipio || null);
    placeholders.push(`$${++n}`);
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
