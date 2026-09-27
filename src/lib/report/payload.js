// The only data that ever leaves the device: rounded measurements and labels.
// No video, images, landmarks or the weight value are included.

import { getExercise } from '../../config/exercises/index.js';
import { round } from './format.js';

function dev(d, def) {
  return {
    value: round(d.value, def.decimals),
    firstRepsAverage: round(d.base, def.decimals),
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
    firstRepsAverage: round(analysis.stats[key]?.mean, def.decimals),
  }));
  const rules = cfg.standards?.rules ?? [];
  const ruleUnit = (id) => rules.find((r) => r.id === id) ?? { decimals: 0 };
  const form = analysis.form;
  return {
    exercise: { name: cfg.name, view: cfg.viewLabel },
    // Layer 1: fixed form standards, checked on every rep (first reps included).
    // Flags are ordered red (injury risk), then yellow (less effective).
    formStandards: form
      ? {
          severityMeaning: {
            red: 'injury risk: a pattern linked to extra joint or back strain',
            yellow: 'less effective for building muscle: safe, but the target muscle does less of the work',
            green: 'good form: nothing flagged',
          },
          setSeverity: form.severity,
          gauge: form.value == null ? null : Math.round(form.value),
          mainReason: form.reason.text,
          rules: rules.map((r) => ({
            rule: r.id,
            label: r.label,
            unit: r.unit,
            worseWhen: r.worse === 'above' ? 'higher' : 'lower',
            yellowLimit: r.yellow ?? null,
            redLimit: r.red ?? null,
          })),
          flags: form.flags.map((f) => ({
            rule: f.ruleId,
            label: f.label,
            severity: f.severity,
            reps: f.reps,
            worstRep: f.worstRep,
            worstValue: round(f.value, ruleUnit(f.ruleId).decimals),
            limit: f.limit,
            text: f.text,
          })),
          notCheckedUnclearTracking: form.skipped.map((s) => ({ rule: s.ruleId, label: s.label, reps: s.reps })),
        }
      : null,
    set: {
      plannedReps: Number(input?.plannedReps) || null,
      countedReps: analysis.reps.length,
      partialReps: analysis.partialReps,
      unscoredReps: analysis.reps.filter((r) => !r.scorable).map((r) => r.index),
      setScore: analysis.setScore,
    },
    painReported: Boolean(input?.painReported),
    // Layer 2: later reps compared with the first reps (`baseline` in the
    // code; field names here use the wording the report should use). A change
    // here counts as yellow.
    firstReps: analysis.baselineReps,
    metrics,
    reps: analysis.reps.map((r) => ({
      rep: r.index,
      severity: r.severity, // combined: the worse of the form standards and the first-reps comparison
      formFlags: r.form
        ? r.form.flags
            .filter((f) => f.kind === 'rule')
            .map((f) => ({ rule: f.ruleId, severity: f.severity, value: round(r.form.checks[f.ruleId].value, ruleUnit(f.ruleId).decimals) }))
        : [],
      status: r.status, // first-reps comparison only
      score: r.score,
      partial: r.partial,
      isFirstRep: r.isBaseline,
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
