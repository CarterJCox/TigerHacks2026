// analyze.js: Turns a pose track into a full set analysis:
//   keypoints -> smoothing -> quality gates -> rep detection ->
//   per-rep metrics -> baseline comparison -> breakdown point.

import { EXERCISES, getExercise } from '../../config/exercises/index.js';
import { MEASURES } from './measure/index.js';
import { smoothTrack } from './smooth.js';
import { buildContext } from './context.js';
import { assessQuality, repConfidence, worstLandmarkInRep } from './quality.js';
import { jointName } from './messages.js';
import { listReps } from '../report/format.js';
import { detectReps, phaseTimes } from './reps.js';
import { scoreSet, pickCues } from './scoring.js';
import { evaluateStandards } from './standards.js';

function round(v, d = 2) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

// How each exercise's rep signal is described in "no reps" messages.
const MOTION_WORDS = {
  curl: { verb: 'Your elbow bent', unit: '°', part: 'arm' },
  row: { verb: 'Your elbow bent', unit: '°', part: 'arm' },
  squat: { verb: 'Your knees bent', unit: '°', part: 'leg' },
  press: { verb: 'Your wrists rose', unit: '% of your torso length', part: 'arm' },
};

/**
 * When the chosen exercise finds no reps, check whether the same footage
 * shows clear reps of a different exercise filmed from the same kind of view.
 */
function otherExerciseMatch(track, sm, exerciseId) {
  const chosen = getExercise(exerciseId);
  let best = null;
  for (const [id, cfg] of Object.entries(EXERCISES)) {
    if (id === exerciseId || cfg.view !== chosen.view) continue;
    const ctx = buildContext(track, cfg);
    const series = MEASURES[id].series(sm, ctx);
    const found = detectReps(series.signal, track.times, cfg.reps).reps.filter((r) => !r.truncated).length;
    if (found >= 2 && (!best || found > best.reps)) best = { id, reps: found };
  }
  return best;
}

/** Longest run of frames (in frames) within [a, b] where a required joint is missing. */
function longestGap(sm, required, a, b) {
  let best = 0;
  let run = 0;
  for (let i = a; i <= b; i++) {
    if (required.every((j) => sm.ok[j][i])) run = 0;
    else best = Math.max(best, ++run);
  }
  return best;
}

/** Why a counted rep isn't scored, in words the UI can show as-is. */
function excludedReason(rep, required, sm, ctx) {
  if (rep.truncatedStart) return { code: 'cut_start', text: 'Cut off by the start of the video' };
  if (rep.truncatedEnd) return { code: 'cut_end', text: 'Cut off by the end of the video' };
  const j = worstLandmarkInRep(sm, required, rep.startIdx, rep.endIdx);
  const joint = j === null ? 'a measured joint' : `your ${jointName(j, { withSide: ctx.view === 'side' })}`;
  if (rep.trackingGap) return { code: 'gap', text: `Tracking lost ${joint} for ${rep.gapSec.toFixed(1)} s during this rep` };
  return { code: 'unclear', text: `Tracking was clear in only ${Math.round(rep.confidence * 100)}% of this rep (${joint} was hard to see)` };
}

