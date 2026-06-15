// Orquestrador da aplicacao: configuracao, controles, filtros (municipio e
// bairro), camadas sob demanda e dashboard.
import { api } from './api.js';
import { gis } from './map.js';
import { renderDashboard } from './dashboard.js';

const SWATCH_COLOR = {
  bairros: '#e6bb00', quadras: '#5b7290', lotes: '#38bdf8', edificacoes: '#a78bfa', ruas: '#34d399',
};
const DEFAULT_ON = ['bairros', 'ruas'];
const LAYER_IDS = ['bairros', 'quadras', 'lotes', 'edificacoes', 'ruas'];

const els = {
  basemaps: document.getElementById('basemaps'),
  overlays: document.getElementById('overlays'),
  heatToggle: document.getElementById('heat-toggle'),
  heatMetric: document.getElementById('heat-metric'),
  filtro: document.getElementById('filtro-bairro'),
  filtroMunicipio: document.getElementById('filtro-municipio'),
  campoMunicipio: document.getElementById('campo-municipio'),
  btnDash: document.getElementById('btn-dashboard'),
  btnCamadas: document.getElementById('btn-camadas'),
  controls: document.getElementById('controls'),
  dash: document.getElementById('dashboard'),
  dashClose: document.getElementById('dashboard-close'),
  msg: document.getElementById('overlay-msg'),
  msgCard: document.getElementById('overlay-card'),
};

const loadedKey = {}; // id -> chave de escopo (municipio||bairro) ja carregada
let currentMunicipio = '';
let currentBairro = '';
const scopeKey = () => currentMunicipio + '||' + currentBairro;

function showMessage(html) { els.msgCard.innerHTML = html; els.msg.hidden = false; }
function hideMessage() { els.msg.hidden = true; }

const swatchHtml = (id) => id === 'ruas'
  ? `<span class="swatch line" style="background:${SWATCH_COLOR.ruas}"></span>`
  : `<span class="swatch" style="background:${SWATCH_COLOR[id] || '#94a3b8'}"></span>`;

const scopeArg = () => currentMunicipio || undefined;

async function showOverlay(id) {
  if (loadedKey[id] !== scopeKey()) {
    const data = await api.layer(id, { municipio: scopeArg(), bairro: currentBairro || undefined });
    gis.setOverlayData(id, data);
    loadedKey[id] = scopeKey();
  }
  gis.toggleOverlay(id, true);
}
function hideOverlay(id) { gis.toggleOverlay(id, false); }

async function refreshHeat() {
  if (!els.heatToggle.checked) { gis.clearHeat(); return; }
  try {
    const { points } = await api.heatmap(els.heatMetric.value, scopeArg());
    gis.setHeat(points, els.heatMetric.value);
  } catch (e) { console.error('heatmap:', e.message); }
}

async function loadBairrosList() {
  try {
    const bairros = await api.bairros(scopeArg());
    els.filtro.innerHTML = '<option value="">Todos os bairros</option>' +
      bairros.map((b) => `<option value="${b}">${b}</option>`).join('');
  } catch { /* segue sem filtro */ }
}

async function refitExtent() {
  try {
    const { extent } = await api.extent(scopeArg());
    if (extent) { gis.fit(extent); gis.setOrthoBounds(extent); }
  } catch { /* usa centro padrao */ }
}

async function loadDashboard() {
  try { renderDashboard(await api.dashboard(scopeArg())); }
  catch (e) { console.error('dashboard:', e.message); }
}

async function reloadVisibleOverlays() {
  for (const id of Object.keys(loadedKey)) loadedKey[id] = null; // invalida cache
  for (const id of LAYER_IDS) if (gis.isOn(id)) await showOverlay(id);
}

// Troca de bairro: recarrega as camadas ativas com o novo filtro.
async function applyBairro() {
  currentBairro = els.filtro.value;
  await reloadVisibleOverlays();
}

// Troca de municipio: reseta bairro, recarrega lista/extensao/camadas/painel.
async function applyMunicipio() {
  currentMunicipio = els.filtroMunicipio.value;
  currentBairro = '';
  els.filtro.value = '';
  gis.setOrthoMunicipio(currentMunicipio);
  await loadBairrosList();
  await refitExtent();
  await reloadVisibleOverlays();
  await loadDashboard();
  await refreshHeat();
}

