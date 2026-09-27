// scoring.js: Compares every rep with the user's own baseline reps and finds where form
// changed. All thresholds come from the exercise config.

import { mean, stdev } from './geometry.js';

const LEVEL_RANK = { ok: 0, notable: 1, major: 2 };

export function selectBaseline(reps, cfg) {
  const scorable = reps.filter((r) => r.scorable);
  const count = scorable.length >= cfg.baseline.threeRepMinSet ? cfg.baseline.maxReps : scorable.length >= 3 ? 2 : 1;
  const full = scorable.filter((r) => !r.partial);
  const chosen = full.slice(0, count);
  // If there aren't enough full reps early on, fall back to the first scorable ones.
  for (const r of scorable) {
    if (chosen.length >= count) break;
    if (!chosen.includes(r)) chosen.push(r);
  }
  chosen.sort((a, b) => a.index - b.index);
  return chosen;
}

export function baselineStats(baselineReps, metricDefs) {
  const stats = {};
  for (const key of Object.keys(metricDefs)) {
    const values = baselineReps.map((r) => r.metrics[key]).filter(Number.isFinite);
    stats[key] = {
      mean: mean(values),
      sd: stdev(values),
      min: values.length ? Math.min(...values) : NaN,
      max: values.length ? Math.max(...values) : NaN,
      n: values.length,
    };
  }
  return stats;
}

export function deviation(value, stat, def) {
  if (!Number.isFinite(value) || !stat || !Number.isFinite(stat.mean)) {
    return { value, base: stat?.mean ?? NaN, delta: NaN, pct: NaN, norm: 0, severity: 0, level: 'na' };
  }
  const delta = value - stat.mean;
  const pct = Math.abs(stat.mean) > 1e-6 ? delta / Math.abs(stat.mean) : NaN;
  const bad = def.direction === 'increase' ? delta : def.direction === 'decrease' ? -delta : Math.abs(delta);
  // Only the part of the change that goes beyond the baseline reps' own range
  // counts: a value one of your baseline reps already had is not a change.
  const beyond =
    def.direction === 'increase'
      ? value - stat.max
      : def.direction === 'decrease'
        ? stat.min - value
        : Math.max(value - stat.max, stat.min - value);
  let adj = Math.max(0, beyond);
  if (Math.abs(delta) < def.minAbsChange) adj = 0;
  const norm = def.mode === 'relative' ? adj / Math.max(Math.abs(stat.mean), def.minAbsChange) : adj;
  const level = norm >= def.major ? 'major' : norm >= def.notable ? 'notable' : 'ok';
  // Continuous deviation for the displayed score: how far the rep moved from
  // the baseline average in the worse direction, relative to the "major"
  // threshold plus the range the baseline reps themselves covered. No noise
  // floor and no dead zone, so small real differences cost a few points, but
  // a baseline that already varied a lot isn't treated as a precise target.
  const ref = def.mode === 'relative' ? Math.max(Math.abs(stat.mean), def.minAbsChange) : 1;
  const spread = Number.isFinite(stat.max - stat.min) ? (stat.max - stat.min) / ref : 0;
  const cont = Math.max(0, bad) / ref / (def.major + spread);
  return { value, base: stat.mean, delta, pct, norm, severity: norm / def.major, cont, level, worse: bad > 0 };
}

function scoreRep(rep, cfg) {
  // Status (green/yellow/red) uses the threshold levels and the
  // beyond-baseline-range penalty, exactly as before, so rep colours and the
  // breakdown point don't move.
  let statusPenalty = 0;
  // The displayed 0-100 score is continuous (see deviation().cont).
  let penalty = 0;
  let hasMajor = false;
  let hasNotable = false;
  for (const [key, def] of Object.entries(cfg.metrics)) {
    const d = rep.deviations[key];
    if (!d || d.level === 'na') continue;
    statusPenalty += def.weight * cfg.scoring.penaltyPerMajor * Math.min(d.severity, 1.5);
    penalty += def.weight * cfg.scoring.penaltyPerMajor * Math.min(d.cont, 1.5);
    if (d.level === 'major' && def.maxStatus !== 'yellow') hasMajor = true;
    if (d.level === 'notable' || d.level === 'major') hasNotable = true;
  }
  const statusScore = Math.max(0, Math.round(100 - statusPenalty));
  let status = 'green';
  if (hasMajor || statusScore < cfg.scoring.redBelow) status = 'red';
  else if (hasNotable || statusScore < cfg.scoring.yellowBelow) status = 'yellow';
  return { score: Math.max(0, Math.min(100, Math.round(100 - penalty))), status };
}

/** Metrics that moved past "notable", worst first. */
export function changedMetrics(rep, cfg) {
  return Object.entries(rep.deviations || {})
    .filter(([, d]) => LEVEL_RANK[d.level] >= 1)
    .map(([key, d]) => ({ key, ...d, def: cfg.metrics[key] }))
    .sort((a, b) => b.severity * b.def.weight - a.severity * a.def.weight);
}

