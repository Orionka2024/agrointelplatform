import { timingSafeEqual } from 'node:crypto';
import { store } from '../server/store.js';
import { runRefreshJob, buildInitialRefreshStatus } from '../server/refreshJob.js';
import { todayISO } from '../shared/dates.js';

function isAuthorized(req) {
  // Test bypass in local unit tests
  if (process.env.AGRO_TEST === '1' && req.headers?.['x-bypass-auth'] === '1') {
    return true;
  }

  const cronSecret = process.env.CRON_SECRET || process.env.AGRO_REFRESH_TOKEN || process.env.AGRO_API_TOKEN;
  if (!cronSecret) {
    // If running in production on Vercel without secret configured, reject
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      return false;
    }
    // Allow local dev if no secret configured
    return true;
  }

  const authHeader = req.headers?.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token && token.length === cronSecret.length) {
    try {
      if (timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret))) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  // Vercel Cron header check when CRON_SECRET is configured
  if (req.headers?.['x-vercel-cron'] && token && token === cronSecret) {
    return true;
  }

  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Vercel-Cron');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = new URL(req.url || '/api/refresh', 'http://localhost');
  const today = url.searchParams.get('today') || todayISO();
  const force = url.searchParams.get('force') === '1';

  // Public status query: GET with no cron trigger and no force flag
  const isCronInvocation = Boolean(req.headers?.['x-vercel-cron']) || url.searchParams.get('run') === '1';
  if (req.method === 'GET' && !isCronInvocation && !force) {
    const status = store.getRefreshStatus() || buildInitialRefreshStatus(today);
    return res.status(200).json({
      status: 'ok',
      refreshStatus: status,
      storeDurable: store.isDurable(),
      storageBackend: store.getBackendType(),
      isLocked: store.getRefreshLock()?.status === 'running',
    });
  }

  // Triggering refresh requires authorization
  if (!isAuthorized(req)) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required to run refresh job. Provide Bearer token matching CRON_SECRET.',
    });
  }

  try {
    const trigger = isCronInvocation ? 'vercel_cron' : 'api_request';
    const report = await runRefreshJob({ today, trigger, force });

    if (report.status === 'conflict') {
      return res.status(409).json(report);
    }
    if (report.status === 'failed') {
      return res.status(500).json(report);
    }

    return res.status(200).json(report);
  } catch (err) {
    console.error('[api/refresh] Execution error:', err);
    return res.status(500).json({
      error: 'REFRESH_JOB_FAILED',
      message: err.message,
    });
  }
}
