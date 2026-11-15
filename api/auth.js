/**
 * Vercel Serverless Function & Local Dev Handler: /api/auth
 * Per-user Email Magic Link authentication & HttpOnly session management.
 * Keeps shared secrets strictly off the client bundle.
 */
import { store } from '../server/store.js';
import { resolveRequestUser, extractSessionToken } from '../server/access.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Agro-Session');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await store.ensureInitialized({ forWrite: req.method !== 'GET' });
  } catch (err) {
    return res.status(err.statusCode || 503).json({
      error: err.code || 'DURABLE_STORE_UNAVAILABLE',
      message: err.message,
    });
  }

  if (req.method === 'GET') {
    const url = new URL(req.url || '/api/auth', 'http://localhost');
    const magicToken = url.searchParams.get('token');
    if (magicToken) {
      const verified = store.verifyMagicLink(magicToken);
      if (!verified) {
        return res.status(401).json({
          error: 'INVALID_OR_EXPIRED_MAGIC_LINK',
          message: 'Ссылка для входа недействительна или уже использована.',
        });
      }
      const maxAge = 30 * 24 * 3600;
      const secureFlag = process.env.VERCEL_ENV === 'production' ? '; Secure' : '';
      res.setHeader(
        'Set-Cookie',
        `agro_session=${encodeURIComponent(verified.sessionToken)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secureFlag}`
      );
      return res.status(200).json({
        authenticated: true,
        user: verified.user,
        sessionToken: verified.sessionToken,
        expiresAt: verified.expiresAt,
      });
    }

    const user = resolveRequestUser(req);
    return res.status(200).json({
      authenticated: Boolean(user && user.authMethod === 'session'),
      user: user && user.authMethod === 'session' ? { id: user.id, email: user.email } : null,
    });
  }

  if (req.method === 'POST' || req.method === 'DELETE') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const action = req.method === 'DELETE' ? 'logout' : (body?.action || 'request_magic_link');

    if (action === 'request_magic_link') {
      try {
        const issued = store.createMagicLink(body?.email);
        const magicLinkUrl = `/api/auth?token=${encodeURIComponent(issued.token)}`;
        const isProdEmailConfigured = Boolean(process.env.RESEND_API_KEY || process.env.MAGIC_LINK_WEBHOOK_URL);
        return res.status(200).json({
          success: true,
          email: issued.email,
          expiresAt: issued.expiresAt,
          delivery: isProdEmailConfigured ? 'email_webhook' : 'direct_magic_link',
          // Returned when external email provider is not configured so local/dev/test users can complete sign-in
          ...(isProdEmailConfigured ? {} : { magicLinkToken: issued.token, magicLinkUrl }),
          message: `Одноразовая ссылка для входа создана для ${issued.email} (действует 15 минут).`,
        });
      } catch (err) {
        return res.status(err.statusCode || 400).json({
          error: err.code || 'BAD_REQUEST',
          message: err.message,
        });
      }
    }

    if (action === 'verify_magic_link') {
      const verified = store.verifyMagicLink(body?.token);
      if (!verified) {
        return res.status(401).json({
          error: 'INVALID_OR_EXPIRED_MAGIC_LINK',
          message: 'Ссылка для входа недействительна, просрочена или уже была использована.',
        });
      }
      const maxAge = 30 * 24 * 3600;
      const secureFlag = process.env.VERCEL_ENV === 'production' ? '; Secure' : '';
      res.setHeader(
        'Set-Cookie',
        `agro_session=${encodeURIComponent(verified.sessionToken)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secureFlag}`
      );
      return res.status(200).json({
        authenticated: true,
        user: verified.user,
        sessionToken: verified.sessionToken,
        expiresAt: verified.expiresAt,
      });
    }

    if (action === 'logout') {
      const token = extractSessionToken(req) || body?.sessionToken;
      if (token) store.revokeSessionToken(token);
      res.setHeader('Set-Cookie', 'agro_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
      return res.status(200).json({ authenticated: false, user: null });
    }

    return res.status(400).json({
      error: 'UNKNOWN_AUTH_ACTION',
      message: 'Допустимые действия: request_magic_link, verify_magic_link, logout',
    });
  }

  return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
}
