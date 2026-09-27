// Node/Connect adapter for the report service: used by the Vite dev
// middleware (vite.config.js, mounted at /api) and by server/index.js.
// Paths arrive without the /api prefix: /health and /report.

import { createReportService, DEFAULT_MODEL } from './service.js';
import { readNodeBody } from './guard.js';

export { DEFAULT_MODEL };

function send(res, { status, body, headers = {} }) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

/**
 * @param env environment variables (see service.js)
 * @param options service options (see service.js)
 * The client IP is the socket address. Behind a reverse proxy every request
 * shares the proxy's address and therefore one rate limit.
 */
export function createReportHandler(env = process.env, options = {}) {
  const service = createReportService(env, options);
  return async function reportHandler(req, res, next) {
    const url = (req.url || '').split('?')[0];
    if (url === '/health' && req.method === 'GET') {
      send(res, service.health());
      return;
    }
    if (url !== '/report') {
      if (next) next();
      else send(res, { status: 404, body: { error: 'not found' } });
      return;
    }
    const result = await service.report({
      method: req.method,
      origin: req.headers.origin,
      hosts: [req.headers.host],
      ip: req.socket?.remoteAddress,
      contentLength: req.headers['content-length'],
      readBody: (max) => readNodeBody(req, max),
    });
    send(res, result);
  };
}
