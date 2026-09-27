// The report service, shared by every entry point: the Vite dev middleware
// and server/index.js (through node.js) and the Vercel functions in api/
// (through web.js). It receives computed metrics only (never video or
// images) and asks Claude to write the plain-language parts of the report.
// Every response is checked by the same safety rules the browser uses;
// anything that fails falls back to the template report the browser
// already shows.
//
// Every non-success answer (wrong method, origin, rate limit, size, bad
// payload) is JSON with source: 'template'. The browser treats any non-2xx
// status, or any source other than 'llm', as "keep the template report".

import Anthropic from '@anthropic-ai/sdk';
import { validateLlmReport } from '../../src/lib/report/safety.js';
import { BodyTooLargeError, LIMITS, createRateLimiter, originAllowed, parseAllowedOrigins } from './guard.js';

// Writing a short report from metrics doesn't need Opus. SPOTTER_MODEL overrides
// this (claude-haiku-4-5-20251001 is faster and cheaper).
export const DEFAULT_MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT = `You write short form-analysis reports for Spotter, an app that checks each rep of a strength-training set using 2-D pose estimation from a video. It checks two things:
1. Form standards (formStandards): every rep, the first ones included, is checked against fixed limits for the exercise. A red flag means injury risk: a pattern linked to extra joint or back strain. A yellow flag means less effective for building muscle: safe, but the target muscle does less of the work.
2. Consistency: later reps are compared with the lifter's own first reps (firstReps) to find where form changed. A change counts as yellow.

You receive a JSON object with the measurements. Write three things:
- headline: one or two sentences, under 300 characters, plain language. If any form-standard flag is red, lead with it, for example "Injury risk on reps 4-6: your torso swung 18° to lift the weight (limit 10°)." Then say where form held and where it changed compared with the first reps, naming the metrics with their numbers, for example "Form held for reps 1-5 and changed from rep 6: range of motion dropped 30% (120° to 84°)."
- summary: two to four sentences, under 1000 characters, in this order: red flags, then yellow flags, then changes compared with the first reps and the biggest single change. Quote numbers exactly as given.
- cues: one or two short coaching cues about movement only (for example "Keep your elbows pinned to your sides"). Base them on red flags first, then yellow flags, then the metrics that changed. Use the provided candidate cues if they fit.

Rules you must follow:
- Describe what happened. Never recommend a weight, a load change, a rep count, a set count, or stopping the set earlier. Do not mention the weight value at all.
- Do not diagnose or name injuries or conditions. Describe movement only.
- For red flags say "injury risk" or "linked to extra strain". For yellow flags say "less effective for building muscle". Don't write "red flag", "yellow flag" or colour names, and don't mention flags that didn't happen. Never say the lifter will get injured or that harm is certain.
- Call the reps in firstReps "your first reps", never "baseline". They are not assumed to be good form.
- Only use numbers that appear in the JSON. Do not compute new percentages or averages.
- If painReported is true, return an empty cues array and use the summary to say plainly that because they reported pain, they should have it checked by a doctor or physical therapist before training this movement again.
- If breakdown is null, say the reps stayed consistent with the first reps and mention any isolated reps that drifted. Do not call the form good when there are form-standard flags.
- Measurements marked reliability "low" should be described as approximate.
- No emoji, no exclamation marks, no hype. Second person ("you", "your"). Use reps' numbers as written ("rep 6").`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    summary: { type: 'string' },
    cues: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'summary', 'cues'],
  additionalProperties: false,
};

// Refuse anything that looks like media, so the endpoint can only ever carry numbers and labels.
function looksLikeMedia(payload) {
  const text = JSON.stringify(payload);
  return /data:(video|image)\//i.test(text) || /[A-Za-z0-9+/]{2000,}/.test(text);
}

