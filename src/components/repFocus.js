// Picks which reps and measures the results screen puts in focus.

import { getExercise } from '../config/exercises/index.js';

/** The baseline rep closest to the baseline average: the most typical one. */
export function typicalBaselineRep(analysis) {
  const cfg = getExercise(analysis.exerciseId);
  let best = null;
  for (const r of analysis.reps.filter((x) => x.isBaseline)) {
    let dist = 0;
    for (const [key, def] of Object.entries(cfg.metrics)) {
      const s = analysis.stats[key];
      const v = r.metrics[key];
      if (!Number.isFinite(v) || !Number.isFinite(s?.mean)) continue;
      const scale = def.mode === 'relative' ? Math.abs(s.mean) * def.major || 1 : def.major;
      dist += Math.abs(v - s.mean) / scale;
    }
    if (!best || dist < best.dist) best = { rep: r, dist };
  }
  return best?.rep ?? null;
}

/** The 2-3 metrics that moved most against baseline for this rep. */
export function repChanges(analysis, rep, limit = 3) {
  const cfg = getExercise(analysis.exerciseId);
  const absNorm = (d, def) => {
    const x = def.mode === 'relative' ? Math.abs(d.pct || 0) : Math.abs(d.delta || 0);
    return x / def.major;
  };
  return Object.entries(rep.deviations || {})
    .filter(([, d]) => d.level !== 'na' && Number.isFinite(d.value) && Number.isFinite(d.base))
    .map(([key, d]) => {
      const def = cfg.metrics[key];
      return { key, d, def, flagged: d.level === 'notable' || d.level === 'major', worse: (d.cont || 0) * def.weight, any: absNorm(d, def) * def.weight };
    })
    // Skip measures that didn't visibly move, unless they were flagged.
    .filter((c) => c.flagged || (c.d.cont || 0) >= 0.05 || Math.abs(c.d.delta) >= c.def.minAbsChange / 2)
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.worse - a.worse || b.any - a.any)
    .slice(0, limit);
}
