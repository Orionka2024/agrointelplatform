/**
 * Vercel Serverless Function & Local Dev Handler: /api/forecast
 * Issues new forecasts and provides stored forecast history.
 */
import { store } from '../server/store.js';
import { issueForecast } from '../shared/forecast.js';
import { todayISO } from '../shared/dates.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const list = store.getForecasts();
    return res.status(200).json({ forecasts: list });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'POST is required to issue a forecast' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const basis = body?.basis || 'warehouse';
  if (basis !== 'warehouse' && basis !== 'moscow') {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'basis must be "warehouse" or "moscow"' });
  }

  const issueDate = body?.issueDate || todayISO();
  const publishLagDays = Number(body?.publishLagDays) || 0;
  const now = new Date().toISOString();

  try {
    const observations = store.getObservations();
    const fc = issueForecast({
      observations,
      basis,
      issueDate,
      publishLagDays,
      now,
    });

    store.saveForecast(fc);

    return res.status(200).json({
      success: true,
      forecast: fc,
    });
  } catch (err) {
    console.error('[api/forecast] Issue error:', err);
    return res.status(500).json({ error: 'FORECAST_ISSUE_FAILED', message: err.message });
  }
}
