import { allowRequest } from '../server/access.js';
import { buildReconciledPlanExport } from '../shared/reportExport.js';

export default async function handler(req, res) {
  if (!allowRequest(req, res, { costly: false, write: false })) return;

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'METHOD_NOT_ALLOWED',
      message: 'Только POST-запросы поддерживаются для /api/export',
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const plan = body?.plan;
  if (!plan || typeof plan !== 'object') {
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'Тело запроса должно содержать объект plan',
    });
  }

  const format = body?.format || 'json';
  const result = buildReconciledPlanExport(plan, { format });

  if (!result.valid) {
    return res.status(result.statusCode || 422).json({
      error: result.error,
      message: result.message,
      violations: result.violations,
      checks: result.checks,
    });
  }

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="volgograd-onion-plan.csv"');
    return res.status(200).send(result.csv);
  }

  return res.status(200).json({
    success: true,
    format: result.format,
    document: result.document,
    csv: result.csv,
  });
}
