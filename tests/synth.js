// Synthetic pose tracks with known answers, used to test the analysis code
// without a browser. Bodies are built by forward kinematics in pixel space and
// converted to MediaPipe's normalized landmark format.

import { LM, NUM_LANDMARKS } from '../src/lib/pose/landmarks.js';

const RAD = Math.PI / 180;
const W = 640;
const H = 640;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Builds a piecewise timeline. `phases` is a list of
 * { dur, from: {...pose params}, to: {...pose params} } with linear-in-cosine easing.
 */
export function timeline(phases) {
  const total = phases.reduce((s, p) => s + p.dur, 0);
  return {
    total,
    at(t) {
      let acc = 0;
      for (const p of phases) {
        if (t <= acc + p.dur || p === phases[phases.length - 1]) {
          const f = p.dur > 0 ? Math.min(1, Math.max(0, (t - acc) / p.dur)) : 1;
          const e = 0.5 - 0.5 * Math.cos(Math.PI * f);
          const out = {};
          for (const k of Object.keys(p.from)) out[k] = p.from[k] + (p.to[k] - p.from[k]) * e;
          return out;
        }
        acc += p.dur;
      }
      return phases[phases.length - 1].to;
    },
  };
}

function put(raw, i, j, p, vis) {
  const b = (i * NUM_LANDMARKS + j) * 4;
  raw[b] = p.x / W;
  raw[b + 1] = p.y / H;
  raw[b + 2] = p.z ?? 0;
  raw[b + 3] = vis;
}

function add(a, len, angFromDownDeg, facing = 1) {
  return { x: a.x + facing * len * Math.sin(angFromDownDeg * RAD), y: a.y + len * Math.cos(angFromDownDeg * RAD) };
}

/**
 * Side-view body. Params per frame:
 *   lean (torso forward lean, deg), arm (upper arm vs torso, deg),
 *   elbow (elbow angle, deg), knee (knee flexion, deg), shin (forward shin
 *   tilt, deg; defaults to 45% of the knee flexion), heel (px).
 */
export function sideTrack(tl, { fps = 15, facing = 1, noise = 0.6, seed = 1, near = 'left', dropFrames = [] } = {}) {
  const n = Math.floor(tl.total * fps) + 1;
  const raw = new Float32Array(n * NUM_LANDMARKS * 4);
  const hasPose = new Uint8Array(n);
  const times = new Float64Array(n);
  const rand = rng(seed);
  const jit = () => (rand() - 0.5) * 2 * noise;
  const far = near === 'left' ? 'right' : 'left';
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    times[i] = t;
    if (dropFrames.includes(i)) continue;
    hasPose[i] = 1;
    const q = { lean: 0, arm: 0, elbow: 165, knee: 5, heel: 0, ...tl.at(t) };
    const cx = 320 - facing * 20;
    // Legs: thigh and shin; knee flexion splits between hip and ankle angles.
    const ankle = { x: cx, y: 560 };
    const shinAng = q.shin != null ? -q.shin : -q.knee * 0.45; // shin tilts forward (degrees from vertical)
    const knee = add(ankle, 130, 180 + shinAng, facing);
    const hip = add(knee, 135, 180 + shinAng + q.knee, facing);
    const shoulder = add(hip, 160, 180 - q.lean, facing);
    const torsoDown = -q.lean;
    const armDir = torsoDown + q.arm;
    const elbow = add(shoulder, 80, armDir, facing);
    const wrist = add(elbow, 70, armDir + (180 - q.elbow), facing);
    const ear = add(shoulder, 45, 180 - q.lean, facing);
    const nose = { x: ear.x + facing * 14, y: ear.y + 4 };
    const heel = { x: ankle.x - facing * 12, y: ankle.y + 12 - q.heel };
    const foot = { x: ankle.x + facing * 38, y: ankle.y + 14 };
    const pts = { Shoulder: shoulder, Elbow: elbow, Wrist: wrist, Hip: hip, Knee: knee, Ankle: ankle, Heel: heel, Foot: foot, Ear: ear };
    for (const [part, p] of Object.entries(pts)) {
      put(raw, i, LM[`${near}${part}`], { x: p.x + jit(), y: p.y + jit(), z: -0.1 }, 0.97);
      put(raw, i, LM[`${far}${part}`], { x: p.x + facing * -6 + jit(), y: p.y + 2 + jit(), z: 0.1 }, 0.75);
    }
    put(raw, i, LM.nose, nose, 0.99);
  }
  return { n, fps, width: W, height: H, duration: tl.total, times, raw, hasPose };
}

