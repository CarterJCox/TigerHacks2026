import { jointAngle, leanFromVertical, angleFromDown, rangeIn } from '../geometry.js';
import { sidePoints, newSeries, sideRequired } from './common.js';

export default {
  requiredParts: ['Shoulder', 'Elbow', 'Wrist', 'Hip'],
  partNames: { Shoulder: 'shoulder', Elbow: 'elbow', Wrist: 'wrist', Hip: 'hip' },

  required(ctx) {
    return sideRequired(ctx.side, this.requiredParts);
  },

  series(sm, ctx) {
    const n = sm.n;
    const elbowAngle = newSeries(n);
    const upperArm = newSeries(n);
    const torsoLean = newSeries(n);
    const signal = newSeries(n);
    for (let i = 0; i < n; i++) {
      const p = sidePoints(sm, ctx.side, i);
      elbowAngle[i] = jointAngle(p.shoulder, p.elbow, p.wrist);
      signal[i] = 180 - elbowAngle[i];
      // Upper arm relative to the torso line, so a torso lean isn't counted as elbow drift.
      const arm = angleFromDown(p.shoulder, p.elbow, ctx.facing);
      const torsoDown = angleFromDown(p.shoulder, p.hip, ctx.facing);
      upperArm[i] = arm - torsoDown;
      torsoLean[i] = leanFromVertical(p.hip, p.shoulder, ctx.facing);
    }
    return { signal, elbowAngle, upperArm, torsoLean };
  },

  repMetrics(rep, S) {
    const { startIdx: a, endIdx: b } = rep;
    return {
      rom: rangeIn(S.elbowAngle, a, b),
      elbowDrift: rangeIn(S.upperArm, a, b),
      torsoSwing: rangeIn(S.torsoLean, a, b),
    };
  },
};
