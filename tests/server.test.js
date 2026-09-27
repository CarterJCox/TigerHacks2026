import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { createReportHandler } from '../server/report/node.js';
import { analyzeTrack } from '../src/lib/analysis/analyze.js';
import { buildTemplateReport } from '../src/lib/report/template.js';
import { buildPayload } from '../src/lib/report/payload.js';
import { sideTrack, curlSet } from './synth.js';

// A stand-in for the Anthropic Messages API so the endpoint can be tested
// without a key or network access.
let mock;
let mockUrl;
let nextReply = null;
let rejectBeta = false;
const seen = [];

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

beforeAll(async () => {
  mock = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      seen.push({ url: req.url, headers: req.headers, body: json });
      if (rejectBeta && json.fallbacks) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'unknown field' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: json.model,
          content: [{ type: 'text', text: JSON.stringify(nextReply) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  mockUrl = await listen(mock);
});

afterAll(() => mock.close());

async function withHandler(env, fn) {
  const handler = createReportHandler(env);
  const server = createServer((req, res) => {
    req.url = req.url.replace(/^\/api/, '');
    handler(req, res);
  });
  const base = await listen(server);
  try {
    return await fn(base);
  } finally {
    server.close();
  }
}

const clean = { top: 45, lift: 1.0, lower: 1.2, lean: 2, arm: 6 };
const bad = { top: 80, lift: 0.7, lower: 0.6, lean: 14, arm: 22 };
const analysis = analyzeTrack(sideTrack(curlSet([...Array(5).fill(clean), ...Array(3).fill(bad)])), 'curl');
const input = { plannedReps: 10, weight: 25, unit: 'lb', painReported: false };
const payload = buildPayload(analysis, input, buildTemplateReport(analysis, input));

async function post(base, body) {
  // Browsers always send Origin on a POST; the endpoint requires it (same origin here).
  const res = await fetch(`${base}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  return res.json();
}

describe('report endpoint', () => {
  it('uses templates when no API key is set', async () => {
    await withHandler({}, async (base) => {
      const health = await (await fetch(`${base}/api/health`)).json();
      expect(health.llm).toBe(false);
      expect((await post(base, payload)).source).toBe('template');
    });
  });

  it('returns a validated Claude report built only from metrics', async () => {
    const c = payload.breakdown.causes[0];
    nextReply = {
      headline: `Form held for reps 1-5 and changed at rep 6: ${c.label.toLowerCase()} went from ${c.firstRepsAverage} to ${c.value}.`,
      summary: 'Reps 1-3 were your baseline. The later reps moved differently.',
      cues: ['Keep your elbows pinned to your sides.'],
    };
    seen.length = 0;
    await withHandler({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: mockUrl }, async (base) => {
      const out = await post(base, payload);
      expect(out.source).toBe('llm');
      expect(out.headline).toContain('rep 6');
    });
    const req = seen[0];
    expect(req.body.model).toBe('claude-sonnet-5');
    expect(req.body.output_config.effort).toBe('low');
    expect(req.body.output_config.format.type).toBe('json_schema');
    expect(req.body.fallbacks).toBe('default');
    expect(req.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    const sent = JSON.stringify(req.body.messages);
    expect(sent).not.toMatch(/video|blob:|data:image|landmark/i);
    expect(sent).not.toContain('"weight"');
  });

  it('falls back to the template when Claude prescribes load', async () => {
    nextReply = { headline: 'Use a lighter dumbbell next time.', summary: 'Drop the weight.', cues: [] };
    await withHandler({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: mockUrl }, async (base) => {
      const out = await post(base, payload);
      expect(out.source).toBe('template');
      expect(out.reason).toMatch(/prescriptive/);
    });
  });

  it('retries without the fallback beta if the API rejects it', async () => {
    nextReply = { headline: 'Form changed at rep 6.', summary: 'Reps 1-3 were your baseline.', cues: [] };
    rejectBeta = true;
    seen.length = 0;
    await withHandler({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: mockUrl }, async (base) => {
      expect((await post(base, payload)).source).toBe('llm');
    });
    rejectBeta = false;
    expect(seen.length).toBe(2);
    expect(seen[1].body.fallbacks).toBeUndefined();
  });

  it('refuses payloads that carry media', async () => {
    await withHandler({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: mockUrl }, async (base) => {
      const res = await fetch(`${base}/api/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify({ ...payload, extra: `data:video/mp4;base64,${'A'.repeat(3000)}` }),
      });
      expect(res.status).toBe(400);
    });
  });
});
