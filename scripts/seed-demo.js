// Gera uma cidade ficticia ("Cidade Modelo") em grade e carrega no banco para
// que o WebGIS funcione ponta a ponta antes dos dados reais.
// Uso: npm run seed
//
// Os bairros tem coberturas de pavimentacao diferentes de proposito:
//   Centro            -> ~96% pavimentado
//   Jardim das Flores -> ~62% pavimentado
//   Vila Industrial   -> ~30% pavimentado
//   Parque Norte      -> 0% pavimentado (aparece em "bairros sem pavimentacao")
import { ensureSchema } from '../src/schema.js';
import { importFeatureCollection } from '../src/import.js';
import { closePool, isConfigured } from '../src/db.js';
import path from 'path';
import { fileURLToPath } from 'url';

const CENTER = {
  lat: Number(process.env.MAP_CENTER_LAT) || -22.0178,
  lng: Number(process.env.MAP_CENTER_LNG) || -47.8908,
};

// PRNG deterministico para que o seed seja reproduzivel.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20240614);
const rand = (min, max) => min + (max - min) * rnd();
const randint = (min, max) => Math.round(rand(min, max));
function weighted(pairs) {
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

// Conversao metros -> graus, ancorada no centro.
const MPER_LAT = 111320;
const MPER_LNG = 111320 * Math.cos((CENTER.lat * Math.PI) / 180);
const toLngLat = (dx, dy) => [CENTER.lng + dx / MPER_LNG, CENTER.lat + dy / MPER_LAT];
const rectRing = (x0, y0, x1, y1) => [[
  toLngLat(x0, y0), toLngLat(x1, y0), toLngLat(x1, y1), toLngLat(x0, y1), toLngLat(x0, y0),
]];
const polyFeature = (ring, properties) => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: ring } });
const lineFeature = (coords, properties) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords } });
const fc = (features) => ({ type: 'FeatureCollection', features });

// Parametros da grade.
const COLS = 12, ROWS = 10;
const QUADRA = 90, STREET = 16, PITCH = QUADRA + STREET;
const W = COLS * PITCH, H = ROWS * PITCH;
const OX = -W / 2, OY = -H / 2;
const HALF_W = W / 2, HALF_H = H / 2;

const BAIRROS = {
  'Centro': { pav: 0.96, pop: 8200 },
  'Jardim das Flores': { pav: 0.62, pop: 5400 },
  'Vila Industrial': { pav: 0.30, pop: 3100 },
  'Parque Norte': { pav: 0.00, pop: 2600 },
};

const BAIRRO_QUAD = {
  'Vila Industrial': [OX, OY, OX + HALF_W, OY + HALF_H],
  'Centro': [OX + HALF_W, OY, OX + W, OY + HALF_H],
  'Parque Norte': [OX, OY + HALF_H, OX + HALF_W, OY + H],
  'Jardim das Flores': [OX + HALF_W, OY + HALF_H, OX + W, OY + H],
};

function bairroOf(i, j) {
  const left = i < COLS / 2;
  const bottom = j < ROWS / 2;
  if (left && bottom) return 'Vila Industrial';
  if (!left && bottom) return 'Centro';
  if (left && !bottom) return 'Parque Norte';
  return 'Jardim das Flores';
}

const USO_WEIGHTS = {
  'Centro': [['comercial', 5], ['misto', 3], ['servicos', 2], ['residencial', 3], ['vazio', 1]],
  'Vila Industrial': [['industrial', 5], ['residencial', 3], ['comercial', 1], ['vazio', 2]],
  'Jardim das Flores': [['residencial', 7], ['comercial', 1], ['misto', 1], ['vazio', 1]],
  'Parque Norte': [['residencial', 6], ['vazio', 3], ['comercial', 1]],
};

