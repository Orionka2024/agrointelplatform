import { officialSnapshot, officialDrivers } from '../shared/officialData.js';
import { allowRequest } from '../server/access.js';
import { annualEvidence } from '../shared/planning.js';
/**
 * Vercel Serverless Function & Local Dev Handler: /api/market
 * Returns unified market model computed by shared/marketModel.js.
 */
import { store } from '../server/store.js';
import { computeMarketModel } from '../shared/marketModel.js';
import { todayISO } from '../shared/dates.js';

function macroWithArchiveFallback(cached, today) {
  const usd = officialDrivers.usdRub.filter(r => r.availableDate <= today).at(-1);
  const kr = officialDrivers.keyRate.filter(r => r.availableDate <= today).at(-1);
  return {
    ...(cached || {}),
    usdRub: cached?.usdRub ?? (usd ? { value: usd.value, asOf: usd.availableDate, origin: 'cached', source: 'cbr.ru (месячный архив)' } : null),
    kztRub: cached?.kztRub ?? null,
    keyRate: cached?.keyRate ?? (kr ? { value: kr.value, asOf: kr.availableDate, origin: 'cached', source: 'cbr.ru (месячный архив)' } : null),
  };
}

export default async function handler(req, res) {
  if (!allowRequest(req, res, {costly: false})) return;

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
    const macro = macroWithArchiveFallback(store.getMacroCache(), today);

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

    model.storeDurable = !process.env.VERCEL || process.env.AGRO_PERSISTENT_VOLUME === 'true';
    model.official = officialSnapshot(today);
    model.annualHistory = store.getAnnual();
    model.annualEvidence = annualEvidence(model.annualHistory, {today, region: model.assumptions.planning?.region});
    res.status(200).json(model);
  } catch (err) {
    console.error('[api/market] Error:', err);
    res.status(500).json({ error: 'Failed to compute market model', message: err.message });
  }
}
