// Renderiza os indicadores (KPIs) e graficos do painel do gestor.
import { fmtInt, fmtNum, fmtLen, fmtPct } from './format.js';

const charts = {};
const COL = { accent: '#34d399', accent2: '#e6bb00', danger: '#ef4444', warn: '#fb923c', gray: '#64748b', ok: '#22c55e' };
const USO_COLORS = {
  residencial: '#38bdf8', comercial: '#f59e0b', industrial: '#a78bfa',
  misto: '#34d399', servicos: '#f472b6', vazio: '#64748b',
};
const TIPO_COLORS = {
  'asfalto': '#475569', 'paralelepipedo': '#38bdf8', 'paralelepípedo': '#38bdf8',
  'bloquete': '#a78bfa', 'concreto': '#cbd5e1', 'intertravado': '#34d399',
  'revestimento asfaltico': '#475569', 'leito natural': '#b45309', 'terra': '#b45309',
  'viela': '#f59e0b',
};
const titleCase = (s) => String(s).toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
function tipoColor(t) {
  const c = TIPO_COLORS[String(t.tipo).toLowerCase()];
  if (c) return c;
  return t.pavimentada ? '#475569' : '#b45309'; // fallback pela situacao
}

if (window.Chart) {
  Chart.defaults.color = '#9fb0c6';
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
}

function destroy(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }
const gridColor = 'rgba(148,163,184,.12)';

function kpi(value, label, cls = '') {
  return `<div class="kpi ${cls}"><span class="val">${value}</span><span class="lbl">${label}</span></div>`;
}

