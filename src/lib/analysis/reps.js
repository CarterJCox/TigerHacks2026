// reps.js: Rep detection from a joint-angle signal where higher = deeper into the
// rep (elbow flexion for curls and rows, wrist height for presses, knee flexion
// for squats).
//
// 1. Peaks are found by topographic prominence: a peak counts only if the
//    signal drops by at least `minProminence` on both sides before reaching a
//    higher peak. Jitter, fidgeting and pauses at the top don't create reps.
// 2. Each rep runs from where the signal leaves its resting level to where it
//    returns to it, so pauses between reps are excluded from rep time.
// 3. Reps whose travel is well below a typical rep are marked partial; reps
//    cut off by the start/end of the clip (or a tracking gap) are marked
//    truncated and not scored.

import { smoothSeries } from './smooth.js';
import { percentile, median } from './geometry.js';

function crossTime(s, times, i0, i1, level) {
  if (i0 === i1 || i0 < 0 || i1 >= s.length) return times[Math.max(0, Math.min(s.length - 1, i0))];
  const a = s[i0];
  const b = s[i1];
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return times[i0];
  const f = Math.max(0, Math.min(1, (level - a) / (b - a)));
  return times[i0] + f * (times[i1] - times[i0]);
}

function prominence(s, i) {
  const v = s[i];
  let leftMin = v;
  for (let k = i - 1; k >= 0; k--) {
    if (!Number.isFinite(s[k]) || s[k] > v) break;
    if (s[k] < leftMin) leftMin = s[k];
  }
  let rightMin = v;
  for (let k = i + 1; k < s.length; k++) {
    if (!Number.isFinite(s[k]) || s[k] > v) break;
    if (s[k] < rightMin) rightMin = s[k];
  }
  return v - Math.max(leftMin, rightMin);
}

function segmentBounds(s, i) {
  let a = i;
  while (a > 0 && Number.isFinite(s[a - 1])) a--;
  let b = i;
  while (b < s.length - 1 && Number.isFinite(s[b + 1])) b++;
  return [a, b];
}

function argMinRange(s, a, b) {
  let m = Infinity;
  let idx = a;
  for (let i = a; i <= b; i++) {
    if (Number.isFinite(s[i]) && s[i] < m) {
      m = s[i];
      idx = i;
    }
  }
  return idx;
}

/**
 * @param signalRaw Float32Array (NaN where unknown)
 * @param times Float64Array seconds
 * @param cfg exercise.reps
 * @returns {{ reps: Rep[], range: number, minProminence: number, smoothed: Float32Array }}
 */
