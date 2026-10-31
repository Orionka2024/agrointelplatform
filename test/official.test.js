import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { officialHistory as history, officialForecast as forecast, officialSnapshot } from '../shared/officialData.js';
import { issueOfficialForecast, monthlyPredict, monthNumber, evaluateMonthly, errorQuantile, OFFICIAL_MODEL_VERSION } from '../shared/officialForecast.js';
import { driverMaps as driverMapsFor } from '../shared/driverModel.js';
import { buildCatBoostContext, catboostTrainAndPredict } from '../shared/catboostModel.js';
import { buildWeeklyDecisionPlan } from '../shared/weeklyDecisionPlan.js';
import { CROP_PROFILES } from '../shared/cropProfiles.js';
import { localBasis, applyBasis, buildUserPriceCsv } from '../shared/localBasis.js';
import { buildWeeklySeries } from '../shared/series.js';
import importHandler from '../api/import.js';
import marketHandler from '../api/market.js';
import signalsHandler from '../api/signals.js';
import { parseAgroRuVolgogradHtml, buildDefaultMarketSignals } from '../shared/marketSignals.js';

test('Official sources retain original files, hashes, source cells and distinct price bases', () => {
  for (const s of history.sources) {
    const data = fs.readFileSync(new URL('../' + s.file, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), s.sha256);
  }
  assert.equal(history.producer.monthly.length, 69);
  assert.equal(history.producer.annual.length, 16);
  assert.equal(history.retail.weekly.length, 246);
  assert.equal(history.producer.monthly[0].period, '2021-01');
  assert.equal(history.producer.monthly.at(-1).period, '2026-09');
  assert.equal(history.producer.monthly.at(-1).value, 18.11816);
  assert.equal(history.producer.monthly.at(-1).cell, 'K1658');
  assert.equal(history.retail.weekly.at(-1).value, 49.19);
  assert.equal(history.retail.weekly.at(-1).cell, 'AQ41');
  assert.equal(history.producer.vat, 'excluded');
  assert.equal(history.retail.vat, 'as_published_consumer_price');
  for (const r of history.producer.monthly) {
    assert.equal(r.value, Math.round((r.rawValue / 1000) * 1e5) / 1e5);
    assert.equal(r.availableDate, '2026-10-23');
  }
  assert.equal(history.acreage.rows.find((r) => r.year === 2024).areaHa, 55000);
  assert.ok(!history.acreage.rows.some((r) => r.year === 2022 && r.yieldTHa));
  const snapOct = officialSnapshot('2026-10-30');
  assert.equal(snapOct.producerSouth?.period, '2026-09');
  assert.equal(snapOct.producerSouth?.value, 17.53219);
  assert.equal(snapOct.producerSouth?.cell, 'K1663');
  assert.equal(officialSnapshot('2026-10-22').producerSouth, null);
  assert.ok(CROP_PROFILES.onion.locationBasis?.tiers?.length >= 6);
});

test('National aggregates do not silently enter warehouse transaction series', () => {
  assert.equal(buildWeeklySeries(history.producer.monthly, { basis: 'warehouse' }).used, 0);
  assert.equal(buildWeeklySeries(history.retail.weekly, { basis: 'warehouse' }).used, 0);
});

test('Saved CatBoost official forecast is reproducible and refuses future source vintages', () => {
  const drivers = JSON.parse(fs.readFileSync(new URL('../data/official-drivers.json', import.meta.url), 'utf8'));
  const result = issueOfficialForecast(history, { issueDate: forecast.issueDate, drivers });
  const { id, ...stored } = forecast;
  assert.ok(id.startsWith('official-'));
  assert.equal(forecast.modelVersion, OFFICIAL_MODEL_VERSION);
  assert.deepEqual(result, stored);
  assert.equal(issueOfficialForecast(history, { issueDate: '2026-10-22' }).status, 'insufficient_data');
  assert.equal(officialSnapshot('2026-10-22').producer, null);
  assert.equal(issueOfficialForecast(history, { issueDate: '2027-03-01' }).status, 'stale_data');
  assert.equal(forecast.rows[0].targetMonth, '2026-11');
  assert.equal(forecast.rows[0].lead, 2);
  assert.equal(forecast.rows.at(-1).targetMonth, '2027-12');
});

