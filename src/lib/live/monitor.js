// Live analysis of the camera feed: readiness before the set, a rep counter,
// the hands-free stop, and the live stop signal. Plain JavaScript over
// landmark frames (no DOM), so tests drive it with synthetic pose streams.
//
// Live alerts reuse the offline form standards: the same per-frame series
// (measure/<exercise>.js), the same red limits, holdSec and minVisibility
// (the exercise config's `standards`), and the same camera-view check
// (quality.js). Only the timing (sustain, cooldown, window) is live-specific
// and lives in config/live.js.

import { getExercise } from '../../config/exercises/index.js';
import { LIVE } from '../../config/live.js';
import { MEASURES } from '../analysis/measure/index.js';
import { buildContext } from '../analysis/context.js';
import { heldMax, heldMin, median } from '../analysis/geometry.js';
import { ruleLevel } from '../analysis/standards.js';
import { shoulderRatio, viewMatches } from '../analysis/quality.js';
import { LM, NUM_LANDMARKS } from '../pose/landmarks.js';

const STRIDE = NUM_LANDMARKS * 4;
const CONTEXT_FRAMES = 45; // about 3 s of frames to decide which side faces the camera

/**
 * How a form rule can be checked live, frame by frame:
 *   'excursion': range and sway rules. How far the body has moved from the
 *                steadiest opposite extreme in the rolling window.
 *   'moved':     past zero, minus however far past zero the window's
 *                reference position already was (sitting reclined isn't movement).
 *   'absolute':  max/min rules where reaching the extreme is the problem
 *                (folding forward, leaning past the shins): the value now.
 *   null:        needs a whole rep: tempo, and "didn't get far enough" checks
 *                (depth, lockout, range at the top or bottom).
 */
export function liveMode(rule) {
  if (rule.measure === 'range' || rule.measure === 'sway') return 'excursion';
  if (rule.measure === 'moved') return 'moved';
  if (rule.measure === 'max' || rule.measure === 'min') {
    const scale = rule.scale ?? 1;
    const highest = (rule.measure === 'max') === scale > 0;
    return highest === (rule.worse === 'above') ? 'absolute' : null;
  }
  return null;
}

/** Red rules of an exercise that can be checked live. */
export function liveRedRules(exerciseId) {
  return (getExercise(exerciseId).standards?.rules ?? []).filter((r) => r.red != null && liveMode(r));
}

function landmarksFor(parts, ctx) {
  const sides = ctx.view === 'side' ? [ctx.side] : ['left', 'right'];
  return sides.flatMap((s) => parts.map((p) => LM[`${s}${p}`]).filter((j) => j !== undefined));
}

// Landmarks that must be in frame for "whole body in frame".
function bodyLandmarks(exerciseId, ctx) {
  const parts = ['Shoulder', 'Hip', 'Knee', ...(exerciseId === 'squat' ? ['Ankle'] : [])];
  return [LM.nose, ...landmarksFor(parts, ctx)];
}

export class LiveMonitor {
  /**
   * @param exerciseId 'curl' | 'press' | 'row' | 'squat'
   * @param options { live: override for config/live.js (tests) }
   */
  constructor(exerciseId, { live = LIVE } = {}) {
    this.exerciseId = exerciseId;
    this.cfg = getExercise(exerciseId);
    this.measure = MEASURES[exerciseId];
    this.live = live;
    this.std = this.cfg.standards;
    this.rules = (this.std?.rules ?? []).filter((r) => liveMode(r));
    this.ruleState = new Map(this.rules.map((r) => [r.id, this._freshRuleState()]));
    this.alertsEnabled = true;
    this.recording = false;
    this.lastAlertT = -Infinity;
    this.alerts = [];
    this.frameCount = 0;
    this.fps = live.targetFps;
    this.lastT = null;
    this.recent = []; // { raw, has } for the side/facing decision
    this.ctx = null;
    this.locked = false;
    this.viewHist = [];
    this.readyHist = [];
    this.readySince = null;
    // Smoothed landmark positions (pixels) and a one-frame track in the shape
    // the measure modules expect, reused every frame.
    this.px = new Float32Array(NUM_LANDMARKS);
    this.py = new Float32Array(NUM_LANDMARKS);
    this.pvis = new Float32Array(NUM_LANDMARKS);
    this.pok = new Uint8Array(NUM_LANDMARKS);
    this.sm = {
      n: 1,
      x: Array.from({ length: NUM_LANDMARKS }, () => new Float32Array(1)),
      y: Array.from({ length: NUM_LANDMARKS }, () => new Float32Array(1)),
      ok: Array.from({ length: NUM_LANDMARKS }, () => new Uint8Array(1)),
      vis: Array.from({ length: NUM_LANDMARKS }, () => new Float32Array(1)),
    };
    this._resetSession();
  }

