// Form standards: fixed per-exercise limits every rep is checked against.
// Each exercise gets a clean set, a set crossing each red rule, a set crossing
// each yellow rule, and a low-confidence set that must not flag.

import { describe, it, expect } from 'vitest';
import { analyzeTrack } from '../src/lib/analysis/analyze.js';
import { gaugeValue, ruleFraction, ruleLevel, GAUGE_ZONES } from '../src/lib/analysis/standards.js';
import { heldMax, heldMin } from '../src/lib/analysis/geometry.js';
import { getExercise } from '../src/config/exercises/index.js';
import { buildShortHeadline, buildTemplateReport } from '../src/lib/report/template.js';
import { sideTrack, frontTrack, timeline, curlSet } from './synth.js';

const levels = (a, id) => a.reps.filter((r) => r.scorable).map((r) => r.form.checks[id].level);
const severities = (a) => a.reps.filter((r) => r.scorable).map((r) => r.severity);
const ruleFlags = (a) => a.reps.flatMap((r) => (r.form ? r.form.flags.filter((f) => f.kind === 'rule') : []));

/** Lowers the visibility of the given landmarks (below the 0.7 rule cutoff, above the 0.5 tracking cutoff). */
function dim(track, landmarks, vis = 0.6) {
  for (let i = 0; i < track.n; i++) for (const j of landmarks) track.raw[(i * 33 + j) * 4 + 3] = vis;
  return track;
}

// ---------------------------------------------------------------- curl

const curlClean = { top: 45, lift: 1.0, lower: 1.2, lean: 2, arm: 6 };
const curl = (reps) => analyzeTrack(sideTrack(curlSet(reps)), 'curl');

describe('curl form standards', () => {
  it('flags nothing on a clean set', () => {
    const a = curl(Array(6).fill(curlClean));
    expect(ruleFlags(a)).toEqual([]);
    expect(severities(a).every((s) => s === 'green')).toBe(true);
    expect(a.form.severity).toBe('green');
    expect(a.form.reason.text).toBe('Every form check passed on every scored rep.');
  });

  it('flags a torso swing as red, on every rep, even when the first reps are just as bad', () => {
    const a = curl(Array(6).fill({ ...curlClean, lean: 18 }));
    // The first-reps comparison sees no change at all...
    expect(a.breakdown).toBeNull();
    expect(a.reps.every((r) => r.status === 'green')).toBe(true);
    // ...but the form standards flag every rep, rep 1 included.
    expect(levels(a, 'torsoSwing').every((l) => l === 'red')).toBe(true);
    expect(a.reps[0].severity).toBe('red');
    expect(a.form.severity).toBe('red');
    expect(a.form.reason.text).toMatch(/^Torso swung \d+° to lift the weight( at worst,)? on reps 1–6 \(limit 10°\)\.$/);
    expect(buildShortHeadline(a)).toBe('Injury risk on reps 1–6: torso swing');
    // Tinted frames exist for the offending segment.
    expect(a.form.tints.some((t) => t.ruleId === 'torsoSwing' && t.severity === 'red' && t.i1 >= t.i0)).toBe(true);
  });

  it('flags the upper arm swinging far forward as red', () => {
    const a = curl(Array(6).fill({ ...curlClean, arm: 55 }));
    expect(levels(a, 'upperArmSwing').every((l) => l === 'red')).toBe(true);
    expect(levels(a, 'torsoSwing').every((l) => l === 'green')).toBe(true);
  });

  it('flags a short range at the top as yellow', () => {
    const a = curl(Array(6).fill({ ...curlClean, top: 95 }));
    expect(levels(a, 'topContraction').every((l) => l === 'yellow')).toBe(true);
    expect(severities(a).every((s) => s === 'yellow')).toBe(true);
    expect(a.form.reason.text).toMatch(/^Elbow closed to only \d+° at the top( at worst,)? on reps 1–6 \(aim for 80° or less\)\.$/);
  });

  it('flags an arm that never straightens at the bottom as yellow', () => {
    const a = curl(Array(6).fill({ ...curlClean, bottom: 125 }));
    // Rep 1 starts from a straight arm hanging at rest, so check the rest.
    expect(levels(a, 'bottomExtension').slice(1).every((l) => l === 'yellow')).toBe(true);
  });

  it('flags lowering much faster than lifting as yellow', () => {
    const a = curl(Array(6).fill({ ...curlClean, lift: 1.3, lower: 0.4 }));
    expect(levels(a, 'lowering').every((l) => l === 'yellow')).toBe(true);
  });

  it('skips a rule instead of flagging when its joints are not clearly visible', () => {
    // Shoulder and hip tracked (visibility 0.6 passes the 0.5 gate) but below the 0.7 rule cutoff.
    const a = analyzeTrack(dim(sideTrack(curlSet(Array(6).fill({ ...curlClean, lean: 18, arm: 45 }))), [11, 23]), 'curl');
    expect(a.status).toBe('ok');
    expect(levels(a, 'torsoSwing').every((l) => l === 'skipped')).toBe(true);
    expect(levels(a, 'upperArmSwing').every((l) => l === 'skipped')).toBe(true);
    expect(severities(a).includes('red')).toBe(false);
    expect(a.form.skipped.map((s) => s.ruleId)).toContain('torsoSwing');
  });

  it('treats a change against the first reps as yellow unless a red rule is crossed', () => {
    const mild = { ...curlClean, lean: 8 }; // more swing than the first reps, below the red limit
    const a = curl([...Array(5).fill(curlClean), mild, mild, mild]);
    expect(a.reps[5].status).not.toBe('green');
    expect(a.reps.slice(5).every((r) => r.severity === 'yellow')).toBe(true);
    const b = curl([...Array(5).fill(curlClean), ...Array(3).fill({ ...curlClean, lean: 18 })]);
    expect(b.reps.slice(5).every((r) => r.severity === 'red')).toBe(true);
    expect(b.reps.slice(0, 5).every((r) => r.severity === 'green')).toBe(true);
    expect(b.breakdown.kind).toBe('breakdown');
  });

  it('reads further along the red zone when the swing is larger', () => {
    const a = curl(Array(5).fill({ ...curlClean, lean: 13 }));
    const b = curl(Array(5).fill({ ...curlClean, lean: 20 }));
    expect(a.form.severity).toBe('red');
    expect(b.form.severity).toBe('red');
    expect(b.form.value).toBeGreaterThan(a.form.value);
  });
});