export function findBreakdown(reps, baselineReps, cfg) {
  const lastBaseline = baselineReps.length ? baselineReps[baselineReps.length - 1].index : 0;
  const after = reps.filter((r) => r.scorable && r.index > lastBaseline);
  const off = (r) => r.status === 'yellow' || r.status === 'red';
  const need = cfg.scoring.sustainReps - 1;
  for (let k = 0; k < after.length; k++) {
    const rep = after[k];
    if (!off(rep)) continue;
    // The change has to persist: the following rep(s) must also be off
    // baseline. One odd rep followed by normal reps is reported as isolated.
    // At the very end of the set, a red rep with nothing after it still counts.
    const next = after.slice(k + 1, k + 1 + need);
    const run = [rep, ...next];
    const sustained = next.length === need ? next.every(off) : next.every(off) && run.some((r) => r.status === 'red');
    if (sustained) {
      return {
        rep: rep.index,
        kind: run.some((r) => r.status === 'red') ? 'breakdown' : 'change',
        causes: changedMetrics(rep, cfg).slice(0, 3),
      };
    }
  }
  return null;
}

export function findRisks(reps, cfg) {
  const out = [];
  for (const risk of cfg.risks) {
    const def = cfg.metrics[risk.metric];
    const hits = reps.filter(
      (r) => r.scorable && !r.isBaseline && LEVEL_RANK[r.deviations[risk.metric]?.level] >= LEVEL_RANK[risk.minLevel],
    );
    if (!hits.length) continue;
    const worst = hits.reduce((w, r) => (r.deviations[risk.metric].severity > w.deviations[risk.metric].severity ? r : w));
    const first = hits[0];
    out.push({
      ...risk,
      def,
      firstRep: first.index,
      reps: hits.map((r) => r.index),
      first: first.deviations[risk.metric],
      worstRep: worst.index,
      worst: worst.deviations[risk.metric],
    });
  }
  return out.sort((a, b) => a.firstRep - b.firstRep || b.worst.severity - a.worst.severity);
}

/** `leading`: cue keys to try first (the form-standard flags, red before yellow). */
export function pickCues(breakdown, risks, reps, cfg, painReported, leading = []) {
  if (painReported) return [];
  const order = [...leading];
  if (breakdown) order.push(...breakdown.causes.map((c) => c.key));
  order.push(...[...risks].sort((a, b) => b.worst.severity - a.worst.severity).map((r) => r.metric));
  // Any other metric that crossed "notable" somewhere, worst first.
  const worstByMetric = {};
  for (const r of reps) {
    if (!r.scorable || r.isBaseline) continue;
    for (const [key, d] of Object.entries(r.deviations)) {
      if (LEVEL_RANK[d.level] >= 1) worstByMetric[key] = Math.max(worstByMetric[key] || 0, d.severity);
    }
  }
  order.push(...Object.keys(worstByMetric).sort((a, b) => worstByMetric[b] - worstByMetric[a]));
  const cues = [];
  for (const key of order) {
    const text = cfg.cues[key];
    if (text && !cues.some((c) => c.text === text)) cues.push({ text, metric: key });
    if (cues.length === 2) break;
  }
  if (!cues.length) cues.push({ text: cfg.defaultCue, metric: null });
  return cues;
}

/**
 * Mutates reps with isBaseline / deviations / score / status and returns the
 * set-level summary.
 */
export function scoreSet(reps, cfg, { painReported = false } = {}) {
  const baselineReps = selectBaseline(reps, cfg);
  const stats = baselineStats(baselineReps, cfg.metrics);
  for (const rep of reps) {
    rep.isBaseline = baselineReps.includes(rep);
    rep.deviations = {};
    for (const [key, def] of Object.entries(cfg.metrics)) rep.deviations[key] = deviation(rep.metrics[key], stats[key], def);
    if (rep.scorable) {
      Object.assign(rep, scoreRep(rep, cfg));
      // A partial rep is a change in itself, even if its measured range stayed near the baseline's.
      if (rep.partial && rep.status === 'green' && !rep.isBaseline) rep.status = 'yellow';
    }
    else Object.assign(rep, { score: null, status: 'unknown' });
  }
  const scored = reps.filter((r) => r.scorable);
  const setScore = scored.length ? Math.round(mean(scored.map((r) => r.score))) : null;
  const breakdown = findBreakdown(reps, baselineReps, cfg);
  const lastBaseline = baselineReps.length ? baselineReps[baselineReps.length - 1].index : 0;
  const isolated = breakdown
    ? []
    : reps.filter((r) => r.scorable && r.index > lastBaseline && r.status !== 'green').map((r) => r.index);
  const risks = findRisks(reps, cfg);
  const cues = pickCues(breakdown, risks, reps, cfg, painReported);
  return { baselineReps: baselineReps.map((r) => r.index), stats, setScore, breakdown, isolated, risks, cues };
}
