import { describe, it, expect } from 'vitest';
import { analyzeTrack } from '../src/lib/analysis/analyze.js';
import { sideTrack, frontTrack, timeline, curlSet } from './synth.js';

const clean = { top: 45, lift: 1.0, lower: 1.2, lean: 2, arm: 6 };

describe('curl analysis', () => {
  it('counts reps and reports no breakdown for a steady set', () => {
    const tl = curlSet(Array.from({ length: 8 }, () => clean));
    const res = analyzeTrack(sideTrack(tl), 'curl');
    expect(res.status).toBe('ok');
    expect(res.reps.length).toBe(8);
    expect(res.breakdown).toBeNull();
    expect(res.baselineReps).toEqual([1, 2, 3]);
    expect(res.reps.every((r) => r.status === 'green')).toBe(true);
    // Measured ROM should be close to the true 120° (smoothing trims a little).
    expect(res.reps[3].metrics.rom).toBeGreaterThan(105);
    expect(res.reps[3].metrics.rom).toBeLessThan(125);
    // Tempo is timed between leaving the top (10% of travel) and reaching
    // rest (within 12%). With eased motion that is ~57% of the 1.2 s phase.
    expect(Math.abs(res.reps[3].metrics.lowerTime - 0.68)).toBeLessThan(0.12);
  });

  it('finds the breakdown rep and its causes', () => {
    const reps = [
      ...Array.from({ length: 5 }, () => clean),
      ...Array.from({ length: 3 }, () => ({ top: 80, lift: 0.7, lower: 0.6, lean: 14, arm: 22 })),
    ];
    const res = analyzeTrack(sideTrack(curlSet(reps)), 'curl');
    expect(res.status).toBe('ok');
    expect(res.reps.length).toBe(8);
    expect(res.breakdown?.rep).toBe(6);
    const causes = res.breakdown.causes.map((c) => c.key);
    expect(causes).toContain('torsoSwing');
    expect(res.reps.slice(5).every((r) => r.status === 'red')).toBe(true);
    expect(res.risks.map((r) => r.metric)).toContain('torsoSwing');
    expect(res.risks.find((r) => r.metric === 'torsoSwing').firstRep).toBe(6);
    expect(res.cues.length).toBeGreaterThan(0);
    expect(res.cues.length).toBeLessThanOrEqual(2);
  });

  it('ignores pauses and excludes them from tempo', () => {
    const reps = Array.from({ length: 6 }, (_, i) => ({ ...clean, pause: i === 2 ? 4 : 0.3 }));
    const res = analyzeTrack(sideTrack(curlSet(reps)), 'curl');
    expect(res.reps.length).toBe(6);
    const lowers = res.reps.map((r) => r.metrics.lowerTime);
    expect(Math.max(...lowers) - Math.min(...lowers)).toBeLessThan(0.3);
    expect(res.breakdown).toBeNull();
  });

  it('marks partial reps', () => {
    const reps = [...Array.from({ length: 5 }, () => clean), { ...clean, top: 110 }, clean];
    const res = analyzeTrack(sideTrack(curlSet(reps)), 'curl');
    expect(res.reps.length).toBe(7);
    expect(res.partialReps).toEqual([6]);
    expect(res.reps[5].deviations.rom.level).toBe('major');
  });

  it('works when the person faces left', () => {
    const reps = [
      ...Array.from({ length: 4 }, () => clean),
      ...Array.from({ length: 3 }, () => ({ ...clean, lean: 15, arm: 25 })),
    ];
    const res = analyzeTrack(sideTrack(curlSet(reps), { facing: -1, near: 'right' }), 'curl');
    expect(res.ctx.facing).toBe(-1);
    expect(res.ctx.side).toBe('right');
    expect(res.breakdown?.rep).toBe(5);
  });

  it('rejects a front-facing video for a side-view exercise', () => {
    const tl = timeline([{ dur: 8, from: { wl: 0, wr: 0 }, to: { wl: 0, wr: 0 } }]);
    const res = analyzeTrack(frontTrack(tl), 'curl');
    expect(res.status).toBe('rejected');
    expect(res.issues.map((i) => i.code)).toContain('wrong_angle');
  });

  it('rejects a clip with no reps', () => {
    const tl = curlSet([], 6, 0);
    const res = analyzeTrack(sideTrack(tl), 'curl');
    expect(res.status).toBe('rejected');
    expect(res.issues[0].code).toBe('no_reps');
  });

  it('rejects an edited clip that cuts between shots', () => {
    const track = sideTrack(curlSet(Array.from({ length: 6 }, () => clean)));
    const cutAt = Math.floor(track.n / 2);
    for (let i = cutAt; i < track.n; i++) for (let j = 0; j < 33; j++) track.raw[(i * 33 + j) * 4] -= 0.3;
    const res = analyzeTrack(track, 'curl');
    expect(res.status).toBe('rejected');
    expect(res.issues.map((i) => i.code)).toContain('camera_cut');
  });

  it('rejects a clip where the camera zooms', () => {
    const track = sideTrack(curlSet(Array.from({ length: 6 }, () => clean)));
    for (let i = 0; i < track.n; i++) {
      const z = 1 + 0.6 * (i / track.n);
      for (let j = 0; j < 33; j++) {
        const b = (i * 33 + j) * 4;
        track.raw[b] = 0.5 + (track.raw[b] - 0.5) * z;
        track.raw[b + 1] = 0.5 + (track.raw[b + 1] - 0.5) * z;
      }
    }
    const res = analyzeTrack(track, 'curl');
    expect(res.status).toBe('rejected');
    expect(res.issues.map((i) => i.code)).toContain('camera_moved');
  });

  it('rejects when the person is missing from most frames', () => {
    const tl = curlSet(Array.from({ length: 5 }, () => clean));
    const n = Math.floor(tl.total * 15) + 1;
    const drop = Array.from({ length: Math.floor(n * 0.6) }, (_, i) => i);
    const res = analyzeTrack(sideTrack(tl, { dropFrames: drop }), 'curl');
    expect(res.status).toBe('rejected');
    expect(res.issues[0].code).toBe('no_person');
  });
});

