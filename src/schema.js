// Definicao do schema PostGIS. As tabelas guardam as colunas "uteis" para o
// dashboard, um campo `municipio` (para multiplas cidades) e um campo `props`
// (JSONB) com todas as propriedades originais do GeoJSON.
import { query, isConfigured } from './db.js';

export const LAYERS = ['bairros', 'quadras', 'lotes', 'ruas', 'edificacoes'];

const STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS postgis`,

  `CREATE TABLE IF NOT EXISTS bairros (
     id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     municipio  TEXT,
     nome       TEXT,
     populacao  INTEGER,
     area_m2    DOUBLE PRECISION,
     props      JSONB NOT NULL DEFAULT '{}'::jsonb,
     geom       geometry(MultiPolygon, 4326)
   )`,

  `CREATE TABLE IF NOT EXISTS quadras (
     id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     municipio  TEXT,
     codigo     TEXT,
     bairro     TEXT,
     area_m2    DOUBLE PRECISION,
     props      JSONB NOT NULL DEFAULT '{}'::jsonb,
     geom       geometry(MultiPolygon, 4326)
   )`,

  `CREATE TABLE IF NOT EXISTS lotes (
     id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     municipio  TEXT,
     codigo     TEXT,
     quadra     TEXT,
     bairro     TEXT,
     uso        TEXT,
     area_m2    DOUBLE PRECISION,
     props      JSONB NOT NULL DEFAULT '{}'::jsonb,
     geom       geometry(MultiPolygon, 4326)
   )`,

  `CREATE TABLE IF NOT EXISTS ruas (
     id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     municipio       TEXT,
     codigo          TEXT,
     nome            TEXT,
     bairro          TEXT,
     pavimentada     BOOLEAN,
     tipo_pavimento  TEXT,
     extensao_m      DOUBLE PRECISION,
     props           JSONB NOT NULL DEFAULT '{}'::jsonb,
     geom            geometry(MultiLineString, 4326)
   )`,

  `CREATE TABLE IF NOT EXISTS edificacoes (
     id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     municipio     TEXT,
     codigo        TEXT,
     uso           TEXT,
     bairro        TEXT,
     n_pavimentos  INTEGER,
     area_m2       DOUBLE PRECISION,
     props         JSONB NOT NULL DEFAULT '{}'::jsonb,
     geom          geometry(MultiPolygon, 4326)
   )`,

  // Migracao: adiciona `municipio` em bancos criados antes desta versao.
  `ALTER TABLE bairros     ADD COLUMN IF NOT EXISTS municipio TEXT`,
  `ALTER TABLE quadras     ADD COLUMN IF NOT EXISTS municipio TEXT`,
  `ALTER TABLE lotes       ADD COLUMN IF NOT EXISTS municipio TEXT`,
  `ALTER TABLE ruas        ADD COLUMN IF NOT EXISTS municipio TEXT`,
  `ALTER TABLE edificacoes ADD COLUMN IF NOT EXISTS municipio TEXT`,
  `ALTER TABLE ruas        ADD COLUMN IF NOT EXISTS codigo TEXT`,

  `CREATE INDEX IF NOT EXISTS idx_bairros_geom      ON bairros      USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_quadras_geom      ON quadras      USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_lotes_geom        ON lotes        USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_ruas_geom         ON ruas         USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_edificacoes_geom  ON edificacoes  USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_ruas_bairro       ON ruas         (bairro)`,
  `CREATE INDEX IF NOT EXISTS idx_ruas_pav          ON ruas         (pavimentada)`,
  `CREATE INDEX IF NOT EXISTS idx_lotes_bairro      ON lotes        (bairro)`,
  `CREATE INDEX IF NOT EXISTS idx_bairros_municipio     ON bairros      (municipio)`,
  `CREATE INDEX IF NOT EXISTS idx_quadras_municipio     ON quadras      (municipio)`,
  `CREATE INDEX IF NOT EXISTS idx_lotes_municipio       ON lotes        (municipio)`,
  `CREATE INDEX IF NOT EXISTS idx_ruas_municipio        ON ruas         (municipio)`,
  `CREATE INDEX IF NOT EXISTS idx_edificacoes_municipio ON edificacoes  (municipio)`,
];

export async function ensureSchema() {
  if (!isConfigured) return false;
  for (const stmt of STATEMENTS) {
    await query(stmt);
  }
  return true;
}
