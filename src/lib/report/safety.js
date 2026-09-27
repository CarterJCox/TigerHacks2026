// Safety rules shared by the browser and the report server.
//   - Pain or injury reports switch the report to "see a professional" mode.
//   - LLM-written text is rejected (and the template used instead) if it
//     prescribes load/reps, names a diagnosis, claims harm is certain ("you
//     will get injured"), or quotes numbers that are not in the measurements.

const PAIN_PATTERNS = [
  /\bpain(ful)?\b/i,
  /\bhurt(s|ing)?\b/i,
  /\binjur(y|ed|ies)\b/i,
  /\bache[sd]?\b|\baching\b/i,
  /\bsharp\b/i,
  /\bpinch(ed|ing)?\b/i,
  /\bstrain(ed)?\b/i,
  /\bsprain(ed)?\b/i,
  /\btweak(ed)?\b/i,
  /\bpop(ped)?\b/i,
  /\bnumb(ness)?\b/i,
  /\btingl(e|ing)\b/i,
  /\bswollen|swelling\b/i,
  /\btendon(itis)?\b|\btendinitis\b/i,
];

export function mentionsPain(text) {
  if (!text) return false;
  return PAIN_PATTERNS.some((re) => re.test(text));
}

// Anything that tells the user what load, reps or sets to do next.
const PRESCRIPTION_PATTERNS = [
  /\b(lighter|heavier)\b/i,
  /\b(reduce|drop|decrease|increase|add|cut|change|adjust)\s+(the\s+|your\s+)?(weight|load|reps?|sets?|resistance|volume)\b/i,
  /\b(lower|raise)\s+(the\s+|your\s+)?(weight|load)\s+(to|by|next)\b/i,
  /\b(weight|load|reps?|sets?)\s+(down|up)\b/i,
  /\b(go|going|move|moving)\s+(up|down)\s+in\s+weight\b/i,
  /\b(fewer|more)\s+reps\b/i,
  /\bstop(ping)?\s+(the\s+set\s+)?at\s+rep\b/i,
  /\b(end|cut|finish)\s+(the|your)\s+set\b/i,
  /\bdeload\b/i,
  // A number after these is a prescription unless it's a joint angle or a
  // tempo percentage from the form standards ("aim for 145° or more").
  /\b(try|use|pick|switch to|stick with|stay at|move to|aim for|target|do)\s+\d+(?:\.\d+)?(?![\d.]|\s*(?:°|%|degrees?\b))/i,
  /\b\d+(\.\d+)?\s*(lb|lbs|kg|kgs|pounds?|kilos?|kilograms?)\b/i,
  /\breps? (next time|in your next set)\b/i,
];

const DIAGNOSIS_PATTERNS = [
  /tendin(itis|osis|opathy)|tendonitis/i,
  /\btear\b|\btorn\b|\brupture/i,
  /impingement/i,
  /bursitis/i,
  /herniat/i,
  /\bsprain/i,
  /\bdiagnos(e|is|ed)\b/i,
  /\bdamage[sd]?\b/i,
];

// Risk wording must stay "injury risk" / "linked to extra strain": never a
// claim that harm will happen.
const HARM_CERTAINTY_PATTERNS = [
  /\bwill\s+(definitely\s+|certainly\s+|eventually\s+)?(get\s+)?(injure|hurt|damage)/i,
  /\bwill\s+(definitely\s+|certainly\s+|eventually\s+)?(cause|lead to|result in|give you)\s+(an?\s+)?(injur|damage|pain)/i,
  /\b(you're|you’re|you are)\s+going\s+to\s+(get\s+)?(injure|hurt)/i,
  /\bguarantee[sd]?\b/i,
];

export function findHarmClaim(text) {
  return HARM_CERTAINTY_PATTERNS.find((re) => re.test(text)) || null;
}

export function findPrescription(text) {
  return PRESCRIPTION_PATTERNS.find((re) => re.test(text)) || null;
}

export function findDiagnosis(text) {
  return DIAGNOSIS_PATTERNS.find((re) => re.test(text)) || null;
}

function numbersIn(text) {
  return (text.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

/**
 * Collects every number that appears in the metrics payload (and a rounded
 * form of each), so LLM text can only quote measured values.
 */
export function allowedNumbers(payload) {
  const set = new Set();
  const addNum = (v) => {
    if (!Number.isFinite(v)) return;
    for (const x of [v, Math.abs(v)]) {
      set.add(x);
      set.add(Math.round(x));
      set.add(Math.round(x * 10) / 10);
      set.add(Math.round(x * 100) / 100);
      set.add(Math.trunc(x));
    }
  };
  const walk = (node) => {
    if (node == null) return;
    if (typeof node === 'number') addNum(node);
    else if (typeof node === 'string') numbersIn(node).forEach(addNum);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(payload);
  // Small counting words written as digits (rep numbers, "2 reps", "1-5").
  const reps = payload?.set?.countedReps || 0;
  for (let i = 0; i <= Math.max(reps, 3); i++) set.add(i);
  return set;
}

/**
 * Validates LLM output. Returns { ok: true, report } or { ok: false, reason }.
 */
export function validateLlmReport(candidate, payload) {
  if (!candidate || typeof candidate !== 'object') return { ok: false, reason: 'not an object' };
  const headline = typeof candidate.headline === 'string' ? candidate.headline.trim() : '';
  const summary = typeof candidate.summary === 'string' ? candidate.summary.trim() : '';
  let cues = Array.isArray(candidate.cues) ? candidate.cues.filter((c) => typeof c === 'string').map((c) => c.trim()).filter(Boolean) : [];
  // The prompt asks for under 300 and 1000 characters; these caps leave some slack.
  if (!headline || headline.length > 360) return { ok: false, reason: `headline missing or too long (${headline.length} characters)` };
  if (!summary || summary.length > 1500) return { ok: false, reason: `summary missing or too long (${summary.length} characters)` };
  if (payload?.painReported) cues = [];
  if (cues.length > 2) cues = cues.slice(0, 2);
  if (cues.some((c) => c.length > 200)) return { ok: false, reason: 'cue too long' };

  const allowed = allowedNumbers(payload);
  for (const text of [headline, summary, ...cues]) {
    const p = findPrescription(text);
    if (p) return { ok: false, reason: `prescriptive language (${p})` };
    const d = findDiagnosis(text);
    if (d) return { ok: false, reason: `diagnostic language (${d})` };
    const h = findHarmClaim(text);
    if (h) return { ok: false, reason: `certain-harm language (${h})` };
    for (const num of numbersIn(text)) {
      if (!allowed.has(num) && !allowed.has(Math.abs(num))) return { ok: false, reason: `unmeasured number ${num}` };
    }
  }
  return { ok: true, report: { headline, summary, cues } };
}