function buildCity() {
  const quadras = [], lotes = [], edificacoes = [], ruas = [];

  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const x0 = OX + i * PITCH + STREET / 2;
      const y0 = OY + j * PITCH + STREET / 2;
      const x1 = x0 + QUADRA, y1 = y0 + QUADRA;
      const bairro = bairroOf(i, j);
      const codigo = `Q${String(i + 1).padStart(2, '0')}${String(j + 1).padStart(2, '0')}`;
      quadras.push(polyFeature(rectRing(x0, y0, x1, y1), { codigo, bairro }));

      const half = QUADRA / 2;
      let l = 0;
      for (let li = 0; li < 2; li++) {
        for (let lj = 0; lj < 2; lj++) {
          l++;
          const inset = 1.5;
          const lx0 = x0 + li * half + inset, ly0 = y0 + lj * half + inset;
          const lx1 = x0 + (li + 1) * half - inset, ly1 = y0 + (lj + 1) * half - inset;
          const uso = weighted(USO_WEIGHTS[bairro]);
          const loteCod = `${codigo}-L${l}`;
          lotes.push(polyFeature(rectRing(lx0, ly0, lx1, ly1), { codigo: loteCod, quadra: codigo, bairro, uso }));

          if (uso !== 'vazio' && rnd() < 0.85) {
            const bin = (half - 2 * inset) * 0.18;
            const nPav = uso === 'comercial' ? randint(1, 3)
              : uso === 'industrial' ? 1
              : uso === 'misto' || uso === 'servicos' ? randint(2, 4)
              : randint(1, 2);
            edificacoes.push(polyFeature(
              rectRing(lx0 + bin, ly0 + bin, lx1 - bin, ly1 - bin),
              { codigo: `E-${loteCod}`, uso, bairro, n_pavimentos: nPav }
            ));
          }
        }
      }
    }
  }

  // Ruas horizontais (uma por linha da grade, segmentada por coluna).
  for (let k = 0; k <= ROWS; k++) {
    const y = OY + k * PITCH;
    for (let i = 0; i < COLS; i++) {
      const xa = OX + i * PITCH, xb = OX + (i + 1) * PITCH;
      const bairro = bairroOf(Math.min(i, COLS - 1), Math.min(k, ROWS - 1));
      const pav = rnd() < BAIRROS[bairro].pav;
      ruas.push(lineFeature([toLngLat(xa, y), toLngLat(xb, y)], {
        nome: `Rua ${k + 1}`, bairro, pavimentada: pav,
        tipo_pavimento: pav ? weighted([['asfalto', 6], ['bloquete', 3], ['concreto', 1]]) : weighted([['terra', 7], ['leito natural', 3]]),
      }));
    }
  }
  // Ruas verticais (uma por coluna da grade, segmentada por linha).
  for (let k = 0; k <= COLS; k++) {
    const x = OX + k * PITCH;
    for (let j = 0; j < ROWS; j++) {
      const ya = OY + j * PITCH, yb = OY + (j + 1) * PITCH;
      const bairro = bairroOf(Math.min(k, COLS - 1), Math.min(j, ROWS - 1));
      const pav = rnd() < BAIRROS[bairro].pav;
      ruas.push(lineFeature([toLngLat(x, ya), toLngLat(x, yb)], {
        nome: `Av. ${String.fromCharCode(65 + (k % 26))}`, bairro, pavimentada: pav,
        tipo_pavimento: pav ? weighted([['asfalto', 6], ['bloquete', 3], ['concreto', 1]]) : weighted([['terra', 7], ['leito natural', 3]]),
      }));
    }
  }

  const bairros = Object.entries(BAIRROS).map(([nome, info]) =>
    polyFeature(rectRing(...BAIRRO_QUAD[nome]), { nome, populacao: info.pop })
  );

  return { bairros, quadras, lotes, ruas, edificacoes };
}

/** Gera e carrega a cidade de demonstracao. Reutilizado pelo servidor no boot. */
export async function seedDemo({ truncate = true, log = () => {} } = {}) {
  await ensureSchema();
  const city = buildCity();
  const result = {};
  for (const layer of ['bairros', 'quadras', 'lotes', 'ruas', 'edificacoes']) {
    const res = await importFeatureCollection(layer, fc(city[layer]), { truncate });
    result[layer] = res.inserted;
    log(`  ${layer.padEnd(12)} ${String(res.inserted).padStart(5)} feicoes`);
  }
  return result;
}

// Executa apenas quando chamado diretamente (npm run seed), nao quando importado.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  (async () => {
    if (!isConfigured) {
      console.error('DATABASE_URL nao configurada. Crie um .env a partir de .env.example.');
      process.exit(1);
    }
    console.log('Gerando "Cidade Modelo" e carregando no banco...');
    await seedDemo({ truncate: true, log: console.log });
    console.log('Seed concluido. Rode "npm start" e abra http://localhost:3000');
    await closePool();
  })().catch((e) => {
    console.error('Erro no seed:', e.message);
    process.exit(1);
  });
}