  _freshRuleState() {
    return { t: [], v: [], redRun: null, yellowRun: null, fired: false, clearSince: null };
  }

  _resetSession() {
    this.reps = 0;
    this.repPhase = 'rest';
    this.sigLo = Infinity;
    this.sigHi = -Infinity;
    this.moveRef = NaN;
    this.lastMoveT = null;
    this.lastRepEndT = null;
    this.torsoStart = [];
    this.torsoBase = NaN;
    this.approachSince = null;
    this.lostSince = null;
  }

  /** Recording begins at time t: lock the camera context and start counting. */
  startRecording(t) {
    this.recording = true;
    this.recStart = t;
    this.locked = true;
    if (!this.ctx) this.ctx = this._context();
    this._resetSession();
    this.lastMoveT = t;
    for (const r of this.rules) this.ruleState.set(r.id, this._freshRuleState());
  }

  stopRecording() {
    this.recording = false;
  }

  /** Live alerts off (the device can't keep up); readiness and reps continue. */
  disableAlerts() {
    this.alertsEnabled = false;
  }

  _context() {
    const frames = this.recent.filter((f) => f.has);
    if (!frames.length) return this.cfg.view === 'front' ? { view: 'front', side: 'both', facing: 1 } : null;
    const n = frames.length;
    const raw = new Float32Array(n * STRIDE);
    frames.forEach((f, i) => raw.set(f.raw, i * STRIDE));
    return buildContext({ n, raw, hasPose: new Uint8Array(n).fill(1), width: this.width, height: this.height }, this.cfg);
  }

  _updateFps(t) {
    if (this.lastT != null && t > this.lastT) {
      const inst = 1 / (t - this.lastT);
      this.fps = this.frameCount < 3 ? inst : this.fps * 0.85 + inst * 0.15;
    }
    this.lastT = t;
  }

  /** Frames needed for a value to count as held (the rules' holdSec). */
  _holdFrames() {
    return Math.max(2, Math.round((this.std?.holdSec ?? 0.2) * Math.min(30, Math.max(5, this.fps))));
  }

