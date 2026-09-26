// Session history, stored per exercise in this browser's localStorage.
// Only summary numbers are kept, never video or pose data.

const KEY = 'spotter.history.v1';

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function getHistory(exerciseId) {
  const list = readAll()[exerciseId];
  return Array.isArray(list) ? [...list].sort((a, b) => a.date.localeCompare(b.date)) : [];
}

export function getAllCounts() {
  const all = readAll();
  const out = {};
  for (const [k, v] of Object.entries(all)) out[k] = Array.isArray(v) ? v.length : 0;
  return out;
}

export function saveSession(exerciseId, session) {
  const all = readAll();
  const list = Array.isArray(all[exerciseId]) ? all[exerciseId] : [];
  list.push(session);
  all[exerciseId] = list.slice(-200);
  return writeAll(all);
}

export function deleteSession(exerciseId, id) {
  const all = readAll();
  all[exerciseId] = (all[exerciseId] || []).filter((s) => s.id !== id);
  writeAll(all);
}

export function clearHistory(exerciseId) {
  const all = readAll();
  delete all[exerciseId];
  writeAll(all);
}

export function sessionFromAnalysis(analysis, input, headline) {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date: new Date().toISOString(),
    weight: input.bodyweight ? 0 : Number(input.weight) || 0,
    unit: input.unit,
    bodyweight: Boolean(input.bodyweight),
    plannedReps: Number(input.plannedReps) || null,
    reps: analysis.reps.length,
    breakdownRep: analysis.breakdown?.rep ?? null,
    breakdownKind: analysis.breakdown?.kind ?? null,
    score: analysis.setScore,
    headline,
  };
}

export function toUnit(weight, from, to) {
  if (from === to || !weight) return weight;
  return from === 'kg' ? weight * 2.20462 : weight / 2.20462;
}
