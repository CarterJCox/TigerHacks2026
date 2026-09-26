import { jointAngle, leanFromVertical, rangeIn, maxIn, valueNear, dist, median } from '../geometry.js';
import { sidePoints, newSeries, sideRequired } from './common.js';

export default {
  requiredParts: ['Shoulder', 'Hip', 'Knee', 'Ankle'],
  partNames: { Shoulder: 'shoulder', Hip: 'hip', Knee: 'knee', Ankle: 'ankle' },

  required(ctx) {
    return sideRequired(ctx.side, this.requiredParts);
  },

  series(sm, ctx) {
    const n = sm.n;
    const kneeAngle = newSeries(n);
    const signal = newSeries(n);
    const torsoLean = newSeries(n);
    const heelRel = newSeries(n);
    const footLens = [];
    for (let i = 0; i < n; i++) {
      const p = sidePoints(sm, ctx.side, i);
      footLens.push(dist(p.heel, p.foot));
    }
    const footLen = median(footLens);
    for (let i = 0; i < n; i++) {
      const p = sidePoints(sm, ctx.side, i);
      kneeAngle[i] = jointAngle(p.hip, p.knee, p.ankle);
      signal[i] = 180 - kneeAngle[i];
      torsoLean[i] = leanFromVertical(p.hip, p.shoulder, ctx.facing);
      // Heel height above the toes as % of foot length (positive = heel up).
      if (p.heel && p.foot && footLen > 1) heelRel[i] = ((p.foot.y - p.heel.y) / footLen) * 100;
    }
    return { signal, kneeAngle, torsoLean, heelRel };
  },

  repMetrics(rep, S) {
    const { startIdx: a, endIdx: b, peakIdx: p, topLeaveIdx } = rep;
    // Extra lean during the first half of the ascent, compared with the bottom.
    const upStart = Math.max(p, topLeaveIdx);
    const upMid = Math.min(b, upStart + Math.max(1, Math.round((b - upStart) / 2)));
    const leanBottom = valueNear(S.torsoLean, p);
    const leanUp = maxIn(S.torsoLean, upStart, upMid);
    const heelStart = valueNear(S.heelRel, a);
    const heelMax = maxIn(S.heelRel, a, b);
    return {
      rom: rangeIn(S.kneeAngle, a, b),
      forwardLean: maxIn(S.torsoLean, a, b),
      hipsRiseFirst: Number.isFinite(leanUp) && Number.isFinite(leanBottom) ? Math.max(0, leanUp - leanBottom) : NaN,
      heelLift: Number.isFinite(heelStart) && Number.isFinite(heelMax) ? Math.max(0, heelMax - heelStart) : NaN,
    };
  },
};
