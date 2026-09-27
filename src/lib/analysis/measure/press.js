import { LM } from '../../pose/landmarks.js';
import { jointAngle, leanFromVertical, rangeIn, maxIn, mean } from '../geometry.js';
import { frontPoints, medianTorso, newSeries } from './common.js';

export default {
  requiredParts: ['Shoulder', 'Elbow', 'Wrist', 'Hip'],
  partNames: { Shoulder: 'shoulders', Elbow: 'elbows', Wrist: 'wrists', Hip: 'hips' },

  required() {
    return [
      LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow,
      LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip,
    ];
  },

  series(sm, ctx) {
    const n = sm.n;
    const torso = medianTorso(sm, ctx) || 1;
    const wristL = newSeries(n);
    const wristR = newSeries(n);
    const signal = newSeries(n);
    const elbowL = newSeries(n);
    const elbowR = newSeries(n);
    const elbowAngleMean = newSeries(n);
    const lateralLean = newSeries(n);
    const hipY = newSeries(n);
    const elbowRise = newSeries(n);
    const wristGap = newSeries(n);
    for (let i = 0; i < n; i++) {
      const p = frontPoints(sm, i);
      // Wrist height above its shoulder, as % of torso length (up is positive).
      if (p.lShoulder && p.lWrist) wristL[i] = ((p.lShoulder.y - p.lWrist.y) / torso) * 100;
      if (p.rShoulder && p.rWrist) wristR[i] = ((p.rShoulder.y - p.rWrist.y) / torso) * 100;
      const both = [wristL[i], wristR[i]].filter(Number.isFinite);
      signal[i] = both.length ? both.reduce((s, v) => s + v, 0) / both.length : NaN;
      elbowL[i] = jointAngle(p.lShoulder, p.lElbow, p.lWrist);
      elbowR[i] = jointAngle(p.rShoulder, p.rElbow, p.rWrist);
      const eb = [elbowL[i], elbowR[i]].filter(Number.isFinite);
      elbowAngleMean[i] = eb.length ? eb.reduce((s, v) => s + v, 0) / eb.length : NaN;
      lateralLean[i] = leanFromVertical(p.hipMid, p.shoulderMid, 1);
      if (p.hipMid) hipY[i] = (p.hipMid.y / torso) * 100;
      // Elbow height above its shoulder (% torso, averaged over both arms); negative = below.
      const rise = [];
      if (p.lShoulder && p.lElbow) rise.push(((p.lShoulder.y - p.lElbow.y) / torso) * 100);
      if (p.rShoulder && p.rElbow) rise.push(((p.rShoulder.y - p.rElbow.y) / torso) * 100);
      if (rise.length === 2) elbowRise[i] = (rise[0] + rise[1]) / 2;
      wristGap[i] = Math.abs(wristL[i] - wristR[i]);
    }
    return { signal, wristL, wristR, elbowL, elbowR, elbowAngleMean, lateralLean, hipY, elbowRise, wristGap };
  },

  repMetrics(rep, S) {
    const { startIdx: a, endIdx: b } = rep;
    // Average the left/right gaps over the frames spent at the top, not a single frame.
    const top0 = rep.topReachIdx;
    const top1 = Math.max(rep.topReachIdx, rep.topLeaveIdx);
    const hGap = [];
    const eGap = [];
    const absLean = [];
    for (let i = top0; i <= top1; i++) {
      hGap.push(Math.abs(S.wristL[i] - S.wristR[i]));
      eGap.push(Math.abs(S.elbowL[i] - S.elbowR[i]));
    }
    for (let i = a; i <= b; i++) absLean.push(Math.abs(S.lateralLean[i]));
    return {
      rom: rangeIn(S.signal, a, b),
      heightAsym: mean(hGap),
      elbowAsym: mean(eGap),
      lateralLean: maxIn(absLean, 0, absLean.length - 1),
      legDrive: rangeIn(S.hipY, a, b),
    };
  },
};
