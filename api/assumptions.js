/**
 * Vercel Serverless Function & Local Dev Handler: /api/assumptions
 * Manages user assumptions (cost bridge, storage parameters, scenarios, sensitivities, balance, manual prices).
 */
import { store } from '../server/store.js';
import { DEFAULT_ASSUMPTIONS } from '../shared/marketModel.js';
import { issueForecast } from '../shared/forecast.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const current = store.getAssumptions();
    return res.status(200).json(current);
  }

  if (req.method === 'DELETE') {
    // Reset to defaults
    store.saveAssumptions(DEFAULT_ASSUMPTIONS);
    return res.status(200).json({ success: true, assumptions: DEFAULT_ASSUMPTIONS });
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    try {
      const updated = store.updateAssumptions(body);

      // If onion price is manually changed, update latest observation and re-issue forecasts
      const onionWhManual = body.manualPrices?.onion?.value ?? body.manualPrices?.warehouse?.value;
      if (onionWhManual !== undefined && Number.isFinite(Number(onionWhManual)) && Number(onionWhManual) > 0) {
        const obs = store.getObservations();
        const targetWeek = '2026-10-19';
        let found = false;
        for (const o of obs) {
          if (o.market === 'warehouse_volgograd' && (o.observationDate === '2026-10-24' || o.observationDate === targetWeek)) {
            o.priceRubKg = Number(onionWhManual);
            o.priceExVatRubKg = Number(onionWhManual);
            o.source = 'Ручной ввод пользователя';
            found = true;
          }
        }
        if (!found) {
          obs.push({
            id: 'manual-wh-' + Date.now(),
            naturalKey: 'manual-wh',
            kind: 'transaction',
            market: 'warehouse_volgograd',
            geography: 'Волгоградская обл.',
            observationDate: '2026-10-24',
            retrievedDate: '2026-10-24',
            retrievedDateAssumed: false,
            priceRubKg: Number(onionWhManual),
            priceExVatRubKg: Number(onionWhManual),
            originalPrice: Number(onionWhManual),
            originalUnit: 'RUB/kg',
            vat: 'excl',
            vatRate: 0.10,
            deliveryBasis: 'EXW',
            source: 'Ручной ввод пользователя',
            quality: { outlier: false, warnings: [] },
          });
        }
        store.saveObservations(obs);

        try {
          const fcWh = issueForecast({
            observations: obs,
            basis: 'warehouse',
            issueDate: '2026-10-24',
          });
          store.saveForecast(fcWh);
        } catch (e) {
          console.warn('[assumptions] Failed to re-issue warehouse forecast:', e.message);
        }
      }

      return res.status(200).json({ success: true, assumptions: updated });
    } catch (err) {
      console.error('[api/assumptions] Update error:', err);
      return res.status(500).json({ error: 'ASSUMPTIONS_UPDATE_FAILED', message: err.message });
    }
  }

  return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
}
