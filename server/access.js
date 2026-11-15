/** Local-first deployment. Production must provide authentication at the reverse proxy
 * and a matching server-side bearer token. Do not expose this token in a public bundle. */
import { timingSafeEqual } from 'node:crypto';

const calls = new Map();
let anonWarned = false;

if (process.env.AGRO_ALLOW_ANON_WRITES === 'true') {
  anonWarned = true;
  console.warn(
    '[SECURITY WARNING] AGRO_ALLOW_ANON_WRITES=true: write endpoints (/api/import, /api/assumptions, /api/forecast, /api/advisor) allow unauthenticated access. Use for local development only.'
  );
}

export function allowRequest(req, res, { costly = false, write = undefined } = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return true;

  const headers = req.headers || {};
  if (headers.origin && headers.host) {
    try {
      if (new URL(headers.origin).host !== headers.host) {
        res.status(403).json({ message: 'Cross-origin access denied' });
        return false;
      }
    } catch {
      res.status(403).json({ message: 'Invalid origin' });
      return false;
    }
  }

  const isWriteOrPrivileged = write !== undefined ? Boolean(write) : method !== 'GET' && method !== 'HEAD';
  const allowAnonWrites = process.env.AGRO_ALLOW_ANON_WRITES === 'true';
  if (allowAnonWrites && !anonWarned) {
    anonWarned = true;
    console.warn(
      '[SECURITY WARNING] AGRO_ALLOW_ANON_WRITES=true: write endpoints allow unauthenticated access. Use for local development only.'
    );
  }

  const requireAuth = process.env.AGRO_REQUIRE_AUTH === 'true' || (isWriteOrPrivileged && !allowAnonWrites);
  if (requireAuth) {
    const expected = (process.env.AGRO_API_TOKEN || '').trim();
    const rawHeader = headers.authorization || headers.Authorization || headers['x-api-token'] || '';
    const supplied = String(rawHeader).replace(/^Bearer\s+/i, '').trim();
    if (!expected || !supplied) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required (provide Authorization: Bearer <AGRO_API_TOKEN>)',
      });
      return false;
    }
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(supplied, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required (invalid token)',
      });
      return false;
    }
  }

  if (costly && process.env.AGRO_TEST !== '1') {
    const now = Date.now();
    const key = req.socket?.remoteAddress || 'local';
    if (calls.size > 1000) {
      for (const [k, v] of calls) {
        if (now - v.start > 60000) calls.delete(k);
      }
    }
    const item = calls.get(key) || { start: now, n: 0 };
    if (now - item.start > 60000) {
      item.start = now;
      item.n = 0;
    }
    item.n++;
    calls.set(key, item);
    if (item.n > 20) {
      res.status(429).json({ message: 'Too many requests; retry in one minute' });
      return false;
    }
  }
  return true;
}

