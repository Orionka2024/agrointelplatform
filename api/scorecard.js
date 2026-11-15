/**
 * Vercel Serverless Function & Local Dev Handler: /api/scorecard
 * Computes realized error and baseline benchmarks for historical issued forecasts.
 */
import { allowRequest } from '../server/access.js';
import { store } from '../server/store.js';
import { officialHistory, officialForecast } from '../shared/officialData.js';
import { buildForecastScorecard } from '../shared/scorecard.js';

export default async function handler(req, res) {
  if (!allowRequest(req, res, { costly: false })) return;

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'GET is required' });
  }

  try {
    await store.ensureInitialized({ forWrite: false });
  } catch (err) {
    return res.status(err.statusCode || 503).json({
      error: err.code || 'DURABLE_STORE_UNAVAILABLE',
      message: err.message,
    });
  }

  const userId = req.user?.id || null;

  try {
    const userForecasts = store.getForecasts({ userId }) || [];
    const storedOfficial = store.getOfficialForecast() || officialForecast;

    // Combine user-issued forecasts and official forecast
    const allForecasts = [...userForecasts];
    if (storedOfficial && !allForecasts.some((f) => f.id === storedOfficial.id || f.issueDate === storedOfficial.issueDate)) {
      allForecasts.unshift({
        id: `official_${storedOfficial.issueDate}`,
        ...storedOfficial,
      });
    }

    // Actuals: combine verified user observations and official Rosstat monthly
    const userObs = store.getObservations({ userId }) || [];
    const officialMonthly = officialHistory?.producer?.monthly || [];
    const actuals = [...officialMonthly, ...userObs];

    const scorecard = buildForecastScorecard(allForecasts, actuals);

    return res.status(200).json({
      success: true,
      scorecard,
    });
  } catch (err) {
    console.error('[api/scorecard] Scorecard generation error:', err);
    return res.status(500).json({
      error: 'SCORECARD_FAILED',
      message: err.message,
    });
  }
}
