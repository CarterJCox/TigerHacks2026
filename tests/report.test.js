import { describe, it, expect } from 'vitest';
import { analyzeTrack } from '../src/lib/analysis/analyze.js';
import { buildTemplateReport } from '../src/lib/report/template.js';
import { buildPayload } from '../src/lib/report/payload.js';
import { validateLlmReport, mentionsPain } from '../src/lib/report/safety.js';
import { listReps } from '../src/lib/report/format.js';
import { sideTrack, curlSet } from './synth.js';

const clean = { top: 45, lift: 1.0, lower: 1.2, lean: 2, arm: 6 };
const bad = { top: 80, lift: 0.7, lower: 0.6, lean: 14, arm: 22 };

function breakdownSet() {
  const tl = curlSet([...Array(5).fill(clean), ...Array(3).fill(bad)]);
  return analyzeTrack(sideTrack(tl), 'curl');
}

describe('template report', () => {
  it('writes a headline with the breakdown rep and measured numbers', () => {
    const a = breakdownSet();
    const r = buildTemplateReport(a, { plannedReps: 10 });
    expect(r.headline).toMatch(/^Form held for reps 1–5 and broke down at rep 6: /);
    expect(r.headline).toMatch(/\d+°/);
    expect(r.summary).toContain('you planned 10');
    expect(r.summary).toContain('Reps 1–3 are your baseline');
    expect(r.cues.length).toBeGreaterThan(0);
  });

  it('says form held when nothing changed', () => {
    const a = analyzeTrack(sideTrack(curlSet(Array(6).fill(clean))), 'curl');
    expect(buildTemplateReport(a, {}).headline).toMatch(/^Form held steady across all 6/);
  });

  it('gives no cues when pain is reported', () => {
    const tl = curlSet([...Array(5).fill(clean), ...Array(3).fill(bad)]);
    const a = analyzeTrack(sideTrack(tl), 'curl', { painReported: true });
    expect(a.cues).toEqual([]);
  });
});

describe('LLM safety checks', () => {
  const a = breakdownSet();
  const payload = buildPayload(a, { plannedReps: 10, painReported: false }, buildTemplateReport(a, {}));

  it('never includes the weight', () => {
    expect(JSON.stringify(payload)).not.toMatch(/weight"/i);
  });

  it('accepts a descriptive report built from payload numbers', () => {
    const c = payload.breakdown.causes[0];
    const res = validateLlmReport(
      {
        headline: `Form held for reps 1-5 and changed at rep 6: ${c.label.toLowerCase()} went from ${c.baseline} to ${c.value}.`,
        summary: 'Reps 1-3 were your baseline.',
        cues: ['Keep your elbows pinned to your sides.'],
      },
      payload,
    );
    expect(res.ok).toBe(true);
  });

  it('rejects load prescriptions, diagnoses and invented numbers', () => {
    const base = { summary: 'Reps 1-3 were your baseline.', cues: [] };
    expect(validateLlmReport({ ...base, headline: 'Try a lighter dumbbell next time.' }, payload).ok).toBe(false);
    expect(validateLlmReport({ ...base, headline: 'Use 15 lb for the next set.' }, payload).ok).toBe(false);
    expect(validateLlmReport({ ...base, headline: 'Do fewer reps so form holds.' }, payload).ok).toBe(false);
    expect(validateLlmReport({ ...base, headline: 'This pattern leads to tendinitis.' }, payload).ok).toBe(false);
    expect(validateLlmReport({ ...base, headline: 'Your swing grew by 987 degrees.' }, payload).ok).toBe(false);
  });

  it('strips cues when pain was reported', () => {
    const res = validateLlmReport(
      { headline: 'Form changed at rep 6.', summary: 'See a physical therapist.', cues: ['Keep your elbows pinned.'] },
      { ...payload, painReported: true },
    );
    expect(res.ok).toBe(true);
    expect(res.report.cues).toEqual([]);
  });
});

describe('helpers', () => {
  it('detects pain mentions', () => {
    expect(mentionsPain('my elbow hurt on the last rep')).toBe(true);
    expect(mentionsPain('felt a sharp pinch in my shoulder')).toBe(true);
    expect(mentionsPain('felt strong, good pump')).toBe(false);
  });

  it('lists reps compactly', () => {
    expect(listReps([6])).toBe('rep 6');
    expect(listReps([1, 2, 3])).toBe('reps 1–3');
    expect(listReps([2, 5, 6, 7])).toBe('reps 2 and 5–7');
  });
});