describe('squat analysis', () => {
  function squatSet(reps) {
    const stand = { knee: 5, lean: 8, heel: 0 };
    const phases = [{ dur: 1, from: stand, to: stand }];
    for (const r of reps) {
      const bottom = { knee: r.depth, lean: r.lean, heel: r.heel ?? 0 };
      phases.push({ dur: r.down ?? 1.4, from: stand, to: bottom });
      phases.push({ dur: 0.15, from: bottom, to: bottom });
      if (r.hipsFirst) {
        const mid = { knee: r.depth * 0.6, lean: r.lean + r.hipsFirst, heel: 0 };
        phases.push({ dur: 0.5, from: bottom, to: mid });
        phases.push({ dur: 0.6, from: mid, to: stand });
      } else {
        phases.push({ dur: r.up ?? 1.1, from: bottom, to: stand });
      }
      phases.push({ dur: 0.5, from: stand, to: stand });
    }
    return timeline(phases);
  }

  it('detects depth loss and hips rising first', () => {
    const good = { depth: 100, lean: 30 };
    const reps = [good, good, good, good, { depth: 72, lean: 44, hipsFirst: 12 }, { depth: 70, lean: 46, hipsFirst: 14 }];
    const res = analyzeTrack(sideTrack(squatSet(reps)), 'squat');
    expect(res.status).toBe('ok');
    expect(res.reps.length).toBe(6);
    expect(res.baselineReps).toEqual([1, 2, 3]);
    expect(res.breakdown?.rep).toBe(5);
    const keys = res.breakdown.causes.map((c) => c.key);
    expect(keys).toContain('forwardLean');
    // Descent comes first for squats.
    expect(Math.abs(res.reps[1].metrics.lowerTime - 0.79)).toBeLessThan(0.12);
  });
});

