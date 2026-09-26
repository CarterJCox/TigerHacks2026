// geometry.js: 2-D geometry in image pixel coordinates (x right, y down).

const DEG = 180 / Math.PI;

/** Interior angle ABC at B, in degrees (0-180). */
export function jointAngle(a, b, c) {
  if (!a || !b || !c) return NaN;
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (m < 1e-6) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / m));
  return Math.acos(cos) * DEG;
}

/**
 * Angle of the vector from `from` to `to` measured from straight up, in
 * degrees. Positive when `to` is displaced in the +facing direction.
 * Used for torso lean (hip -> shoulder): 0 = upright, + = leaning forward.
 */
export function leanFromVertical(from, to, facing = 1) {
  if (!from || !to) return NaN;
  const dx = (to.x - from.x) * facing;
  const dy = from.y - to.y; // up is positive
  return Math.atan2(dx, dy) * DEG;
}

/**
 * Angle of the vector from `from` to `to` measured from straight down.
 * Positive when `to` is in the +facing direction. For shoulder -> elbow:
 * 0 = arm hanging, + = elbow in front of the shoulder.
 */
export function angleFromDown(from, to, facing = 1) {
  if (!from || !to) return NaN;
  const dx = (to.x - from.x) * facing;
  const dy = to.y - from.y; // down is positive
  return Math.atan2(dx, dy) * DEG;
}

export function midpoint(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function dist(a, b) {
  if (!a || !b) return NaN;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---- array helpers over index ranges (inclusive), ignoring NaN ----

export function maxIn(arr, a, b) {
  let m = -Infinity;
  for (let i = a; i <= b; i++) if (Number.isFinite(arr[i]) && arr[i] > m) m = arr[i];
  return m === -Infinity ? NaN : m;
}

export function minIn(arr, a, b) {
  let m = Infinity;
  for (let i = a; i <= b; i++) if (Number.isFinite(arr[i]) && arr[i] < m) m = arr[i];
  return m === Infinity ? NaN : m;
}

export function argMaxIn(arr, a, b) {
  let m = -Infinity;
  let idx = -1;
  for (let i = a; i <= b; i++) if (Number.isFinite(arr[i]) && arr[i] > m) {
    m = arr[i];
    idx = i;
  }
  return idx;
}

export function rangeIn(arr, a, b) {
  const hi = maxIn(arr, a, b);
  const lo = minIn(arr, a, b);
  return Number.isFinite(hi) && Number.isFinite(lo) ? hi - lo : NaN;
}

/** Value at i, or the nearest finite value within `reach` frames. */
export function valueNear(arr, i, reach = 3) {
  if (Number.isFinite(arr[i])) return arr[i];
  for (let k = 1; k <= reach; k++) {
    if (Number.isFinite(arr[i - k])) return arr[i - k];
    if (Number.isFinite(arr[i + k])) return arr[i + k];
  }
  return NaN;
}

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function mean(values) {
  const v = values.filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
}

export function stdev(values) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}
