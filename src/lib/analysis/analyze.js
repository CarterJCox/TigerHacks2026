// analyze.js: Turns a pose track into a full set analysis:
//   keypoints -> smoothing -> quality gates -> rep detection ->
//   per-rep metrics -> baseline comparison -> breakdown point.

import { getExercise } from '../../config/exercises/index.js';
import { MEASURES } from './measure/index.js';
import { smoothTrack } from './smooth.js';
import { buildContext } from './context.js';
import { assessQuality, repConfidence } from './quality.js';
import { detectReps, phaseTimes } from './reps.js';
import { scoreSet } from './scoring.js';

function round(v, d = 2) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
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
    rep.lowConfidence = rep.confidence < cfg.pose.minRepConfidence;
    rep.scorable = !rep.lowConfidence && !rep.truncated;
    const tempo = phaseTimes(rep, cfg.reps.concentricFirst);
    rep.metrics = { ...measure.repMetrics(rep, series, ctx), liftTime: tempo.liftTime, lowerTime: tempo.lowerTime };
    rep.holdTime = tempo.holdTime;
    return rep;
  });

  const scorable = reps.filter((r) => r.scorable);
  const issues = [];
  if (!reps.length) {
    const unit = exerciseId === 'press' ? '% of torso length' : '°';
    issues.push({
      code: 'no_reps',
      title: 'No clear reps were found',
      message: `The main joint moved through at most ${Math.round(detection.range)}${unit === '°' ? '°' : ' ' + unit} in this clip; a rep needs at least ${cfg.reps.minAbsProminence}${unit === '°' ? '°' : ' ' + unit}. Check that you picked the right exercise and that the working arm or leg is the one nearest the camera.`,
    });
  } else if (scorable.length < cfg.reps.minReps) {
    const lowConf = reps.filter((r) => r.lowConfidence).length;
    issues.push({
      code: lowConf ? 'low_conf_reps' : 'too_few_reps',
      title: lowConf ? 'Tracking was too unclear during the reps' : 'Not enough reps to compare',
      message: lowConf
        ? `Found ${reps.length} rep${reps.length === 1 ? '' : 's'}, but ${lowConf} had the measured joints out of view or unclear for over ${Math.round((1 - cfg.pose.minRepConfidence) * 100)}% of the rep. Film with the working side closer to the camera and nothing in between.`
        : `Found ${scorable.length} complete rep${scorable.length === 1 ? '' : 's'}. Spotter needs at least ${cfg.reps.minReps} to compare later reps against your first ones.`,
    });
  }
  if (issues.length) {
    return { ...base, status: 'rejected', issues, sm, series, reps, detection: { range: detection.range } };
  }

  const summary = scoreSet(reps, cfg, { painReported });
  const partialReps = reps.filter((r) => r.partial).map((r) => r.index);

  return {
    ...base,
    status: 'ok',
    sm,
    series,
    reps,
    ...summary,
    partialReps,
    detection: { range: round(detection.range, 1), minProminence: round(detection.minProminence, 1) },
  };
}
