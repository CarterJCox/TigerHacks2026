// Form standards: every scored rep, first reps included, is checked against
// fixed per-exercise limits from the exercise config (`standards.rules`).
// This is the second layer next to the comparison with the user's first reps
// (scoring.js). The two combine into one severity per rep:
//   green  good form: nothing flagged
//   yellow less effective for building muscle (a yellow rule, or any change
//          against the first reps)
//   red    injury risk (a red rule)
// and one gauge reading, 0-100 (gaugeValue below).

import { LM } from '../pose/landmarks.js';
import { heldMax, heldMin } from './geometry.js';
import { changedMetrics } from './scoring.js';
import { changePhrase, fmtLong, listReps, round } from '../report/format.js';

export const SEVERITY_RANK = { unknown: -1, green: 0, yellow: 1, red: 2 };

// ---------------------------------------------------------------------------
// Gauge value. The dial runs 0-100 in three equal zones:
//   green  0-33    good form
//   yellow 33-67   less effective for building muscle
//   red    67-100  injury risk
// The zone is the severity. Inside it, the needle moves with how far the
// worst measurement has travelled (`fraction`, 0 to 1):
//   green : from the rule's ideal toward its first limit (1 = at the limit);
//           for the first-reps comparison, toward the "notable" level
//   yellow: past the yellow limit toward the red one (with no red limit, by
//           as much again as the distance from ideal to the yellow limit);
//           for the first-reps comparison, from "notable" toward "major"
//   red   : past the red limit, by up to one more yellow-to-red span (half
//           the ideal-to-red distance when there is no yellow limit)
// Each zone keeps a 6% inset at both edges, so a reading never sits exactly
// on a boundary: green spans 2-31, yellow 35-65, red 69-98.
// ---------------------------------------------------------------------------
export const GAUGE_ZONES = { green: [0, 100 / 3], yellow: [100 / 3, 200 / 3], red: [200 / 3, 100] };
const GAUGE_INSET = 0.06;

export function gaugeValue(severity, fraction) {
  const zone = GAUGE_ZONES[severity];
  if (!zone) return null;
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const [lo, hi] = zone;
  return Math.round((lo + (hi - lo) * (GAUGE_INSET + (1 - 2 * GAUGE_INSET) * f)) * 10) / 10;
}

/** How far a rule's value has travelled within its severity zone (unclamped). */
export function ruleFraction(rule, value, level) {
  const dir = rule.worse === 'above' ? 1 : -1;
  const past = (limit) => dir * (value - limit);
  if (level === 'red') {
    const span = rule.yellow != null ? Math.abs(rule.red - rule.yellow) : Math.abs(rule.red - rule.ideal) / 2;
    return past(rule.red) / span;
  }
  if (level === 'yellow') {
    const span = rule.red != null ? Math.abs(rule.red - rule.yellow) : Math.abs(rule.yellow - rule.ideal);
    return past(rule.yellow) / span;
  }
  const first = rule.yellow ?? rule.red;
  return (dir * (value - rule.ideal)) / Math.abs(first - rule.ideal);
}

/** Severity of a rule's value. Compared after rounding, so "12° (limit 12°)" never shows as flagged. */
export function ruleLevel(rule, value) {
  const r = round(value, rule.decimals);
  const past = (limit) => limit != null && (rule.worse === 'above' ? r > limit : r < limit);
  if (past(rule.red)) return 'red';
  if (past(rule.yellow)) return 'yellow';
  return 'green';
}

function unitDef(rule) {
  return { unit: rule.unit, decimals: rule.decimals };
}

/**
 * "Torso swung 18° to lift the weight (limit 10°)." With several reps, the
 * value is the worst one: "... 18° at worst, on reps 4–6 (limit 10°)."
 */
export function ruleText(rule, value, level, repsText = '', several = false) {
  const def = unitDef(rule);
  const limit = level === 'red' ? rule.red : rule.yellow;
  const say = rule.says.replace('{value}', fmtLong(value, def));
  const lim = (rule.limitText || 'limit {limit}').replace('{limit}', fmtLong(limit, def));
  const where = `${several ? ` at worst${repsText ? ',' : ''}` : ''}${repsText ? ` on ${repsText}` : ''}`;
  return `${say}${where} (${lim}).`;
}

