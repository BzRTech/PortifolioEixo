// Camada de acesso ao banco PostgreSQL + PostGIS.
// Usa node-postgres (pg) com pool de conexoes. Funciona tanto com o Neon
// (string de conexao com ?sslmode=require) quanto com um Postgres local.
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || '';
export const isConfigured = Boolean(connectionString);

function sslConfig(cs) {
  if (!cs) return false;
  const isLocal = /@(localhost|127\.0\.0\.1|::1|host\.docker\.internal)/.test(cs);
  const sslDisabled = /sslmode=disable/.test(cs);
  if (isLocal || sslDisabled) return false;
  // Neon e a maioria dos provedores gerenciados exigem SSL.
  return { rejectUnauthorized: false };
}

let pool = null;
if (isConfigured) {
  pool = new Pool({
    connectionString,
    ssl: sslConfig(connectionString),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (err) => console.error('[db] erro no pool:', err.message));
}

export function getPool() {
  if (!pool) {
    throw new Error('DATABASE_URL nao configurada. Defina a variavel de ambiente.');
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

/** Executa uma funcao dentro de uma transacao com um client dedicado. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function healthcheck() {
  if (!isConfigured) {
    return { ok: false, reason: 'DATABASE_URL nao configurada' };
  }
  try {
    const r = await query('SELECT current_database() AS db, version() AS version');
    let postgis = null;
    try {
      const p = await query('SELECT postgis_version() AS v');
      postgis = p.rows[0].v;
    } catch {
      postgis = null; // PostGIS ainda nao instalado
    }
    return { ok: true, db: r.rows[0].db, postgis };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export async function closePool() {
  if (pool) await pool.end();
}
