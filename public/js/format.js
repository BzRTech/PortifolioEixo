// Formatadores numericos pt-BR.
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export const fmtInt = (v) => (v == null ? '—' : nf0.format(v));
export const fmtNum = (v) => (v == null ? '—' : nf1.format(v));

export function fmtArea(m2) {
  if (m2 == null) return '—';
  if (m2 >= 1e6) return nf1.format(m2 / 1e6) + ' km²';
  if (m2 >= 10000) return nf1.format(m2 / 10000) + ' ha';
  return nf0.format(m2) + ' m²';
}

export function fmtLen(m) {
  if (m == null) return '—';
  if (m >= 1000) return nf1.format(m / 1000) + ' km';
  return nf0.format(m) + ' m';
}

export function fmtPct(v) {
  return v == null ? '—' : nf1.format(v) + '%';
}
