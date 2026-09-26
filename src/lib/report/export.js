// Report exports: a plain-text summary for the clipboard and a PNG summary
// card drawn directly on a canvas (no screenshot library needed).

import { getExercise } from '../../config/exercises/index.js';
import { fmtDelta, fmtLong, fmtRange, listReps } from './format.js';

const STATUS_WORD = { green: 'Held', yellow: 'Changed', red: 'Broke down', unknown: 'Not scored' };

function weightText(input) {
  return input.weightLabel || (input.bodyweight ? 'Bodyweight' : `${input.weight} ${input.unit}`);
}

function dateText(d = new Date()) {
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

/** The findings behind the headline: breakdown causes, then risk factors, with numbers. */
export function keyFindings(analysis, limit = 4) {
  const cfg = getExercise(analysis.exerciseId);
  const out = [];
  if (analysis.breakdown) {
    for (const c of analysis.breakdown.causes) {
      const def = cfg.metrics[c.key];
      out.push(`Rep ${analysis.breakdown.rep}: ${def.label.toLowerCase()} ${fmtRange(c.base, c.value, def)} (${fmtDelta(c, def)})`);
    }
  }
  for (const r of analysis.isolated || []) {
    const rep = analysis.reps.find((x) => x.index === r);
    const worst = Object.entries(rep?.deviations || {})
      .filter(([, d]) => d.level === 'notable' || d.level === 'major')
      .sort((a, b) => b[1].severity - a[1].severity)[0];
    if (worst) {
      const def = cfg.metrics[worst[0]];
      out.push(`Rep ${r} only: ${def.label.toLowerCase()} ${fmtRange(worst[1].base, worst[1].value, def)} (${fmtDelta(worst[1], def)})`);
    }
  }
  for (const risk of analysis.risks) {
    const def = cfg.metrics[risk.metric];
    const line = `${risk.title}: ${def.label.toLowerCase()} ${fmtRange(risk.first.base, risk.first.value, def)} from rep ${risk.firstRep}`;
    if (!out.some((l) => l.includes(def.label.toLowerCase()))) out.push(line);
  }
  return out.slice(0, limit);
}

/** Baseline vs later-rep numbers for the main metrics, used when nothing crossed a threshold. */
export function keyNumbers(analysis, limit = 3) {
  const cfg = getExercise(analysis.exerciseId);
  const later = analysis.reps.filter((r) => r.scorable && !r.isBaseline);
  return Object.entries(cfg.metrics)
    .filter(([, def]) => def.reliability !== 'low')
    .slice(0, limit)
    .map(([key, def]) => {
      const base = analysis.stats[key]?.mean;
      const vals = later.map((r) => r.metrics[key]).filter(Number.isFinite);
      const span = vals.length ? `${fmtLong(Math.min(...vals), def)} to ${fmtLong(Math.max(...vals), def)} across later reps` : 'no later reps';
      return `${def.label}: ${fmtLong(base, def)} baseline, ${span}`;
    });
}

export function buildPlainTextReport(analysis, input, report) {
  const cfg = getExercise(analysis.exerciseId);
  const lines = [];
  lines.push(`Spotter report: ${cfg.name}`);
  lines.push(dateText());
  lines.push('');
  lines.push(`Weight: ${weightText(input)}`);
  const partial = analysis.partialReps.length ? `, ${listReps(analysis.partialReps)} partial` : '';
  lines.push(`Reps: ${analysis.reps.length} counted${input.plannedReps ? ` of ${input.plannedReps} planned` : ''}${partial}`);
  lines.push(`Baseline: ${listReps(analysis.baselineReps)}`);
  lines.push(
    `Breakdown rep: ${
      analysis.breakdown ? `rep ${analysis.breakdown.rep} (form ${analysis.breakdown.kind === 'breakdown' ? 'broke down' : 'changed'})` : 'none, form held'
    }`,
  );
  lines.push(`Set score: ${analysis.setScore ?? '-'} / 100`);
  lines.push('');
  lines.push(report.headline);
  lines.push('');
  lines.push(report.summary);

  const findings = keyFindings(analysis, 6);
  lines.push('');
  lines.push(findings.length ? 'Key findings' : 'Key numbers');
  (findings.length ? findings : keyNumbers(analysis)).forEach((f) => lines.push(`- ${f}`));
  if (analysis.risks.length) {
    lines.push('');
    lines.push('Risk factors (not diagnoses)');
    analysis.risks.forEach((r) => lines.push(`- ${r.title}, from rep ${r.firstRep}: ${r.text}`));
  }
  if (report.cues.length && !input.painReported) {
    lines.push('');
    lines.push('Coaching cues');
    report.cues.forEach((c) => lines.push(`- ${c}`));
  }

  lines.push('');
  lines.push('Rep by rep');
  const keys = Object.keys(cfg.metrics);
  for (const r of analysis.reps) {
    const status = r.isBaseline ? 'Baseline' : STATUS_WORD[r.status] || r.status;
    const vals = keys.map((k) => `${cfg.metrics[k].short} ${fmtLong(r.metrics[k], cfg.metrics[k])}`).join(', ');
    lines.push(`Rep ${r.index}: ${status}${r.score != null ? `, score ${r.score}` : ''}${r.partial ? ', partial' : ''}. ${vals}`);
  }
  if (input.painReported) {
    lines.push('');
    lines.push('Pain was reported with this set. Have it checked by a doctor or physical therapist before training this movement again.');
  }
  lines.push('');
  lines.push('Measured from video by Spotter. Not medical advice.');
  return lines.join('\n');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers or contexts without the async clipboard API.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// ---------- PNG summary card ----------

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the results summary (headline, per-rep chart, key metrics) and returns a PNG blob. */
export async function renderSummaryImage(analysis, input, report) {
  const cfg = getExercise(analysis.exerciseId);
  const display = '"Bricolage Grotesque Variable", system-ui, sans-serif';
  const body = '"Instrument Sans Variable", system-ui, sans-serif';
  const mono = '"IBM Plex Mono", ui-monospace, monospace';
  try {
    await Promise.all([document.fonts.load(`700 40px ${display}`), document.fonts.load(`500 16px ${body}`), document.fonts.load(`400 14px ${mono}`)]);
  } catch {
    // Fonts fall back to system faces.
  }
  const C = {
    bg: cssVar('--bg', '#0b0c0f'),
    surface: cssVar('--surface', '#15171c'),
    line: cssVar('--line-soft', '#1f2228'),
    text: cssVar('--text', '#eef0f3'),
    text2: cssVar('--text-2', '#b3b8c2'),
    muted: cssVar('--muted', '#7d838f'),
    accent: cssVar('--accent', '#a797ff'),
    green: cssVar('--good', '#0ca30c'),
    yellow: cssVar('--warn', '#fab219'),
    red: cssVar('--bad', '#d03b3b'),
    unknown: cssVar('--unknown', '#5d636e'),
  };
  const W = 1200;
  const pad = 64;
  const inner = W - pad * 2;
  const scale = 2;
  const measure = document.createElement('canvas').getContext('2d');

  measure.font = `650 40px ${display}`;
  const headLines = wrap(measure, report.headline, inner);
  const found = keyFindings(analysis, 4);
  const findings = found.length ? found : keyNumbers(analysis);
  const findingsTitle = found.length ? 'Key findings' : 'Key numbers';
  const cues = input.painReported ? [] : report.cues.slice(0, 2);
  // Drawn on a generously tall canvas, then cropped to the content.
  const H = 1600 + headLines.length * 50;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 120, -60, 20, W - 120, -60, 700);
  glow.addColorStop(0, 'rgba(167,151,255,0.16)');
  glow.addColorStop(1, 'rgba(167,151,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  let y = pad;
  // Brand + eyebrow
  rrect(ctx, pad, y - 4, 30, 30, 8);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.strokeStyle = '#110d24';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pad + 6, y + 19);
  ctx.lineTo(pad + 12.5, y + 7);
  ctx.lineTo(pad + 17, y + 13.5);
  ctx.lineTo(pad + 24, y + 4);
  ctx.stroke();
  ctx.font = `700 22px ${display}`;
  ctx.fillStyle = C.text;
  ctx.fillText('Spotter', pad + 42, y + 19);
  ctx.font = `600 14px ${body}`;
  ctx.fillStyle = C.accent;
  const eyebrow = `${cfg.name} · ${weightText(input)} · ${dateText()}`.toUpperCase();
  ctx.fillText(eyebrow, pad, y + 62);
  y += 34 + 18 + 30;

  // Headline
  ctx.font = `650 40px ${display}`;
  ctx.fillStyle = C.text;
  for (const l of headLines) {
    y += 50;
    ctx.fillText(l, pad, y - 12);
  }
  y += 34;

  // Stat tiles
  const stats = [
    ['Reps counted', `${analysis.reps.length}`, input.plannedReps ? `of ${input.plannedReps} planned` : ''],
    ['Form held through', analysis.breakdown ? `Rep ${analysis.breakdown.rep - 1}` : 'Every rep', analysis.breakdown ? `changed at rep ${analysis.breakdown.rep}` : ''],
    ['Set score', `${analysis.setScore ?? '-'}`, 'average of scored reps'],
    ['Baseline', listReps(analysis.baselineReps).replace(/^reps? /, ''), 'first clean reps'],
  ];
  const gap = 16;
  const tileW = (inner - gap * 3) / 4;
  stats.forEach(([label, value, sub], i) => {
    const x = pad + i * (tileW + gap);
    rrect(ctx, x, y, tileW, 104, 14);
    ctx.fillStyle = C.surface;
    ctx.fill();
    ctx.font = `500 14px ${body}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(label, x + 18, y + 28);
    ctx.font = `650 30px ${display}`;
    ctx.fillStyle = C.text;
    ctx.fillText(value, x + 18, y + 66);
    ctx.font = `500 13px ${body}`;
    ctx.fillStyle = C.text2;
    ctx.fillText(sub, x + 18, y + 88);
  });
  y += 104 + 40;

  // Per-rep chart
  ctx.font = `650 20px ${display}`;
  ctx.fillStyle = C.text;
  ctx.fillText('Form quality by rep', pad, y);
  ctx.font = `500 14px ${body}`;
  ctx.fillStyle = C.muted;
  ctx.fillText('Score out of 100 compared with your baseline reps', pad + 220, y);
  y += 36;
  const chartH = 190;
  const left = pad + 36;
  const cw = inner - 36;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.font = `400 12px ${mono}`;
  ctx.fillStyle = C.muted;
  for (const t of [0, 50, 100]) {
    const yy = y + chartH - (t / 100) * chartH;
    ctx.beginPath();
    ctx.moveTo(left, yy + 0.5);
    ctx.lineTo(left + cw, yy + 0.5);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String(t), left - 10, yy + 4);
  }
  ctx.textAlign = 'center';
  const n = analysis.reps.length;
  const band = cw / Math.max(1, n);
  const bw = Math.min(28, band * 0.6);
  analysis.reps.forEach((r, i) => {
    const cx = left + band * (i + 0.5);
    const color = C[r.status] || C.unknown;
    if (r.score != null) {
      const h = Math.max(4, (r.score / 100) * chartH);
      const top = y + chartH - h;
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2, y + chartH);
      ctx.lineTo(cx - bw / 2, top + 4);
      ctx.quadraticCurveTo(cx - bw / 2, top, cx - bw / 2 + 4, top);
      ctx.lineTo(cx + bw / 2 - 4, top);
      ctx.quadraticCurveTo(cx + bw / 2, top, cx + bw / 2, top + 4);
      ctx.lineTo(cx + bw / 2, y + chartH);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.fillStyle = C.unknown;
      ctx.fillRect(cx - bw / 2, y + chartH - 3, bw, 3);
    }
    ctx.fillStyle = r.index === analysis.breakdown?.rep ? C.text : C.muted;
    ctx.font = `${r.index === analysis.breakdown?.rep ? 600 : 400} 12px ${mono}`;
    ctx.fillText(String(r.index), cx, y + chartH + 20);
  });
  if (analysis.breakdown) {
    const i = analysis.reps.findIndex((r) => r.index === analysis.breakdown.rep);
    const x = left + band * i;
    ctx.strokeStyle = C.text2;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y - 14);
    ctx.lineTo(x + 0.5, y + chartH);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = `600 12px ${body}`;
    ctx.fillStyle = C.text;
    ctx.fillText(analysis.breakdown.kind === 'breakdown' ? 'Broke down' : 'Changed', x + 6, y - 4);
  }
  // Legend
  ctx.textAlign = 'left';
  let lx = left;
  const ly = y + chartH + 46;
  for (const s of ['green', 'yellow', 'red', 'unknown']) {
    if (!analysis.reps.some((r) => r.status === s)) continue;
    ctx.fillStyle = C[s];
    rrect(ctx, lx, ly - 10, 12, 12, 3);
    ctx.fill();
    ctx.font = `500 13px ${body}`;
    ctx.fillStyle = C.text2;
    ctx.fillText(STATUS_WORD[s], lx + 18, ly);
    lx += ctx.measureText(STATUS_WORD[s]).width + 44;
  }
  y += 250 + 36;

  // Key findings
  if (findings.length) {
    ctx.font = `650 20px ${display}`;
    ctx.fillStyle = C.text;
    ctx.fillText(findingsTitle, pad, y);
    y += 40;
    ctx.font = `500 16px ${body}`;
    for (const f of findings) {
      ctx.fillStyle = C.accent;
      ctx.fillRect(pad, y - 10, 8, 2);
      ctx.fillStyle = C.text2;
      ctx.fillText(f, pad + 20, y - 4);
      y += 32;
    }
  }
  if (cues.length) {
    y += 8;
    ctx.font = `650 17px ${display}`;
    ctx.fillStyle = C.text;
    ctx.fillText('Coaching cues', pad, y);
    y += 30;
    ctx.font = `500 16px ${body}`;
    for (const c of cues) {
      ctx.fillStyle = C.text2;
      ctx.fillText(c, pad, y - 4);
      y += 30;
    }
  }

  // Footer
  y += 12;
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();
  ctx.font = `500 13px ${body}`;
  ctx.fillStyle = C.muted;
  ctx.fillText('Measured from video by Spotter. Not medical advice and cannot diagnose injuries.', pad, y + 30);
  const finalH = Math.min(H, Math.ceil(y + 30 + pad * 0.75));

  const out = document.createElement('canvas');
  out.width = W * scale;
  out.height = finalH * scale;
  out.getContext('2d').drawImage(canvas, 0, 0);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png'));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function reportFileName(analysis) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `spotter-${analysis.exerciseId}-${stamp}.png`;
}
