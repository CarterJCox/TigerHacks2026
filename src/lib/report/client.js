import { validateLlmReport } from './safety.js';

export async function fetchReportStatus() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { llm: false };
    return await res.json();
  } catch {
    return { llm: false };
  }
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
