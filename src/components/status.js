// First-reps comparison only (rep.status). Shown in the rep table.
export const STATUS = {
  green: { label: 'Held', long: 'Within the range of your first reps', color: 'var(--good)' },
  yellow: { label: 'Changed', long: 'Form changed', color: 'var(--warn)' },
  red: { label: 'Broke down', long: 'Form broke down', color: 'var(--bad)' },
  unknown: { label: 'Not scored', long: 'Not scored (unclear or cut off)', color: 'var(--unknown)' },
};

// Combined severity (rep.severity): the worse of the form standards and the
// first-reps comparison. This is what the gauge, rep strip and badges show.
export const SEVERITY = {
  green: { label: 'Good form', long: 'Good form', color: 'var(--good)' },
  yellow: { label: 'Less effective', long: 'Less effective for building muscle', color: 'var(--warn)' },
  red: { label: 'Injury risk', long: 'Injury risk', color: 'var(--bad)' },
  unknown: { label: 'Not scored', long: 'Not scored (unclear or cut off)', color: 'var(--unknown)' },
};

export function severityOf(rep) {
  return SEVERITY[rep?.scorable ? rep.severity : 'unknown'] || SEVERITY.unknown;
}

export function statusOf(rep) {
  return STATUS[rep?.status] || STATUS.unknown;
}

export function repAt(reps, t) {
  return reps.find((r) => t >= r.tStart - 0.05 && t <= r.tEnd + 0.05) || null;
}

export function fmtClock(t) {
  if (!Number.isFinite(t)) return '0:00.0';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
