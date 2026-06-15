// Cliente da API.
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

function qs(params) {
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)
  ).toString();
  return q ? '?' + q : '';
}

export const api = {
  config: () => getJSON('/api/config'),
  health: () => getJSON('/api/health'),
  municipios: () => getJSON('/api/municipios'),
  counts: (municipio) => getJSON('/api/counts' + qs({ municipio })),
  bairros: (municipio) => getJSON('/api/bairros' + qs({ municipio })),
  extent: (municipio) => getJSON('/api/extent' + qs({ municipio })),
  dashboard: (municipio) => getJSON('/api/dashboard' + qs({ municipio })),
  heatmap: (metric, municipio) => getJSON('/api/heatmap' + qs({ metric, municipio })),
  layer: (id, params = {}) => getJSON(`/api/layers/${id}` + qs(params)),
};