test('Monthly predictions ignore future values and require contiguous observations', () => {
  const points = history.producer.monthly;
  const origin = monthNumber('2024-09');
  const changed = points.map((r) => (r.period > '2024-09' ? { ...r, value: r.value * 100 } : r));
  for (const id of ['naive', 'seasonal', 'ratio', 'eq_carry']) {
    assert.equal(monthlyPredict(points, origin, 3, id), monthlyPredict(changed, origin, 3, id));
  }
  const broken = structuredClone(history);
  broken.producer.monthly.splice(8, 1);
  assert.throws(() => issueOfficialForecast(broken, { issueDate: '2026-10-29' }), /continuous/);
});

test('Calibration and tuning are purged for lead time; final data never selects model or intervals', () => {
  const points = history.producer.monthly;
  for (const lead of [1, 2, 6, 13, 15]) {
    const v = evaluateMonthly(points, lead);
    const split = v.split;
    assert.ok(monthNumber(split.tuningEnds) < monthNumber(split.calibrationStarts) - lead);
    assert.ok(monthNumber(split.calibrationEnds) < monthNumber(split.finalStarts) - lead);
    const changed = points.map((r) => (r.period >= split.finalStarts ? { ...r, value: r.value * 10 } : r));
    const other = evaluateMonthly(changed, lead);
    assert.equal(other.selected, v.selected);
    assert.equal(other.q80, v.q80);
    assert.equal(other.q95, v.q95);
    assert.deepEqual(other.comparisons, v.comparisons);
  }
});

test('Insufficient 95% interval samples remain unknown; CatBoost substantially beats naive on medium/long holdout', () => {
  assert.equal(errorQuantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 0.95), null);
  assert.equal(errorQuantile([], 0.8), null);
  assert.equal(forecast.status, 'research_benchmark');
  assert.equal(forecast.evaluationType, 'latest_vintage_hindcast');
  for (const r of forecast.rows) {
    assert.ok(Number.isFinite(r.point) && r.point > 0);
    assert.ok(Number.isFinite(r.catboostPoint) && r.catboostPoint > 0);
    assert.ok(!r.interval95);
    if (r.lead >= 4) {
      assert.ok(r.catboostHoldoutMae < r.validation.naiveFinal.mae * 0.75);
    }
  }
});

const drv = () => JSON.parse(fs.readFileSync(new URL('../data/official-drivers.json', import.meta.url), 'utf8'));

test('CBR & ERA5 driver history (USD, KZT, KeyRate, Weather) is hashed and only available after month end', () => {
  const d = drv();
  for (const s of Object.values(d.sources)) {
    const data = fs.readFileSync(new URL('../' + s.file, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), s.sha256);
  }
  for (const r of [...d.usdRub, ...d.kztRub, ...d.keyRate]) {
    assert.ok(r.value > 0);
    assert.ok(r.availableDate > r.period + '-28');
  }
  for (const r of [...d.weather.volgograd, ...d.weather.zhambyl]) {
    assert.ok(Number.isFinite(r.tempMeanC) && Number.isFinite(r.tempMinC));
    assert.ok(r.availableDate > r.period + '-28');
  }
  assert.equal(d.usdRub.at(-1).period, '2026-09');
  assert.equal(d.kztRub.at(-1).period, '2026-09');
  assert.equal(d.keyRate.at(-1).period, '2026-09');
  assert.equal(officialSnapshot('2026-10-30').drivers.count, 81);
  assert.ok(officialSnapshot('2026-10-30').drivers.kztRub.value > 0);
});