export function detectReps(signalRaw, times, cfg) {
  const s = smoothSeries(signalRaw, 1.2);
  const finite = [];
  for (const v of s) if (Number.isFinite(v)) finite.push(v);
  if (finite.length < 8) return { reps: [], range: 0, minProminence: cfg.minAbsProminence, smoothed: s };
  finite.sort((a, b) => a - b);
  const range = percentile(finite, 0.95) - percentile(finite, 0.05);
  const minProm = Math.max(cfg.minAbsProminence, cfg.minProminenceFrac * range);
  if (range < cfg.minAbsProminence) return { reps: [], range, minProminence: minProm, smoothed: s };

  // Local maxima (first index of any plateau).
  const peaks = [];
  for (let i = 0; i < s.length; i++) {
    if (!Number.isFinite(s[i])) continue;
    const l = i > 0 && Number.isFinite(s[i - 1]) ? s[i - 1] : -Infinity;
    const r = i < s.length - 1 && Number.isFinite(s[i + 1]) ? s[i + 1] : -Infinity;
    if (s[i] > l && s[i] >= r && prominence(s, i) >= minProm) peaks.push(i);
  }
  if (!peaks.length) return { reps: [], range, minProminence: minProm, smoothed: s };

  // Valleys between consecutive peaks (and at the ends of each segment).
  const raw = peaks.map((p, k) => {
    const [segA, segB] = segmentBounds(s, p);
    const lb = k > 0 ? Math.max(peaks[k - 1], segA) : segA;
    const rb = k < peaks.length - 1 ? Math.min(peaks[k + 1], segB) : segB;
    return { p, segA, segB, vL: argMinRange(s, lb, p), vR: argMinRange(s, p, rb) };
  });

  // The typical resting level. A valley far below it (picking the weights up
  // off the floor, racking them after the set) is clamped to it so it doesn't
  // stretch the first or last rep.
  const typicalValley = median(raw.flatMap((r) => [s[r.vL], s[r.vR]]));

  const reps = [];
  for (const r of raw) {
    const { p, segA, segB, vL, vR } = r;
    const floorL = Math.max(s[vL], typicalValley);
    const floorR = Math.max(s[vR], typicalValley);
    const ampL = s[p] - floorL;
    const ampR = s[p] - floorR;
    if (ampL <= 0 || ampR <= 0) continue;
    const restL = floorL + cfg.restTolFrac * ampL;
    const restR = floorR + cfg.restTolFrac * ampR;
    const topL = s[p] - cfg.peakTolFrac * ampL;
    const topR = s[p] - cfg.peakTolFrac * ampR;

    let start = -1;
    for (let i = p; i >= segA; i--) {
      if (s[i] <= restL) {
        start = i;
        break;
      }
    }
    let end = -1;
    for (let i = p; i <= segB; i++) {
      if (s[i] <= restR) {
        end = i;
        break;
      }
    }
    const truncatedStart = start < 0;
    const truncatedEnd = end < 0;
    if (truncatedStart) start = segA;
    if (truncatedEnd) end = segB;

    let topReach = p;
    for (let i = start; i <= p; i++) if (s[i] >= topL) {
      topReach = i;
      break;
    }
    let topLeave = p;
    for (let i = end; i >= p; i--) if (s[i] >= topR) {
      topLeave = i;
      break;
    }

    const tStart = truncatedStart ? times[start] : crossTime(s, times, start, start + 1, restL);
    const tEnd = truncatedEnd ? times[end] : crossTime(s, times, end - 1, end, restR);
    const tTopReach = topReach > start ? crossTime(s, times, topReach - 1, topReach, topL) : times[topReach];
    const tTopLeave = topLeave < end ? crossTime(s, times, topLeave, topLeave + 1, topR) : times[topLeave];
    const duration = tEnd - tStart;
    if (duration < cfg.minRepSec || duration > cfg.maxRepSec) continue;

    reps.push({
      startIdx: start,
      endIdx: end,
      peakIdx: p,
      topReachIdx: topReach,
      topLeaveIdx: topLeave,
      tStart,
      tEnd,
      tPeak: times[p],
      tTopReach,
      tTopLeave,
      peakValue: s[p],
      amplitude: (ampL + ampR) / 2,
      truncated: truncatedStart || truncatedEnd,
    });
  }

  const fullAmps = reps.filter((r) => !r.truncated).map((r) => r.amplitude).sort((a, b) => a - b);
  const refAmp = fullAmps.length ? percentile(fullAmps, 0.75) : 0;
  reps.forEach((rep, i) => {
    rep.index = i + 1;
    rep.partial = refAmp > 0 && rep.amplitude < cfg.partialFrac * refAmp;
  });
  return { reps, range, minProminence: minProm, smoothed: s, refAmplitude: refAmp };
}

/** Lifting / lowering / hold time for a rep, in seconds. */
export function phaseTimes(rep, concentricFirst) {
  const first = Math.max(0, rep.tTopReach - rep.tStart);
  const hold = Math.max(0, rep.tTopLeave - rep.tTopReach);
  const second = Math.max(0, rep.tEnd - rep.tTopLeave);
  return concentricFirst
    ? { liftTime: first, lowerTime: second, holdTime: hold }
    : { lowerTime: first, liftTime: second, holdTime: hold };
}
