export const STATUS = {
  green: { label: 'Held', long: 'Within your baseline range', color: 'var(--good)' },
  yellow: { label: 'Changed', long: 'Form changed', color: 'var(--warn)' },
  red: { label: 'Broke down', long: 'Form broke down', color: 'var(--bad)' },
  unknown: { label: 'Not scored', long: 'Not scored (unclear or cut off)', color: 'var(--unknown)' },
};

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