  /**
   * One analyzed camera frame.
   * @param frame { t: seconds, raw: Float32Array(33 * 4) of normalized x, y, z,
   *   visibility (or null when no person was found), width, height,
   *   brightness: mean luma 0-255 (optional) }
   */
  push({ t, raw, width, height, brightness }) {
    this.width = width;
    this.height = height;
    this._updateFps(t);
    this.frameCount += 1;
    const has = Boolean(raw) && raw.length >= STRIDE;

    this.recent.push({ raw: has ? Float32Array.from(raw.subarray(0, STRIDE)) : null, has });
    if (this.recent.length > CONTEXT_FRAMES) this.recent.shift();
    if (!this.locked && (this.ctx == null || this.frameCount % 15 === 0)) this.ctx = this._context();

    this._smooth(raw, has);
    const ctx = this.ctx;
    const values = has && ctx ? this._series(ctx) : null;

    // The same shoulder-width view check as the quality gate, over the last second.
    const P = (j) => (this.pok[j] ? { x: this.px[j], y: this.py[j] } : null);
    const ratio = has ? shoulderRatio(P(LM.leftShoulder), P(LM.rightShoulder), P(LM.leftHip), P(LM.rightHip)) : NaN;
    this.viewHist.push({ t, ratio });
    while (this.viewHist.length && t - this.viewHist[0].t > this.live.alerts.viewWindowSec) this.viewHist.shift();
    const viewRatio = median(this.viewHist.map((h) => h.ratio));
    const viewOk = viewMatches(this.cfg, viewRatio);

    const readiness = this._readiness(t, has, ctx, viewOk, brightness);
    const { flags, alert } = values ? this._rules(t, values, viewOk, ctx) : { flags: [], alert: null };
    if (!values) for (const st of this.ruleState.values()) this._breakRuns(st, t);
    const stop = this.recording ? this._session(t, has, values, ctx) : null;

    return {
      t,
      hasPose: has,
      ctx,
      points: { x: this.px, y: this.py, vis: this.pvis, ok: this.pok },
      viewOk,
      readiness,
      flags,
      alert,
      reps: this.reps,
      stop,
      lastRepEndT: this.lastRepEndT,
      fps: this.fps,
    };
  }

  _smooth(raw, has) {
    const a = this.live.smoothing;
    const minVis = this.cfg.pose.minLandmarkVisibility;
    for (let j = 0; j < NUM_LANDMARKS; j++) {
      const b = j * 4;
      const vis = has ? raw[b + 3] : 0;
      const x = has ? raw[b] * this.width : NaN;
      const y = has ? raw[b + 1] * this.height : NaN;
      const ok = vis >= minVis && Number.isFinite(x) && Number.isFinite(y);
      if (ok) {
        this.px[j] = this.pok[j] ? a * x + (1 - a) * this.px[j] : x;
        this.py[j] = this.pok[j] ? a * y + (1 - a) * this.py[j] : y;
      }
      this.pok[j] = ok ? 1 : 0;
      this.pvis[j] = vis;
      this.sm.x[j][0] = this.px[j];
      this.sm.y[j][0] = this.py[j];
      this.sm.ok[j][0] = this.pok[j];
      this.sm.vis[j][0] = vis;
    }
  }

  // This frame's value of every series the exercise measures.
  _series(ctx) {
    const s = this.measure.series(this.sm, ctx);
    const out = {};
    for (const [k, arr] of Object.entries(s)) out[k] = arr[0];
    return out;
  }

  _clear(joints) {
    const minVis = this.std?.minVisibility ?? 0.7;
    return joints.every((j) => this.pok[j] && this.pvis[j] >= minVis);
  }

  _breakRuns(st, t) {
    st.redRun = null;
    st.yellowRun = null;
    if (st.clearSince == null) st.clearSince = t;
    if (t - st.clearSince >= this.live.alerts.rearmSec) st.fired = false;
  }

