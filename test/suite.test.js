/**
 * Automated test suite for the Agro Intelligence Platform core forecasting & calculations.
 * Run with: node --test test/suite.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseISODate, isISODate, daysBetween, weekStart, addWeeks, weeksBetween } from '../shared/dates.js';
import { parseCSV, parseNumber } from '../shared/csv.js';
import { validatePriceRow, importPriceCSV, flagOutliers, availableDate } from '../shared/observations.js';
import { buildWeeklySeries, describeSeries } from '../shared/series.js';
import { predictNaive, predictSeasonalRatio, HORIZONS, conformalQuantile } from '../shared/models.js';
import { rollingOriginBacktest } from '../shared/backtest.js';
import { issueForecast, forecastAgeDays } from '../shared/forecast.js';
import { validateBridge, warehouseToMoscow, moscowToWarehouse, impliedMargin, freightRubKg } from '../shared/bridge.js';
import { deficitIndex, classifyDeficit, shareOfMarket } from '../shared/balance.js';
import { evaluateScenario, applyScenarioToRows } from '../shared/scenarios.js';
import { evaluateStorage, validateStorageParams } from '../shared/storageEconomics.js';
import { evaluateSeasonalPressure, calendarFeatures, estimateLag } from '../shared/seasonality.js';
import { computeMarketModel } from '../shared/marketModel.js';
import { buildSnapshot, sanitizeSnapshot } from '../shared/snapshot.js';
import { parseSafeMarkdown } from '../shared/safeMarkdown.js';

test('1. Date utilities - ISO format and calendar calculations', () => {
  assert.equal(isISODate('2026-10-24'), true);
  assert.equal(isISODate('2026-02-31'), false); // invalid calendar date
  assert.equal(daysBetween('2026-10-20', '2026-10-24'), 4);
  assert.equal(weekStart('2026-10-24'), '2026-10-19'); // Monday of that week
  assert.equal(addWeeks('2026-10-19', 1), '2026-10-26');
  assert.equal(weeksBetween('2026-10-19', '2026-11-02'), 2);
});

test('2. Observation validation and units conversion', () => {
  // RUB/kg standard
  const r1 = validatePriceRow({
    observation_date: '2026-10-15',
    retrieved_date: '2026-10-16',
    kind: 'transaction',
    market: 'warehouse_volgograd',
    geography: 'Волгоградская обл., Городищенский р-н',
    source: 'AgroServer',
    price: '15.5',
    unit: 'RUB/kg',
    vat: 'excl',
    delivery_basis: 'EXW',
  }, { today: '2026-10-20' });
  assert.equal(r1.ok, true);
  assert.equal(r1.obs.priceRubKg, 15.5);
  assert.equal(r1.obs.priceExVatRubKg, 15.5);

  // RUB/t conversion
  const r2 = validatePriceRow({
    observation_date: '2026-10-15',
    retrieved_date: '2026-10-16',
    kind: 'transaction',
    market: 'warehouse_volgograd',
    geography: 'Волгоградская обл.',
    source: 'AgroServer',
    price: '16000',
    unit: 'RUB/t',
    vat: 'excl',
    delivery_basis: 'EXW',
  }, { today: '2026-10-20' });
  assert.equal(r2.ok, true);
  assert.equal(r2.obs.priceRubKg, 16.0);
  assert.equal(r2.obs.priceExVatRubKg, 16.0);

  // Plausibility corridor catches unscaled tons
  const rCorridor = validatePriceRow({
    observation_date: '2026-10-15',
    retrieved_date: '2026-10-16',
    kind: 'transaction',
    market: 'warehouse_volgograd',
    geography: 'Волгоград',
    source: 'AgroServer',
    price: '16000',
    unit: 'RUB/kg', // mistakenly labelled kg
    vat: 'excl',
    delivery_basis: 'EXW',
  }, { today: '2026-10-20' });
  assert.equal(rCorridor.ok, false);
  assert.match(rCorridor.errors[0], /вне допустимого коридора/);
});

test('3. Point-in-time leakage prevention in series builder', () => {
  const observations = [
    { id: '1', market: 'warehouse_volgograd', kind: 'transaction', observationDate: '2026-10-05', priceExVatRubKg: 15.0, deliveryBasis: 'EXW', spec: {}, source: 's1', verification: {status:'verified',by:'test fixture',at:'2026-10-29',evidence:'synthetic test record'} },
    { id: '2', market: 'warehouse_volgograd', kind: 'transaction', observationDate: '2026-10-12', priceExVatRubKg: 15.5, deliveryBasis: 'EXW', spec: {}, source: 's1', verification: {status:'verified',by:'test fixture',at:'2026-10-29',evidence:'synthetic test record'} },
    { id: '3', market: 'warehouse_volgograd', kind: 'transaction', observationDate: '2026-10-26', priceExVatRubKg: 16.5, deliveryBasis: 'EXW', spec: {}, source: 's1', verification: {status:'verified',by:'test fixture',at:'2026-10-29',evidence:'synthetic test record'} },
  ];

  // As of 2026-10-15, observation on 2026-10-26 must NOT be included!
  const s = buildWeeklySeries(observations, { basis: 'warehouse', asOf: '2026-10-15' });
  assert.equal(s.points.length, 2);
  assert.equal(s.excluded.notAvailableYet, 1);
  assert.equal(s.points[s.points.length - 1].week, '2026-10-12');
});

test('4. Forecast immutability - changing today does not re-date an old forecast', () => {
  const dummyObs = [
    { id: '1', market: 'warehouse_volgograd', kind: 'transaction', observationDate: '2026-10-05', priceExVatRubKg: 15.0, deliveryBasis: 'EXW', spec: {}, source: 's1', verification: {status:'verified',by:'test fixture',at:'2026-10-29',evidence:'synthetic test record'} },
    { id: '2', market: 'warehouse_volgograd', kind: 'transaction', observationDate: '2026-10-12', priceExVatRubKg: 15.2, deliveryBasis: 'EXW', spec: {}, source: 's1', verification: {status:'verified',by:'test fixture',at:'2026-10-29',evidence:'synthetic test record'} },
  ];

  const fc = issueForecast({
    observations: dummyObs,
    basis: 'warehouse',
    issueDate: '2026-10-15',
    now: '2026-10-15T12:00:00Z',
  });

  assert.equal(fc.issueDate, '2026-10-15');
  assert.equal(fc.inputCutoff, '2026-10-12');

  // Next week, the forecast age increases, but issueDate remains 2026-10-15
  const ageDaysLater = forecastAgeDays(fc, '2026-10-29');
  assert.equal(ageDaysLater, 14);
  assert.equal(fc.issueDate, '2026-10-15');
});

test('5. Cost bridge - explicit components and loss compounding', () => {
  const bridge = {
    truckCostRub: 135000,
    truckPayloadKg: 20000,
    packagingRubKg: 1.5,
    handlingRubKg: 1.0,
    lossPct: 5, // 5% loss between warehouse and Moscow
    marginRubKg: 2.0,
    vatRate: 0.10,
  };

  const W = 15.0; // Warehouse price ex-VAT
  const fRubKg = freightRubKg(bridge);
  assert.equal(fRubKg, 6.75);

  const res = warehouseToMoscow(W, bridge);
  assert.equal(res.status, 'ok');

  // Loss allowance must equal W / (1 - 0.05) - W = 15 / 0.95 - 15 ≈ 0.7895
  const expectedLossAllowance = (W / 0.95) - W;
  assert.ok(Math.abs(res.components.lossAllowance - expectedLossAllowance) < 0.001);

  // Moscow Ex-VAT = W / 0.95 + 1.5 + 1.0 + 6.75 + 2.0 = 15.7895 + 11.25 = 27.0395
  assert.ok(Math.abs(res.moscowExVat - 27.0395) < 0.01);
  // Moscow Incl VAT = 27.0395 * 1.10 ≈ 29.74
  assert.ok(Math.abs(res.moscowInclVat - 29.743) < 0.01);

  // Test reverse bridge: moscowToWarehouse
  const back = moscowToWarehouse(res.moscowInclVat, bridge);
  assert.equal(back.status, 'ok');
  assert.ok(Math.abs(back.warehouseExVat - W) < 0.001);

  // Missing parameter returns incomplete
  const inc = warehouseToMoscow(W, { ...bridge, truckCostRub: null });
  assert.equal(inc.status, 'incomplete');
  assert.deepEqual(inc.missing, ['truckCostRub']);
});

test('6. Supply-demand balance equation and opening stocks', () => {
  // Correct formula: availableSupply = P * weatherFactor + I * importFactor + S
  // index = D / availableSupply
  const D = 2.2, P = 1.65, I = 0.35, S = 0.25;
  const r = deficitIndex({ D, P, I, S });
  assert.equal(r.status, 'ok');
  assert.equal(r.supply, 2.25); // 1.65 + 0.35 + 0.25
  assert.ok(Math.abs(r.index - (2.2 / 2.25)) < 0.0001); // 0.9777...

  // Zero / negative supply guard
  const zeroSupply = deficitIndex({ D: 2.2, P: 0, I: 0, S: 0 });
  assert.equal(zeroSupply.status, 'invalid');
  assert.match(zeroSupply.reason, /Доступное предложение/);
});

test('7. Storage economics - per kg stored vs sold and break-even price', () => {
  const params = {
    months: 4,
    shrinkPct: 6,
    rotPct: 4,
    downgradeSharePct: 10,
    downgradeDiscountPct: 15,
    energyRubKgMonth: 0.35,
    handlingRubKg: 0.5,
    sortingRubKgSold: 0.6,
    financingRatePctYear: 20,
    sellNowCostRubKg: 0.2,
    acquisitionCostRubKg: 12.0,
  };

  const pNow = 15.0;
  const pFuture = 24.0;

  const res = evaluateStorage(pNow, pFuture, params);
  assert.equal(res.status, 'ok');

  // Compounded saleable yield: (1 - 0.06) * (1 - 0.04) = 0.94 * 0.96 = 0.9024
  assert.ok(Math.abs(res.saleableYield - 0.9024) < 0.0001);

  // Financing cost: 15 * 0.20 * (4 / 12) = 1.00 RUB/kg stored
  assert.ok(Math.abs(res.components.financing - 1.0) < 0.001);

  // Break-even future price must satisfy netLater == netNow
  const bePrice = res.breakEvenFuturePrice;
  assert.ok(bePrice > pNow);
  const testBe = evaluateStorage(pNow, bePrice, params);
  assert.ok(Math.abs(testBe.gain) < 0.001);
});

test('8. Scenarios - separate import and FX with unquantified handling', () => {
  const scenario = {
    id: 'test',
    label: 'Шок импорта',
    importScope: 'total',
    importDeltaPct: -20,
    domesticSupplyDeltaPct: 0,
    fxDeltaPct: 10,
  };

  // With no sensitivities, effects are honest unquantified
  const emptyRes = evaluateScenario(scenario);
  assert.equal(emptyRes.complete, false);
  assert.ok(emptyRes.unquantified.length > 0);

  // With explicit sensitivities
  const sens = {
    importVolume: { pctPerPct: -0.2, scope: 'total', source: 'assumption' },
    domesticSupply: { pctPerPct: -0.5, source: 'assumption' },
    fx: { pctPerPct: 0.15, source: 'assumption' },
  };

  const quantifiedRes = evaluateScenario(scenario, sens);
  assert.equal(quantifiedRes.complete, true);
  // import: -20 * -0.2 = +4.0%
  // fx: +10 * 0.15 = +1.5%
  // total: +5.5%
  assert.ok(Math.abs(quantifiedRes.totalPct - 5.5) < 0.001);
});

test('9. Seasonal pressure - requires dated observation, no fixed week rows', () => {
  // Empty observations: no seasonal pressure claimed
  const empty = evaluateSeasonalPressure({ asOf: '2026-10-24', indicators: [] });
  assert.equal(empty.status, 'no_observations');

  // Dated harvest progress in September 2026
  const indicators = [
    {
      id: 'i1',
      indicator: 'harvest_progress_pct',
      value: 65,
      unit: '%',
      region: 'Волгоградская обл.',
      observationDate: '2026-09-20',
      source: 'Комитет с/х Волгоградской обл.',
    }
  ];

  // Evaluated on 2026-09-25: active!
  const sep = evaluateSeasonalPressure({ asOf: '2026-09-25', indicators });
  assert.equal(sep.status, 'ok');
  assert.equal(sep.pressures[0].active, true);
  assert.equal(sep.pressures[0].stale, false);
  assert.match(sep.pressures[0].reason, /Уборка идёт: 65%/);

  // Evaluated on 2026-11-25: observation is 66 days old -> STALE!
  const nov = evaluateSeasonalPressure({ asOf: '2026-11-25', indicators });
  assert.equal(nov.status, 'ok');
  assert.equal(nov.pressures[0].active, false);
  assert.equal(nov.pressures[0].stale, true);
});

test('10. Safe Markdown parser prevents script injection', () => {
  const unsafe = 'Рекомендация: **Покупать** <script>alert("hack")</script> <img src="x" onerror="steal()"/>';
  const tokens = parseSafeMarkdown(unsafe);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, 'p');

  // Text tokens preserve literal characters, not parsed as HTML
  const hasScript = tokens[0].children.some(c => c.v.includes('<script>'));
  assert.ok(hasScript);
});

test('11. AI Advisor snapshot sanitizer bounds depth and size', () => {
  const deep = { a: { b: { c: { d: { e: { f: { g: { h: 'too deep' } } } } } } } };
  const sanitized = sanitizeSnapshot(deep);
  assert.equal(sanitized.a.b.c.d.e.f.g.h, null); // truncated at depth limit
});
