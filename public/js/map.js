// Controlador do mapa Leaflet: camadas base, ortofoto, overlays vetoriais
// estilizados por atributo, popups, mapa de calor e legenda dinamica.
import { fmtArea, fmtLen, fmtInt } from './format.js';

const USO_COLORS = {
  residencial: '#38bdf8',
  comercial: '#f59e0b',
  industrial: '#a78bfa',
  misto: '#34d399',
  servicos: '#f472b6',
  vazio: '#64748b',
};
const usoColor = (u) => USO_COLORS[String(u || '').toLowerCase()] || '#94a3b8';

const RUA_COLORS = { sim: '#34d399', nao: '#ef4444', info: '#9aa0a6' };

// Cores por tipo de pavimento (para colorir as ruas "por tipo").
const TIPO_COLORS = {
  'asfalto': '#475569', 'revestimento asfaltico': '#475569', 'revestimento asfáltico': '#475569',
  'paralelepipedo': '#38bdf8', 'paralelepípedo': '#38bdf8',
  'bloquete': '#a78bfa', 'concreto': '#cbd5e1', 'intertravado': '#34d399',
  'leito natural': '#b45309', 'terra': '#b45309', 'viela': '#f59e0b',
};
const tipoColor = (t) => TIPO_COLORS[String(t || '').toLowerCase()] || '#9aa0a6';
const titleCase = (s) => String(s).toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
// Slug URL-safe p/ casar com a pasta da ortofoto no S3 (sem acento/espaco/maiuscula).
// Ex.: "Catolé do Rocha - PB" -> "catole-do-rocha-pb"; "Tabira" -> "tabira".
const slugify = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const PANES = ['bairros', 'quadras', 'lotes', 'edificacoes', 'heat', 'ruas'];

let map;
let baseLayers = {};
let orthoLayer = null;
const overlays = {};        // id -> L.geoJSON
const overlayState = {};    // id -> bool (visivel)
const renderers = {};       // id -> L.canvas (um por pane, para performance)
let heatLayer = null;
let ruasMode = 'situacao';  // 'situacao' (pavimentada) ou 'tipo' (tipo de pavimento)
let ruasTipos = [];         // tipos distintos presentes nos dados carregados
const legendEl = document.getElementById('legend');

// ---------------------------------------------------------------------------
// Estilos por camada
// ---------------------------------------------------------------------------
function styleFor(id) {
  switch (id) {
    case 'ruas':
      return (f) => {
        let color;
        if (ruasMode === 'tipo') {
          color = tipoColor(f.properties.tipo_pavimento);
        } else {
          const p = f.properties.pavimentada;
          color = p === true ? RUA_COLORS.sim : p === false ? RUA_COLORS.nao : RUA_COLORS.info;
        }
        return { color, weight: 3, opacity: 0.95, lineCap: 'round' };
      };
    case 'bairros':
      return () => ({
        color: '#e6bb00', weight: 1.6, fillColor: '#e6bb00',
        fillOpacity: 0.06, dashArray: '4 3',
      });
    case 'quadras':
      return () => ({ color: '#5b7290', weight: 1, fillColor: '#5b7290', fillOpacity: 0.05 });
    case 'lotes':
      return (f) => ({ color: '#2b3a52', weight: 0.7, fillColor: usoColor(f.properties.uso), fillOpacity: 0.4 });
    case 'edificacoes':
      return (f) => ({ color: '#0b1220', weight: 0.5, fillColor: usoColor(f.properties.uso), fillOpacity: 0.85 });
    default:
      return () => ({ color: '#94a3b8', weight: 1 });
  }
}