  _rules(t, values, viewOk, ctx) {
    const A = this.live.alerts;
    const k = this._holdFrames();
    const flags = [];
    let alert = null;
    const sustained = (run) => run && t - run.start >= A.sustainSec - 1e-6 && run.frames >= A.minSustainFrames;
    for (const rule of this.rules) {
      const st = this.ruleState.get(rule.id);
      const joints = landmarksFor(rule.joints, ctx);
      const clear = this._clear(joints);
      const s = clear ? values[rule.series] : NaN;
      st.t.push(t);
      st.v.push(Number.isFinite(s) ? s : NaN);
      while (st.t.length && t - st.t[0] > A.windowSec) {
        st.t.shift();
        st.v.shift();
      }

      const value = this._liveValue(rule, st.v, s, k);
      const level = clear && viewOk && Number.isFinite(value) ? ruleLevel(rule, value) : null;
      if (level !== 'red' && level !== 'yellow') {
        this._breakRuns(st, t);
        continue;
      }
      if (level === 'red') {
        st.clearSince = null;
        st.redRun = st.redRun ?? { start: t, frames: 0 };
        st.redRun.frames += 1;
      } else {
        st.redRun = null;
        if (st.clearSince == null) st.clearSince = t;
        if (t - st.clearSince >= A.rearmSec) st.fired = false;
      }
      st.yellowRun = st.yellowRun ?? { start: t, frames: 0 };
      st.yellowRun.frames += 1;

      if (sustained(st.redRun)) {
        flags.push({ ruleId: rule.id, severity: 'red', joints });
        if (!st.fired && this.recording && this.alertsEnabled) {
          // One alert per pattern: a pattern swallowed by the cooldown doesn't fire later either.
          st.fired = true;
          if (t - this.lastAlertT >= A.cooldownSec && !alert) {
            this.lastAlertT = t;
            alert = {
              t,
              ruleId: rule.id,
              label: rule.label,
              short: rule.short,
              value,
              limit: rule.red,
              patternStart: st.redRun.start,
              recordingT: t - (this.recStart ?? 0),
            };
            this.alerts.push(alert);
          }
        }
      } else if (sustained(st.yellowRun)) {
        flags.push({ ruleId: rule.id, severity: 'yellow', joints });
      }
    }
    return { flags, alert };
  }

