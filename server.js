// Servidor Express: serve o front-end estatico, a API de dados (GeoJSON,
// dashboard, mapa de calor) e, opcionalmente, os tiles XYZ da ortofoto.
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { isConfigured, healthcheck } from './src/db.js';
import { ensureSchema } from './src/schema.js';
import {
  isValidLayer, getLayerGeoJSON, getDashboard, getHeatmap,
  getExtent, getCounts, getBairros,
} from './src/queries.js';
import { seedDemo } from './scripts/seed-demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ---- Tiles locais da ortofoto (opcional) ---------------------------------
const localTilesDir = path.join(__dirname, 'tiles');
const hasLocalOrtho = fs.existsSync(path.join(localTilesDir, 'ortho'));
const serveLocalTiles = String(process.env.SERVE_LOCAL_TILES || 'true') === 'true';
if (serveLocalTiles && fs.existsSync(localTilesDir)) {
  app.use('/tiles', express.static(localTilesDir, { maxAge: '7d', fallthrough: true }));
}

// ---- Front-end estatico ---------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---- Configuracao publica para o front ------------------------------------
function buildPublicConfig() {
  let orthoUrl = process.env.ORTHO_TILE_URL || '';
  if (!orthoUrl && hasLocalOrtho) orthoUrl = '/tiles/ortho/{z}/{x}/{y}.png';
  return {
    appName: 'Eixo WebGIS',
    map: {
      center: [Number(process.env.MAP_CENTER_LAT) || -22.0178, Number(process.env.MAP_CENTER_LNG) || -47.8908],
      zoom: Number(process.env.MAP_ZOOM) || 14,
      minZoom: 3,
      maxZoom: 22,
    },
    ortho: {
      url: orthoUrl || null,
      attribution: process.env.ORTHO_TILE_ATTRIBUTION || 'Ortofoto municipal',
      minZoom: Number(process.env.ORTHO_TILE_MINZOOM) || 0,
      maxZoom: Number(process.env.ORTHO_TILE_MAXZOOM) || 22,
    },
    layers: [
      { id: 'bairros', label: 'Bairros', kind: 'polygon' },
      { id: 'quadras', label: 'Quadras', kind: 'polygon' },
      { id: 'lotes', label: 'Lotes', kind: 'polygon' },
      { id: 'edificacoes', label: 'Edificacoes', kind: 'polygon' },
      { id: 'ruas', label: 'Ruas', kind: 'line' },
    ],
    dbConfigured: isConfigured,
  };
}

// ---- Helpers --------------------------------------------------------------
function requireDb(res) {
  if (!isConfigured) {
    res.status(503).json({ error: 'Banco de dados nao configurado. Defina DATABASE_URL.' });
    return false;
  }
  return true;
}

const asyncRoute = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[api]', req.path, err.message);
    res.status(500).json({ error: err.message });
  });
};

function parseBbox(value) {
  if (!value) return undefined;
  const parts = String(value).split(',').map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : undefined;
}

// ---- Rotas da API ---------------------------------------------------------
app.get('/api/health', asyncRoute(async (req, res) => {
  const hc = await healthcheck();
  res.status(hc.ok ? 200 : 503).json(hc);
}));

app.get('/api/config', (req, res) => res.json(buildPublicConfig()));

app.get('/api/counts', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  res.json(await getCounts());
}));

app.get('/api/bairros', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  res.json(await getBairros());
}));

app.get('/api/extent', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  res.json({ extent: await getExtent() });
}));

app.get('/api/dashboard', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  res.json(await getDashboard());
}));

app.get('/api/heatmap', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  const metric = String(req.query.metric || 'populacao');
  res.json({ metric, points: await getHeatmap(metric) });
}));

app.get('/api/layers/:layer', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  const { layer } = req.params;
  if (!isValidLayer(layer)) {
    return res.status(404).json({ error: 'Camada invalida: ' + layer });
  }
  const fc = await getLayerGeoJSON(layer, {
    bbox: parseBbox(req.query.bbox),
    bairro: req.query.bairro ? String(req.query.bairro) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    simplify: req.query.simplify ? Number(req.query.simplify) : undefined,
  });
  res.json(fc);
}));

// ---- Boot -----------------------------------------------------------------
async function start() {
  if (isConfigured) {
    try {
      await ensureSchema();
      console.log('[db] schema verificado.');
      // Auto-seed opcional: util para um deploy de demonstracao sem shell.
      if (String(process.env.SEED_DEMO || '') === 'true') {
        const counts = await getCounts();
        const total = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
        if (total === 0) {
          console.log('[db] SEED_DEMO=true e banco vazio — carregando cidade de demonstracao...');
          await seedDemo({ truncate: true, log: console.log });
          console.log('[db] seed de demonstracao concluido.');
        }
      }
    } catch (e) {
      console.error('[db] nao foi possivel preparar o schema:', e.message);
    }
  } else {
    console.warn('[db] DATABASE_URL nao definida — a API de dados respondera 503 ate configurar.');
  }
  app.listen(PORT, () => {
    console.log(`Eixo WebGIS rodando em http://localhost:${PORT}`);
  });
}

start();
