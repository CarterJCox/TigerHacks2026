// Skeleton overlay drawing, shared by the main player and the side-by-side
// comparison. Coordinates come from the smoothed analysis track.

import { LM, SKELETON, BODY_POINTS } from '../lib/pose/landmarks.js';
import { getExercise } from '../config/exercises/index.js';
import { MEASURES } from '../lib/analysis/measure/index.js';

const NAME_OF = Object.fromEntries(Object.entries(LM).map(([k, v]) => [v, k]));

export function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function overlayColors() {
  return {
    green: cssVar('--good', '#3ecf7a'),
    yellow: cssVar('--warn', '#fab219'),
    red: cssVar('--bad', '#e5534b'),
    unknown: cssVar('--unknown', '#8a909c'),
    neutral: 'rgba(236,238,242,0.92)',
    far: 'rgba(236,238,242,0.38)',
    dim: 'rgba(236,238,242,0.22)',
    accent: cssVar('--accent', '#3ecf7a'),
  };
}

/** Fractional frame index for a video time (analysis may start after 0 when trimmed). */
export function frameAt(analysis, t) {
  return (t - (analysis.t0 || 0)) * analysis.fps;
}

// Interpolated landmark position at fractional frame fi (analysis pixel coordinates).
function pointAtFrame(sm, j, fi) {
  if (fi < -0.5 || fi > sm.n - 0.5) return null;
  const i0 = Math.max(0, Math.min(sm.n - 1, Math.floor(fi)));
  const i1 = Math.min(sm.n - 1, i0 + 1);
  const f = Math.max(0, Math.min(1, fi - i0));
  const ok0 = sm.ok[j][i0] && Number.isFinite(sm.x[j][i0]);
  const ok1 = sm.ok[j][i1] && Number.isFinite(sm.x[j][i1]);
  if (ok0 && ok1) return { x: sm.x[j][i0] * (1 - f) + sm.x[j][i1] * f, y: sm.y[j][i0] * (1 - f) + sm.y[j][i1] * f };
  if (ok0 && f < 0.5) return { x: sm.x[j][i0], y: sm.y[j][i0] };
  if (ok1 && f >= 0.5) return { x: sm.x[j][i1], y: sm.y[j][i1] };
  return null;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Landmark indices a metric measures, from the `body` list in the exercise
 * config. Side views use the measured side only; front views use both sides.
 */
export function highlightFor(analysis, metricKey) {
  if (!metricKey) return null;
  const cfg = getExercise(analysis.exerciseId);
  const parts = cfg.metrics[metricKey]?.body;
  if (!parts?.length) return null;
  const sides = analysis.ctx.view === 'side' ? [analysis.ctx.side] : ['left', 'right'];
  const set = new Set();
  for (const side of sides) for (const part of parts) if (LM[`${side}${part}`] !== undefined) set.add(LM[`${side}${part}`]);
  return set;
}

// Landmarks of each form rule's joints, per analysis (side views use the measured side).
const ruleJointCache = new WeakMap();
function ruleJoints(analysis, ruleId) {
  let byRule = ruleJointCache.get(analysis);
  if (!byRule) {
    byRule = {};
    const cfg = getExercise(analysis.exerciseId);
    const sides = analysis.ctx.view === 'side' ? [analysis.ctx.side] : ['left', 'right'];
    for (const rule of cfg.standards?.rules ?? []) {
      byRule[rule.id] = new Set(sides.flatMap((s) => rule.joints.map((p) => LM[`${s}${p}`]).filter((j) => j !== undefined)));
    }
    ruleJointCache.set(analysis, byRule);
  }
  return byRule[ruleId] ?? new Set();
}

const TINT_FADE = 2; // frames to fade a tint in and out
const TINT_RANK = { yellow: 1, red: 2 };

/**
 * Form-standard flags active at fractional frame fi, each with the joints to
 * tint and an alpha that fades in and out at the edges of the flagged frames.
 */
export function activeTints(analysis, fi) {
  const out = [];
  for (const t of analysis.form?.tints ?? []) {
    if (fi < t.i0 - TINT_FADE || fi > t.i1 + TINT_FADE) continue;
    const edge = fi < t.i0 ? (fi - (t.i0 - TINT_FADE)) / TINT_FADE : fi > t.i1 ? (t.i1 + TINT_FADE - fi) / TINT_FADE : 1;
    out.push({ severity: t.severity, alpha: Math.max(0, Math.min(1, edge)), joints: ruleJoints(analysis, t.ruleId) });
  }
  return out;
}

function tintFor(tints, a, b) {
  let best = null;
  for (const t of tints) {
    if (!t.joints.has(a) || !t.joints.has(b)) continue;
    if (!best || TINT_RANK[t.severity] > TINT_RANK[best.severity] || (t.severity === best.severity && t.alpha > best.alpha)) best = t;
  }
  return best;
}

function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/**
 * Draws the skeleton for video time t.
 * opts: { scale, dpr, colors, statusColor, highlight: Set<landmark> | null, showReadout }
 */
export function drawSkeleton(ctx, analysis, t, opts) {
  const { sm, ctx: body, series } = analysis;
  const { scale, dpr, colors, statusColor, highlight, showReadout = true, origin = { x: 0, y: 0 } } = opts;
  const cfg = getExercise(analysis.exerciseId);
  const fi = frameAt(analysis, t);
  const pts = {};
  const extra = highlight ? [...highlight].filter((j) => !BODY_POINTS.includes(j)) : [];
  for (const j of [...BODY_POINTS, LM.nose, ...extra]) {
    const p = pointAtFrame(sm, j, fi);
    if (p) pts[j] = { x: (p.x - origin.x) * scale, y: (p.y - origin.y) * scale };
  }
  if (!Object.keys(pts).length) return;
  const nearSide = body.view === 'side' ? body.side : null;
  const isNear = (j) => !nearSide || (NAME_OF[j] || '').startsWith(nearSide);
  const lit = (j) => Boolean(highlight?.has(j));
  // While a form issue is happening, its segments take the flag's colour.
  // Hovering a metric takes over the overlay, so tints step aside then.
  const tints = highlight ? [] : activeTints(analysis, fi);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Far side first, dimmer, so the measured side sits on top. When a metric
  // is highlighted, everything else steps back.
  for (const pass of ['far', 'near']) {
    for (const [a, b] of SKELETON) {
      const near = isNear(a) && isNear(b);
      if ((pass === 'near') !== near) continue;
      const pa = pts[a];
      const pb = pts[b];
      if (!pa || !pb) continue;
      const on = lit(a) && lit(b);
      ctx.strokeStyle = 'rgba(8,9,12,0.55)';
      ctx.lineWidth = (on ? 9 : near ? 6 : 4) * dpr;
      line(ctx, pa, pb);
      ctx.strokeStyle = on ? colors.accent : highlight ? colors.dim : near ? statusColor : colors.far;
      ctx.lineWidth = (on ? 5 : near ? 3 : 2) * dpr;
      line(ctx, pa, pb);
      const tint = tintFor(tints, a, b);
      if (tint && tint.alpha > 0) {
        ctx.save();
        ctx.strokeStyle = colors[tint.severity];
        ctx.globalAlpha = 0.22 * tint.alpha;
        ctx.lineWidth = (near ? 11 : 8) * dpr;
        line(ctx, pa, pb);
        ctx.globalAlpha = 0.95 * tint.alpha;
        ctx.lineWidth = (near ? 3.5 : 2.5) * dpr;
        line(ctx, pa, pb);
        ctx.restore();
      }
    }
  }
  // Segments that aren't part of the drawn skeleton but are measured (ear to shoulder for shrugs).
  if (highlight) {
    const earShoulder = [
      [LM.leftEar, LM.leftShoulder],
      [LM.rightEar, LM.rightShoulder],
    ];
    for (const [a, b] of earShoulder) {
      if (!lit(a) || !lit(b) || !pts[a] || !pts[b]) continue;
      ctx.strokeStyle = 'rgba(8,9,12,0.55)';
      ctx.lineWidth = 9 * dpr;
      line(ctx, pts[a], pts[b]);
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 5 * dpr;
      line(ctx, pts[a], pts[b]);
    }
  }
  for (const [key, p] of Object.entries(pts)) {
    const j = Number(key);
    if (j === LM.nose || ((j === LM.leftEar || j === LM.rightEar) && !lit(j))) continue;
    const near = isNear(j);
    const on = lit(j);
    ctx.fillStyle = 'rgba(8,9,12,0.8)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, (on ? 7 : near ? 5 : 3.5) * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = on ? colors.accent : highlight ? colors.dim : near ? statusColor : colors.far;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (on ? 4.5 : near ? 3 : 2) * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!showReadout || highlight) return;
  // Key joint readout, e.g. "Elbow 47°".
  const joints =
    body.view === 'side'
      ? [LM[`${body.side}${cfg.overlay.joint === 'knee' ? 'Knee' : 'Elbow'}`]]
      : [LM.leftElbow, LM.rightElbow];
  const values = series[cfg.overlay.series];
  const idx = Math.round(fi);
  const value = values && idx >= 0 && idx < sm.n ? values[idx] : NaN;
  const anchor = joints.map((j) => pts[j]).find(Boolean);
  for (const j of joints) {
    const p = pts[j];
    if (!p) continue;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (anchor && Number.isFinite(value)) {
    const text = `${cfg.overlay.label} ${Math.round(value)}°`;
    ctx.font = `600 ${12.5 * dpr}px "Instrument Sans Variable", system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 16 * dpr;
    const h = 24 * dpr;
    let x = anchor.x + 16 * dpr;
    let y = anchor.y - h - 8 * dpr;
    x = Math.min(Math.max(4 * dpr, x), ctx.canvas.width - w - 4 * dpr);
    y = Math.min(Math.max(4 * dpr, y), ctx.canvas.height - h - 4 * dpr);
    ctx.fillStyle = 'rgba(12,13,16,0.82)';
    roundRect(ctx, x, y, w, h, 7 * dpr);
    ctx.fill();
    ctx.fillStyle = '#f4f5f7';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 8 * dpr, y + h / 2 + 0.5 * dpr);
  }
}

/**
 * The region around the joints this exercise measures (plus the head),
 * across the whole clip, in analysis pixels. Padded and kept to a sensible
 * shape; used to crop the side-by-side views so the movement fills them.
 */
export function bodyRegion(analysis) {
  const { sm, width, height } = analysis;
  const xs = [];
  const ys = [];
  const measured = MEASURES[analysis.exerciseId]?.required(analysis.ctx) ?? BODY_POINTS;
  const joints = [...new Set([...measured, LM.nose, LM.leftEar, LM.rightEar])];
  for (const j of joints) {
    for (let i = 0; i < sm.n; i += 2) {
      if (!sm.ok[j][i]) continue;
      xs.push(sm.x[j][i]);
      ys.push(sm.y[j][i]);
    }
  }
  if (xs.length < 20) return { x: 0, y: 0, w: width, h: height };
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)))];
  let x0 = q(xs, 0.01);
  let x1 = q(xs, 0.99);
  let y0 = q(ys, 0.01);
  let y1 = q(ys, 0.99);
  // Padding: room for the head above the top landmark and for the weight.
  const padX = (x1 - x0) * 0.26 + width * 0.02;
  const padTop = (y1 - y0) * 0.22 + height * 0.02;
  const padBottom = (y1 - y0) * 0.08 + height * 0.02;
  x0 -= padX;
  x1 += padX;
  y0 -= padTop;
  y1 += padBottom;
  // Keep the crop between 0.6 and 1.4 (width / height) so it never gets extreme.
  let w = x1 - x0;
  let h = y1 - y0;
  if (w / h < 0.6) {
    const nw = h * 0.6;
    x0 -= (nw - w) / 2;
    w = nw;
  } else if (w / h > 1.4) {
    const nh = w / 1.4;
    y0 -= (nh - h) / 2;
    h = nh;
  }
  w = Math.min(w, width);
  h = Math.min(h, height);
  x0 = Math.max(0, Math.min(width - w, x0));
  y0 = Math.max(0, Math.min(height - h, y0));
  return { x: x0, y: y0, w, h };
}

/** Sizes a canvas to fit its container at the given aspect ratio. Returns the CSS size. */
export function fitCanvas(canvas, containerWidth, aspect, maxHeight) {
  let w = containerWidth;
  let h = w / aspect;
  if (h > maxHeight) {
    h = maxHeight;
    w = h * aspect;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.style.width = `${Math.round(w)}px`;
  canvas.style.height = `${Math.round(h)}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  return { w, h, dpr };
}

/**
 * The skeleton on the live camera view. `points` are the live monitor's
 * smoothed landmarks in video pixels ({ x, y, vis, ok } arrays); `flags` are
 * the form rules currently crossed ({ severity, joints }). Red segments are
 * part of the stop signal; yellow stays faint on purpose, so the live view is
 * clean while lifting.
 */
export function drawLivePose(ctx, points, { scale, dpr, colors, flags = [], nearSide = null }) {
  const on = (j) => points.ok[j] === 1;
  const at = (j) => ({ x: points.x[j] * scale, y: points.y[j] * scale });
  const isNear = (j) => !nearSide || (NAME_OF[j] || '').startsWith(nearSide);
  const flagFor = (a, b) => {
    let best = null;
    for (const f of flags) {
      if (!f.joints.includes(a) || !f.joints.includes(b)) continue;
      if (!best || (f.severity === 'red' && best.severity !== 'red')) best = f;
    }
    return best;
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of ['far', 'near']) {
    for (const [a, b] of SKELETON) {
      if (!on(a) || !on(b)) continue;
      const near = isNear(a) && isNear(b);
      if ((pass === 'near') !== near) continue;
      const pa = at(a);
      const pb = at(b);
      const flag = flagFor(a, b);
      ctx.strokeStyle = 'rgba(8,9,12,0.5)';
      ctx.lineWidth = (near ? 6 : 4) * dpr;
      line(ctx, pa, pb);
      ctx.strokeStyle = near ? colors.neutral : colors.far;
      ctx.lineWidth = (near ? 3 : 2) * dpr;
      line(ctx, pa, pb);
      if (flag?.severity === 'red') {
        ctx.save();
        ctx.strokeStyle = colors.red;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 16 * dpr;
        line(ctx, pa, pb);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 6 * dpr;
        line(ctx, pa, pb);
        ctx.restore();
      } else if (flag?.severity === 'yellow') {
        ctx.save();
        ctx.strokeStyle = colors.yellow;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 3.5 * dpr;
        line(ctx, pa, pb);
        ctx.restore();
      }
    }
  }
  for (const j of BODY_POINTS) {
    if (!on(j)) continue;
    const p = at(j);
    const near = isNear(j);
    ctx.fillStyle = 'rgba(8,9,12,0.8)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, (near ? 4.5 : 3) * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = near ? colors.neutral : colors.far;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (near ? 2.6 : 1.8) * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
}