describe('press analysis', () => {
  function pressSet(reps) {
    const rack = { wl: 0.05, wr: 0.05, lean: 0, hipDip: 0 };
    const phases = [{ dur: 1, from: rack, to: rack }];
    for (const r of reps) {
      const top = { wl: r.top, wr: r.top - (r.gap ?? 0), lean: r.lean ?? 0, hipDip: 0 };
      phases.push({ dur: 1.0, from: rack, to: top });
      phases.push({ dur: 0.2, from: top, to: top });
      phases.push({ dur: 1.2, from: top, to: rack });
      phases.push({ dur: 0.4, from: rack, to: rack });
    }
    return timeline(phases);
  }

  it('flags left/right asymmetry and side lean from the front', () => {
    const good = { top: 1.0 };
    const reps = [good, good, good, good, good, good, { top: 1.0, gap: 0.2, lean: 7 }, { top: 0.95, gap: 0.25, lean: 8 }];
    const res = analyzeTrack(frontTrack(pressSet(reps)), 'press');
    expect(res.status).toBe('ok');
    expect(res.reps.length).toBe(8);
    expect(res.breakdown?.rep).toBe(7);
    const keys = res.breakdown.causes.map((c) => c.key);
    expect(keys).toContain('heightAsym');
    expect(keys).toContain('lateralLean');
  });

  it('rejects a side-on video for the press', () => {
    const good = { top: 1.0 };
    const res = analyzeTrack(frontTrack(pressSet([good, good, good]), { shoulderSpan: 20 }), 'press');
    expect(res.status).toBe('rejected');
    expect(res.issues.map((i) => i.code)).toContain('wrong_angle');
  });
});


