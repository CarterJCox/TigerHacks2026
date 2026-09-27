// quality.js: Decides whether the video is good enough to analyze. When it 
// isn't, Spotter explains what's wrong (with the measured numbers) and asks 
// for a better video instead of producing a misleading report.

import { LM, NUM_LANDMARKS } from '../pose/landmarks.js';
import { median } from './geometry.js';
import { clock, describeSpans, fixForReason, jointName, missingReason, pct, reasonPhrase, spansWhere } from './messages.js';

/**
 * Horizontal shoulder span over torso length (shoulder midpoint to hip
 * midpoint) for one frame. Side-on the shoulders overlap (small ratio);
 * facing the camera they're far apart. NaN if a point is missing.
 */
export function shoulderRatio(ls, rs, lh, rh) {
  if (!ls || !rs || !lh || !rh) return NaN;
  const torso = Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  return torso > 1e-6 ? Math.abs(ls.x - rs.x) / torso : NaN;
}

/** Whether a shoulder ratio fits the camera view the exercise needs. Used by the quality gate and the live checks. */
export function viewMatches(cfg, ratio) {
  if (!Number.isFinite(ratio)) return false;
  if (cfg.view === 'side') return ratio <= cfg.viewCheck.maxShoulderRatio;
  if (cfg.view === 'front') return ratio >= cfg.viewCheck.minShoulderRatio;
  return true;
}

/**
 * @returns {{ ok: boolean, issues: Issue[], stats: object }}
 *   Issue = { code, title, message, fix }
 */