// ---------------------------------------------------------------- squat

function squatSet(reps, stand = { knee: 5, lean: 8, shin: 2 }) {
  const phases = [{ dur: 1, from: stand, to: stand }];
  for (const r of reps) {
    const bottom = { knee: r.knee, lean: r.lean, shin: r.shin };
    phases.push({ dur: r.down ?? 1.4, from: stand, to: bottom });
    phases.push({ dur: 0.2, from: bottom, to: bottom });
    phases.push({ dur: r.up ?? 1.1, from: bottom, to: stand });
    phases.push({ dur: 0.5, from: stand, to: stand });
  }
  return timeline(phases);
}
const squatClean = { knee: 115, shin: 30, lean: 35 };
const squat = (reps) => analyzeTrack(sideTrack(squatSet(reps)), 'squat');

describe('squat form standards', () => {
  it('flags nothing on a clean set', () => {
    const a = squat(Array(5).fill(squatClean));
    expect(a.status).toBe('ok');
    expect(ruleFlags(a)).toEqual([]);
    expect(a.form.severity).toBe('green');
  });

  it('flags a torso leaning far past the shins as red', () => {
    const a = squat(Array(5).fill({ ...squatClean, lean: 70 }));
    expect(levels(a, 'excessLean').every((l) => l === 'red')).toBe(true);
  });

  it('flags a shallow squat as yellow', () => {
    const a = squat(Array(5).fill({ knee: 70, shin: 20, lean: 25 }));
    expect(levels(a, 'depth').every((l) => l === 'yellow')).toBe(true);
    expect(levels(a, 'excessLean').every((l) => l === 'green')).toBe(true);
  });

  it('flags dropping into the bottom as yellow', () => {
    const a = squat(Array(5).fill({ ...squatClean, down: 0.45, up: 1.4 }));
    expect(levels(a, 'lowering').every((l) => l === 'yellow')).toBe(true);
  });

  it('does not flag when the hips and knees are unclear', () => {
    const a = analyzeTrack(dim(sideTrack(squatSet(Array(5).fill({ knee: 70, shin: 20, lean: 70 }))), [23, 25]), 'squat');
    expect(a.status).toBe('ok');
    expect(ruleFlags(a).filter((f) => f.ruleId !== 'lowering')).toEqual([]);
  });
});

// ---------------------------------------------------------------- row

function rowSet(reps) {
  const rest = { lean: 10, arm: 80, elbow: 170, knee: 5 };
  const phases = [{ dur: 1, from: rest, to: rest }];
  for (const r of reps) {
    const reach = { ...rest, lean: r.reachLean ?? 10, elbow: r.reachElbow ?? 170 };
    const finish = { lean: r.finishLean ?? 0, arm: r.finishArm ?? -25, elbow: 70, knee: 5 };
    phases.push({ dur: 0.01, from: reach, to: reach });
    phases.push({ dur: r.pull ?? 1.0, from: reach, to: finish });
    phases.push({ dur: 0.2, from: finish, to: finish });
    phases.push({ dur: r.back ?? 1.2, from: finish, to: reach });
    phases.push({ dur: 0.4, from: reach, to: reach });
  }
  phases.push({ dur: 0.8, from: rest, to: rest });
  return timeline(phases);
}
const row = (reps) => analyzeTrack(sideTrack(rowSet(reps)), 'row');