describe('failure messages', () => {
  it('says to film from the side and why', () => {
    const tl = timeline([{ dur: 8, from: { wl: 0, wr: 0 }, to: { wl: 0, wr: 0 } }]);
    const issue = analyzeTrack(frontTrack(tl), 'curl').issues.find((i) => i.code === 'wrong_angle');
    expect(issue.title).toBe('Film from the side for this exercise');
    expect(issue.message).toMatch(/looks like it's facing you/);
    expect(issue.fix).toMatch(/Turn about 90°/);
  });

  it('names the joint, the frame edge and when it left the frame', () => {
    const track = sideTrack(curlSet(Array.from({ length: 6 }, () => clean)));
    const half = Math.floor(track.n * 0.3);
    for (let i = half; i < track.n; i++) {
      const b = (i * 33 + 15) * 4; // left wrist
      track.raw[b + 1] = 1.08;
      track.raw[b + 3] = 0.1;
    }
    const res = analyzeTrack(track, 'curl');
    const issue = res.issues.find((i) => i.code === 'missing_parts');
    expect(issue.title).toBe('Your left wrist is out of frame for much of the set');
    expect(issue.message).toMatch(/off the bottom of the frame/);
    expect(issue.message).toMatch(/from 0:0\d to the end/);
    expect(issue.fix).toMatch(/at the bottom of every rep/);
  });

  it('suggests the exercise the footage actually shows', () => {
    const stand = { knee: 5, lean: 8 };
    const bottom = { knee: 100, lean: 30 };
    const phases = [{ dur: 1, from: stand, to: stand }];
    for (let k = 0; k < 5; k++) {
      phases.push({ dur: 1.3, from: stand, to: bottom }, { dur: 1.1, from: bottom, to: stand }, { dur: 0.4, from: stand, to: stand });
    }
    const res = analyzeTrack(sideTrack(timeline(phases)), 'curl');
    expect(res.issues[0].code).toBe('no_reps');
    expect(res.issues[0].title).toBe('This looks like a squat, not a bicep curl');
    expect(res.issues[0].fix).toBe('Pick Squat and analyze the video again.');
  });
});

describe('rep counting at the edges of the clip', () => {
  it('counts complete first and last reps when the clip starts and ends tight on the set', () => {
    const tl = curlSet(Array.from({ length: 6 }, () => ({ ...clean, pause: 0.2 })), 0.05, 0.02);
    const res = analyzeTrack(sideTrack(tl), 'curl');
    expect(res.status).toBe('ok');
    expect(res.reps.length).toBe(6);
    expect(res.reps.every((r) => r.scorable)).toBe(true);
    expect(res.reps[0].tStart).toBeLessThan(0.6);
    expect(res.reps[5].tEnd).toBeGreaterThan(tl.total - 0.8);
  });

  it('keeps a rep whose top was briefly hidden and says why it is not scored', () => {
    const tl = curlSet(Array.from({ length: 6 }, () => clean), 0.1, 0.1);
    const track = sideTrack(tl);
    // Hide the wrist around the top of the first and the last rep (0.6 s each).
    const hide = (a, b) => {
      for (let i = 0; i < track.n; i++) if (track.times[i] >= a && track.times[i] <= b) track.raw[(i * 33 + 15) * 4 + 3] = 0.1;
    };
    hide(1.2, 1.8);
    hide(tl.total - 2.35, tl.total - 1.75);
    const res = analyzeTrack(track, 'curl');
    expect(res.reps.length).toBe(6);
    const excluded = res.reps.filter((r) => !r.scorable);
    expect(excluded.length).toBeGreaterThan(0);
    for (const r of excluded) expect(r.excluded.text).toMatch(/Tracking (lost|was clear)/);
  });

  it('explains reps cut off by the end of the video', () => {
    // The clip stops halfway down the last rep.
    const tl = curlSet(Array.from({ length: 5 }, () => clean), 0.5, 0);
    const track = sideTrack(tl);
    const keep = track.n - Math.round(0.9 * track.fps);
    const cut = { ...track, n: keep, duration: track.times[keep - 1], times: track.times.slice(0, keep), raw: track.raw.slice(0, keep * 33 * 4), hasPose: track.hasPose.slice(0, keep) };
    const res = analyzeTrack(cut, 'curl');
    const last = res.reps[res.reps.length - 1];
    expect(last.scorable).toBe(false);
    expect(last.excluded.text).toBe('Cut off by the end of the video');
  });
});

describe('continuous rep scores', () => {
  it('reflects small differences while keeping every rep green', () => {
    const arms = [6, 7, 6, 9, 12, 8];
    const tl = curlSet(arms.map((arm) => ({ ...clean, arm })));
    const res = analyzeTrack(sideTrack(tl), 'curl');
    expect(res.reps.every((r) => r.status === 'green')).toBe(true);
    const scores = res.reps.map((r) => r.score);
    expect(new Set(scores).size).toBeGreaterThan(2);
    expect(scores.some((s) => s < 100)).toBe(true);
    // More elbow drift than baseline costs more points.
    expect(res.reps[4].score).toBeLessThan(res.reps[3].score);
    expect(res.reps[3].score).toBeLessThan(100);
  });

  it('keeps rep colours and the breakdown point on the same thresholds', () => {
    const reps = [
      ...Array.from({ length: 5 }, () => clean),
      ...Array.from({ length: 3 }, () => ({ top: 80, lift: 0.7, lower: 0.6, lean: 14, arm: 22 })),
    ];
    const res = analyzeTrack(sideTrack(curlSet(reps)), 'curl');
    expect(res.reps.map((r) => r.status)).toEqual(['green', 'green', 'green', 'green', 'green', 'red', 'red', 'red']);
    expect(res.breakdown.rep).toBe(6);
    expect(Math.max(...res.reps.slice(5).map((r) => r.score))).toBeLessThan(Math.min(...res.reps.slice(0, 5).map((r) => r.score)));
  });
});
