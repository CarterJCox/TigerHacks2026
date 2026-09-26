// quality.js: Decides whether the video is good enough to analyze. When it 
// isn't, Spotter explains what's wrong (with the measured numbers) and asks 
// for a better video instead of producing a misleading report.

import { LM, NUM_LANDMARKS } from '../pose/landmarks.js';
import { median } from './geometry.js';

const PART_LABELS = {
  Shoulder: 'shoulder',
  Elbow: 'elbow',
  Wrist: 'wrist',
  Hip: 'hip',
  Knee: 'knee',
  Ankle: 'ankle',
};

function landmarkName(j) {
  const name = Object.keys(LM).find((k) => LM[k] === j) || '';
  const part = name.replace(/^(left|right)/, '');
  const label = PART_LABELS[part] || part.toLowerCase();
  return label;
}

function pct(x) {
  return Math.round(x * 100);
}

/**
 * @returns {{ ok: boolean, issues: Issue[], stats: object }}
 *   Issue = { code, title, message }
 */
export function assessQuality(track, sm, cfg, ctx, required) {
  const n = track.n;
  const issues = [];
  let poseFrames = 0;
  for (let i = 0; i < n; i++) poseFrames += track.hasPose[i];
  const poseFraction = poseFrames / n;

  const stats = { frames: n, poseFraction, keyFraction: 0, torsoFraction: NaN, shoulderRatio: NaN, weakParts: [] };

  if (poseFraction < cfg.pose.minPoseFraction) {
    issues.push({
      code: 'no_person',
      title: 'Spotter could not find you in most of the video',
      message: `A person was detected in ${pct(poseFraction)}% of sampled frames; at least ${pct(cfg.pose.minPoseFraction)}% is needed. Make sure your whole body is in frame, well lit, and not blocked by equipment.`,
    });
    return { ok: false, issues, stats };
  }

  // How often each required landmark is trustworthy.
  let keyFrames = 0;
  const partOk = required.map(() => 0);
  for (let i = 0; i < n; i++) {
    let all = true;
    required.forEach((j, k) => {
      if (sm.ok[j][i]) partOk[k] += 1;
      else all = false;
    });
    if (all) keyFrames++;
  }
  stats.keyFraction = keyFrames / n;
  const weak = [];
  required.forEach((j, k) => {
    const f = partOk[k] / n;
    if (f < cfg.pose.minKeyFraction) weak.push({ name: landmarkName(j), fraction: f });
  });
  stats.weakParts = weak;

  if (stats.keyFraction < cfg.pose.minKeyFraction) {
    const names = [...new Set(weak.map((w) => w.name))];
    const which = names.length ? names.join(', ') : 'measured joints';
    issues.push({
      code: 'missing_parts',
      title: 'Key joints were not clearly visible',
      message: `The ${which} ${names.length === 1 ? 'was' : 'were'} hard to track: all the joints this exercise needs were clearly visible in only ${pct(stats.keyFraction)}% of frames (${pct(cfg.pose.minKeyFraction)}% needed). Keep your whole body in frame, avoid baggy sleeves or equipment blocking the camera, and use even lighting.`,
    });
  }

  // Size in frame and camera angle, from the raw (unsmoothed) landmarks.
  const torsoLens = [];
  const shoulderSpans = [];
  const at = (i, j) => {
    const b = (i * NUM_LANDMARKS + j) * 4;
    return { x: track.raw[b] * track.width, y: track.raw[b + 1] * track.height };
  };
  for (let i = 0; i < n; i++) {
    if (!track.hasPose[i]) continue;
    const ls = at(i, LM.leftShoulder);
    const rs = at(i, LM.rightShoulder);
    const lh = at(i, LM.leftHip);
    const rh = at(i, LM.rightHip);
    const sm2 = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const hm = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
    torsoLens.push(Math.hypot(sm2.x - hm.x, sm2.y - hm.y));
    shoulderSpans.push(Math.abs(ls.x - rs.x));
  }
  const torso = median(torsoLens);
  stats.torsoFraction = torso / Math.max(track.width, track.height);
  stats.shoulderRatio = median(shoulderSpans) / torso;

  // Camera stability. Torso length barely changes during these lifts, so a
  // large spread means zooming or the camera moving closer/farther; a jump of
  // the hips between consecutive frames that no body could make means a cut.
  const sorted = [...torsoLens].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
  stats.torsoSpread = sorted.length > 10 ? p(0.95) / p(0.05) : 1;
  const hipMid = (i) => {
    if (i < 0 || i >= n || !track.hasPose[i]) return null;
    const lh = at(i, LM.leftHip);
    const rh = at(i, LM.rightHip);
    return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  };
  const far = (a, b) => a && b && Math.hypot(a.x - b.x, a.y - b.y) > cfg.camera.maxJumpTorso * torso;
  const cuts = [];
  for (let i = 1; i < n; i++) {
    const before = hipMid(i - 1);
    // A cut stays displaced; a one-frame tracking glitch snaps back.
    if (far(hipMid(i), before) && far(hipMid(i + 2), before) && far(hipMid(i + 4), before)) cuts.push(track.times[i]);
  }
  stats.cuts = cuts;
  if (cuts.length) {
    const at0 = cuts[0];
    issues.push({
      code: 'camera_cut',
      title: 'The video jumps between shots',
      message: `Your position jumped further than a body can move in one frame (first at ${Math.floor(at0 / 60)}:${(at0 % 60).toFixed(1).padStart(4, '0')}), which usually means an edited clip or a camera that was moved. Record the whole set in one continuous take with the phone kept still.`,
    });
  } else if (stats.torsoSpread > cfg.camera.maxTorsoSpread) {
    issues.push({
      code: 'camera_moved',
      title: 'The camera moved or zoomed during the set',
      message: `Your torso's size in the frame changed by ${Math.round((stats.torsoSpread - 1) * 100)}% during the clip (under ${Math.round((cfg.camera.maxTorsoSpread - 1) * 100)}% is expected with a still camera). Joint angles and distances need a fixed camera: prop the phone up and don't zoom while recording.`,
    });
  }

  if (stats.torsoFraction < cfg.pose.minTorsoFraction) {
    issues.push({
      code: 'too_far',
      title: 'You are too small in the frame',
      message: `Your torso takes up ${pct(stats.torsoFraction)}% of the frame (${pct(cfg.pose.minTorsoFraction)}% needed for reliable joint angles). Move the camera closer or zoom in, keeping your whole body in view.`,
    });
  }

  const ratio = stats.shoulderRatio;
  if (cfg.view === 'side' && Number.isFinite(ratio) && ratio > cfg.viewCheck.maxShoulderRatio) {
    issues.push({
      code: 'wrong_angle',
      title: 'This looks like it was filmed from the front or at an angle',
      message: `The ${cfg.shortName.toLowerCase()} needs a side view. Your shoulders appear ${ratio.toFixed(2)}× your torso length apart; side-on they overlap (under ${cfg.viewCheck.maxShoulderRatio.toFixed(2)}×). Turn so your shoulder points at the camera.`,
    });
  }
  if (cfg.view === 'front' && Number.isFinite(ratio) && ratio < cfg.viewCheck.minShoulderRatio) {
    issues.push({
      code: 'wrong_angle',
      title: 'This looks like it was filmed from the side',
      message: `The ${cfg.shortName.toLowerCase()} needs a front view so both arms can be compared. Your shoulders appear only ${ratio.toFixed(2)}× your torso length apart (at least ${cfg.viewCheck.minShoulderRatio.toFixed(2)}× when facing the camera). Face the camera squarely.`,
    });
  }

  return { ok: issues.length === 0, issues, stats };
}

/** Fraction of frames within a rep where every required landmark is trusted. */
export function repConfidence(sm, required, a, b) {
  let good = 0;
  for (let i = a; i <= b; i++) {
    if (required.every((j) => sm.ok[j][i])) good++;
  }
  return good / Math.max(1, b - a + 1);
}