function landmarksFor(parts, ctx) {
  const sides = ctx.view === 'side' ? [ctx.side] : ['left', 'right'];
  const out = [];
  for (const s of sides) for (const p of parts) if (LM[`${s}${p}`] !== undefined) out.push(LM[`${s}${p}`]);
  return out;
}

// Frames where every joint the rule needs was seen clearly (not interpolated,
// visibility at or above the rule threshold).
function clearMask(sm, joints, minVis) {
  const mask = new Uint8Array(sm.n);
  for (let i = 0; i < sm.n; i++) mask[i] = joints.every((j) => sm.ok[j][i] && sm.vis[j][i] >= minVis) ? 1 : 0;
  return mask;
}

function runs(a, b, pred) {
  const out = [];
  let start = -1;
  for (let i = a; i <= b + 1; i++) {
    const on = i <= b && pred(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

function frameWindow(rule, rep, prev, next, n, pad) {
  if (rule.window !== 'reach') return [rep.startIdx, rep.endIdx];
  return [
    Math.min(rep.startIdx, Math.max(prev ? prev.endIdx : 0, rep.startIdx - pad)),
    Math.max(rep.endIdx, Math.min(next ? next.startIdx : n - 1, rep.endIdx + pad)),
  ];
}

/**
 * One rule on one rep: { value, level, fraction, spans } or { level: 'skipped' }.
 * `spans` are the frame runs where the issue shows, for the skeleton tint.
 */
function checkRule(p, rep, win, k, std, concentricFirst) {
  const { rule, mask, masked } = p;
  const [a, b] = win;
  let clear = 0;
  for (let i = a; i <= b; i++) clear += mask[i];
  if (clear / (b - a + 1) < std.minClearFraction) return { level: 'skipped', why: 'unclear' };

  let value;
  let spansFor;
  if (rule.measure === 'tempo') {
    const { liftTime, lowerTime } = rep.metrics;
    if (!(liftTime > 0.15) || !Number.isFinite(lowerTime)) return { level: 'skipped', why: 'unclear' };
    value = (lowerTime / liftTime) * 100;
    spansFor = () => [concentricFirst ? [rep.topLeaveIdx, rep.endIdx] : [rep.startIdx, rep.topReachIdx]];
  } else {
    const s = masked;
    const scale = rule.scale ?? 1;
    // Around the frames that set a "didn't get far enough" value.
    const around = (at) => [[Math.max(a, at - 1), Math.min(b, at + k)]];
    if (rule.measure === 'range') {
      const hi = heldMax(s, a, b, k);
      const lo = heldMin(s, a, b, k);
      value = hi.value - lo.value;
      // Tint where the body is past the limit, measured from the extreme it moved away from.
      const start = s[a];
      const towardHi = !Number.isFinite(start) || Math.abs(hi.value - start) >= Math.abs(lo.value - start);
      spansFor = (limit) => runs(a, b, (i) => Number.isFinite(s[i]) && (towardHi ? s[i] - lo.value : hi.value - s[i]) > limit);
    } else if (rule.measure === 'sway' || rule.measure === 'moved') {
      let ref = NaN;
      for (let i = a; i < Math.min(b, a + k) && !Number.isFinite(ref); i++) ref = s[i];
      // sway: distance from the starting value. moved: scale × value, minus
      // however far past zero the rep already started (a reclined seat or a
      // tilted camera isn't movement).
      const dev =
        rule.measure === 'sway'
          ? Float32Array.from(s, (v) => Math.abs(v - ref))
          : Float32Array.from(s, (v) => v * scale - Math.max(0, ref * scale));
      value = heldMax(dev, a, b, k).value;
      spansFor = (limit) => runs(a, b, (i) => Number.isFinite(dev[i]) && dev[i] > limit);
    } else {
      const h = rule.measure === 'max' ? heldMax(s, a, b, k) : heldMin(s, a, b, k);
      value = h.value * scale;
      // The measured extreme is the highest level reached when scale and
      // measure agree ('max', or 'min' flipped by scale -1).
      const highest = (rule.measure === 'max') === scale > 0;
      const excursion = highest === (rule.worse === 'above');
      spansFor = excursion
        ? (limit) => runs(a, b, (i) => Number.isFinite(s[i]) && (rule.worse === 'above' ? s[i] * scale > limit : s[i] * scale < limit))
        : () => around(h.at);
    }
  }
  if (!Number.isFinite(value)) return { level: 'skipped', why: 'unclear' };
  const level = ruleLevel(rule, value);
  const fraction = ruleFraction(rule, value, level);
  const limit = level === 'red' ? rule.red : level === 'yellow' ? rule.yellow : null;
  return { value, level, fraction, spans: limit == null ? [] : spansFor(limit) };
}

/** The first-reps comparison expressed on the same severity scale. */
function consistencyReading(rep, cfg) {
  if (rep.status === 'green') {
    let f = 0;
    for (const [key, d] of Object.entries(rep.deviations || {})) {
      const def = cfg.metrics[key];
      if (d.level !== 'na' && Number.isFinite(d.norm)) f = Math.max(f, d.norm / def.notable);
    }
    return { severity: 'green', fraction: Math.min(0.95, f) };
  }
  const changed = changedMetrics(rep, cfg);
  let f = changed.length ? 0 : 0.3;
  for (const c of changed) f = Math.max(f, (c.norm - c.def.notable) / (c.def.major - c.def.notable));
  const top = changed[0];
  const text = top
    ? `Compared with your first reps, ${changePhrase(top.key, top, top.def)}.`
    : rep.partial
      ? `Partial rep: less than ${Math.round(cfg.reps.partialFrac * 100)}% of a typical rep's range.`
      : 'Several measures drifted from your first reps.';
  return { severity: 'yellow', fraction: f, metric: top?.key ?? null, text };
}

/**
 * Runs the form standards on every scored rep and combines them with the
 * first-reps comparison. Mutates reps with `form` and `severity`; returns the
 * set-level reading.
 */
export function evaluateStandards(reps, series, sm, ctx, cfg, fps) {
  const std = cfg.standards;
  const rules = std?.rules ?? [];
  const k = Math.max(2, Math.round(std.holdSec * fps));
  const pad = Math.round(0.6 * fps);
  const prepared = rules.map((rule) => {
    const mask = clearMask(sm, landmarksFor(rule.joints, ctx), std.minVisibility);
    const s = rule.series ? series[rule.series] : null;
    return { rule, mask, masked: s ? Float32Array.from(s, (v, i) => (mask[i] ? v : NaN)) : null };
  });

  const tints = [];
  reps.forEach((rep, r) => {
    if (!rep.scorable) {
      rep.form = null;
      rep.severity = 'unknown';
      return;
    }
    const checks = {};
    for (const p of prepared) {
      const win = frameWindow(p.rule, rep, reps[r - 1], reps[r + 1], sm.n, pad);
      checks[p.rule.id] = checkRule(p, rep, win, k, std, cfg.reps.concentricFirst);
    }
    const cons = consistencyReading(rep, cfg);
    // Everything that flagged, ordered red rules, yellow rules, then the
    // first-reps comparison; within a group, furthest past its limit first.
    const flags = rules
      .filter((rule) => checks[rule.id].level === 'red' || checks[rule.id].level === 'yellow')
      .map((rule) => ({ kind: 'rule', ruleId: rule.id, severity: checks[rule.id].level, fraction: checks[rule.id].fraction }));
    if (cons.severity === 'yellow') flags.push({ kind: 'consistency', metric: cons.metric, severity: 'yellow', fraction: cons.fraction });
    flags.sort(
      (x, y) => SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity] || (x.kind === 'rule' ? 0 : 1) - (y.kind === 'rule' ? 0 : 1) || y.fraction - x.fraction,
    );

    let severity = 'green';
    let fraction = cons.fraction;
    let reason;
    if (flags.length) {
      severity = flags[0].severity;
      fraction = Math.max(...flags.filter((f) => f.severity === severity).map((f) => f.fraction));
      const top = flags[0];
      if (top.kind === 'rule') {
        const rule = rules.find((x) => x.id === top.ruleId);
        reason = { kind: 'rule', ruleId: rule.id, severity, text: ruleText(rule, checks[rule.id].value, severity) };
      } else {
        reason = { kind: 'consistency', metric: cons.metric, severity, text: cons.text };
      }
    } else {
      for (const rule of rules) if (checks[rule.id].level === 'green') fraction = Math.max(fraction, checks[rule.id].fraction);
      const skipped = rules.some((rule) => checks[rule.id].level === 'skipped');
      reason = { kind: 'clear', severity, text: skipped ? 'Every form check that could be measured passed on this rep.' : 'Every form check passed on this rep.' };
    }
    rep.form = { checks, flags, severity, fraction, value: gaugeValue(severity, fraction), reason };
    rep.severity = severity;
    for (const rule of rules) {
      const c = checks[rule.id];
      if (c.level === 'red' || c.level === 'yellow') for (const [i0, i1] of c.spans) tints.push({ i0, i1, severity: c.level, ruleId: rule.id, rep: rep.index });
    }
  });

  return summarize(reps, rules, tints);
}

function summarize(reps, rules, tints) {
  const scored = reps.filter((r) => r.form);
  // Per-rule results across the set, red groups first, then yellow.
  const flags = [];
  for (const level of ['red', 'yellow']) {
    for (const rule of rules) {
      const hits = scored.filter((r) => r.form.checks[rule.id].level === level);
      if (!hits.length) continue;
      const dir = rule.worse === 'above' ? 1 : -1;
      const worst = hits.reduce((w, r) => (dir * r.form.checks[rule.id].value > dir * w.form.checks[rule.id].value ? r : w));
      const value = worst.form.checks[rule.id].value;
      // Whether the flagged reps differ, so the text says "at worst".
      const varies = hits.some((r) => round(r.form.checks[rule.id].value, rule.decimals) !== round(value, rule.decimals));
      flags.push({
        ruleId: rule.id,
        label: rule.label,
        short: rule.short,
        severity: level,
        reps: hits.map((r) => r.index),
        worstRep: worst.index,
        value,
        limit: level === 'red' ? rule.red : rule.yellow,
        varies,
        text: ruleText(rule, value, level, listReps(hits.map((r) => r.index)), varies),
      });
    }
  }
  const skipped = rules
    .map((rule) => ({ ruleId: rule.id, label: rule.label, reps: scored.filter((r) => r.form.checks[rule.id].level === 'skipped').map((r) => r.index) }))
    .filter((s) => s.reps.length);
  const consistencyReps = scored.filter((r) => r.form.flags.some((f) => f.kind === 'consistency')).map((r) => r.index);

  // The set reading is its worst rep: one red rep puts the set in the red.
  const worst = scored.reduce((w, r) => (!w || r.form.value > w.form.value ? r : w), null);
  let reason;
  if (!worst) reason = { kind: 'clear', severity: 'unknown', text: 'No reps could be checked.' };
  else if (worst.form.reason.kind === 'rule') {
    const f = flags.find((x) => x.ruleId === worst.form.reason.ruleId && x.severity === worst.severity);
    reason = { kind: 'rule', ruleId: f.ruleId, severity: f.severity, reps: f.reps, text: f.text };
  } else if (worst.form.reason.kind === 'consistency') {
    const text = worst.form.reason.text.replace(/^Compared with your first reps, /, `From your first reps to rep ${worst.index}, `);
    reason = { kind: 'consistency', metric: worst.form.reason.metric, severity: 'yellow', reps: [worst.index], text: text.replace(/^Partial rep:/, `Rep ${worst.index} was partial:`) };
  } else {
    reason = {
      kind: 'clear',
      severity: 'green',
      text: skipped.length ? 'Every form check that could be measured passed on every scored rep.' : 'Every form check passed on every scored rep.',
    };
  }
  return {
    severity: worst ? worst.severity : 'unknown',
    value: worst ? worst.form.value : null,
    worstRep: worst?.index ?? null,
    reason,
    flags,
    skipped,
    consistencyReps,
    redReps: scored.filter((r) => r.severity === 'red').map((r) => r.index),
    tints,
  };
}
