// Definicao do schema PostGIS. As tabelas guardam as colunas "uteis" para o
// dashboard e mantêm um campo `props` (JSONB) com todas as propriedades
// originais do GeoJSON, garantindo importacao sem perda de informacao.
import { query, isConfigured } from './db.js';

export const LAYERS = ['bairros', 'quadras', 'lotes', 'ruas', 'edificacoes'];

const STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS postgis`,

  `CREATE TABLE IF NOT EXISTS bairros (
     id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     nome       TEXT,
     populacao  INTEGER,
     area_m2    DOUBLE PRECISION,
     props      JSONB NOT NULL DEFAULT '{}'::jsonb,
     geom       geometry(MultiPolygon, 4326)
   )`,

  `CREATE TABLE IF NOT EXISTS quadras (
     id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     codigo     TEXT,
     bairro     TEXT,
     area_m2    DOUBLE PRECISION,
     props      JSONB NOT NULL DEFAULT '{}'::jsonb,
     geom       geometry(MultiPolygon, 4326)
   )`,

  `CREATE TABLE IF NOT EXISTS lotes (
     id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
     codigo        TEXT,
     uso           TEXT,
     bairro        TEXT,
     n_pavimentos  INTEGER,
     area_m2       DOUBLE PRECISION,
     props         JSONB NOT NULL DEFAULT '{}'::jsonb,
     geom          geometry(MultiPolygon, 4326)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_bairros_geom      ON bairros      USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_quadras_geom      ON quadras      USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_lotes_geom        ON lotes        USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_ruas_geom         ON ruas         USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_edificacoes_geom  ON edificacoes  USING GIST (geom)`,
  `CREATE INDEX IF NOT EXISTS idx_ruas_bairro       ON ruas         (bairro)`,
  `CREATE INDEX IF NOT EXISTS idx_ruas_pav          ON ruas         (pavimentada)`,
  `CREATE INDEX IF NOT EXISTS idx_lotes_bairro      ON lotes        (bairro)`,
];

export async function ensureSchema() {
  if (!isConfigured) return false;
  for (const stmt of STATEMENTS) {
    await query(stmt);
  }
  return true;
}