describe('row form standards', () => {
  it('flags nothing on a clean set', () => {
    const a = row(Array(6).fill({}));
    expect(a.status).toBe('ok');
    expect(ruleFlags(a)).toEqual([]);
  });

  it('flags leaning back and rocking to pull as red', () => {
    const a = row(Array(6).fill({ finishLean: -30 }));
    expect(levels(a, 'leanBack').every((l) => l === 'red')).toBe(true);
    expect(levels(a, 'torsoRock').every((l) => l === 'red')).toBe(true);
  });

  it('does not flag sitting reclined when the torso stays still', () => {
    // Reclined 18° the whole time (posture or a tilted camera), moving only a few degrees.
    const a = row(Array(6).fill({ reachLean: -18, finishLean: -22 }));
    expect(levels(a, 'leanBack').every((l) => l === 'green')).toBe(true);
    // Leaning back further during the pull still counts, from where the rep started.
    const b = row(Array(6).fill({ reachLean: -5, finishLean: -28 }));
    expect(levels(b, 'leanBack').every((l) => l === 'red')).toBe(true);
  });

  it('flags folding far forward at the stretch as red', () => {
    const a = row(Array(6).fill({ reachLean: 45, finishLean: 25 }));
    expect(levels(a, 'forwardFold').slice(0, -1).every((l) => l === 'red')).toBe(true);
    expect(levels(a, 'leanBack').every((l) => l === 'green')).toBe(true);
  });

  it('flags a short pull and a missing stretch as yellow', () => {
    const a = row(Array(6).fill({ finishArm: 15 }));
    expect(levels(a, 'elbowsBack').every((l) => l === 'yellow')).toBe(true);
    const b = row(Array(6).fill({ reachElbow: 125 }));
    expect(levels(b, 'reach').slice(1, -1).every((l) => l === 'yellow')).toBe(true);
  });

  it('flags a handle snapping back as yellow', () => {
    const a = row(Array(6).fill({ pull: 1.3, back: 0.4 }));
    expect(levels(a, 'lowering').every((l) => l === 'yellow')).toBe(true);
  });

  it('does not flag torso rules when the shoulder and hip are unclear', () => {
    const a = analyzeTrack(dim(sideTrack(rowSet(Array(6).fill({ finishLean: -22 }))), [11, 23]), 'row');
    expect(a.status).toBe('ok');
    expect(severities(a).includes('red')).toBe(false);
  });
});

// ---------------------------------------------------------------- press

function pressSet(reps) {
  const rack = (r) => ({ wl: r.rack ?? 0.05, wr: r.rack ?? 0.05, lean: 0, hipDip: 0 });
  const phases = [{ dur: 1, from: rack(reps[0]), to: rack(reps[0]) }];
  for (const r of reps) {
    const top = { wl: r.top ?? 1.0, wr: (r.top ?? 1.0) - (r.gap ?? 0), lean: r.lean ?? 0, hipDip: 0 };
    phases.push({ dur: r.press ?? 1.0, from: rack(r), to: top });
    phases.push({ dur: 0.25, from: top, to: top });
    phases.push({ dur: r.lower ?? 1.2, from: top, to: rack(r) });
    phases.push({ dur: 0.4, from: rack(r), to: rack(r) });
  }
  return timeline(phases);
}
const press = (reps) => analyzeTrack(frontTrack(pressSet(reps)), 'press');

describe('press form standards', () => {
  it('flags nothing on a clean set', () => {
    const a = press(Array(6).fill({}));
    expect(a.status).toBe('ok');
    expect(ruleFlags(a)).toEqual([]);
  });

  it('flags a heavy side lean as red', () => {
    const a = press(Array(6).fill({ lean: 16 }));
    expect(levels(a, 'sideLean').every((l) => l === 'red')).toBe(true);
  });

  it('flags stopping above shoulder level and short of lockout as yellow', () => {
    const a = press(Array(6).fill({ rack: 0.6 }));
    expect(levels(a, 'bottomDepth').every((l) => l === 'yellow')).toBe(true);
    const b = press(Array(6).fill({ top: 0.55 }));
    expect(levels(b, 'lockout').every((l) => l === 'yellow')).toBe(true);
  });

  it('flags one arm lagging and fast lowering as yellow', () => {
    const a = press(Array(6).fill({ gap: 0.3 }));
    expect(levels(a, 'armLag').every((l) => l === 'yellow')).toBe(true);
    const b = press(Array(6).fill({ press: 1.3, lower: 0.4 }));
    expect(levels(b, 'lowering').every((l) => l === 'yellow')).toBe(true);
  });

  it('does not flag a lean when the hips are unclear', () => {
    const a = analyzeTrack(dim(frontTrack(pressSet(Array(6).fill({ lean: 16 }))), [23, 24]), 'press');
    expect(a.status).toBe('ok');
    expect(levels(a, 'sideLean').every((l) => l === 'skipped')).toBe(true);
    expect(severities(a).includes('red')).toBe(false);
  });
});

