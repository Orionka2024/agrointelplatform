import { monitorMarket } from './monitoring.js';
import { MODEL_VERSION } from './models.js';
import { isVerified } from './observations.js';
/**
 * Single source of truth for every screen (dashboard, forecast, deficit, storage, profitability, AI adviser).
 * Pure function: all inputs are explicit (including `today`), so the same inputs give the same numbers everywhere.
 *
 * Modes are exclusive:
 *   demo=true   → only labelled demo numbers (no observations are mixed in)
 *   demo=false  → observed data + user assumptions + cached/live macro; anything missing is "unavailable"
 */
import { buildWeeklySeries, describeSeries } from './series.js';
import { classifyFreshness, FRESHNESS_DAYS } from './provenance.js';
import { warehouseToMoscow, validateBridge, estimateDifferenceFromMatched, impliedMargin } from './bridge.js';
import { deficitIndex } from './balance.js';
import { DEFAULT_SCENARIOS, EMPTY_SENSITIVITIES, SCENARIO_IDS, evaluateScenario, applyScenarioToRows } from './scenarios.js';
import { evaluateStorage, validateStorageParams, storageAtHorizon } from './storageEconomics.js';
import { evaluateSeasonalPressure } from './seasonality.js';
import { buildDemoForecast, DEMO_ISSUE_DATE, DEMO_BRIDGE, DEMO_STORAGE, DEMO_BALANCE, DEMO_SCENARIO_SENSITIVITIES, DEMO_ONION_MOSCOW_INCL, DEMO_SEASONAL_PRESSURES } from './demo.js';
import { DEFAULT_VAT_RATE, TARGET_SPECS } from './spec.js';
import { moscowToWarehouse } from './bridge.js';

export const BENCHMARK_BRIDGE = {
  truckCostRub: 135000,
  truckPayloadKg: 20000,
  packagingRubKg: 1.5,
  handlingRubKg: 1.0,
  lossPct: 1.5,
  marginRubKg: 1.5,
  vatRate: DEFAULT_VAT_RATE,
};

export const BENCHMARK_STORAGE = {
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
  acquisitionCostRubKg: 12,
};

export const DEFAULT_ASSUMPTIONS = {
  version: 2,
  bridge: BENCHMARK_BRIDGE,
  manualPrices: { warehouse: null, moscow: null },
  storage: BENCHMARK_STORAGE,
  scenarios: DEFAULT_SCENARIOS,
  sensitivities: EMPTY_SENSITIVITIES,
  balance: {},
};

function mergeAssumptions(a) {
  return {
    ...DEFAULT_ASSUMPTIONS, ...(a || {}),
    bridge: { ...BENCHMARK_BRIDGE, ...(a?.bridge || {}) },
    storage: { ...BENCHMARK_STORAGE, ...(a?.storage || {}) },
    scenarios: { ...DEFAULT_SCENARIOS, ...(a?.scenarios || {}) },
    sensitivities: { ...EMPTY_SENSITIVITIES, ...(a?.sensitivities || {}) },
    manualPrices: { warehouse: null, moscow: null, ...(a?.manualPrices || {}) },
  };
}

function latestStoredForecast(forecasts, basis) {
  return forecasts.filter(f => f.basis === basis && f.modelVersion === MODEL_VERSION && f.schema === 2).sort((a, b) => (a.issueDate === b.issueDate ? (a.issuedAt || '') < (b.issuedAt || '') ? 1 : -1 : a.issueDate < b.issueDate ? 1 : -1))[0] || null;
}

