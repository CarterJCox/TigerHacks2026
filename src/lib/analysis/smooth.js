// smooth.js: Keypoint cleanup. Runs offline over the whole clip, so it can look both
// forward and backward in time (no lag, unlike a live filter):
//   1. drop points below the visibility threshold,
//   2. fill short gaps by linear interpolation (longer gaps stay empty),
//   3. median filter (5 frames) to remove single-frame spikes,
//   4. visibility-weighted Gaussian smoothing to remove jitter.
// Output coordinates are in pixels of the analysis frame, so angles are
// computed in an isotropic space.

import { NUM_LANDMARKS } from '../pose/landmarks.js';

function fillGaps(values, valid, maxGap) {
  const n = values.length;
  const filled = new Uint8Array(n);
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    if (last >= 0 && i - last > 1 && i - last - 1 <= maxGap) {
      for (let k = last + 1; k < i; k++) {
        const f = (k - last) / (i - last);
        values[k] = values[last] * (1 - f) + values[i] * f;
        filled[k] = 1;
      }
    }
    last = i;
  }
  return filled;
}

function median5(values, ok) {
  const n = values.length;
  const out = new Float32Array(n);
  const win = [];
  for (let i = 0; i < n; i++) {
    if (!ok[i]) {
      out[i] = NaN;
      continue;
    }
    win.length = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (ok[k]) win.push(values[k]);
    win.sort((a, b) => a - b);
    out[i] = win[win.length >> 1];
  }
  return out;
}

function gaussian(values, ok, weights, sigma) {
  const n = values.length;
  const out = new Float32Array(n);
  if (sigma <= 0.01) {
    for (let i = 0; i < n; i++) out[i] = ok[i] ? values[i] : NaN;
    return out;
  }
  const radius = Math.max(1, Math.ceil(sigma * 2.5));
  const kernel = [];
  for (let k = -radius; k <= radius; k++) kernel.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  for (let i = 0; i < n; i++) {
    if (!ok[i]) {
      out[i] = NaN;
      continue;
    }
    let s = 0;
    let w = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= n || !ok[j]) continue;
      const wk = kernel[k + radius] * weights[j];
      s += values[j] * wk;
      w += wk;
    }
    out[i] = w > 0 ? s / w : values[i];
  }
  return out;
}

/**
 * @param track output of extractPose
 * @param opts { minLandmarkVisibility, maxGapSec, smoothingSigmaSec }
 * @returns {{ n, fps, width, height, times, x: Float32Array[], y: Float32Array[],
 *             vis: Float32Array[], ok: Uint8Array[], z: Float32Array[] }}
 */
export function smoothTrack(track, opts) {
  const { n, fps, width, height, times, raw, hasPose } = track;
  const maxGap = Math.round(opts.maxGapSec * fps);
  const sigma = opts.smoothingSigmaSec * fps;
  const x = [];
  const y = [];
  const vis = [];
  const ok = [];
  const z = [];
  for (let j = 0; j < NUM_LANDMARKS; j++) {
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const vs = new Float32Array(n);
    const zs = new Float32Array(n);
    const valid = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!hasPose[i]) {
        zs[i] = NaN;
        continue;
      }
      const b = (i * NUM_LANDMARKS + j) * 4;
      xs[i] = raw[b] * width;
      ys[i] = raw[b + 1] * height;
      zs[i] = raw[b + 2];
      vs[i] = raw[b + 3];
      valid[i] = vs[i] >= opts.minLandmarkVisibility && Number.isFinite(xs[i]) && Number.isFinite(ys[i]) ? 1 : 0;
    }
    const fx = fillGaps(xs, valid, maxGap);
    fillGaps(ys, valid, maxGap);
    const usable = new Uint8Array(n);
    const weights = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      usable[i] = valid[i] || fx[i] ? 1 : 0;
      // Interpolated points get a low weight so real observations dominate.
      weights[i] = valid[i] ? Math.max(0.05, vs[i]) : 0.05;
    }
    x.push(gaussian(median5(xs, usable), usable, weights, sigma));
    y.push(gaussian(median5(ys, usable), usable, weights, sigma));
    vis.push(vs);
    ok.push(usable);
    z.push(zs);
  }
  return { n, fps, width, height, times, x, y, vis, ok, z, hasPose };
}

/** Point accessor: returns {x, y} or null when the landmark isn't trusted in frame i. */
export function pointAt(sm, j, i) {
  if (!sm.ok[j][i]) return null;
  const px = sm.x[j][i];
  const py = sm.y[j][i];
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  return { x: px, y: py };
}

/** Gaussian smoothing of a 1-D series that may contain NaN. */
export function smoothSeries(values, sigma) {
  const n = values.length;
  const ok = new Uint8Array(n);
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ok[i] = Number.isFinite(values[i]) ? 1 : 0;
    w[i] = 1;
  }
  return gaussian(values, ok, w, sigma);
}
