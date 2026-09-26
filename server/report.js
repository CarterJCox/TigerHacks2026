// Report endpoint. Receives computed metrics only (never video or images)
// and asks Claude to write the plain-language parts of the report. Every
// response is checked by the same safety rules the browser uses; anything
// that fails falls back to the template report the browser already has.

import Anthropic from '@anthropic-ai/sdk';
import { validateLlmReport } from '../src/lib/report/safety.js';

const DEFAULT_MODEL = 'claude-opus-5';
const MAX_BODY_BYTES = 256 * 1024;

const SYSTEM_PROMPT = `You write short form-analysis reports for Spotter, an app that compares each rep of a strength-training set against the lifter's own first reps (the baseline) using 2-D pose estimation from a video.

You receive a JSON object with the measurements. Write three things:
- headline: one or two sentences, plain language, saying where form held and where it changed, naming the metrics that changed with their numbers. Example shape: "Form held for reps 1-5 and changed from rep 6: range of motion dropped 30% (120° to 84°) and your torso started swinging (3° to 14°)."
- summary: two to four sentences that add context: the baseline reps, how many later reps stayed outside the baseline, and the biggest single change. Quote numbers exactly as given.
- cues: one or two short coaching cues about movement only (for example "Keep your elbows pinned to your sides"). Base them on the metrics that changed. Use the provided candidate cues if they fit.

Rules you must follow:
- Describe what happened. Never recommend a weight, a load change, a rep count, a set count, or stopping the set earlier. Do not mention the weight value at all.
- Do not diagnose or name injuries or conditions. Describe movement only.
- Only use numbers that appear in the JSON. Do not compute new percentages or averages.
- If painReported is true, return an empty cues array and use the summary to say plainly that because they reported pain, they should have it checked by a doctor or physical therapist before training this movement again.
- If breakdown is null, say form held steady and mention any isolated reps that drifted.
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

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

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

async function callClaude(client, model, payload) {
  const request = {
    model,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    messages: [{ role: 'user', content: `Measurements:\n${JSON.stringify(payload)}` }],
  };
  let message;
  try {
    // Server-side fallback: if the model declines, the API retries on its recommended fallback model.
    message = await client.beta.messages.create(
      { ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
      { timeout: 60_000 },
    );
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      // Older API surfaces may not accept the fallback beta; retry once without it.
      message = await client.messages.create(request, { timeout: 60_000 });
    } else {
      throw err;
    }
  }
  if (message.stop_reason === 'refusal') throw new Error('model declined the request');
  if (message.stop_reason === 'max_tokens') throw new Error('response was cut off');
  return JSON.parse(extractText(message));
}

export function createReportHandler(env = process.env) {
  const apiKey = (env.ANTHROPIC_API_KEY || '').trim();
  const model = (env.SPOTTER_MODEL || '').trim() || DEFAULT_MODEL;
  const client = apiKey ? new Anthropic({ apiKey, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1 }) : null;

  return async function reportHandler(req, res, next) {
    const url = (req.url || '').split('?')[0];
    if (url === '/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, llm: Boolean(client), model: client ? model : null });
      return;
    }
    if (url !== '/report') {
      if (next) next();
      else sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    let payload;
    try {
      payload = await readJson(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    if (!payload || typeof payload !== 'object' || !payload.set || !Array.isArray(payload.reps)) {
      sendJson(res, 400, { error: 'expected a metrics payload' });
      return;
    }
    if (looksLikeMedia(payload)) {
      sendJson(res, 400, { error: 'only measurements are accepted' });
      return;
    }
    if (!client) {
      sendJson(res, 200, { source: 'template', reason: 'no API key configured' });
      return;
    }
    try {
      const candidate = await callClaude(client, model, payload);
      const checked = validateLlmReport(candidate, payload);
      if (!checked.ok) {
        console.warn(`[spotter] LLM report rejected: ${checked.reason}`);
        sendJson(res, 200, { source: 'template', reason: `rejected: ${checked.reason}` });
        return;
      }
      sendJson(res, 200, { source: 'llm', model, ...checked.report });
    } catch (err) {
      console.warn(`[spotter] LLM report failed: ${err.message}`);
      sendJson(res, 200, { source: 'template', reason: 'LLM request failed' });
    }
  };
}
