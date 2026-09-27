// Abuse protection for the public report endpoint. Each report is a paid
// Claude call, so requests are checked before anything else happens:
//   1. Origin: browsers always send Origin on a POST. Only the site itself
//      (same host), localhost, and origins listed in ALLOWED_ORIGINS pass.
//      This stops other websites from using the endpoint from their
//      visitors' browsers. It does not stop scripts, which can send any
//      Origin they like; the rate limits and the Claude Console spending cap
//      are what bound that.
//   2. Rate limits: per IP and per server instance, in memory.
//   3. Body size: payloads are rounded measurements, 6-25 KB in practice.

export const LIMITS = {
  maxBodyBytes: 64 * 1024,
  perIpPerMinute: 10,
  // All callers together, per instance: a ceiling on cost if requests
  // come from many addresses.
  totalPerMinute: 60,
  windowMs: 60_000,
  maxTrackedIps: 5000,
};

export class BodyTooLargeError extends Error {
  constructor() {
    super('payload too large');
    this.name = 'BodyTooLargeError';
  }
}

function isLocalhost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}

/** Parses ALLOWED_ORIGINS ("https://a.com, https://b.com", or "*"). */
export function parseAllowedOrigins(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Whether a request's Origin may use the endpoint.
 * @param origin the Origin header (null/undefined when missing)
 * @param hosts the host(s) this request was addressed to, e.g. ['spotter.vercel.app']
 * @param allowed parsed ALLOWED_ORIGINS
 */
export function originAllowed(origin, hosts, allowed) {
  if (!origin) return false;
  if (allowed.includes('*')) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin === 'null') return false;
  if (hosts.filter(Boolean).some((h) => h.toLowerCase() === url.host.toLowerCase())) return true; // same origin
  if (isLocalhost(url.hostname)) return true;
  return allowed.includes(url.origin);
}

/**
 * Sliding-window rate limiter kept in memory. On a serverless platform each
 * instance has its own memory and instances come and go, so these limits
 * are best effort: they reset when an instance is recycled and are not
 * shared between concurrent instances.
 */
export function createRateLimiter({ perIpPerMinute, totalPerMinute, windowMs, maxTrackedIps } = LIMITS) {
  const hits = new Map(); // ip -> timestamps
  let total = [];
  const prune = (list, now) => {
    let i = 0;
    while (i < list.length && now - list[i] >= windowMs) i++;
    return i ? list.slice(i) : list;
  };
  return {
    /** Records a request; returns { ok, retryAfter } (seconds). */
    take(ip, now = Date.now()) {
      total = prune(total, now);
      const key = ip || 'unknown';
      const mine = prune(hits.get(key) || [], now);
      if (mine.length >= perIpPerMinute) return { ok: false, retryAfter: Math.ceil((windowMs - (now - mine[0])) / 1000) };
      if (total.length >= totalPerMinute) return { ok: false, retryAfter: Math.ceil((windowMs - (now - total[0])) / 1000) };
      mine.push(now);
      total.push(now);
      hits.delete(key);
      hits.set(key, mine);
      // Forget the least recently seen addresses so memory stays bounded.
      while (hits.size > maxTrackedIps) hits.delete(hits.keys().next().value);
      return { ok: true, retryAfter: 0 };
    },
  };
}

/** Reads a Node request body as text, stopping as soon as it passes maxBytes. */
export function readNodeBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const onData = (c) => {
      size += c.length;
      if (size > maxBytes) {
        req.off('data', onData);
        req.resume(); // drain the rest without keeping it
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(c);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (size <= maxBytes) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/** Reads a Web Request body as text, stopping as soon as it passes maxBytes. */
export async function readWebBody(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}