test('CatBoost and ridge driver models never see future prices, FX, rates, retail, or weather', () => {
  const d = drv();
  const points = history.producer.monthly;
  const origin = monthNumber('2025-06');
  const makeCtx = (ds, ret) => ({
    maps: driverMapsFor(ds),
    cb: buildCatBoostContext(ds, ret),
  });

  const baseDrv = monthlyPredict(points, origin, 4, 'drivers', makeCtx(d, history.retail.weekly));
  const baseCb = monthlyPredict(points, origin, 4, 'catboost', makeCtx(d, history.retail.weekly));
  assert.ok(Number.isFinite(baseDrv) && Number.isFinite(baseCb));

  const futurePrices = points.map((r) => (r.period > '2025-06' ? { ...r, value: r.value * 50 } : r));
  assert.equal(monthlyPredict(futurePrices, origin, 4, 'drivers', makeCtx(d, history.retail.weekly)), baseDrv);
  assert.equal(monthlyPredict(futurePrices, origin, 4, 'catboost', makeCtx(d, history.retail.weekly)), baseCb);

  const futureDrivers = {
    usdRub: d.usdRub.map((r) => (r.period > '2025-06' ? { ...r, value: r.value * 7 } : r)),
    kztRub: d.kztRub.map((r) => (r.period > '2025-06' ? { ...r, value: r.value * 7 } : r)),
    keyRate: d.keyRate.map((r) => (r.period > '2025-06' ? { ...r, value: r.value + 30 } : r)),
    weather: {
      volgograd: d.weather.volgograd.map((r) => (r.period > '2025-06' ? { ...r, frostDays12C: 28 } : r)),
      zhambyl: d.weather.zhambyl.map((r) => (r.period > '2025-06' ? { ...r, frostDays12C: 28 } : r)),
    },
  };
  const futureRetail = history.retail.weekly.map((r) => (r.date > '2025-06-30' ? { ...r, value: r.value * 10 } : r));
  assert.equal(monthlyPredict(points, origin, 4, 'drivers', makeCtx(futureDrivers, futureRetail)), baseDrv);
  assert.equal(monthlyPredict(points, origin, 4, 'catboost', makeCtx(futureDrivers, futureRetail)), baseCb);
});

test('Exact interventional TreeSHAP satisfies Shapley efficiency additivity to machine precision', () => {
  const d = drv();
  const cbCtx = buildCatBoostContext(d, history.retail.weekly);
  const priceMap = new Map(history.producer.monthly.map((r) => [monthNumber(r.period), r.value]));
  const lastOrigin = monthNumber('2026-09');
  const res = catboostTrainAndPredict(priceMap, cbCtx, lastOrigin, 6);
  assert.ok(res && res.treesUsed >= 0);
  const sumPhi = res.treeShap.phi.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumPhi - (res.treeShap.pred - res.treeShap.baseValue)) < 1e-11);
});

test('Trained candidates are selected on tuning only; untouched final block never changes selection', () => {
  const d = drv();
  const points = history.producer.monthly;
  for (const lead of [2, 6, 13]) {
    const v = evaluateMonthly(points, lead, d, history.retail.weekly);
    const s = v.split;
    const changed = points.map((r) => (r.period >= s.finalStarts ? { ...r, value: r.value * 10 } : r));
    const o = evaluateMonthly(changed, lead, d, history.retail.weekly);
    assert.equal(o.selected, v.selected);
    assert.equal(o.q80, v.q80);
    assert.deepEqual(o.comparisons, v.comparisons);
    assert.ok(v.comparisons.some((c) => c.id === 'catboost') && v.comparisons.some((c) => c.id === 'eq_carry'));
  }
});

test('Saved forecast reports every trained candidate on the final block and builds 26-week + 5-stage sales plan', () => {
  for (const r of forecast.rows) {
    assert.ok(r.validation.usesDrivers);
    assert.ok(r.validation.finalAll.some((x) => x.id === 'catboost'));
    assert.ok(r.validation.finalAll.some((x) => x.id === 'drivers'));
  }
  const plan = buildWeeklyDecisionPlan({
    cropId: 'onion',
    cropProfile: CROP_PROFILES.onion,
    officialForecast: forecast,
    today: '2026-10-30',
    baseWarehousePrice: 15.5,
    bridge: { truckCostRub: 135000, truckPayloadKg: 20000, packagingRubKg: 1.2, handlingRubKg: 0.5, transitLossPct: 1.5, marginRubKg: 2.0, moscowVatRate: 0.1 },
    storageParams: CROP_PROFILES.onion.storageParams,
  });
  assert.equal(plan.weeks.length, 26);
  assert.equal(plan.stages.length, 5);
  assert.equal(plan.stages.reduce((s, r) => s + r.sharePct, 0), 100);
  assert.ok(plan.peakWeek.whPrice > 19 && plan.peakWeek.whPrice < 28);
});