// ---------------------------------------------------------------------------
// Popups
// ---------------------------------------------------------------------------
function row(label, value) {
  return `<div class="popup-row"><span>${label}</span><span>${value}</span></div>`;
}
function pavBadge(p) {
  if (p === true) return '<span class="badge ok">Pavimentada</span>';
  if (p === false) return '<span class="badge no">Não pavimentada</span>';
  return '<span class="badge">Sem info</span>';
}
function buildPopup(id, p) {
  switch (id) {
    case 'ruas':
      return `<div class="popup-title">${p.nome || 'Via'}</div>`
        + row('Pavimentação', pavBadge(p.pavimentada))
        + (p.tipo_pavimento ? row('Tipo', p.tipo_pavimento) : '')
        + row('Bairro', p.bairro || '—')
        + row('Extensão', fmtLen(p.extensao_m));
    case 'bairros':
      return `<div class="popup-title">${p.nome || 'Bairro'}</div>`
        + row('População', fmtInt(p.populacao))
        + row('Área', fmtArea(p.area_m2));
    case 'lotes':
      return `<div class="popup-title">Lote ${p.codigo || ''}</div>`
        + row('Uso', p.uso || '—') + row('Quadra', p.quadra || '—')
        + row('Bairro', p.bairro || '—') + row('Área', fmtArea(p.area_m2));
    case 'quadras':
      return `<div class="popup-title">Quadra ${p.codigo || ''}</div>`
        + row('Bairro', p.bairro || '—') + row('Área', fmtArea(p.area_m2));
    case 'edificacoes':
      return `<div class="popup-title">Edificação ${p.codigo || ''}</div>`
        + row('Uso', p.uso || '—') + row('Pavimentos', fmtInt(p.n_pavimentos))
        + row('Bairro', p.bairro || '—') + row('Área', fmtArea(p.area_m2));
    default:
      return '<div class="popup-title">Feição</div>';
  }
}

