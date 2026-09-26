// Plain-language explanations for rejected videos. The gates in quality.js
// and analyze.js decide *whether* a video is usable; these helpers use the
// per-frame data they already have to say *what* went wrong and *what to change*.

import { LM, NUM_LANDMARKS } from '../pose/landmarks.js';

const PART_WORDS = {
  Shoulder: 'shoulder',
  Elbow: 'elbow',
  Wrist: 'wrist',
  Hip: 'hip',
  Knee: 'knee',
  Ankle: 'ankle',
  Heel: 'heel',
  Foot: 'foot',
  Ear: 'ear',
};

export function clock(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function pct(x) {
  return Math.round(x * 100);
}

/** "left elbow", "elbow" (front views name both sides together). */
export function jointName(j, { withSide = true } = {}) {
  const key = Object.keys(LM).find((k) => LM[k] === j) || '';
  const side = key.startsWith('left') ? 'left' : key.startsWith('right') ? 'right' : '';
  const part = PART_WORDS[key.replace(/^(left|right)/, '')] || key.toLowerCase();
  return withSide && side ? `${side} ${part}` : part;
}

/** Contiguous time ranges where flag[i] is true, ignoring blips shorter than minSec. */
export function spansWhere(flag, times, minSec = 0.3) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= flag.length; i++) {
    const on = i < flag.length && flag[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const a = times[start];
      const b = times[i - 1];
      if (b - a >= minSec) out.push({ start: a, end: b });
      start = -1;
    }
  }
  // Merge ranges separated by less than a second.
  const merged = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < 1) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

export function describeSpans(spans, clipStart, clipEnd, limit = 2) {
  if (!spans.length) return '';
  const parts = spans
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, limit)
    .sort((a, b) => a.start - b.start)
    .map((s) => {
      if (s.start - clipStart < 0.5 && clipEnd - s.end < 0.5) return 'for the whole clip';
      if (s.start - clipStart < 0.5) return `from the start until ${clock(s.end)}`;
      if (clipEnd - s.end < 0.5) return `from ${clock(s.start)} to the end`;
      return `from ${clock(s.start)} to ${clock(s.end)}`;
    });
  return parts.join(' and ');
}

/**
 * Why a landmark was missing: off an edge of the frame, or inside the frame
 * but unclear (blocked, baggy clothing, poor light).
 */
export function missingReason(track, sm, j) {
  const counts = { left: 0, right: 0, top: 0, bottom: 0, hidden: 0, noPerson: 0 };
  for (let i = 0; i < track.n; i++) {
    if (sm.ok[j][i]) continue;
    if (!track.hasPose[i]) {
      counts.noPerson++;
      continue;
    }
    const b = (i * NUM_LANDMARKS + j) * 4;
    const x = track.raw[b];
    const y = track.raw[b + 1];
    if (y > 1) counts.bottom++;
    else if (y < 0) counts.top++;
    else if (x < 0) counts.left++;
    else if (x > 1) counts.right++;
    else counts.hidden++;
  }
  const [reason] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return reason[1] > 0 ? reason[0] : 'hidden';
}

export function reasonPhrase(reason) {
  switch (reason) {
    case 'bottom':
      return 'off the bottom of the frame';
    case 'top':
      return 'off the top of the frame';
    case 'left':
      return 'off the left edge of the frame';
    case 'right':
      return 'off the right edge of the frame';
    case 'noPerson':
      return 'while you were out of view';
    default:
      return 'inside the frame but hard to see';
  }
}

export function fixForReason(reason, part) {
  if (reason === 'bottom' || reason === 'top') {
    return `Move the camera back or lower the zoom so your ${part} stays inside the frame ${reason === 'top' ? 'at the top' : 'at the bottom'} of every rep.`;
  }
  if (reason === 'left' || reason === 'right') {
    return `Move the camera back or center yourself so your ${part} stays inside the frame for the whole set.`;
  }
  if (reason === 'noPerson') return 'Start recording with your whole body already in frame and stay in view until the last rep is done.';
  return `Make sure nothing blocks your ${part} (bench, rack, your other arm), and film in even light. Fitted sleeves or shorts help the tracker find the joint.`;
}
