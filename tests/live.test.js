// Live stop signal: synthetic pose streams fed frame by frame through the
// live monitor, as the camera view does while recording.

import { describe, it, expect, vi } from 'vitest';
import { LiveMonitor, liveMode, liveRedRules } from '../src/lib/live/monitor.js';
import { createAlertSignal } from '../src/lib/live/signal.js';
import { LIVE } from '../src/config/live.js';
import { getExercise } from '../src/config/exercises/index.js';
import { sideTrack, frontTrack, timeline, curlSet } from './synth.js';

const STRIDE = 33 * 4;
const clean = { top: 45, lift: 1.0, lower: 1.2, lean: 2, arm: 6 };
const swing = { ...clean, lean: 18 }; // torso rocks 18° back on the lift; the red limit is 10°

/** Feeds a track through a live monitor, recording from `recordFrom` seconds. */
function feed(track, exerciseId, { recordFrom = 0.9, edit } = {}) {
  const m = new LiveMonitor(exerciseId);
  const results = [];
  for (let i = 0; i < track.n; i++) {
    const t = track.times[i];
    if (!m.recording && t >= recordFrom) m.startRecording(t);
    let raw = track.hasPose[i] ? track.raw.subarray(i * STRIDE, (i + 1) * STRIDE) : null;
    if (raw && edit) raw = edit(i, Float32Array.from(raw));
    results.push(m.push({ t, raw, width: track.width, height: track.height }));
  }
  return { m, results, alerts: results.filter((r) => r.alert).map((r) => r.alert) };
}

function dim(track, landmarks, vis = 0.6) {
  for (let i = 0; i < track.n; i++) for (const j of landmarks) track.raw[(i * 33 + j) * 4 + 3] = vis;
  return track;
}

