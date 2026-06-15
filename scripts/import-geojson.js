// Importa arquivos GeoJSON para as tabelas PostGIS.
//
// Exemplos:
//   npm run import -- --file data/ruas.geojson
//   npm run import -- --file data/ruas.geojson --layer ruas --truncate
//   npm run import -- --dir data/ --truncate
//
// A camada e detectada pelo nome do arquivo quando --layer nao e informado.
import fs from 'fs';
import path from 'path';
import { ensureSchema } from '../src/schema.js';
import { importFeatureCollection, detectLayer, IMPORT_LAYERS } from '../src/import.js';
import { closePool, isConfigured } from '../src/db.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function loadFeatureCollection(filePath) {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (json.type === 'FeatureCollection') return json;
  if (json.type === 'Feature') return { type: 'FeatureCollection', features: [json] };
  if (Array.isArray(json)) return { type: 'FeatureCollection', features: json };
  if (Array.isArray(json.features)) return json;
  throw new Error('Arquivo nao parece ser um GeoJSON valido: ' + filePath);
}

async function importFile(filePath, layerArg, truncate, municipio) {
  const layer = layerArg && layerArg !== true ? layerArg : detectLayer(path.basename(filePath));
  if (!layer || !IMPORT_LAYERS.includes(layer)) {
    throw new Error(
      `Nao foi possivel detectar a camada de "${path.basename(filePath)}". ` +
      `Use --layer <${IMPORT_LAYERS.join('|')}>.`
    );
  }
  const fc = loadFeatureCollection(filePath);
  const total = (fc.features || []).length;
  process.stdout.write(`  ${path.basename(filePath)} -> ${layer} (${total} feicoes) ... `);
  const res = await importFeatureCollection(layer, fc, { truncate, municipio });
  console.log(`OK: ${res.inserted} inseridas, ${res.skipped} ignoradas (sem geometria).`);
}

(async () => {
  if (!isConfigured) {
    console.error('DATABASE_URL nao configurada. Crie um .env a partir de .env.example.');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const truncate = Boolean(args.truncate);

  let files = [];
  if (args.dir && args.dir !== true) {
    files = fs.readdirSync(args.dir)
      .filter((f) => /\.(geojson|json)$/i.test(f))
      .map((f) => path.join(args.dir, f));
  } else if (args.file && args.file !== true) {
    files = [args.file];
  } else if (args._.length) {
    files = args._;
  }

  if (!files.length) {
    console.log(`Uso:
  npm run import -- --file data/ruas.geojson [--layer ruas] [--municipio "Tabira"] [--truncate]
  npm run import -- --dir data/ --municipio "Tabira" --truncate

Camadas disponiveis: ${IMPORT_LAYERS.join(', ')}
A camada e detectada pelo nome do arquivo se --layer nao for informado.
Com --municipio, os dados sao marcados com a cidade; --truncate substitui
apenas aquela cidade (sem --municipio, --truncate limpa a tabela inteira).`);
    process.exit(0);
  }

  const municipio = args.municipio && args.municipio !== true ? String(args.municipio) : null;
  await ensureSchema();
  console.log(`Importando ${files.length} arquivo(s)`
    + `${municipio ? ` para o municipio "${municipio}"` : ''}`
    + `${truncate ? (municipio ? ' (substituindo a cidade)' : ' (truncando tabelas)') : ''}:`);
  for (const f of files) {
    await importFile(f, args.layer, truncate, municipio);
  }
  console.log('Concluido.');
  await closePool();
})().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