function extractText(message) {
  return (message.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

// Haiku 4.5 rejects the effort parameter; every other current model accepts it.
function supportsEffort(model) {
  return !/haiku/i.test(model);
}

/**
 * One report from Claude. `timeoutMs` bounds the whole call, including the
 * retry without the fallback beta, so a serverless function can answer
 * before its own time limit.
 */
async function callClaude(client, model, payload, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const format = { type: 'json_schema', schema: OUTPUT_SCHEMA };
  const request = {
    model,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    output_config: supportsEffort(model) ? { effort: 'low', format } : { format },
    messages: [{ role: 'user', content: `Measurements:\n${JSON.stringify(payload)}` }],
  };
  let message;
  try {
    // Server-side fallback: if the model declines, the API retries on its recommended fallback model.
    message = await client.beta.messages.create(
      { ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
      { timeout: timeoutMs },
    );
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      // Older API surfaces may not accept the fallback beta; retry once without it.
      const left = deadline - Date.now();
      if (left < 2000) throw new Error('no time left to retry');
      message = await client.messages.create(request, { timeout: left });
    } else {
      throw err;
    }
  }
  if (message.stop_reason === 'refusal') throw new Error('model declined the request');
  if (message.stop_reason === 'max_tokens') throw new Error('response was cut off');
  return JSON.parse(extractText(message));
}

const reply = (status, body, headers = {}) => ({ status, body, headers });
const template = (status, reason, extra = {}) => reply(status, { source: 'template', reason, ...extra });

/**
 * @param env ANTHROPIC_API_KEY, SPOTTER_MODEL, ALLOWED_ORIGINS (and ANTHROPIC_BASE_URL for tests)
 * @param options {
 *   claudeTimeoutMs: whole Claude call (default 60 s; the Vercel function uses less),
 *   maxRetries: SDK retries on 429/5xx/network errors (default 1),
 *   limits: overrides for guard.js LIMITS (tests) }
 */
export function createReportService(env = process.env, options = {}) {
  const apiKey = (env.ANTHROPIC_API_KEY || '').trim();
  const model = (env.SPOTTER_MODEL || '').trim() || DEFAULT_MODEL;
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const limits = { ...LIMITS, ...options.limits };
  const limiter = createRateLimiter(limits);
  const claudeTimeoutMs = options.claudeTimeoutMs ?? 60_000;
  const client = apiKey ? new Anthropic({ apiKey, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: options.maxRetries ?? 1 }) : null;

  return {
    model,
    limits,

    /** GET /api/health: whether Claude is configured (the browser skips the report request if not). */
    health() {
      return reply(200, { ok: true, llm: Boolean(client), model: client ? model : null });
    },

    /**
     * POST /api/report.
     * @param req { method, origin, hosts: [host...], ip, contentLength, readBody(maxBytes) -> Promise<string> }
     * @returns { status, body, headers }
     */
    async report(req) {
      if (req.method !== 'POST') return { ...template(405, 'method not allowed', { error: 'Use POST.' }), headers: { Allow: 'POST' } };
      if (!originAllowed(req.origin, req.hosts, allowed)) {
        return template(403, 'origin not allowed', { error: 'This endpoint only accepts requests from the Spotter site.' });
      }
      const length = Number(req.contentLength);
      if (Number.isFinite(length) && length > limits.maxBodyBytes) return template(413, 'payload too large', { error: 'payload too large' });
      const rate = limiter.take(req.ip);
      if (!rate.ok) {
        const limited = template(429, 'rate limited', { error: 'Too many report requests. Try again in a minute.' });
        return { ...limited, headers: { 'Retry-After': String(rate.retryAfter) } };
      }

      let payload;
      try {
        const text = await req.readBody(limits.maxBodyBytes);
        payload = JSON.parse(text || '{}');
      } catch (err) {
        if (err instanceof BodyTooLargeError) return template(413, 'payload too large', { error: 'payload too large' });
        return template(400, 'invalid JSON', { error: 'invalid JSON' });
      }
      if (!payload || typeof payload !== 'object' || !payload.set || !Array.isArray(payload.reps)) {
        return template(400, 'expected a metrics payload', { error: 'expected a metrics payload' });
      }
      if (looksLikeMedia(payload)) return template(400, 'only measurements are accepted', { error: 'only measurements are accepted' });
      if (!client) return template(200, 'no API key configured');

      try {
        const candidate = await callClaude(client, model, payload, claudeTimeoutMs);
        const checked = validateLlmReport(candidate, payload);
        if (!checked.ok) {
          console.warn(`[spotter] LLM report rejected: ${checked.reason}`);
          return template(200, `rejected: ${checked.reason}`);
        }
        return reply(200, { source: 'llm', model, ...checked.report });
      } catch (err) {
        console.warn(`[spotter] LLM report failed: ${err.message}`);
        return template(200, 'LLM request failed');
      }
    },
  };
}