test('Local basis calibrates level by monthly medians, flags unpublished-month anchor, and rejects large gaps', () => {
  const nat = [{ period: '2026-08', value: 20 }, { period: '2026-09', value: 18 }];
  const pts = [
    { week: '2026-08-03', value: 15 },
    { week: '2026-08-10', value: 16 },
    { week: '2026-08-17', value: 30 },
    { week: '2026-10-19', value: 14.4 },
  ];
  const cal = localBasis(pts, nat);
  assert.equal(cal.n, 2);
  assert.equal(cal.approx, 1);
  assert.equal(cal.strength, 'anchor');
  assert.ok(Math.abs(cal.factor - 0.8) < 1e-9);
  const scaled = applyBasis({ point: 20, interval80: { lo: 15, hi: 25 } }, cal);
  assert.ok(Math.abs(scaled.point - 16) < 1e-9);
  assert.ok(Math.abs(scaled.interval80.lo - 12) < 1e-9);
  assert.ok(Math.abs(scaled.interval80.hi - 20) < 1e-9);
  assert.equal(localBasis([{ week: '2027-01-05', value: 15 }], nat), null);
});

test('Adding a user-attested actual price stores verified observation and calibrates local basis immediately', async () => {
  const csv = buildUserPriceCsv([{ basis: 'warehouse', date: '2026-10-28', price: 15.4, vat: 'excl' }], '2026-10-28');
  let impOut = null;
  let mktOut = null;
  const resImp = { setHeader() {}, status() { return this; }, end() { return this; }, json(d) { impOut = d; return this; } };
  await importHandler({ method: 'POST', url: '/api/import', body: { type: 'prices', csv } }, resImp);
  assert.equal(impOut.success, true);
  const resMkt = { setHeader() {}, status() { return this; }, end() { return this; }, json(d) { mktOut = d; return this; } };
  await marketHandler({ method: 'GET', url: '/api/market?today=2026-10-28' }, resMkt);
  assert.equal(mktOut.prices.warehouse.exVat, 15.4);
  assert.equal(mktOut.storeDurable, true);
  assert.ok(mktOut.evidence.pricesVerified >= 1);
  assert.ok(mktOut.macro.usdRub.value > 0 && mktOut.macro.kztRub.value > 0 && mktOut.macro.keyRate.value > 0);
  const cal = localBasis(mktOut.series.warehouse.points, history.producer.monthly);
  assert.ok(cal && cal.n >= 1);
  assert.ok(Math.abs(cal.factor - 15.4 / 18.11816) < 1e-5);
});

test('AgroRU Volgograd HTML parser accepts clean 2026 5+ cm offers, strips VAT, and filters out archives, 2nd grade, and peeled vacuum', () => {
  const sampleHtml = `
    <div class="tovar-list__card">
      <a class="tovar-list__card-link" href="/doska/1">Лук репчатый Манас 5-8 см оптом</a>
      <div class="tovar-list__card-price">16,5 ₽ / кг</div>
      <div class="tovar-list__card-desc">Отгрузка от 20 тонн, сетка 30 кг, безнал с НДС</div>
      <a class="tovar-list__seller-name">КФХ Городище</a>
      <div class="tovar-list__card-meta">Волгоград · 24 октября 2026</div>
    </div>
    <div class="tovar-list__card">
      <a class="tovar-list__card-link" href="/doska/2">Лук репчатый 1 сорт 6+</a>
      <div class="tovar-list__card-price">15.4 ₽ / кг</div>
      <div class="tovar-list__card-desc">Склад сухой, без НДС, от 20 т</div>
      <a class="tovar-list__seller-name">Агро-Волга</a>
      <div class="tovar-list__card-meta">Волжский · 28 октября 2026</div>
    </div>
    <div class="tovar-list__card">
      <a class="tovar-list__card-link" href="/doska/3">Лук на чистку 2-го сорта калибр 3-4</a>
      <div class="tovar-list__card-price">9 ₽ / кг</div>
      <div class="tovar-list__card-desc">Мелкий лук на переработку</div>
      <div class="tovar-list__card-meta">Городище · 25 октября 2026</div>
    </div>
    <div class="tovar-list__card">
      <a class="tovar-list__card-link" href="/doska/4">Лук очищенный в вакуумной упаковке</a>
      <div class="tovar-list__card-price">58 ₽ / кг</div>
      <div class="tovar-list__card-desc">Для ресторанов HoReCa</div>
      <div class="tovar-list__card-meta">Волгоград · 29 октября 2026</div>
    </div>
    <div class="tovar-list__card">
      <a class="tovar-list__card-link" href="/doska/5">Лук репчатый старое объявление</a>
      <div class="tovar-list__card-price">14 ₽ / кг</div>
      <div class="tovar-list__card-desc">Оптом от 20 т</div>
      <div class="tovar-list__card-meta">Волгоград · 12 октября 2023</div>
    </div>
  `;
  const parsed = parseAgroRuVolgogradHtml(sampleHtml, { referenceYear: 2026, minMonth: 8 });
  assert.equal(parsed.totalScanned, 5);
  assert.equal(parsed.acceptedCount, 2);
  assert.equal(parsed.rejectedCount, 3);
  // 16.5 / 1.1 = 15.00 ex-VAT; (15.00 + 15.40) / 2 = 15.20
  assert.equal(parsed.offers[0].priceExVat, 15.0);
  assert.equal(parsed.medianExVat, 15.2);
});

