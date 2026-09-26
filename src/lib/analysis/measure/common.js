import { LM } from '../../pose/landmarks.js';
import { pointAt } from '../smooth.js';
import { dist, midpoint, median } from '../geometry.js';

export function sidePoints(sm, side, i) {
  const P = (part) => pointAt(sm, LM[`${side}${part}`], i);
  return {
    shoulder: P('Shoulder'),
    elbow: P('Elbow'),
    wrist: P('Wrist'),
    hip: P('Hip'),
    knee: P('Knee'),
    ankle: P('Ankle'),
    heel: P('Heel'),
    foot: P('Foot'),
    ear: P('Ear'),
  };
}

export function frontPoints(sm, i) {
  const P = (name) => pointAt(sm, LM[name], i);
  const pts = {
    lShoulder: P('leftShoulder'),
    rShoulder: P('rightShoulder'),
    lElbow: P('leftElbow'),
    rElbow: P('rightElbow'),
    lWrist: P('leftWrist'),
    rWrist: P('rightWrist'),
    lHip: P('leftHip'),
    rHip: P('rightHip'),
  };
  pts.shoulderMid = midpoint(pts.lShoulder, pts.rShoulder);
  pts.hipMid = midpoint(pts.lHip, pts.rHip);
  return pts;
}

/** Median torso length (shoulder to hip) over the clip, in pixels. */
export function medianTorso(sm, ctx) {
  const vals = [];
  for (let i = 0; i < sm.n; i++) {
    if (ctx.view === 'front') {
      const p = frontPoints(sm, i);
      vals.push(dist(p.shoulderMid, p.hipMid));
    } else {
      const p = sidePoints(sm, ctx.side, i);
      vals.push(dist(p.shoulder, p.hip));
    }
  }
  return median(vals);
}

export function newSeries(n) {
  return new Float32Array(n).fill(NaN);
}

/** Landmark indices that must be visible for a frame to count as usable. */
export function sideRequired(side, parts) {
  return parts.map((p) => LM[`${side}${p}`]);
}
