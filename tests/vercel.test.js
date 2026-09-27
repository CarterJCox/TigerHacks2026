// The Vercel functions (api/report.js, api/health.js) against the Node
// endpoint used in dev and by server/index.js: same answers for the same
// input, and every rejection ends with the browser keeping the template.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer } from 'node:http';
import { createReportHandler } from '../server/report/node.js';
import { createWebHandlers, SERVERLESS_OPTIONS } from '../server/report/web.js';
import { LIMITS } from '../server/report/guard.js';
import reportFunction from '../api/report.js';
import healthFunction from '../api/health.js';
import { fetchLlmReport } from '../src/lib/report/client.js';
import { analyzeTrack } from '../src/lib/analysis/analyze.js';
import { buildTemplateReport } from '../src/lib/report/template.js';
import { buildPayload } from '../src/lib/report/payload.js';
import { sideTrack, curlSet } from './synth.js';

const SITE = 'https://spotter.example';

// A stand-in for the Anthropic Messages API.
let mock;
let mockUrl;
let nextReply = null;
let calls = 0;

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

beforeAll(async () => {
  mock = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls += 1;
      const json = JSON.parse(body || '{}');
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
afterEach(() => vi.unstubAllGlobals());

const clean = { top: 45, lift: 1.0, lower: 1.2, lean: 2, arm: 6 };
const bad = { top: 80, lift: 0.7, lower: 0.6, lean: 14, arm: 22 };
const analysis = analyzeTrack(sideTrack(curlSet([...Array(5).fill(clean), ...Array(3).fill(bad)])), 'curl');
const input = { plannedReps: 10, weight: 25, unit: 'lb', painReported: false };
const payload = buildPayload(analysis, input, buildTemplateReport(analysis, input));

function reportRequest(body, { origin = SITE, ip = '203.0.113.7', method = 'POST', headers = {} } = {}) {
  const init = { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1`, ...headers } };
  if (origin) init.headers.origin = origin;
  if (method !== 'GET' && method !== 'HEAD') init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(`${SITE}/api/report`, init);
}

async function callWeb(handlers, request) {
  const res = await handlers.report(request);
  return { status: res.status, headers: res.headers, body: await res.json() };
}

async function callNode(env, body) {
  const handler = createReportHandler(env);
  const server = createServer((req, res) => {
    req.url = req.url.replace(/^\/api/, '');
    handler(req, res);
  });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

/** Points the browser client's fetch('/api/report') at a Vercel handler. */
function routeBrowserTo(handlers, { origin = SITE, ip } = {}) {
  const realFetch = globalThis.fetch;
  // Only the browser's relative /api/report call; the Anthropic SDK's own requests pass through.
  vi.stubGlobal('fetch', (url, init) => (url === '/api/report' ? handlers.report(reportRequest(init.body, { origin, ip })) : realFetch(url, init)));
}

describe('Vercel report function', () => {
  it('returns the same report as the Node endpoint for the same input', async () => {
    const c = payload.breakdown.causes[0];
    nextReply = {
      headline: `Injury risk on reps 6 and 8: your torso swung ${payload.formStandards.flags[0].worstValue}° to lift the weight (limit 10°). Form held for reps 1-5 and changed at rep 6: ${c.label.toLowerCase()} went from ${c.firstRepsAverage} to ${c.value}.`,
      summary: 'Reps 1-3 were your first reps. The later reps moved differently.',
      cues: ['Keep your chest and hips still.'],
    };
    const env = { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: mockUrl };
    const node = await callNode(env, payload);
    const web = await callWeb(createWebHandlers(env), reportRequest(payload));
    expect(web.status).toBe(200);
    expect(web.body).toEqual(node.body);
    expect(web.body.source).toBe('llm');
    // Without a key both answer with the template fallback, identically.
    const nodeNoKey = await callNode({}, payload);
    const webNoKey = await callWeb(createWebHandlers({}), reportRequest(payload));
    expect(webNoKey).toMatchObject({ status: 200, body: nodeNoKey.body });
    expect(webNoKey.body).toEqual({ source: 'template', reason: 'no API key configured' });
  });

  it('gives the browser a Claude report through the function', async () => {
    nextReply = { headline: 'Form changed at rep 6.', summary: 'Reps 1-3 were your first reps.', cues: [] };
    routeBrowserTo(createWebHandlers({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: mockUrl }));
    const report = await fetchLlmReport(payload);
    expect(report).toMatchObject({ source: 'llm', headline: 'Form changed at rep 6.' });
  });

  it('only accepts POST', async () => {
    const handlers = createWebHandlers({});
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await callWeb(handlers, reportRequest(null, { method }));
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
      expect(res.body.source).toBe('template');
    }
  });

  it('rejects oversized bodies, declared or streamed, without calling Claude', async () => {
    const handlers = createWebHandlers({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: mockUrl });
    const before = calls;
    const big = { ...payload, padding: Array.from({ length: 20000 }, (_, i) => i) };
    expect(JSON.stringify(big).length).toBeGreaterThan(LIMITS.maxBodyBytes);
    const declared = await callWeb(handlers, reportRequest(big));
    expect(declared.status).toBe(413);
    // No Content-Length: the body is read as a stream and cut off at the limit.
    const text = JSON.stringify(big);
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < text.length; i += 8192) controller.enqueue(new TextEncoder().encode(text.slice(i, i + 8192)));
        controller.close();
      },
    });
    const streamed = await callWeb(handlers, new Request(`${SITE}/api/report`, { method: 'POST', body: stream, duplex: 'half', headers: { origin: SITE, 'content-type': 'application/json' } }));
    expect(streamed.status).toBe(413);
    expect(calls).toBe(before);
    routeBrowserTo(handlers);
    expect(await fetchLlmReport(big)).toBeNull();
  });

  it('rejects other sites and missing origins, and allows the site, localhost and ALLOWED_ORIGINS', async () => {
    const handlers = createWebHandlers({});
    expect((await callWeb(handlers, reportRequest(payload, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await callWeb(handlers, reportRequest(payload, { origin: null }))).status).toBe(403);
    expect((await callWeb(handlers, reportRequest(payload, { origin: 'null' }))).status).toBe(403);
    expect((await callWeb(handlers, reportRequest(payload))).status).toBe(200); // same origin
    expect((await callWeb(handlers, reportRequest(payload, { origin: 'http://localhost:5173' }))).status).toBe(200);
    const listed = createWebHandlers({ ALLOWED_ORIGINS: 'https://app.spotter.example, https://other.example/' });
    expect((await callWeb(listed, reportRequest(payload, { origin: 'https://other.example' }))).status).toBe(200);
    expect((await callWeb(listed, reportRequest(payload, { origin: 'https://evil.example' }))).status).toBe(403);
    routeBrowserTo(handlers, { origin: 'https://evil.example' });
    expect(await fetchLlmReport(payload)).toBeNull();
  });

  it('rate limits per IP, and in total per instance', async () => {
    const handlers = createWebHandlers({});
    for (let i = 0; i < LIMITS.perIpPerMinute; i++) expect((await callWeb(handlers, reportRequest(payload))).status).toBe(200);
    const limited = await callWeb(handlers, reportRequest(payload));
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ source: 'template', reason: 'rate limited' });
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another address still gets through.
    expect((await callWeb(handlers, reportRequest(payload, { ip: '198.51.100.2' }))).status).toBe(200);
    // The browser keeps the template when limited.
    routeBrowserTo(handlers);
    expect(await fetchLlmReport(payload)).toBeNull();

    const tight = createWebHandlers({}, { ...SERVERLESS_OPTIONS, limits: { totalPerMinute: 3 } });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await callWeb(tight, reportRequest(payload, { ip: `192.0.2.${i}` }))).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it('answers bad JSON and non-metrics payloads with clear JSON errors', async () => {
    const handlers = createWebHandlers({});
    const badJson = await callWeb(handlers, reportRequest('{not json'));
    expect(badJson).toMatchObject({ status: 400, body: { source: 'template', error: 'invalid JSON' } });
    const notMetrics = await callWeb(handlers, reportRequest({ hello: 'world' }));
    expect(notMetrics).toMatchObject({ status: 400, body: { error: 'expected a metrics payload' } });
    const media = await callWeb(handlers, reportRequest({ ...payload, extra: `data:video/mp4;base64,${'A'.repeat(3000)}` }));
    expect(media).toMatchObject({ status: 400, body: { error: 'only measurements are accepted' } });
  });
});

describe('the deployed function files', () => {
  it('api/report.js and api/health.js answer as Vercel functions', async () => {
    const wrongMethod = await reportFunction.fetch(new Request(`${SITE}/api/report`, { method: 'GET' }));
    expect(wrongMethod.status).toBe(405);
    const otherSite = await reportFunction.fetch(reportRequest(payload, { origin: 'https://evil.example' }));
    expect(otherSite.status).toBe(403);
    expect(await otherSite.json()).toMatchObject({ source: 'template' });
    const health = await healthFunction.fetch(new Request(`${SITE}/api/health`));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });
    expect((await healthFunction.fetch(new Request(`${SITE}/api/health`, { method: 'POST' }))).status).toBe(405);
  });
});
