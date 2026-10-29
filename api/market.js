/**
 * Vercel Serverless Function & Local Dev Handler: /api/market
 * Returns unified market model computed by shared/marketModel.js.
 */
import { store } from '../server/store.js';
import { computeMarketModel } from '../shared/marketModel.js';
import { todayISO } from '../shared/dates.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, 'http://localhost');
  const demoParam = url.searchParams.get('demo');
  const demo = demoParam === 'true' || demoParam === '1';
  const todayParam = url.searchParams.get('today');
  const today = todayParam || todayISO();

  try {
    const observations = store.getObservations();
    const indicators = store.getIndicators();
    const forecasts = store.getForecasts();
    const assumptions = store.getAssumptions();
    const macroCache = store.getMacroCache();

    // Format macroCache for computeMarketModel
    const macro = {
      usdRub: macroCache?.usdRub ?? null,
      kztRub: macroCache?.kztRub ?? null,
      keyRate: macroCache?.keyRate ?? null,
    };

    const model = computeMarketModel({
      observations,
      indicators,
      forecasts,
      assumptions,
      macro,
      demo,
      today,
      storeAvailable: true,
    });

    res.status(200).json(model);
  } catch (err) {
    console.error('[api/market] Error:', err);
    res.status(500).json({ error: 'Failed to compute market model', message: err.message });
  }
}
