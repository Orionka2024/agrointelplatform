/**
 * DEMO DATA — illustrative numbers for UI demonstration only.
 *
 * Everything in this file is shown exclusively when the user switches on "Демо-режим", and always labelled ДЕМО.
 * None of it is a market observation or a model output. The values were carried over from the original
 * prototype so existing screens remain demonstrable; they have no verified source.
 */
import { addDays } from './dates.js';
import { moscowToWarehouse } from './bridge.js';

export const DEMO_ISSUE_DATE = '2026-10-24'; // fixed: a demo forecast is never moved forward with today's date

/** Moscow wholesale, incl. VAT, RUB/kg, W+1..W+26 — the old hard-coded array, now demo-only. */
export const DEMO_ONION_MOSCOW_INCL = [31.2, 31.5, 30.9, 32.4, 34.5, 37.2, 40.5, 43.8, 44.2, 42.6, 42.1, 43.5, 45.8, 48.9, 52.4, 55.8, 58.2, 60.9, 62.8, 64.5, 65.8, 66.2, 61.5, 54.8, 48.2, 43.0];

export const DEMO_BRIDGE = {
  truckCostRub: 135000, truckPayloadKg: 20000, packagingRubKg: 1.5, handlingRubKg: 1.0,
  lossPct: 3, marginRubKg: 2.0, vatRate: 0.10,
};

export const DEMO_STORAGE = {
  months: 4, shrinkPct: 6, rotPct: 4, downgradeSharePct: 10, downgradeDiscountPct: 15,
  energyRubKgMonth: 0.35, handlingRubKg: 0.5, sortingRubKgSold: 0.6, financingRatePctYear: 20,
  sellNowCostRubKg: 0.2, acquisitionCostRubKg: 12,
};

export const DEMO_SCENARIO_SENSITIVITIES = {
  importVolume: { pctPerPct: -0.15, scope: 'total', source: 'assumption', note: 'ДЕМО: допущение, не оценка' },
  domesticSupply: { pctPerPct: -0.5, source: 'assumption', note: 'ДЕМО: допущение, не оценка' },
  fx: { pctPerPct: 0.2, source: 'assumption', note: 'ДЕМО: допущение, не оценка' },
};

/** Demo balance inputs, million tonnes. Unverified. */
export const DEMO_BALANCE = {
  onion: { D: 2.2, P: 1.65, I: 0.35, S: 0.25 },
  watermalon: { D: 1.5, P: 1.35, I: 0.1, S: 0.05 },
  melon: { D: 0.8, P: 0.72, I: 0.12, S: 0.04 },
  garlic: { D: 0.52, P: 0.21, I: 0.28, S: 0.09 },
  carrot: { D: 1.8, P: 1.58, I: 0.28, S: 0.18 },
  potato: { D: 8.0, P: 7.4, I: 0.9, S: 1.3 },
  beet: { D: 1.0, P: 0.88, I: 0.19, S: 0.1 },
  cabbage: { D: 2.5, P: 2.75, I: 0.22, S: 0.35 },
};

/** Demo farm norms (yield t/ha, cost thousand RUB/ha) and reference prices (RUB/kg). */
export const DEMO_FARM_NORMS = {
  onion: { yield: 55, cost: 780, price: 15 },
  watermalon: { yield: 40, cost: 320, price: 13 },
  melon: { yield: 20, cost: 420, price: 28 },
  garlic: { yield: 10, cost: 540, price: 95 },
  carrot: { yield: 45, cost: 630, price: 12.5 },
  potato: { yield: 30, cost: 580, price: 11.5 },
  beet: { yield: 42, cost: 430, price: 10 },
  cabbage: { yield: 35, cost: 380, price: 6.5 },
};

export function buildDemoForecast(basis, bridge = DEMO_BRIDGE) {
  const rows = DEMO_ONION_MOSCOW_INCL.map((m, i) => {
    const h = i + 1;
    const date = addDays(DEMO_ISSUE_DATE, h * 7);
    let point;
    if (basis === 'moscow') point = m;
    else {
      const w = moscowToWarehouse(m, bridge);
      point = w.status === 'ok' ? w.warehouseExVat : null;
    }
    return { h, targetDate: date, targetWeekStart: date, point: point == null ? null : +point.toFixed(2), modelId: 'demo', validated: false, interval: null };
  });
  return {
    mode: 'demo', status: 'demo', basis, issueDate: DEMO_ISSUE_DATE, inputCutoff: null, modelVersion: 'demo', horizons: rows,
    validation: null,
    unit: 'RUB/kg',
    vatNote: basis === 'moscow' ? 'с НДС' : 'без НДС',
    provenance: { seriesKey: 'demo', nObservations: 0, sources: ['ДЕМО (иллюстративные числа)'] },
    reasons: ['ДЕМО: иллюстративные числа, не прогноз. Выпущено фиксированной датой.'],
  };
}