export function renderDashboard(d) {
  const r = d.ruasResumo || {};
  const t = d.totais || {};
  const extTotal = Number(r.extensao_total_m) || 0;
  const extNaoPav = Number(r.extensao_naopav_m) || 0;
  const extPav = Number(r.extensao_pav_m) || 0;
  const pctPav = extTotal > 0 ? (extPav / extTotal) * 100 : null;

  // ---- KPIs: grandes numeros (quantidades) ----
  document.getElementById('kpis').innerHTML = [
    kpi(fmtInt(t.total_vias), 'Vias', 'accent'),
    kpi(fmtInt(t.total_lotes), 'Lotes'),
    kpi(fmtInt(t.total_edificacoes), 'Edificações'),
    kpi(fmtInt(t.total_quadras), 'Quadras'),
    kpi(fmtInt(t.total_bairros), 'Bairros'),
    kpi(fmtLen(extTotal), 'Extensão de vias'),
  ].join('');

  // ---- Barra de proporcao de pavimentacao (por extensao) ----
  const pavBar = document.getElementById('pav-bar');
  if (extTotal > 0) {
    pavBar.innerHTML = `
      <span class="pav" style="width:${(extPav / extTotal) * 100}%" title="Pavimentadas: ${fmtLen(extPav)}"></span>
      <span class="nao" style="width:${(extNaoPav / extTotal) * 100}%" title="Não pavimentadas: ${fmtLen(extNaoPav)}"></span>
      <span class="info" style="width:${100 - (extPav + extNaoPav) / extTotal * 100}%"></span>`;
  } else {
    pavBar.innerHTML = '';
  }

  // ---- Resumo km + % por situacao ----
  const pctPavV = extTotal > 0 ? (extPav / extTotal) * 100 : null;
  const pctNaoV = extTotal > 0 ? (extNaoPav / extTotal) * 100 : null;
  document.getElementById('pav-stats').innerHTML = `
    <div class="ps">
      <div class="k">${fmtLen(extPav)} <small>${fmtPct(pctPavV)}</small></div>
      <div class="l"><span class="dot" style="background:${COL.accent}"></span>Pavimentadas</div>
    </div>
    <div class="ps">
      <div class="k">${fmtLen(extNaoPav)} <small>${fmtPct(pctNaoV)}</small></div>
      <div class="l"><span class="dot" style="background:${COL.danger}"></span>Não pavimentadas</div>
    </div>`;

  // ---- Doughnut: status das vias (por extensao) ----
  const extInfo = Math.max(0, extTotal - extPav - extNaoPav);
  destroy('pavStatus');
  charts.pavStatus = new Chart(document.getElementById('chart-pav-status'), {
    type: 'doughnut',
    data: {
      labels: ['Pavimentadas', 'Não pavimentadas', 'Sem info'],
      datasets: [{
        data: [extPav, extNaoPav, extInfo],
        backgroundColor: [COL.accent, COL.danger, COL.gray], borderWidth: 0,
      }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtLen(c.parsed)} (${fmtPct(extTotal > 0 ? c.parsed / extTotal * 100 : null)})` } },
      },
      cutout: '62%',
    },
  });

  // ---- Doughnut: pavimentacao por tipo (por extensao) ----
  const tipos = d.pavPorTipo || [];
  destroy('pavTipo');
  charts.pavTipo = new Chart(document.getElementById('chart-pav-tipo'), {
    type: 'doughnut',
    data: {
      labels: tipos.map((t) => titleCase(t.tipo)),
      datasets: [{
        data: tipos.map((t) => Number(t.extensao_m) || 0),
        backgroundColor: tipos.map((t) => tipoColor(t)), borderWidth: 0,
      }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtLen(c.parsed)}` } },
      },
      cutout: '58%',
    },
  });

  // ---- Bairros sem pavimentacao ----
  const semPav = d.bairrosSemPavimentacao || [];
  const temRuas = (r.total || 0) > 0;
  const lista = document.getElementById('lista-sem-pav');
  const card = document.getElementById('card-sem-pav');
  if (!temRuas) {
    card.querySelector('h3').textContent = 'Pavimentação';
    lista.innerHTML = '<li class="ok">Sem dados de vias (ruas) cadastrados</li>';
  } else if (semPav.length) {
    card.querySelector('h3').textContent = `⚠ Bairros sem pavimentação (${semPav.length})`;
    lista.innerHTML = semPav.map((b) => `<li>${b}</li>`).join('');
  } else {
    card.querySelector('h3').textContent = '✓ Pavimentação';
    lista.innerHTML = '<li class="ok">Todos os bairros possuem alguma pavimentação</li>';
  }

  // ---- Barra horizontal: % pavimentacao por bairro ----
  const pb = (d.pavPorBairro || []).slice(0, 12);
  destroy('pavBairro');
  charts.pavBairro = new Chart(document.getElementById('chart-pav-bairro'), {
    type: 'bar',
    data: {
      labels: pb.map((x) => x.bairro),
      datasets: [{
        label: '% pavimentada',
        data: pb.map((x) => Number(x.pct_pavimentada) || 0),
        backgroundColor: pb.map((x) => {
          const v = Number(x.pct_pavimentada) || 0;
          return v < 25 ? COL.danger : v < 60 ? COL.warn : COL.accent;
        }),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => {
          const b = pb[c.dataIndex] || {};
          return `${fmtPct(c.parsed.x)} · ${fmtLen(b.extensao_pav_m)} de ${fmtLen(b.extensao_total_m)}`;
        } } },
      },
      scales: { x: { max: 100, grid: { color: gridColor } }, y: { grid: { display: false } } },
    },
  });

  // ---- Doughnut: uso do solo ----
  const uso = d.usoLotes || [];
  destroy('uso');
  charts.uso = new Chart(document.getElementById('chart-uso'), {
    type: 'doughnut',
    data: {
      labels: uso.map((x) => x.uso),
      datasets: [{
        data: uso.map((x) => x.qtd),
        backgroundColor: uso.map((x) => USO_COLORS[String(x.uso).toLowerCase()] || '#94a3b8'),
        borderWidth: 0,
      }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtInt(c.parsed)} lotes` } },
      },
      cutout: '58%',
    },
  });
}
