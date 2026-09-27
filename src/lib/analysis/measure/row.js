import { jointAngle, leanFromVertical, angleFromDown, rangeIn, minIn, valueNear } from '../geometry.js';
import { sidePoints, medianTorso, newSeries, sideRequired } from './common.js';

export default {
  requiredParts: ['Shoulder', 'Elbow', 'Wrist', 'Hip'],
  partNames: { Shoulder: 'shoulder', Elbow: 'elbow', Wrist: 'wrist', Hip: 'hip' },

  required(ctx) {
    return sideRequired(ctx.side, this.requiredParts);
  },

  series(sm, ctx) {
    const n = sm.n;
    const torso = medianTorso(sm, ctx) || 1;
    const elbowAngle = newSeries(n);
    const signal = newSeries(n);
    const torsoLean = newSeries(n);
    const earGap = newSeries(n);
    const upperArm = newSeries(n);
    for (let i = 0; i < n; i++) {
      const p = sidePoints(sm, ctx.side, i);
      elbowAngle[i] = jointAngle(p.shoulder, p.elbow, p.wrist);
      signal[i] = 180 - elbowAngle[i];
      torsoLean[i] = leanFromVertical(p.hip, p.shoulder, ctx.facing);
      // Upper arm relative to the torso line: negative once the elbow is behind the torso.
      upperArm[i] = angleFromDown(p.shoulder, p.elbow, ctx.facing) - angleFromDown(p.shoulder, p.hip, ctx.facing);
      // Vertical ear-to-shoulder distance as % of torso length; it shrinks on a shrug.
      if (p.ear && p.shoulder) earGap[i] = ((p.shoulder.y - p.ear.y) / torso) * 100;
    }
    return { signal, elbowAngle, torsoLean, earGap, upperArm };
  },

  repMetrics(rep, S) {
    const { startIdx: a, endIdx: b } = rep;
    const startGap = valueNear(S.earGap, a);
    const minGap = minIn(S.earGap, a, b);
    return {
      rom: rangeIn(S.elbowAngle, a, b),
      torsoSwing: rangeIn(S.torsoLean, a, b),
      leanBack: -minIn(S.torsoLean, a, b),
      shrug: Number.isFinite(startGap) && Number.isFinite(minGap) ? startGap - minGap : NaN,
    };
  },
};