  /** This frame's reading of a rule, in the rule's own unit (see liveMode). */
  _liveValue(rule, hist, s, k) {
    if (!Number.isFinite(s)) return NaN;
    const scale = rule.scale ?? 1;
    const mode = liveMode(rule);
    if (mode === 'absolute') return s * scale;
    const last = hist.length - 1;
    if (mode === 'excursion') {
      // Peak to peak, like the offline range: from the steadiest extreme on
      // the other side of the body's usual position (the window median) to
      // where it is now. Capped at twice the distance from that usual
      // position, so coming back to it after a swing reads as 0, not as a
      // second swing, while rocking back and forth keeps its full range.
      const lo = heldMin(hist, 0, last, k).value;
      const hi = heldMax(hist, 0, last, k).value;
      const mid = median(hist);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(mid)) return NaN;
      const peakToPeak = s >= mid ? s - lo : hi - s;
      return Math.max(0, Math.min(peakToPeak, 2 * Math.abs(s - mid)));
    }
    // moved: the reference is the window's steadiest position on the "good" side.
    const ref = scale > 0 ? heldMin(hist, 0, last, k).value : heldMax(hist, 0, last, k).value;
    if (!Number.isFinite(ref)) return NaN;
    return s * scale - Math.max(0, ref * scale);
  }

  _torsoPx(ctx) {
    const P = (j) => (this.pok[j] ? { x: this.px[j], y: this.py[j] } : null);
    if (ctx.view === 'side') {
      const a = P(LM[`${ctx.side}Shoulder`]);
      const b = P(LM[`${ctx.side}Hip`]);
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : NaN;
    }
    const ls = P(LM.leftShoulder);
    const rs = P(LM.rightShoulder);
    const lh = P(LM.leftHip);
    const rh = P(LM.rightHip);
    if (!ls || !rs || !lh || !rh) return NaN;
    return Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  }

  _readiness(t, has, ctx, viewOk, brightness) {
    const R = this.live.ready;
    const std = this.std;
    const checks = { person: has && Boolean(ctx), inFrame: false, size: false, view: viewOk, light: true, confidence: false };
    if (checks.person) {
      const m = R.edgeMargin;
      checks.inFrame = bodyLandmarks(this.exerciseId, ctx).every((j) => {
        if (!(this.pvis[j] >= R.minJointVisibility) || !this.pok[j]) return false;
        const x = this.px[j] / this.width;
        const y = this.py[j] / this.height;
        return x > m && x < 1 - m && y > m && y < 1 - m;
      });
      checks.size = this._torsoPx(ctx) / Math.max(this.width, this.height) >= this.cfg.pose.minTorsoFraction;
      const req = this.measure.required(ctx);
      const meanVis = req.reduce((s, j) => s + this.pvis[j], 0) / req.length;
      checks.confidence = meanVis >= (std?.minVisibility ?? 0.7);
    }
    if (Number.isFinite(brightness)) checks.light = brightness >= R.minBrightness;

    // Each check has to hold for most of the last half second.
    this.readyHist.push({ t, checks });
    while (this.readyHist.length && t - this.readyHist[0].t > R.smoothSec) this.readyHist.shift();
    const steady = {};
    for (const key of Object.keys(checks)) {
      const passed = this.readyHist.filter((h) => h.checks[key]).length;
      steady[key] = passed / this.readyHist.length >= 0.7;
    }
    const ok = Object.values(steady).every(Boolean);
    if (ok && this.readySince == null) this.readySince = t;
    if (!ok) this.readySince = null;

    const cfg = this.cfg;
    let message = 'Hold that position';
    if (!steady.person) message = 'Step into the frame';
    else if (!steady.inFrame) message = this.exerciseId === 'squat' ? 'Step back until you fit from head to feet' : 'Step back until you fit from head to knees';
    else if (!steady.size) message = 'Move a little closer to the camera';
    else if (!steady.view) message = cfg.view === 'side' ? 'Turn side-on to the camera' : 'Face the camera squarely';
    else if (!steady.light) message = 'Add more light in front of you';
    else if (!steady.confidence) message = 'Hold still for a moment';

    return {
      ok,
      readyFor: ok ? t - this.readySince : 0,
      message,
      body: steady.person && steady.inFrame && steady.size,
      view: steady.person && steady.view,
      light: steady.person && steady.light && steady.confidence,
    };
  }

  // Rep counter and the hands-free stop.
  _session(t, has, values, ctx) {
    const S = this.live.autoStop;
    const Rp = this.live.reps;
    const since = t - this.recStart;

    const torso = has && ctx ? this._torsoPx(ctx) : NaN;
    const core = has && ctx && Number.isFinite(torso);
    if (!core) this.lostSince = this.lostSince ?? t;
    else this.lostSince = null;

    if (core && since <= S.baselineSec) this.torsoStart.push(torso);
    else if (core && !Number.isFinite(this.torsoBase) && this.torsoStart.length) this.torsoBase = median(this.torsoStart);
    if (core && Number.isFinite(this.torsoBase) && torso / this.torsoBase >= S.approachRatio) this.approachSince = this.approachSince ?? t;
    else this.approachSince = null;

    const s = values?.signal;
    if (Number.isFinite(s)) {
      this.sigLo = Math.min(this.sigLo, s);
      this.sigHi = Math.max(this.sigHi, s);
      const amp = Math.max(this.cfg.reps.minAbsProminence, this.sigHi - this.sigLo);
      const up = s - this.sigLo;
      if (this.repPhase === 'rest' && up >= Rp.upFrac * amp) this.repPhase = 'out';
      else if (this.repPhase === 'out' && up <= Rp.downFrac * amp) {
        this.repPhase = 'rest';
        this.reps += 1;
        this.lastRepEndT = t;
      }
      if (!Number.isFinite(this.moveRef) || Math.abs(s - this.moveRef) >= Rp.moveFrac * amp) {
        this.moveRef = s;
        this.lastMoveT = t;
      }
    }

    if (since < S.minRecordSec) return null;
    if (this.lostSince != null && t - this.lostSince >= S.lostSec) return { reason: 'left', t };
    if (this.approachSince != null && t - this.approachSince >= S.approachSec) return { reason: 'approach', t };
    if (this.reps >= 1 && t - this.lastMoveT >= S.idleSec) return { reason: 'idle', t };
    return null;
  }
}