describe('live stop signal', () => {
  it('fires once for one sustained red pattern, within the sustain time of it starting', () => {
    const up = { lean: 0, arm: 0, elbow: 165 };
    const back = { lean: -18, arm: 0, elbow: 165 };
    const tl = timeline([
      { dur: 2, from: up, to: up },
      { dur: 0.6, from: up, to: back },
      { dur: 2.5, from: back, to: back },
      { dur: 0.6, from: back, to: up },
      { dur: 3, from: up, to: up },
    ]);
    const { alerts } = feed(sideTrack(tl), 'curl');
    expect(alerts.length).toBe(1);
    const a = alerts[0];
    expect(a.ruleId).toBe('torsoSwing');
    expect(a.patternStart).toBeGreaterThan(2);
    expect(a.patternStart).toBeLessThan(2.6);
    // Signal time: the sustain window plus at most one frame.
    expect(a.t - a.patternStart).toBeGreaterThanOrEqual(LIVE.alerts.sustainSec - 1e-6);
    expect(a.t - a.patternStart).toBeLessThanOrEqual(LIVE.alerts.sustainSec + 1 / 15 + 1e-6);
  });

  it('fires for a swinging curl and names the rule', () => {
    const { alerts } = feed(sideTrack(curlSet([clean, clean, swing, clean])), 'curl');
    expect(alerts.length).toBe(1);
    expect(alerts[0]).toMatchObject({ ruleId: 'torsoSwing', short: 'torso swing', limit: 10 });
  });

  it('ignores a single-frame spike', () => {
    const track = sideTrack(curlSet(Array(5).fill(clean)));
    const spike = Math.floor(track.n / 2);
    // One frame where the shoulder jumps far forward (a 30°+ lean), then snaps back.
    const { alerts, results } = feed(track, 'curl', {
      edit: (i, raw) => {
        if (i === spike) raw[11 * 4] += 100 / 640;
        return raw;
      },
    });
    expect(alerts).toEqual([]);
    expect(results.some((r) => r.flags.some((f) => f.severity === 'red'))).toBe(false);
  });

  it('does not repeat within the cooldown, and fires again after it', () => {
    const close = feed(sideTrack(curlSet([clean, swing, clean, swing, clean])), 'curl');
    expect(close.alerts.length).toBe(1);
    const apart = feed(sideTrack(curlSet([clean, swing, clean, clean, clean, swing, clean])), 'curl');
    expect(apart.alerts.length).toBe(2);
    expect(apart.alerts[1].t - apart.alerts[0].t).toBeGreaterThanOrEqual(LIVE.alerts.cooldownSec);
  });

  it('does not fire when the joints are not clearly visible', () => {
    // Shoulder and hip tracked (0.6 passes the 0.5 tracking cutoff) but below the rules' 0.7.
    const { alerts } = feed(dim(sideTrack(curlSet([clean, swing, swing, swing])), [11, 23]), 'curl');
    expect(alerts).toEqual([]);
  });

  it('does not fire when the camera view is wrong for the exercise', () => {
    // Facing the camera and bending sideways: fails the side-view check for a curl.
    const lean = timeline([
      { dur: 2, from: { wl: 0, wr: 0, lean: 0 }, to: { wl: 0, wr: 0, lean: 0 } },
      { dur: 0.6, from: { wl: 0, wr: 0, lean: 0 }, to: { wl: 0, wr: 0, lean: 25 } },
      { dur: 2, from: { wl: 0, wr: 0, lean: 25 }, to: { wl: 0, wr: 0, lean: 25 } },
    ]);
    const { alerts, results } = feed(frontTrack(lean), 'curl');
    expect(results.at(-1).viewOk).toBe(false);
    expect(alerts).toEqual([]);
  });

  it('never makes a sound for yellow issues', () => {
    const mild = { ...clean, lean: 7 }; // past the yellow limit (5°), under the red one (10°)
    const { results } = feed(sideTrack(curlSet([clean, mild, mild, mild])), 'curl');
    expect(results.some((r) => r.flags.some((f) => f.severity === 'yellow'))).toBe(true);
    expect(results.some((r) => r.alert)).toBe(false);
    const playTone = vi.fn();
    const speak = vi.fn();
    const signal = createAlertSignal({ playTone, speak, isMuted: () => false, schedule: (fn) => fn() });
    results.forEach(signal);
    expect(playTone).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it('sounds once for a red alert, and not at all when muted', () => {
    const { results } = feed(sideTrack(curlSet([clean, swing, clean])), 'curl');
    const playTone = vi.fn();
    const speak = vi.fn();
    results.forEach(createAlertSignal({ playTone, speak, isMuted: () => false, schedule: (fn) => fn() }));
    expect(playTone).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith(LIVE.alerts.speech);
    const muted = vi.fn();
    const shown = results.map(createAlertSignal({ playTone: muted, speak: muted, isMuted: () => true, schedule: (fn) => fn() }));
    expect(muted).not.toHaveBeenCalled();
    expect(shown.filter(Boolean).length).toBe(1); // still shown on screen
  });

  it('does not alert before recording starts', () => {
    const { alerts } = feed(sideTrack(curlSet([swing, swing])), 'curl', { recordFrom: 1e9 });
    expect(alerts).toEqual([]);
  });
});

describe('live rules', () => {
  it('checks every red rule live and reuses the config limits', () => {
    for (const id of ['curl', 'press', 'row', 'squat']) {
      const reds = getExercise(id).standards.rules.filter((r) => r.red != null);
      expect(liveRedRules(id).map((r) => r.id)).toEqual(reds.map((r) => r.id));
    }
    const rules = Object.fromEntries(['curl', 'row', 'squat', 'press'].flatMap((id) => getExercise(id).standards.rules.map((r) => [`${id}.${r.id}`, r])));
    expect(liveMode(rules['curl.torsoSwing'])).toBe('excursion');
    expect(liveMode(rules['row.leanBack'])).toBe('moved');
    expect(liveMode(rules['squat.excessLean'])).toBe('absolute');
    // Rep-level checks can't be judged mid-rep.
    expect(liveMode(rules['curl.lowering'])).toBeNull();
    expect(liveMode(rules['squat.depth'])).toBeNull();
    expect(liveMode(rules['press.lockout'])).toBeNull();
  });

  it('never alerts on clean sets of any exercise', () => {
    // Curl
    expect(feed(sideTrack(curlSet(Array(6).fill(clean))), 'curl').alerts).toEqual([]);
    // Squat: torso roughly parallel to the shins, to about parallel depth.
    const stand = { knee: 5, lean: 8, shin: 2 };
    const good = { knee: 115, lean: 35, shin: 30 };
    const sq = [{ dur: 1.5, from: stand, to: stand }];
    for (let k = 0; k < 5; k++) sq.push({ dur: 1.4, from: stand, to: good }, { dur: 0.2, from: good, to: good }, { dur: 1.1, from: good, to: stand }, { dur: 0.5, from: stand, to: stand });
    expect(feed(sideTrack(timeline(sq)), 'squat').alerts).toEqual([]);
    // Row: slight lean at the reach, upright at the finish.
    const reach = { lean: 10, arm: 80, elbow: 170, knee: 5 };
    const finish = { lean: 0, arm: -25, elbow: 70, knee: 5 };
    const rw = [{ dur: 1.5, from: reach, to: reach }];
    for (let k = 0; k < 6; k++) rw.push({ dur: 1, from: reach, to: finish }, { dur: 0.2, from: finish, to: finish }, { dur: 1.2, from: finish, to: reach }, { dur: 0.4, from: reach, to: reach });
    expect(feed(sideTrack(timeline(rw)), 'row').alerts).toEqual([]);
    // Press, from the front.
    const rack = { wl: 0.05, wr: 0.05, lean: 0, hipDip: 0 };
    const top = { wl: 1, wr: 1, lean: 0, hipDip: 0 };
    const pr = [{ dur: 1.5, from: rack, to: rack }];
    for (let k = 0; k < 6; k++) pr.push({ dur: 1, from: rack, to: top }, { dur: 0.25, from: top, to: top }, { dur: 1.2, from: top, to: rack }, { dur: 0.4, from: rack, to: rack });
    expect(feed(frontTrack(timeline(pr)), 'press').alerts).toEqual([]);
    // ...and a heavy side lean on the press does alert.
    const leanTop = { ...top, lean: 16 };
    const bad = [{ dur: 1.5, from: rack, to: rack }, { dur: 1, from: rack, to: leanTop }, { dur: 0.6, from: leanTop, to: leanTop }, { dur: 1.2, from: leanTop, to: rack }, { dur: 1, from: rack, to: rack }];
    expect(feed(frontTrack(timeline(bad)), 'press').alerts.map((a) => a.ruleId)).toEqual(['sideLean']);
  });

  it('fires for a squat torso leaning far past the shins', () => {
    const stand = { knee: 5, lean: 8, shin: 2 };
    const bad = { knee: 110, lean: 75, shin: 30 };
    const phases = [{ dur: 1.5, from: stand, to: stand }];
    for (let k = 0; k < 2; k++) phases.push({ dur: 1.4, from: stand, to: bad }, { dur: 0.6, from: bad, to: bad }, { dur: 1.1, from: bad, to: stand }, { dur: 0.5, from: stand, to: stand });
    const { alerts } = feed(sideTrack(timeline(phases)), 'squat');
    expect(alerts.length).toBe(1);
    expect(alerts[0].ruleId).toBe('excessLean');
  });
});

describe('live session', () => {
  it('counts reps as they finish', () => {
    const { results } = feed(sideTrack(curlSet(Array(5).fill(clean))), 'curl');
    expect(results.at(-1).reps).toBe(5);
  });

  it('stops on its own after a few seconds without rep movement', () => {
    const { results } = feed(sideTrack(curlSet(Array(3).fill(clean), 1, 6)), 'curl');
    const stop = results.find((r) => r.stop)?.stop;
    expect(stop?.reason).toBe('idle');
  });

  it('stops when the lifter leaves the frame', () => {
    const tl = curlSet(Array(3).fill(clean), 1, 3);
    const n = Math.floor(tl.total * 15) + 1;
    const gone = Array.from({ length: 30 }, (_, k) => n - 30 + k);
    const { results } = feed(sideTrack(tl, { dropFrames: gone }), 'curl');
    expect(results.find((r) => r.stop)?.stop.reason).toBe('left');
  });

  it('reports ready once the whole body is in frame from the side', () => {
    const tl = timeline([{ dur: 3, from: { lean: 0 }, to: { lean: 0 } }]);
    const { results } = feed(sideTrack(tl), 'curl', { recordFrom: 1e9 });
    const last = results.at(-1).readiness;
    expect(last.ok).toBe(true);
    expect(last.readyFor).toBeGreaterThan(2);
    const front = feed(frontTrack(timeline([{ dur: 2, from: { wl: 0 }, to: { wl: 0 } }])), 'curl', { recordFrom: 1e9 });
    expect(front.results.at(-1).readiness.view).toBe(false);
    expect(front.results.at(-1).readiness.message).toBe('Turn side-on to the camera');
  });
});
