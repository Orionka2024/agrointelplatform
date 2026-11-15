/** Per-user magic-link session authentication (`agro_session` HttpOnly cookie or bearer session token)
 * plus server-to-server bearer token (`AGRO_API_TOKEN`) support for CLI and automated tests.
 * Never expose `AGRO_API_TOKEN` in a client bundle. */
import { timingSafeEqual } from 'node:crypto';
import { store } from './store.js';

const calls = new Map();
let anonWarned = false;

if (process.env.AGRO_ALLOW_ANON_WRITES === 'true') {
  anonWarned = true;
  console.warn(
    '[SECURITY WARNING] AGRO_ALLOW_ANON_WRITES=true: write endpoints (/api/import, /api/assumptions, /api/forecast, /api/advisor) allow unauthenticated access. Use for local development only.'
  );
}

export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function extractSessionToken(req) {
  const headers = req?.headers || {};
  const cookies = parseCookies(headers.cookie || headers.Cookie || '');
  if (cookies.agro_session) return cookies.agro_session;
  if (headers['x-agro-session']) return String(headers['x-agro-session']).trim();
  const rawAuth = headers.authorization || headers.Authorization || '';
  if (/^Bearer\s+/i.test(rawAuth)) {
    const candidate = String(rawAuth).replace(/^Bearer\s+/i, '').trim();
    const sess = store.verifySessionToken(candidate);
    if (sess) return candidate;
  }
  return null;
}

export function resolveRequestUser(req) {
  const headers = req?.headers || {};
  const sessionToken = extractSessionToken(req);
  if (sessionToken) {
    const sess = store.verifySessionToken(sessionToken);
    if (sess) {
      return {
        id: sess.userId,
        email: sess.email,
        sessionId: sess.id,
        sessionToken,
        authMethod: 'session',
      };
    }
  }

  const expected = (process.env.AGRO_API_TOKEN || '').trim();
  const rawHeader = headers.authorization || headers.Authorization || headers['x-api-token'] || '';
  const supplied = String(rawHeader).replace(/^Bearer\s+/i, '').trim();
  if (expected && supplied) {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(supplied, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) {
      const customUser = headers['x-user-id'] ? String(headers['x-user-id']).trim() : 'default';
      return {
        id: customUser,
        email: 'service@local',
        authMethod: 'api_token',
      };
    }
  }

  return null;
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

  const resolvedUser = resolveRequestUser(req);
  if (resolvedUser) {
    req.user = resolvedUser;
  } else if (allowAnonWrites && isWriteOrPrivileged) {
    const customUser = headers['x-user-id'] ? String(headers['x-user-id']).trim() : 'default';
    req.user = { id: customUser, email: 'dev@local', authMethod: 'anon_dev' };
  } else {
    req.user = null;
  }

  const requireAuth = process.env.AGRO_REQUIRE_AUTH === 'true' || (isWriteOrPrivileged && !allowAnonWrites);
  if (requireAuth && !req.user) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required (sign in via /api/auth magic link or provide Authorization: Bearer <token>)',
    });
    return false;
  }

  if (costly && process.env.AGRO_TEST !== '1') {
    const now = Date.now();
    const key = req.user?.id || req.socket?.remoteAddress || 'local';
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


