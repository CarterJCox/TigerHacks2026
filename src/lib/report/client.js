import { validateLlmReport } from './safety.js';

let statusPromise = null;

/** Whether the server has an LLM configured. Cached for the session. */
export function fetchReportStatus() {
  if (!statusPromise) {
    statusPromise = fetch('/api/health')
      .then((res) => (res.ok ? res.json() : { llm: false }))
      .catch(() => ({ llm: false }));
  }
  return statusPromise;
}

/**
 * Asks the server for an LLM-written report. Resolves to a validated report
 * or null (the caller keeps the template report).
 */
export async function fetchLlmReport(payload, { signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75_000);
  signal?.addEventListener('abort', () => controller.abort());
  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (body.source !== 'llm') return null;
    const checked = validateLlmReport(body, payload);
    if (!checked.ok) return null;
    return { source: 'llm', model: body.model, ...checked.report };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
