// format.js: Number formatting shared by the report text and the results UI, 
// so the numbers in sentences always match the numbers in the tables.

export function round(v, decimals = 0) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** "45°", "0.68 s", "32% torso" */
export function fmt(v, def) {
  const r = round(v, def.decimals);
  if (r === null) return '–';
  const n = def.decimals ? r.toFixed(def.decimals) : String(r);
  if (def.unit === '°') return `${n}°`;
  if (def.unit === 's') return `${n} s`;
  return `${n}${def.unit.startsWith('%') ? '' : ' '}${def.unit}`;
}

/** Number only, for table cells whose column header carries the unit. */
export function fmtNum(v, def) {
  const r = round(v, def.decimals);
  if (r === null) return '–';
  return def.decimals ? r.toFixed(def.decimals) : String(r);
}

/** Signed change: "+12°", "−0.21 s", "−30%" (relative) */
export function fmtDelta(d, def) {
  if (!d || !Number.isFinite(d.delta)) return '–';
  if (def.mode === 'relative' && Number.isFinite(d.pct)) {
    const p = Math.round(d.pct * 100);
    return `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p)}%`;
  }
  const r = round(d.delta, def.decimals);
  const body = fmt(Math.abs(r), def);
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${body}`;
}

export function pctAbs(d) {
  return Number.isFinite(d.pct) ? Math.round(Math.abs(d.pct) * 100) : null;
}

export function unitLabel(def) {
  if (def.unit === '°') return 'degrees';
  if (def.unit === 's') return 'seconds';
  if (def.unit === '% torso') return '% of torso length';
  if (def.unit === '% foot') return '% of foot length';
  return def.unit;
}

export function listReps(indices) {
  if (!indices.length) return '';
  const sorted = [...indices].sort((a, b) => a - b);
  const parts = [];
  let s = sorted[0];
  let prev = s;
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(s === prev ? `${s}` : prev === s + 1 ? `${s}, ${prev}` : `${s}–${prev}`);
    s = cur;
    prev = cur;
  }
  const label = sorted.length === 1 ? 'rep' : 'reps';
  if (parts.length === 1) return `${label} ${parts[0]}`;
  return `${label} ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function joinAnd(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// Fills a config phrase like "range of motion dropped {pct}% ({base} → {value})". 
export function fillPhrase(template, d, def) {
  return template
    .replace('{pct}', String(pctAbs(d) ?? '–'))
    .replace('{base}', fmt(d.base, def))
    .replace('{value}', fmt(d.value, def))
    .replace('{delta}', fmtDelta(d, def));
}

export function changePhrase(key, d, def) {
  if (def.phrase?.worse) return fillPhrase(def.phrase.worse, d, def);
  return `${def.label.toLowerCase()} changed from ${fmt(d.base, def)} to ${fmt(d.value, def)}`;
}