function priceView({ basis, observations, assumptions, today, demo, vatRate }) {
  const target = TARGET_SPECS[basis];
  if (demo) {
    const m = DEMO_ONION_MOSCOW_INCL[0];
    const exVat = basis === 'moscow' ? m / (1 + DEMO_BRIDGE.vatRate) : moscowToWarehouse(m, DEMO_BRIDGE).warehouseExVat;
    return { basis, label: target.label, unit: 'RUB/kg', exVat, inclVat: exVat * (1 + DEMO_BRIDGE.vatRate), provenance: { status: 'demo', origin: 'demo', asOf: DEMO_ISSUE_DATE, source: 'ДЕМО' }, kind: 'demo' };
  }
  const series = buildWeeklySeries(observations, { basis, kind: 'transaction', asOf: today });
  const last = series.points[series.points.length - 1];
  if (last) {
    const f = classifyFreshness({ origin: 'observed', value: last.value, asOf: last.week, today, staleDays: FRESHNESS_DAYS.priceObservation });
    return { basis, label: target.label, unit: 'RUB/kg', exVat: last.value, inclVat: last.value * (1 + vatRate), provenance: { ...f, source: last.sources.join(', '), nInWeek: last.n }, kind: 'transaction' };
  }
  const mp = assumptions.manualPrices[basis];
  if (mp && Number.isFinite(Number(mp.value)) && Number(mp.value) > 0) {
    const v = Number(mp.value);
    const exVat = mp.vat === 'incl' ? v / (1 + vatRate) : v;
    const f = classifyFreshness({ origin: 'manual', value: exVat, asOf: mp.asOf || null, today, staleDays: FRESHNESS_DAYS.manualPrice });
    return { basis, label: target.label, unit: 'RUB/kg', exVat, inclVat: exVat * (1 + vatRate), provenance: { ...f, source: mp.note || 'ввод пользователя' }, kind: 'manual' };
  }
  return { basis, label: target.label, unit: 'RUB/kg', exVat: null, inclVat: null, provenance: { status: 'unavailable', origin: null, asOf: null, ageDays: null, source: null }, kind: null };
}

export function computeBalanceFor(cropId, { assumptions, demo, today, toggles = {} }) {
  const src = demo ? { ...DEMO_BALANCE[cropId], asOf: DEMO_ISSUE_DATE, source: 'ДЕМО' } : assumptions.balance?.[cropId];
  if (!src) return { cropId, inputs: null, result: { status: 'unavailable', reason: 'Баланс не задан (нет источника данных). Введите значения вручную.', index: null }, provenance: { status: 'unavailable' } };
  const weatherFactor = toggles.drought ? 0.8 : 1;
  const importFactor = toggles.importRestriction ? 0.85 : 1;
  const result = deficitIndex({ D: Number(src.D), P: Number(src.P), I: Number(src.I), S: Number(src.S), weatherFactor, importFactor });
  const prov = demo ? { status: 'demo', origin: 'demo', asOf: DEMO_ISSUE_DATE, source: 'ДЕМО' }
    : { ...classifyFreshness({ origin: 'manual', value: 1, asOf: src.asOf || null, today, staleDays: 400 }), source: src.source || 'ввод пользователя' };
  return { cropId, inputs: { D: src.D, P: src.P, I: src.I, S: src.S }, toggles: { drought: !!toggles.drought, importRestriction: !!toggles.importRestriction }, result, provenance: prov };
}

