// context.js Works out which side of the body faces the camera (side-view exercises)
// and which way the person is facing, so signed angles like "leaning forward"
// mean the same thing whether they face left or right in the frame.

import { LM, NUM_LANDMARKS } from '../pose/landmarks.js';
import { median } from './geometry.js';

const SIDE_PARTS = ['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Knee', 'Ankle'];

function rawAt(track, i, j) {
  const b = (i * NUM_LANDMARKS + j) * 4;
  return { x: track.raw[b] * track.width, y: track.raw[b + 1] * track.height, z: track.raw[b + 2], v: track.raw[b + 3] };
}

export function chooseSide(track, parts = SIDE_PARTS) {
  const acc = { left: { v: 0, z: 0, n: 0 }, right: { v: 0, z: 0, n: 0 } };
  for (let i = 0; i < track.n; i++) {
    if (!track.hasPose[i]) continue;
    for (const side of ['left', 'right']) {
      for (const part of parts) {
        const p = rawAt(track, i, LM[`${side}${part}`]);
        acc[side].v += p.v;
        acc[side].z += p.z;
        acc[side].n += 1;
      }
    }
  }
  if (!acc.left.n) return 'left';
  const lv = acc.left.v / acc.left.n;
  const rv = acc.right.v / acc.right.n;
  if (Math.abs(lv - rv) > 0.04) return lv > rv ? 'left' : 'right';
  // Visibility is ambiguous: MediaPipe's z is smaller for points nearer the camera.
  return acc.left.z / acc.left.n <= acc.right.z / acc.right.n ? 'left' : 'right';
}

/** +1 when the person faces the +x direction (right side of the image), -1 otherwise. */
export function chooseFacing(track, side) {
  const noseAhead = [];
  const toeAhead = [];
  const torso = [];
  for (let i = 0; i < track.n; i++) {
    if (!track.hasPose[i]) continue;
    const nose = rawAt(track, i, LM.nose);
    const earL = rawAt(track, i, LM.leftEar);
    const earR = rawAt(track, i, LM.rightEar);
    const sh = rawAt(track, i, LM[`${side}Shoulder`]);
    const hip = rawAt(track, i, LM[`${side}Hip`]);
    torso.push(Math.hypot(sh.x - hip.x, sh.y - hip.y));
    if (nose.v > 0.3 && (earL.v > 0.3 || earR.v > 0.3)) {
      const earX = earL.v > 0.3 && earR.v > 0.3 ? (earL.x + earR.x) / 2 : earL.v > 0.3 ? earL.x : earR.x;
      noseAhead.push(nose.x - earX);
    }
    for (const s of ['left', 'right']) {
      const heel = rawAt(track, i, LM[`${s}Heel`]);
      const toe = rawAt(track, i, LM[`${s}Foot`]);
      if (heel.v > 0.4 && toe.v > 0.4) toeAhead.push(toe.x - heel.x);
    }
  }
  const t = median(torso) || 1;
  const score = (median(noseAhead) || 0) / t + (median(toeAhead) || 0) / t;
  return score >= 0 ? 1 : -1;
}

export function buildContext(track, cfg) {
  if (cfg.view === 'front') return { view: 'front', side: 'both', facing: 1 };
  const side = chooseSide(track);
  return { view: 'side', side, facing: chooseFacing(track, side) };
}