export function analyzeTrack(track, exerciseId, { painReported = false } = {}) {
  const cfg = getExercise(exerciseId);
  const measure = MEASURES[exerciseId];
  const sm = smoothTrack(track, cfg.pose);
  const ctx = buildContext(track, cfg);
  const required = measure.required(ctx);
  const quality = assessQuality(track, sm, cfg, ctx, required);
  const series = measure.series(sm, ctx);

  const base = {
    exerciseId,
    ctx,
    quality: quality.stats,
    fps: track.fps,
    t0: track.t0 || 0, // start of the analyzed range in the video (non-zero when trimmed)
    duration: track.duration,
    width: track.width,
    height: track.height,
  };

  if (!quality.ok) {
    return { ...base, status: 'rejected', issues: quality.issues, sm, series, reps: [] };
  }

  const detection = detectReps(series.signal, track.times, cfg.reps);
  const reps = detection.reps.map((r) => {
    const rep = { ...r };
    rep.confidence = repConfidence(sm, required, rep.startIdx, rep.endIdx);
    rep.gapSec = longestGap(sm, required, rep.startIdx, rep.endIdx) / track.fps;
    rep.lowConfidence = rep.confidence < cfg.pose.minRepConfidence;
    // A rep found across a tracking gap is counted, but its measurements
    // would be missing the part of the movement that wasn't seen.
    rep.trackingGap = rep.gapSec > cfg.pose.maxGapSec;
    rep.scorable = !rep.lowConfidence && !rep.truncated && !rep.trackingGap;
    rep.excluded = rep.scorable ? null : excludedReason(rep, required, sm, ctx);
    const tempo = phaseTimes(rep, cfg.reps.concentricFirst);
    rep.metrics = { ...measure.repMetrics(rep, series, ctx), liftTime: tempo.liftTime, lowerTime: tempo.lowerTime };
    rep.holdTime = tempo.holdTime;
    return rep;
  });

  const scorable = reps.filter((r) => r.scorable);
  const issues = [];
  if (!reps.length) {
    const motion = MOTION_WORDS[exerciseId];
    const other = otherExerciseMatch(track, sm, exerciseId);
    issues.push({
      code: 'no_reps',
      title: other ? `This looks like a ${EXERCISES[other.id].shortName.toLowerCase()}, not a ${cfg.shortName.toLowerCase()}` : 'No clear reps were found',
      message: `${motion.verb} through at most ${Math.round(detection.range)}${motion.unit} in this clip, and a ${cfg.shortName.toLowerCase()} rep needs at least ${cfg.reps.minAbsProminence}${motion.unit}.${
        other ? ` The movement does match ${other.reps} reps of a ${EXERCISES[other.id].shortName.toLowerCase()}.` : ''
      }`,
      fix: other
        ? `Pick ${EXERCISES[other.id].name} and analyze the video again.`
        : `Check that you picked the right exercise, that the ${motion.part} you're working is the one nearest the camera, and that the clip includes the reps rather than only the setup.`,
      suggestExercise: other?.id ?? null,
    });
  } else if (scorable.length < cfg.reps.minReps) {
    const unclear = reps.filter((r) => r.lowConfidence);
    const cut = reps.filter((r) => r.truncated && !r.lowConfidence);
    if (unclear.length) {
      // Name the joint that was lost most often during the unclear reps.
      const counts = {};
      for (const r of unclear) {
        const j = worstLandmarkInRep(sm, required, r.startIdx, r.endIdx);
        if (j !== null) counts[j] = (counts[j] || 0) + 1;
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      const joint = top ? jointName(Number(top[0]), { withSide: ctx.view === 'side' }) : 'measured joints';
      issues.push({
        code: 'low_conf_reps',
        title: `Your ${joint} was hard to track during the reps`,
        message: `Spotter found ${reps.length} rep${reps.length === 1 ? '' : 's'}, but on ${listReps(unclear.map((r) => r.index))} your ${joint} was out of view or unclear for more than ${Math.round((1 - cfg.pose.minRepConfidence) * 100)}% of the rep, so ${unclear.length === 1 ? 'it' : 'they'} can't be scored. That leaves ${scorable.length} usable rep${scorable.length === 1 ? '' : 's'}, and at least ${cfg.reps.minReps} are needed.`,
        fix: `Film with your ${joint} on the side nearest the camera, with nothing between it and the lens, and keep it inside the frame at both ends of each rep.`,
      });
    } else {
      issues.push({
        code: 'too_few_reps',
        title: 'Not enough reps to compare',
        message: `Spotter found ${scorable.length} complete rep${scorable.length === 1 ? '' : 's'}${
          cut.length ? ` (${listReps(cut.map((r) => r.index))} ${cut.length === 1 ? 'was' : 'were'} cut off by the start or end of the clip)` : ''
        }. At least ${cfg.reps.minReps} are needed to compare later reps against your first ones.`,
        fix: cut.length
          ? 'Start recording before the first rep and stop after the last one. If you trimmed the video, widen the trim so every rep is complete.'
          : 'Record a full set of at least 3 reps in one clip.',
      });
    }
  }
  if (issues.length) {
    return { ...base, status: 'rejected', issues, sm, series, reps, detection: { range: detection.range } };
  }

  const summary = scoreSet(reps, cfg, { painReported });
  // Second layer: fixed form standards on every scored rep, combined with the
  // first-reps comparison into one severity per rep. Runs only here, after
  // every quality gate (including the camera-angle check) has passed.
  const form = evaluateStandards(reps, series, sm, ctx, cfg, track.fps);
  // The breakdown point still comes from the first-reps comparison, but it
  // only reads as "broke down" when a rep in that run is an injury risk.
  if (summary.breakdown) {
    const run = reps.filter((r) => r.scorable && r.index >= summary.breakdown.rep).slice(0, cfg.scoring.sustainReps);
    summary.breakdown.kind = run.some((r) => r.severity === 'red') ? 'breakdown' : 'change';
  }
  // Cues follow the same order as the report: red flags, yellow flags, then changes.
  const formCues = form.flags.map((f) => cfg.standards.rules.find((r) => r.id === f.ruleId)?.cue).filter(Boolean);
  summary.cues = pickCues(summary.breakdown, summary.risks, reps, cfg, painReported, formCues);
  const partialReps = reps.filter((r) => r.partial).map((r) => r.index);

  return {
    ...base,
    status: 'ok',
    sm,
    series,
    reps,
    ...summary,
    form,
    partialReps,
    detection: { range: round(detection.range, 1), minProminence: round(detection.minProminence, 1) },
  };
}