// ---------------------------------------------------------------- building blocks

describe('held values', () => {
  it('ignores a single-frame spike', () => {
    const s = Float32Array.from([0, 0, 0, 20, 0, 0, 0]);
    expect(heldMax(s, 0, 6, 3).value).toBe(0);
    const held = Float32Array.from([0, 0, 20, 21, 20, 0, 0]);
    expect(heldMax(held, 0, 6, 3).value).toBe(20);
    expect(heldMin(Float32Array.from([5, 5, -9, 5, 5]), 0, 4, 3).value).toBe(5);
  });

  it('does not bridge missing frames', () => {
    expect(heldMax(Float32Array.from([20, NaN, 20, 20, 0]), 0, 4, 3).value).toBe(0);
  });
});

describe('gauge value', () => {
  const rule = getExercise('curl').standards.rules.find((r) => r.id === 'torsoSwing'); // yellow 5°, red 10°

  it('maps severity to three zones', () => {
    for (const [sev, [lo, hi]] of Object.entries(GAUGE_ZONES)) {
      for (const f of [0, 0.5, 1]) {
        const v = gaugeValue(sev, f);
        expect(v).toBeGreaterThan(lo);
        expect(v).toBeLessThan(hi);
      }
    }
    expect(gaugeValue('green', 0)).toBe(2);
    expect(gaugeValue('red', 1)).toBe(98);
    expect(gaugeValue('unknown', 0.5)).toBeNull();
    // Out-of-range fractions are clamped to the zone.
    expect(gaugeValue('yellow', 5)).toBe(gaugeValue('yellow', 1));
    expect(gaugeValue('yellow', -1)).toBe(gaugeValue('yellow', 0));
  });

  it('moves within a zone as the value moves past the limit', () => {
    const at = (v) => {
      const level = ruleLevel(rule, v);
      return { level, value: gaugeValue(level, ruleFraction(rule, v, level)) };
    };
    const readings = [0, 2, 4, 6, 8, 11, 13, 16].map(at);
    expect(readings.map((r) => r.level)).toEqual(['green', 'green', 'green', 'yellow', 'yellow', 'red', 'red', 'red']);
    for (let i = 1; i < readings.length; i++) expect(readings[i].value).toBeGreaterThan(readings[i - 1].value);
    // Green is below yellow is below red, with room between.
    expect(at(4).value).toBeLessThan(100 / 3);
    expect(at(6).value).toBeGreaterThan(100 / 3);
    expect(at(8).value).toBeLessThan(200 / 3);
    expect(at(11).value).toBeGreaterThan(200 / 3);
  });

  it('works for rules where lower values are worse', () => {
    const low = getExercise('curl').standards.rules.find((r) => r.id === 'lowering'); // yellow below 50%
    expect(ruleLevel(low, 120)).toBe('green');
    expect(ruleLevel(low, 45)).toBe('yellow');
    const f30 = ruleFraction(low, 30, 'yellow');
    const f45 = ruleFraction(low, 45, 'yellow');
    expect(f30).toBeGreaterThan(f45);
    expect(ruleFraction(low, 70, 'green')).toBeGreaterThan(ruleFraction(low, 95, 'green'));
  });
});

describe('form standards in the report', () => {
  it('leads the template report with red flags, then yellow, then first-rep changes', () => {
    const bad = { ...curlClean, lean: 18, top: 95 };
    const a = curl([bad, bad, bad, bad, bad, { ...bad, lower: 0.5 }]);
    expect(a.form.flags[0].severity).toBe('red');
    const order = a.form.flags.map((f) => f.severity);
    expect(order.indexOf('yellow')).toBeGreaterThan(order.lastIndexOf('red'));
    const r = buildTemplateReport(a, {});
    expect(r.headline).toMatch(/^Injury risk on reps 1–6: torso swung \d+° to lift the weight( at worst)? \(limit 10°\)\./);
    const red = r.summary.indexOf('Injury risk');
    const yellow = r.summary.indexOf('Less effective');
    expect(red).toBeGreaterThanOrEqual(0);
    expect(yellow).toBeGreaterThan(red);
  });
});
