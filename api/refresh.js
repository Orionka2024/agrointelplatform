import { timingSafeEqual } from 'node:crypto';
import { store } from '../server/store.js';
import { runRefreshJob, buildInitialRefreshStatus } from '../server/refreshJob.js';
import { todayISO } from '../shared/dates.js';

function isAuthorized(req) {
  if (process.env.AGRO_ALLOW_ANON_WRITES === 'true') {
    return true;
  }
  if (process.env.AGRO_TEST === '1' && req.headers?.['x-bypass-auth'] === '1') {
    return true;
  }

  const cronSecret = (process.env.CRON_SECRET || process.env.AGRO_REFRESH_TOKEN || '').trim();
  if (!cronSecret) {
    return false;
  }

  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return false;
  }

  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(cronSecret, 'utf8');
  if (a.length === b.length) {
    try {
      if (timingSafeEqual(a, b)) {
        return true;
      }
    } catch {
      return false;
    }
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
    await store.ensureInitialized({ forWrite: false });
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
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    const customFetchers =
      body?.customFetchers && typeof body.customFetchers === 'object' ? body.customFetchers : null;
    const trigger = isCronInvocation ? 'vercel_cron' : 'api_request';
    const report = await runRefreshJob({ today, trigger, force, customFetchers });

    if (report.status === 'conflict') {
      return res.status(409).json(report);
    }
    if (report.status === 'failed' || (Array.isArray(report.errors) && report.errors.length > 0)) {
      return res.status(500).json(report);
    }

    return res.status(200).json(report);
  } catch (err) {
    console.error('[api/refresh] Execution error:', err);
    return res.status(500).json({
      status: 'failed',
      error: 'REFRESH_JOB_FAILED',
      failedStep: err.step || 'execution',
      message: err.message,
    });
  }
}
