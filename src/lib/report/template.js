// Template report: the headline, summary and cues written directly from the
// measurements. Always available; used as-is when no LLM key is configured
// or when an LLM response fails the safety checks.

import { getExercise } from '../../config/exercises/index.js';
import { changePhrase, fmtLong, joinAnd, listReps } from './format.js';
import { changedMetrics } from '../analysis/scoring.js';

function heldText(k) {
  if (k <= 1) return null;
  return k - 1 === 1 ? 'Form held for rep 1' : `Form held for reps 1–${k - 1}`;
}

export function buildHeadline(analysis) {
  const cfg = getExercise(analysis.exerciseId);
  const { breakdown, reps, isolated } = analysis;
  const scored = reps.filter((r) => r.scorable);
  if (breakdown) {
    const causes = breakdown.causes.slice(0, 2).map((c) => changePhrase(c.key, c, cfg.metrics[c.key]));
    const verb = breakdown.kind === 'breakdown' ? 'broke down at rep' : 'changed from rep';
    const held = heldText(breakdown.rep);
    const lead = held ? `${held} and ${verb} ${breakdown.rep}` : `Form ${verb} ${breakdown.rep}`;
    return `${lead}: ${joinAnd(causes)}.`;
  }
  if (isolated.length) {
    const worst = isolated
      .map((i) => reps.find((r) => r.index === i))
      .map((r) => ({ r, c: changedMetrics(r, cfg)[0] }))
      .filter((x) => x.c)
      .sort((a, b) => b.c.severity * b.c.def.weight - a.c.severity * a.c.def.weight)[0];
    const detail = worst ? `${changePhrase(worst.c.key, worst.c, cfg.metrics[worst.c.key])}` : null;
    const lastScored = scored.length ? scored[scored.length - 1].index : null;
    if (isolated.length === 1) {
      const after = isolated[0] === lastScored ? 'it was the last rep of the set' : 'the rep after it returned to your baseline';
      return `Form held across the set apart from rep ${isolated[0]}${detail ? `, where ${detail}` : ''}; ${after}.`;
    }
    return `Form held across the set apart from brief, one-rep changes on ${listReps(isolated)}${detail ? `. The largest was on rep ${worst.r.index}: ${detail}` : ''}.`;
  }
  const nb = analysis.baselineReps.length;
  return `Form held steady across all ${scored.length} scored reps; every rep stayed within the range of your ${nb === 1 ? 'baseline rep' : `${nb} baseline reps`}.`;
}

function baselineDescription(analysis, cfg) {
  const keys = Object.keys(cfg.metrics).filter((k) => cfg.metrics[k].reliability !== 'low').slice(0, 3);
  const parts = keys
    .map((k) => ({ k, s: analysis.stats[k] }))
    .filter(({ s }) => Number.isFinite(s.mean))
    .map(({ k, s }) => `${cfg.metrics[k].label.toLowerCase()} ${fmtLong(s.mean, cfg.metrics[k])}`);
  return joinAnd(parts);
}

