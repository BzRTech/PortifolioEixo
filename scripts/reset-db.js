// Limpa todas as tabelas de dados (mantem o schema). Util antes de importar
// um conjunto novo de GeoJSON ou para remover os dados de demonstracao.
// Uso: npm run reset-db
import { query, closePool, isConfigured } from '../src/db.js';
import { ensureSchema, LAYERS } from '../src/schema.js';

(async () => {
  if (!isConfigured) {
    console.error('DATABASE_URL nao configurada. Crie um .env a partir de .env.example.');
    process.exit(1);
  }
  await ensureSchema();
  await query(`TRUNCATE ${LAYERS.join(', ')} RESTART IDENTITY`);
  console.log('Tabelas limpas:', LAYERS.join(', '));
  await closePool();
})().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