export function assessQuality(track, sm, cfg, ctx, required) {
  const n = track.n;
  const issues = [];
  const tStart = track.times[0] ?? 0;
  const tEnd = track.times[n - 1] ?? 0;
  let poseFrames = 0;
  for (let i = 0; i < n; i++) poseFrames += track.hasPose[i];
  const poseFraction = poseFrames / n;
  const side = ctx.view === 'side';

  const stats = { frames: n, poseFraction, keyFraction: 0, torsoFraction: NaN, shoulderRatio: NaN, weakParts: [] };

  if (poseFraction < cfg.pose.minPoseFraction) {
    const gaps = spansWhere(Array.from(track.hasPose, (h) => !h), track.times);
    const when = describeSpans(gaps, tStart, tEnd);
    issues.push({
      code: 'no_person',
      title: 'Spotter could not find you in most of the video',
      message: `A person was detected in only ${pct(poseFraction)}% of frames (at least ${pct(cfg.pose.minPoseFraction)}% is needed)${when ? `; nobody was found ${when}` : ''}.`,
      fix: 'Start recording with your whole body already in frame, light yourself from the front rather than from a window behind you, and keep equipment from blocking the camera.',
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
    if (f < cfg.pose.minKeyFraction) weak.push({ j, name: jointName(j, { withSide: false }), fraction: f });
  });
  stats.weakParts = weak.map(({ name, fraction }) => ({ name, fraction }));

  if (stats.keyFraction < cfg.pose.minKeyFraction) {
    // The worst joint drives the message; others are listed after it.
    const worst = [...weak].sort((a, b) => a.fraction - b.fraction)[0] ?? null;
    if (worst) {
      const label = jointName(worst.j, { withSide: side });
      const reason = missingReason(track, sm, worst.j);
      const missing = Array.from({ length: n }, (_, i) => !sm.ok[worst.j][i]);
      const when = describeSpans(spansWhere(missing, track.times), tStart, tEnd);
      const others = [...new Set(weak.filter((w) => w !== worst).map((w) => jointName(w.j, { withSide: false })))].filter((x) => x !== worst.name);
      issues.push({
        code: 'missing_parts',
        title:
          reason === 'hidden'
            ? `Your ${label} is hard to see for much of the set`
            : reason === 'noPerson'
              ? `Your ${label} is out of view for much of the set`
              : `Your ${label} is out of frame for much of the set`,
        message: `Your ${label} was ${reasonPhrase(reason)} in ${pct(1 - worst.fraction)}% of frames${when ? `, mostly ${when}` : ''}.${
          others.length ? ` Your ${others.join(' and ')} ${others.length === 1 ? 'was' : 'were'} also hard to track.` : ''
        } All the joints this exercise measures were clear together in only ${pct(stats.keyFraction)}% of frames (${pct(cfg.pose.minKeyFraction)}% needed).`,
        fix: fixForReason(reason, worst.name),
      });
    } else {
      issues.push({
        code: 'missing_parts',
        title: 'The measured joints were rarely all visible at once',
        message: `Each joint was visible on its own, but all of them were clear together in only ${pct(stats.keyFraction)}% of frames (${pct(cfg.pose.minKeyFraction)}% needed).`,
        fix: 'Keep your whole body in frame and make sure equipment or your other limbs do not block the side facing the camera.',
      });
    }
  }

  // Size in frame and camera angle, from the raw (unsmoothed) landmarks.
  const torsoLens = [];
  const torsoTimes = [];
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
    torsoTimes.push(track.times[i]);
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
    const list = cuts.slice(0, 3).map(clock).join(', ');
    issues.push({
      code: 'camera_cut',
      title: 'The video jumps between shots',
      message: `Your position jumps further than a body can move in one frame at ${list}${cuts.length > 3 ? ' and later' : ''}. That usually means an edited clip or a camera that was picked up and moved.`,
      fix: 'Record the whole set in one continuous take with the phone propped up. If you joined clips together, upload only the one with the set.',
    });
  } else if (stats.torsoSpread > cfg.camera.maxTorsoSpread) {
    // When did it start? The first moment the size drifts well away from the opening frames.
    const opening = median(torsoLens.slice(0, Math.max(3, Math.round(track.fps * 1.5))));
    const driftAt = torsoTimes.find((t, k) => Math.abs(torsoLens[k] / opening - 1) > (cfg.camera.maxTorsoSpread - 1) / 2);
    issues.push({
      code: 'camera_moved',
      title: 'The camera moved or zoomed during the set',
      message: `Your size in the frame changed by ${Math.round((stats.torsoSpread - 1) * 100)}% across the clip${
        Number.isFinite(driftAt) ? (driftAt - tStart < 1.5 ? ' throughout the clip' : `, starting around ${clock(driftAt)}`) : ''
      } (a still camera stays under ${Math.round((cfg.camera.maxTorsoSpread - 1) * 100)}%). Joint angles and distances can't be compared when the view changes.`,
      fix: "Prop the phone up before you start, and don't zoom, pan or follow yourself with the camera while recording.",
    });
  }

  if (stats.torsoFraction < cfg.pose.minTorsoFraction) {
    const closer = Math.max(1.5, Math.ceil((cfg.pose.minTorsoFraction / stats.torsoFraction) * 2) / 2);
    issues.push({
      code: 'too_far',
      title: 'You are too small in the frame',
      message: `Your torso takes up ${pct(stats.torsoFraction)}% of the frame (at least ${pct(cfg.pose.minTorsoFraction)}% is needed for reliable joint angles).`,
      fix: `Move the camera about ${closer}× closer, or zoom in before you start recording, while keeping your whole body in view.`,
    });
  }

  const ratio = stats.shoulderRatio;
  if (cfg.view === 'side' && Number.isFinite(ratio) && !viewMatches(cfg, ratio)) {
    issues.push({
      code: 'wrong_angle',
      title: 'Film from the side for this exercise',
      message: `The camera looks like it's facing you: your shoulders appear ${ratio.toFixed(2)}× your torso length apart, but side-on they overlap (under ${cfg.viewCheck.maxShoulderRatio.toFixed(2)}×). The ${cfg.shortName.toLowerCase()} is measured from the side.`,
      fix: 'Turn about 90° so one shoulder points straight at the camera, with the arm or leg you want measured on the camera side.',
    });
  }
  if (cfg.view === 'front' && Number.isFinite(ratio) && !viewMatches(cfg, ratio)) {
    issues.push({
      code: 'wrong_angle',
      title: 'Film from the front for this exercise',
      message: `The camera looks like it's at your side: your shoulders appear only ${ratio.toFixed(2)}× your torso length apart, and facing the camera they're at least ${cfg.viewCheck.minShoulderRatio.toFixed(2)}×. The ${cfg.shortName.toLowerCase()} compares your left and right arms, so both need to be visible.`,
      fix: 'Face the camera squarely so both shoulders, elbows and wrists are in view.',
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

/** The required landmark that was missing most often within a rep. */
export function worstLandmarkInRep(sm, required, a, b) {
  let worst = null;
  for (const j of required) {
    let miss = 0;
    for (let i = a; i <= b; i++) if (!sm.ok[j][i]) miss++;
    if (!worst || miss > worst.miss) worst = { j, miss };
  }
  return worst?.miss ? worst.j : null;
}
