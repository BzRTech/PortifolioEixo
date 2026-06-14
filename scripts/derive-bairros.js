// Deriva a camada de bairros dissolvendo quadras (ou lotes) pelo campo BAIRRO.
// Util quando o municipio nao fornece um GeoJSON proprio de bairros.
// Uso: npm run derive-bairros
import { query, closePool, isConfigured } from '../src/db.js';
import { ensureSchema } from '../src/schema.js';

(async () => {
  if (!isConfigured) {
    console.error('DATABASE_URL nao configurada. Crie um .env a partir de .env.example.');
    process.exit(1);
  }
  await ensureSchema();

  // Prefere quadras (menos geometrias, fronteiras mais limpas); cai para lotes.
  const q = await query("SELECT COUNT(*)::int AS c FROM quadras WHERE bairro IS NOT NULL AND bairro <> ''");
  const source = q.rows[0].c > 0 ? 'quadras' : 'lotes';
  console.log(`Derivando bairros a partir de "${source}" (dissolve por bairro)...`);

  await query('TRUNCATE bairros RESTART IDENTITY');
  const r = await query(`
    INSERT INTO bairros (nome, props, geom)
    SELECT bairro,
           jsonb_build_object('origem', '${source}', '${source}', COUNT(*)),
           ST_Multi(ST_Union(geom))
    FROM ${source}
    WHERE bairro IS NOT NULL AND bairro <> ''
    GROUP BY bairro
    RETURNING nome`);

  await query('UPDATE bairros SET area_m2 = ST_Area(geom::geography) WHERE area_m2 IS NULL');
  console.log(`OK: ${r.rowCount} bairros derivados.`);
  console.log('Obs.: populacao fica vazia (nao havia dado demografico nos lotes).');
  await closePool();
})().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