test('/api/signals returns FX parities (KZ, UZ, EG), 4 weather hubs, and spot radar without polluting verified deals', async () => {
  let sigOut = null;
  const res = { setHeader() {}, status() { return this; }, end() { return this; }, json(d) { sigOut = d; return this; } };
  await signalsHandler({ method: 'GET', url: '/api/signals?offline=1&today=2026-10-31&baseWh=15.5' }, res);
  assert.ok(sigOut && sigOut.fx.usdRub.value > 0 && sigOut.fx.kztRub.value > 0 && sigOut.fx.uzsPer10k.value > 0);
  assert.ok(sigOut.weatherHubs.volgograd && sigOut.weatherHubs.zhambyl && sigOut.weatherHubs.surkhandarya && sigOut.weatherHubs.moscow);
  assert.ok(sigOut.analytics.parity.kzLandedVolgogradExVat > 12);
  assert.ok(sigOut.analytics.parity.uzEarlyLandedSouthExVat > 15);
  assert.ok(sigOut.spotChannels.length >= 4);
});

test('26-week onion trajectory reflects KZ autumn cap, pre-NY retail surge, Jan 1-14 New Year dip, March peak, and April UZ rollover', () => {
  const sig = buildDefaultMarketSignals('2026-10-30', 15.5);
  const plan = buildWeeklyDecisionPlan({
    cropId: 'onion',
    cropProfile: CROP_PROFILES.onion,
    officialForecast: forecast,
    today: '2026-10-30',
    baseWarehousePrice: 15.5,
    bridge: { truckCostRub: 135000, truckPayloadKg: 20000, packagingRubKg: 1.2, handlingRubKg: 0.5, transitLossPct: 1.5, marginRubKg: 2.0, moscowVatRate: 0.1 },
    storageParams: CROP_PROFILES.onion.storageParams,
    scenarioId: 'base',
    liveSignals: sig,
  });

  const novMid = plan.weeks.find((w) => w.targetDate === '2026-11-09');
  const decPreNy = plan.weeks.find((w) => w.targetDate === '2026-12-21');
  const janNyPause = plan.weeks.find((w) => w.targetDate === '2027-01-04');
  const marPeak = plan.weeks.find((w) => w.targetDate === '2027-03-15');
  const aprLate = plan.weeks.find((w) => w.targetDate === '2027-04-26');

  assert.ok(novMid && decPreNy && janNyPause && marPeak && aprLate);
  // 1) Nov stays restrained near starting basis due to KZ transit + shed clearing
  assert.ok(novMid.whPrice <= 15.8, `Expected restrained Nov price, got ${novMid.whPrice}`);
  // 2) Pre-New-Year retail procurement peak exceeds Jan 1-14 holiday lull (non-monotonic dip!)
  assert.ok(decPreNy.whPrice > janNyPause.whPrice, `Expected Dec 21 (${decPreNy.whPrice}) > Jan 04 NY pause (${janNyPause.whPrice})`);
  assert.ok(janNyPause.wowDelta < 0, `Expected negative WoW delta on Jan 04, got ${janNyPause.wowDelta}`);
  // 3) Seasonal cold-storage peak in March inside realistic corridor
  assert.ok(marPeak.whPrice > 19 && marPeak.whPrice < 28, `Expected March peak in (19,28), got ${marPeak.whPrice}`);
  // 4) April bends downward as early Uzbekistan & Egypt crop enters market
  assert.ok(aprLate.whPrice < marPeak.whPrice - 1.5, `Expected April rollover (${aprLate.whPrice}) below March peak (${marPeak.whPrice})`);
  assert.ok(aprLate.wowDelta < 0, `Expected negative WoW delta in late April, got ${aprLate.wowDelta}`);
});