export function buildSummary(analysis, input) {
  const cfg = getExercise(analysis.exerciseId);
  const { reps, breakdown, partialReps, baselineReps } = analysis;
  const sentences = [];

  const planned = Number(input?.plannedReps) || null;
  let count = `Spotter counted ${reps.length} rep${reps.length === 1 ? '' : 's'}`;
  if (planned) count += ` (you planned ${planned})`;
  if (partialReps.length) count += `, with ${listReps(partialReps)} partial`;
  sentences.push(`${count}.`);

  const unscored = reps.filter((r) => !r.scorable);
  if (unscored.length) {
    const cut = unscored.filter((r) => r.truncated).map((r) => r.index);
    const unclear = unscored.filter((r) => !r.truncated).map((r) => r.index);
    if (cut.length) sentences.push(`${capitalize(listReps(cut))} ${cut.length === 1 ? 'was' : 'were'} cut off by the start or end of the video and ${cut.length === 1 ? 'is' : 'are'} not scored.`);
    if (unclear.length) sentences.push(`${capitalize(listReps(unclear))} had unclear tracking and ${unclear.length === 1 ? 'is' : 'are'} not scored.`);
  }

  const baseDesc = baselineDescription(analysis, cfg);
  sentences.push(`${capitalize(listReps(baselineReps))} ${baselineReps.length === 1 ? 'is' : 'are'} your baseline${baseDesc ? `: ${baseDesc}` : ''}.`);

  if (breakdown) {
    const after = reps.filter((r) => r.scorable && r.index >= breakdown.rep);
    const off = after.filter((r) => r.status !== 'green');
    if (after.length === 1) sentences.push(`Rep ${breakdown.rep} was the last scored rep of the set.`);
    else sentences.push(`From rep ${breakdown.rep} on, ${off.length} of ${after.length} rep${after.length === 1 ? '' : 's'} stayed outside that baseline.`);
  }

  // The single largest change in the set.
  let worst = null;
  for (const r of reps) {
    if (!r.scorable || r.isBaseline) continue;
    for (const [key, d] of Object.entries(r.deviations)) {
      if (d.level !== 'notable' && d.level !== 'major') continue;
      const score = d.severity * cfg.metrics[key].weight;
      if (!worst || score > worst.score) worst = { rep: r.index, key, d, score };
    }
  }
  // Skip it when the headline already names it.
  const inHeadline = breakdown
    ? worst && worst.rep === breakdown.rep && breakdown.causes.slice(0, 2).some((c) => c.key === worst.key)
    : analysis.isolated.length > 0;
  if (worst && !inHeadline) {
    sentences.push(`The largest single change was on rep ${worst.rep}, where ${changePhrase(worst.key, worst.d, cfg.metrics[worst.key])}.`);
  }
  return sentences.join(' ');
}

/** "upper-arm swing up 14°", "range of motion down 30%". */
export function shortChange(d, def) {
  const label = def.label.charAt(0).toLowerCase() + def.label.slice(1);
  const dir = d.delta >= 0 ? 'up' : 'down';
  if (def.mode === 'relative' && Number.isFinite(d.pct)) return `${label} ${dir} ${Math.round(Math.abs(d.pct) * 100)}%`;
  const amount = def.unit.startsWith('%') ? `${Math.round(Math.abs(d.delta))} pts` : fmtLong(Math.abs(d.delta), def);
  return `${label} ${dir} ${amount}`;
}

/** One short line for the top of the results. */
export function buildShortHeadline(analysis) {
  const cfg = getExercise(analysis.exerciseId);
  const { breakdown, reps, isolated } = analysis;
  const scored = reps.filter((r) => r.scorable);
  if (breakdown) {
    const c = breakdown.causes[0];
    const lead = breakdown.kind === 'breakdown' ? `Form broke down at rep ${breakdown.rep}` : `Form changed from rep ${breakdown.rep}`;
    return c ? `${lead}: ${shortChange(c, cfg.metrics[c.key])}` : lead;
  }
  if (isolated.length === 1) {
    const rep = reps.find((r) => r.index === isolated[0]);
    const c = changedMetrics(rep, cfg)[0];
    return c ? `Form held, except rep ${rep.index}: ${shortChange(c, cfg.metrics[c.key])}` : `Form held, except a brief change on rep ${rep.index}`;
  }
  if (isolated.length > 1) return `Form held, with brief one-rep changes on ${listReps(isolated)}`;
  return scored.length === reps.length ? `Form held through all ${reps.length} reps` : `Form held through all ${scored.length} scored reps`;
}

export function painNotice() {
  return 'You reported pain or an injury with this set. The measurements below describe the movement only. Pain during lifting is worth having checked by a doctor or physical therapist before you train this movement again, so Spotter is not giving coaching cues for this set.';
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function buildTemplateReport(analysis, input) {
  return {
    source: 'template',
    headline: buildHeadline(analysis),
    summary: buildSummary(analysis, input),
    cues: analysis.cues.map((c) => c.text),
  };
}