/**
 * Front-view body for presses. Params: wl, wr (wrist height above shoulder
 * as a fraction of torso), lean (lateral, deg), hipDip (px).
 */
export function frontTrack(tl, { fps = 15, noise = 0.6, seed = 2, shoulderSpan = 120 } = {}) {
  const n = Math.floor(tl.total * fps) + 1;
  const raw = new Float32Array(n * NUM_LANDMARKS * 4);
  const hasPose = new Uint8Array(n);
  const times = new Float64Array(n);
  const rand = rng(seed);
  const jit = () => (rand() - 0.5) * 2 * noise;
  const torso = 160;
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    times[i] = t;
    hasPose[i] = 1;
    const q = { wl: 0, wr: 0, lean: 0, hipDip: 0, ...tl.at(t) };
    const hipMid = { x: 320, y: 420 + q.hipDip };
    const shMid = { x: hipMid.x + torso * Math.sin(q.lean * RAD), y: hipMid.y - torso * Math.cos(q.lean * RAD) };
    const set = (name, p) => put(raw, i, LM[name], { x: p.x + jit(), y: p.y + jit() }, 0.97);
    // Person's left appears on image right when facing the camera.
    const sides = { left: 1, right: -1 };
    for (const [side, sgn] of Object.entries(sides)) {
      const sh = { x: shMid.x + (sgn * shoulderSpan) / 2, y: shMid.y };
      const h = side === 'left' ? q.wl : q.wr;
      const wrist = { x: sh.x + sgn * 20, y: sh.y - h * torso };
      // Elbow sits between shoulder and wrist, bowed outward when the wrist is low.
      const bend = Math.max(0, 1 - h) * 45;
      const elbow = { x: (sh.x + wrist.x) / 2 + sgn * bend, y: (sh.y + wrist.y) / 2 + 20 * Math.max(0, 1 - h) };
      set(`${side}Shoulder`, sh);
      set(`${side}Elbow`, elbow);
      set(`${side}Wrist`, wrist);
      set(`${side}Hip`, { x: hipMid.x + sgn * 45, y: hipMid.y });
      set(`${side}Knee`, { x: hipMid.x + sgn * 50, y: hipMid.y + 130 });
      set(`${side}Ankle`, { x: hipMid.x + sgn * 50, y: hipMid.y + 250 });
      set(`${side}Ear`, { x: shMid.x + sgn * 22, y: shMid.y - 55 });
    }
    put(raw, i, LM.nose, { x: shMid.x, y: shMid.y - 50 }, 0.99);
  }
  return { n, fps, width: W, height: H, duration: tl.total, times, raw, hasPose };
}

/** Curl set: `reps` is a list of { top, bottom, lift, lower, lean, arm, pause }. */
export function curlSet(reps, lead = 1, tail = 1) {
  const rest = { lean: 0, arm: 0, elbow: 165 };
  const phases = [{ dur: lead, from: rest, to: rest }];
  let prevBottom = 165;
  for (const r of reps) {
    const bottom = { lean: 0, arm: 0, elbow: r.bottom ?? 165 };
    const top = { lean: -(r.lean ?? 0), arm: r.arm ?? 5, elbow: r.top ?? 45 };
    phases.push({ dur: 0.01, from: { ...bottom, elbow: prevBottom }, to: bottom });
    phases.push({ dur: r.lift ?? 1.0, from: bottom, to: top });
    phases.push({ dur: r.hold ?? 0.2, from: top, to: top });
    phases.push({ dur: r.lower ?? 1.2, from: top, to: bottom });
    phases.push({ dur: r.pause ?? 0.4, from: bottom, to: bottom });
    prevBottom = bottom.elbow;
  }
  phases.push({ dur: tail, from: { ...rest, elbow: prevBottom }, to: { ...rest, elbow: prevBottom } });
  return timeline(phases);
}