export function computeMarketModel({ observations = [], indicators = [], forecasts = [], assumptions: rawAssumptions, macro = null, demo = false, today, storeAvailable = true }) {
  if (!today) throw new Error('computeMarketModel requires explicit `today`');
  const assumptions = mergeAssumptions(rawAssumptions?.version === 2 ? rawAssumptions : null);
  const evidence = { pricesTotal: observations.length, pricesVerified: observations.filter(isVerified).length,
    indicatorsTotal: indicators.length, indicatorsVerified: indicators.filter(isVerified).length,
    legacyForecasts: forecasts.filter(f => f.modelVersion !== MODEL_VERSION).length };
  indicators = indicators.filter(isVerified);
  const bridge = demo ? DEMO_BRIDGE : assumptions.bridge;
  const vatRate = Number.isFinite(Number(bridge.vatRate)) ? Number(bridge.vatRate) : DEFAULT_VAT_RATE;
  const sens = demo ? DEMO_SCENARIO_SENSITIVITIES : assumptions.sensitivities;
  const storageParams = demo ? DEMO_STORAGE : assumptions.storage;

  const prices = {
    warehouse: priceView({ basis: 'warehouse', observations, assumptions, today, demo, vatRate }),
    moscow: priceView({ basis: 'moscow', observations, assumptions, today, demo, vatRate }),
  };

  // series diagnostics (observed only)
  const series = {};
  for (const basis of ['warehouse', 'moscow']) {
    const s = demo ? { points: [], excluded: {}, used: 0 } : buildWeeklySeries(observations, { basis, kind: 'transaction', asOf: today });
    const kinds = {};
    observations.filter(o => o.market === TARGET_SPECS[basis].market).forEach(o => { kinds[o.kind] = (kinds[o.kind] || 0) + 1; });
    series[basis] = { ...describeSeries(s.points), excluded: s.excluded, nUsed: s.used, kindsStored: kinds, points: s.points };
  }

  // bridge
  const bridgeValidation = validateBridge(bridge);
  const whEx = prices.warehouse.exVat;
  const bridgeResult = bridgeValidation.ok && whEx ? warehouseToMoscow(whEx, bridge) : { status: bridgeValidation.ok ? 'no_warehouse_price' : 'incomplete', missing: bridgeValidation.missing };
  const empirical = demo ? { status: 'insufficient', nPairs: 0 } : estimateDifferenceFromMatched(series.warehouse.points, series.moscow.points);
  const observedBoth = prices.warehouse.exVat && prices.moscow.exVat && prices.warehouse.kind === 'transaction' && prices.moscow.kind === 'transaction';
  const margin = observedBoth && bridgeValidation.ok ? impliedMargin(prices.warehouse.exVat, prices.moscow.exVat, bridge) : null;
  const spread = {
    observedGrossDifferenceExVat: observedBoth ? prices.moscow.exVat - prices.warehouse.exVat : null,
    bridgeGrossDifferenceExVat: bridgeResult.status === 'ok' ? bridgeResult.grossDifferenceExVat : null,
    impliedMargin: margin?.status === 'ok' ? margin.impliedMargin : null,
    note: 'Валовая разница = Москва без НДС − склад без НДС. Достижимая маржа — остаток после издержек моста.',
  };

  // forecasts
  const fc = {};
  for (const basis of ['warehouse', 'moscow']) {
    fc[basis] = demo ? buildDemoForecast(basis) : latestStoredForecast(forecasts, basis);
  }
  const forecastInfo = {};
  for (const basis of ['warehouse', 'moscow']) {
    const f = fc[basis];
    forecastInfo[basis] = f ? { ...f, ageDays: f.mode === 'demo' ? null : Math.round((Date.parse(today) - Date.parse(f.issueDate)) / 86400000) } : null;
  }

  // scenarios (labelled; no probabilities)
  const scenarioResults = SCENARIO_IDS.map(id => evaluateScenario(assumptions.scenarios[id], sens));
  const scenarioRows = {};
  for (const basis of ['warehouse', 'moscow']) {
    const f = forecastInfo[basis];
    scenarioRows[basis] = f?.horizons?.length ? Object.fromEntries(scenarioResults.map(r => [r.id, applyScenarioToRows(f.horizons.filter(x => x.point != null), r, null)])) : null;
  }

  // balance (onion)
  const balance = computeBalanceFor('onion', { assumptions, demo, today });

  // storage economics per horizon
  const storageValidation = validateStorageParams({ ...storageParams, months: storageParams.months ?? 0 });
  const storage = { params: storageParams, validation: storageValidation, rows: [], note: null };
  const wf = forecastInfo.warehouse;
  if (!storageValidation.ok) storage.note = 'Не заданы параметры хранения: ' + storageValidation.missing.join(', ');
  else if (!prices.warehouse.exVat) storage.note = 'Нет цены склада «продать сейчас».';
  else if (!wf?.horizons?.length) storage.note = 'Нет прогноза цены склада.';
  else {
    storage.rows = wf.horizons.filter(r => r.point != null && r.targetDate > today).map(r => {
      const e = evaluateStorage(prices.warehouse.exVat, r.point, storageAtHorizon(storageParams, Math.max(0, (Date.parse(r.targetDate)-Date.parse(today))/86400000/30.4375)));
      return { h: r.h, targetDate: r.targetDate, futurePrice: r.point, interval: r.interval, result: e };
    });
  }

  // seasonal pressure
  const seasonal = demo
    ? { status: 'demo', asOf: DEMO_ISSUE_DATE, pressures: DEMO_SEASONAL_PRESSURES, note: 'ДЕМО: иллюстративные сезонные фазы на 24.10.2026.' }
    : evaluateSeasonalPressure({ asOf: today, indicators });

  // macro
  const macroView = {};
  for (const k of ['usdRub', 'kztRub', 'keyRate']) {
    const f = macro?.[k];
    macroView[k] = f && f.value != null
      ? { value: f.value, unit: k === 'keyRate' ? '%' : 'RUB', provenance: { ...classifyFreshness({ origin: f.origin || 'cached', value: f.value, asOf: f.asOf || null, today, staleDays: FRESHNESS_DAYS.macroDaily }), source: f.source || 'cbr.ru', fetchedAt: f.fetchedAt || null } }
      : { value: null, unit: k === 'keyRate' ? '%' : 'RUB', provenance: { status: 'unavailable' } };
  }

  const dataStatus = [
    { id: 'warehouse', label: 'Цена склада (сделки)', status: prices.warehouse.provenance.status, asOf: prices.warehouse.provenance.asOf, n: series.warehouse.n },
    { id: 'moscow', label: 'Опт Москва (сделки)', status: prices.moscow.provenance.status, asOf: prices.moscow.provenance.asOf, n: series.moscow.n },
    { id: 'fx', label: 'USD/RUB', status: macroView.usdRub.provenance.status, asOf: macroView.usdRub.provenance.asOf },
    { id: 'kzt', label: 'KZT/RUB', status: macroView.kztRub.provenance.status, asOf: macroView.kztRub.provenance.asOf },
    { id: 'key', label: 'Ключевая ставка', status: macroView.keyRate.provenance.status, asOf: macroView.keyRate.provenance.asOf },
    { id: 'balance', label: 'Баланс спрос/предложение', status: balance.provenance.status, asOf: balance.provenance.asOf || null },
    { id: 'indicators', label: 'Сезонные индикаторы', status: demo ? 'demo' : indicators.length ? 'observed' : 'unavailable', asOf: indicators.length ? indicators.map(i => i.observationDate).sort().pop() : null, n: indicators.length },
  ];

  const verifiedObservations = demo
    ? []
    : observations
        .filter(isVerified)
        .slice()
        .sort((a, b) => (a.observationDate < b.observationDate ? 1 : a.observationDate > b.observationDate ? -1 : 0))
        .slice(0, 20)
        .map((o) => ({
          id: o.id,
          observationDate: o.observationDate,
          market: o.market,
          kind: o.kind,
          geography: o.geography,
          deliveryBasis: o.deliveryBasis,
          priceRubKg: o.priceRubKg,
          priceExVatRubKg: o.priceExVatRubKg,
          vat: o.vat,
          source: o.source,
          verifiedAt: o.verification?.verifiedAt || null,
        }));

  return {
    mode: demo ? 'demo' : 'observed', today, storeAvailable, evidence,
    verifiedObservations,
    monitoring: monitorMarket(observations, indicators, today),
    assumptions, bridge, vatRate, sensitivities: sens,
    prices, series, bridgeValidation, bridgeResult, empirical, spread,
    forecasts: forecastInfo, scenarios: { results: scenarioResults, rows: scenarioRows },
    balance, storage, seasonal, macro: macroView, dataStatus,
  };
}
