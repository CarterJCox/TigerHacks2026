// The only data that ever leaves the device: rounded measurements and labels.
// No video, images, landmarks or the weight value are included.

import { getExercise } from '../../config/exercises/index.js';
import { round } from './format.js';

function dev(d, def) {
  return {
    value: round(d.value, def.decimals),
    baseline: round(d.base, def.decimals),
    change: round(d.delta, def.decimals),
    changePct: Number.isFinite(d.pct) ? Math.round(d.pct * 100) : null,
    level: d.level,
  };
}

export function buildPayload(analysis, input, templateReport) {
  const cfg = getExercise(analysis.exerciseId);
  const metrics = Object.entries(cfg.metrics).map(([key, def]) => ({
    key,
    label: def.label,
    unit: def.unit,
    worseWhen: def.direction === 'increase' ? 'higher' : def.direction === 'decrease' ? 'lower' : 'different',
    reliability: def.reliability,
    baselineMean: round(analysis.stats[key]?.mean, def.decimals),
  }));
  return {
    exercise: { name: cfg.name, view: cfg.viewLabel },
    set: {
      plannedReps: Number(input?.plannedReps) || null,
      countedReps: analysis.reps.length,
      partialReps: analysis.partialReps,
      unscoredReps: analysis.reps.filter((r) => !r.scorable).map((r) => r.index),
      setScore: analysis.setScore,
    },
    painReported: Boolean(input?.painReported),
    baselineReps: analysis.baselineReps,
    metrics,
    reps: analysis.reps.map((r) => ({
      rep: r.index,
      status: r.status,
      score: r.score,
      partial: r.partial,
      baseline: r.isBaseline,
      changes: Object.entries(r.deviations)
        .filter(([, d]) => d.level === 'notable' || d.level === 'major')
        .map(([key, d]) => ({ metric: key, label: cfg.metrics[key].label, ...dev(d, cfg.metrics[key]) })),
    })),
    breakdown: analysis.breakdown
      ? {
          rep: analysis.breakdown.rep,
          kind: analysis.breakdown.kind === 'breakdown' ? 'broke down' : 'changed',
          causes: analysis.breakdown.causes.map((c) => ({ metric: c.key, label: cfg.metrics[c.key].label, ...dev(c, cfg.metrics[c.key]) })),
        }
      : null,
    isolatedReps: analysis.isolated,
    riskFactors: analysis.risks.map((r) => ({
      title: r.title,
      metric: r.metric,
      firstRep: r.firstRep,
      reps: r.reps,
      ...dev(r.first, cfg.metrics[r.metric]),
    })),
    candidateCues: input?.painReported ? [] : analysis.cues.map((c) => c.text),
    templateHeadline: templateReport.headline,
  };
}
