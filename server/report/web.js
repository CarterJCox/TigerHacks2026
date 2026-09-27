// Web-standard (Request -> Response) adapter for the report service, used by
// the Vercel functions in api/. Vercel sets x-forwarded-for to the client's
// real address (it overwrites anything the client sends), so that's the IP
// used for rate limiting.

import { createReportService } from './service.js';
import { readWebBody } from './guard.js';

// Vercel stops the function at maxDuration (30 s in vercel.json). The Claude
// call gets 24 s with no SDK retries, so a slow response ends as a template
// fallback inside the limit instead of a platform timeout. The browser shows
// the template report either way.
export const SERVERLESS_OPTIONS = { claudeTimeoutMs: 24_000, maxRetries: 0 };

function json({ status, body, headers = {} }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

/** Handlers for the two functions; the service (and its rate limiter) lives as long as the instance. */
export function createWebHandlers(env = process.env, options = SERVERLESS_OPTIONS) {
  let service = null;
  // Created on first use so environment variables are read at request time.
  const get = () => (service ??= createReportService(env, options));
  return {
    async report(request) {
      const url = new URL(request.url);
      return json(
        await get().report({
          method: request.method,
          origin: request.headers.get('origin'),
          hosts: [url.host, request.headers.get('x-forwarded-host'), request.headers.get('host')],
          ip: clientIp(request),
          contentLength: request.headers.get('content-length'),
          readBody: (max) => readWebBody(request, max),
        }),
      );
    },
    async health(request) {
      if (request.method !== 'GET') return json({ status: 405, body: { error: 'Use GET.' }, headers: { Allow: 'GET' } });
      return json(get().health());
    },
  };
}
