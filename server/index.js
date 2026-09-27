// Production server: serves the built app from dist/ and the report endpoint.
// Usage: npm run build && npm start

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReportHandler } from './report/node.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  // No .env file: the app runs with template reports.
}

const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('No build found in dist/. Run `npm run build` first (or use `npm run dev`).');
  process.exit(1);
}
const port = Number(process.env.PORT) || 8787;
const api = createReportHandler(process.env);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

async function serveFile(res, file) {
  const body = await readFile(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
  if (file.includes(`${join('dist', 'assets')}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path.startsWith('/api/')) {
      req.url = path.slice(4);
      await api(req, res);
      return;
    }
    const target = normalize(join(dist, path));
    if (!target.startsWith(dist)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    const info = await stat(target).catch(() => null);
    if (info?.isFile()) await serveFile(res, target);
    else await serveFile(res, join(dist, 'index.html'));
  } catch (err) {
    res.statusCode = 500;
    res.end('Server error');
    console.error(err);
  }
});

server.listen(port, () => {
  const llm = process.env.ANTHROPIC_API_KEY ? 'Claude-written reports enabled' : 'template reports (no ANTHROPIC_API_KEY)';
  console.log(`Spotter running at http://localhost:${port} (${llm})`);
});