function buildControls(config) {
  els.basemaps.innerHTML = gis.baseLayerNames().map((name) =>
    `<label><input type="radio" name="basemap" value="${name}" ${name === gis.defaultBase() ? 'checked' : ''}/> ${name}</label>`
  ).join('');
  els.basemaps.addEventListener('change', (e) => {
    if (e.target.name === 'basemap') gis.setBase(e.target.value);
  });

  els.overlays.innerHTML = config.layers.map((l) =>
    `<label><input type="checkbox" value="${l.id}" ${DEFAULT_ON.includes(l.id) ? 'checked' : ''}/> ${swatchHtml(l.id)} ${l.label}</label>`
  ).join('');
  els.overlays.addEventListener('change', async (e) => {
    const id = e.target.value;
    if (e.target.checked) {
      e.target.disabled = true;
      try { await showOverlay(id); } catch (err) { console.error(err); e.target.checked = false; }
      e.target.disabled = false;
    } else {
      hideOverlay(id);
    }
  });

  els.heatToggle.addEventListener('change', refreshHeat);
  els.heatMetric.addEventListener('change', () => { if (els.heatToggle.checked) refreshHeat(); });
  const ruasModeSel = document.getElementById('ruas-mode');
  ruasModeSel.addEventListener('change', () => gis.setRuasMode(ruasModeSel.value));
  els.filtro.addEventListener('change', applyBairro);
  els.filtroMunicipio.addEventListener('change', applyMunicipio);

  els.btnDash.addEventListener('click', () => {
    const hidden = els.dash.classList.toggle('hidden');
    els.btnDash.setAttribute('aria-pressed', String(!hidden));
  });
  els.dashClose.addEventListener('click', () => {
    els.dash.classList.add('hidden');
    els.btnDash.setAttribute('aria-pressed', 'false');
  });
  // Mobile: botao abre/fecha a gaveta de camadas.
  els.btnCamadas.addEventListener('click', () => els.controls.classList.toggle('open'));
  document.querySelectorAll('.panel-toggle[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const body = document.getElementById(btn.dataset.target);
      const collapsed = body.classList.toggle('collapsed');
      btn.textContent = collapsed ? '+' : '–';
    });
  });
}

async function setupMunicipios() {
  let municipios = [];
  try { municipios = await api.municipios(); } catch { /* sem municipios */ }
  if (municipios.length) {
    currentMunicipio = municipios[0];
    els.filtroMunicipio.innerHTML = municipios.map((m) => `<option value="${m}">${m}</option>`).join('');
    els.filtroMunicipio.value = currentMunicipio;
    els.campoMunicipio.hidden = false;
  } else {
    els.campoMunicipio.hidden = true;
    currentMunicipio = '';
  }
  gis.setOrthoMunicipio(currentMunicipio);
}

async function loadData() {
  await loadBairrosList();
  await refitExtent();
  for (const id of DEFAULT_ON) {
    try { await showOverlay(id); } catch (e) { console.error('overlay', id, e.message); }
  }
  await loadDashboard();
}

async function checkData(config) {
  if (!config.dbConfigured) {
    showMessage(`<h2>Banco de dados não configurado</h2>
      <p>Defina a variável <code>DATABASE_URL</code> (string do Neon) e reinicie.</p>
      <p>Depois rode <code>npm run seed</code> para dados de demonstração ou
      <code>npm run import</code> para seus GeoJSON.</p>
      <button class="btn btn-primary" id="msg-ok">Continuar mesmo assim</button>`);
    document.getElementById('msg-ok').onclick = hideMessage;
    return false;
  }
  try {
    const counts = await api.counts();
    const total = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
    if (total === 0) {
      showMessage(`<h2>Nenhum dado carregado</h2>
        <p>O banco está conectado, mas vazio.</p>
        <p>Rode <code>npm run seed</code> (cidade de demonstração) ou
        <code>npm run import -- --dir data/</code> com seus GeoJSON.</p>
        <button class="btn btn-primary" id="msg-ok">Continuar</button>`);
      document.getElementById('msg-ok').onclick = hideMessage;
      return false;
    }
  } catch (e) {
    showMessage(`<h2>Erro ao acessar o banco</h2><p>${e.message}</p>
      <button class="btn btn-primary" id="msg-ok">Continuar</button>`);
    document.getElementById('msg-ok').onclick = hideMessage;
    return false;
  }
  return true;
}

async function main() {
  showMessage('<div class="spinner"></div><p>Carregando o WebGIS…</p>');
  let config;
  try {
    config = await api.config();
  } catch (e) {
    showMessage(`<h2>Falha ao iniciar</h2><p>${e.message}</p>`);
    return;
  }
  gis.init(config);
  buildControls(config);

  const ok = await checkData(config);
  if (!ok) return;
  hideMessage();
  // No celular, comeca com o painel fechado para o mapa ficar visivel.
  if (window.matchMedia('(max-width: 820px)').matches) {
    els.dash.classList.add('hidden');
    els.btnDash.setAttribute('aria-pressed', 'false');
  }
  await setupMunicipios();
  await loadData();
}

main();