function onEachFeature(id) {
  return (feature, layer) => {
    layer.bindPopup(buildPopup(id, feature.properties || {}), { maxWidth: 280 });
    if (id === 'bairros' && feature.properties?.nome) {
      layer.bindTooltip(feature.properties.nome, { sticky: true, direction: 'top' });
    }
    if (id === 'ruas') {
      layer.on('mouseover', () => layer.setStyle({ weight: 6 }));
      layer.on('mouseout', () => overlays.ruas && overlays.ruas.resetStyle(layer));
    }
  };
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------
export const gis = {
  init(config) {
    map = L.map('map', { zoomControl: true, minZoom: config.map.minZoom, maxZoom: config.map.maxZoom })
      .setView(config.map.center, config.map.zoom);

    PANES.forEach((name, i) => {
      map.createPane(name);
      map.getPane(name).style.zIndex = String(410 + i * 10);
      // Renderizador canvas por pane: aguenta dezenas de milhares de feicoes.
      if (name !== 'heat') renderers[name] = L.canvas({ pane: name, padding: 0.5 });
    });

    const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 22, subdomains: 'abcd',
    });
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 19,
    });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Imagery &copy; Esri', maxZoom: 22,
    });
    baseLayers = { 'Mapa escuro': dark, 'Mapa claro': osm, 'Satélite': sat };

    if (config.ortho && config.ortho.url) {
      // A URL pode conter {municipio} (substituido pela cidade selecionada).
      this._orthoTemplate = config.ortho.url;
      orthoLayer = L.tileLayer(this._orthoTemplate.replace('{municipio}', ''), {
        attribution: config.ortho.attribution || 'Ortofoto',
        minZoom: 0,
        maxZoom: config.map.maxZoom,
        minNativeZoom: config.ortho.minZoom,   // abaixo: reduz o tile do zoom minimo
        maxNativeZoom: config.ortho.maxZoom,   // acima: amplia o tile do zoom maximo (sem 404)
      });
      baseLayers['Ortofoto'] = orthoLayer;
    }
    // Ortofoto como camada base padrao quando configurada; senao, mapa escuro.
    const initialBase = orthoLayer ? 'Ortofoto' : 'Mapa escuro';
    baseLayers[initialBase].addTo(map);
    this._defaultBase = initialBase;
    return map;
  },

  baseLayerNames() { return Object.keys(baseLayers); },
  defaultBase() { return this._defaultBase; },

  setBase(name) {
    Object.values(baseLayers).forEach((l) => map.removeLayer(l));
    if (baseLayers[name]) baseLayers[name].addTo(map);
  },

  // Aponta a ortofoto para a pasta da cidade (placeholder {municipio} na URL).
  setOrthoMunicipio(m) {
    if (!orthoLayer || !this._orthoTemplate || !this._orthoTemplate.includes('{municipio}')) return;
    orthoLayer.setUrl(this._orthoTemplate.replace('{municipio}', slugify(m)), false);
  },

  // Restringe a ortofoto a extensao da cidade (evita pedir tiles fora da cobertura).
  setOrthoBounds(extent) {
    if (!orthoLayer || !extent || extent.length !== 4) return;
    orthoLayer.options.bounds = L.latLngBounds([[extent[1], extent[0]], [extent[3], extent[2]]]);
    if (map.hasLayer(orthoLayer)) orthoLayer.redraw();
  },

  setOverlayData(id, geojson) {
    if (overlays[id]) { map.removeLayer(overlays[id]); delete overlays[id]; }
    if (id === 'ruas') {
      const set = new Set();
      (geojson.features || []).forEach((f) => { const t = f.properties?.tipo_pavimento; if (t) set.add(String(t)); });
      ruasTipos = [...set].sort();
    }
    overlays[id] = L.geoJSON(geojson, {
      pane: id, renderer: renderers[id], style: styleFor(id), onEachFeature: onEachFeature(id),
    });
    if (overlayState[id]) overlays[id].addTo(map);
  },

  setRuasMode(mode) {
    ruasMode = mode === 'tipo' ? 'tipo' : 'situacao';
    if (overlays.ruas) overlays.ruas.setStyle(styleFor('ruas'));
    this.updateLegend();
  },

  hasOverlay(id) { return Boolean(overlays[id]); },

  toggleOverlay(id, on) {
    overlayState[id] = on;
    if (overlays[id]) {
      if (on) overlays[id].addTo(map);
      else map.removeLayer(overlays[id]);
    }
    this.updateLegend();
  },

  isOn(id) { return Boolean(overlayState[id]); },

  setHeat(points, metric) {
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
    if (!points || !points.length) { this.updateLegend(); return; }
    const isPav = metric === 'nao_pavimentadas';
    // Gradiente classico azul -> vermelho (bom contraste, inclusive sobre a ortofoto).
    const grad = { 0.2: '#2b3bd6', 0.4: '#1fb6d6', 0.6: '#36d35a', 0.8: '#f5e02f', 1.0: '#e8341c' };
    // Normalizacao por densidade evita o "borrao": peso ~1 precisa de varios
    // pontos sobrepostos para esquentar.
    const max = isPav ? Math.max(1, ...points.map((p) => p[2])) : 8;
    heatLayer = L.heatLayer(points, {
      radius: isPav ? 20 : 15,
      blur: isPav ? 20 : 16,
      max, minOpacity: 0.4, maxZoom: 17, pane: 'heat', gradient: grad,
    }).addTo(map);
    this.updateLegend();
  },

  clearHeat() { if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; } this.updateLegend(); },
  heatActive() { return Boolean(heatLayer); },

  fit(extent) {
    if (extent && extent.length === 4) {
      map.fitBounds([[extent[1], extent[0]], [extent[3], extent[2]]], { padding: [50, 50], maxZoom: 15 });
    }
  },

  updateLegend() {
    const groups = [];
    if (overlayState.ruas) {
      if (ruasMode === 'tipo') {
        const items = (ruasTipos.length ? ruasTipos : Object.keys(TIPO_COLORS))
          .map((t) => `<div class="row"><span class="swatch line" style="background:${tipoColor(t)}"></span>${titleCase(t)}</div>`).join('');
        groups.push(`<div class="group"><h4>Ruas (tipo)</h4>${items}</div>`);
      } else {
        groups.push(`<div class="group"><h4>Ruas</h4>
          <div class="row"><span class="swatch line" style="background:${RUA_COLORS.sim}"></span>Pavimentada</div>
          <div class="row"><span class="swatch line" style="background:${RUA_COLORS.nao}"></span>Não pavimentada</div>
          <div class="row"><span class="swatch line" style="background:${RUA_COLORS.info}"></span>Sem informação</div></div>`);
      }
    }
    if (overlayState.lotes || overlayState.edificacoes) {
      const items = Object.entries(USO_COLORS)
        .map(([k, c]) => `<div class="row"><span class="swatch" style="background:${c}"></span>${k}</div>`).join('');
      groups.push(`<div class="group"><h4>Uso do solo</h4>${items}</div>`);
    }
    if (heatLayer) {
      groups.push(`<div class="group"><h4>Mapa de calor</h4>
        <div class="row"><span class="swatch" style="background:linear-gradient(90deg,#2b3bd6,#1fb6d6,#36d35a,#f5e02f,#e8341c)"></span>baixo → alto</div></div>`);
    }
    if (!groups.length) { legendEl.hidden = true; return; }
    legendEl.hidden = false;
    legendEl.innerHTML = groups.join('');
  },
};
