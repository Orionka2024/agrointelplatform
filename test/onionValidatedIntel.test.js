import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HS_ONION_CODE,
  CONDITIONAL_FORECAST_WARNING,
  isStandardYellowOnion,
  validateIntelObservation,
  countIndependentSources,
  backtestFarmgateHorizons,
  buildVolgogradHorizonsForecast,
  computeKazakhstanParityScenarios,
  computeStorageBreakEvenMatrix,
  evaluateFarmerLotDecision,
  buildVolgogradOnionIntelligence,
} from '../shared/onionValidatedIntel.js';
import { BENCHMARK_STORAGE } from '../shared/marketModel.js';
import {
  buildDefaultMarketSignals,
  parseAgroRuVolgogradHtml,
  computeMarketFactorAnalytics,
} from '../shared/marketSignals.js';
import observationsData from '../data/observations.json' with { type: 'json' };
import officialForecastData from '../data/official-forecast.json' with { type: 'json' };
import { lookupCbrKztRate } from '../shared/cbrKztDailyData.js';
import {
  buildWeeklyDecisionPlan,
  evaluateVolgogradOnionTargetForecast,
  VOLGOGRAD_ONION_TARGET_SPEC,
} from '../shared/weeklyDecisionPlan.js';
import { evaluateStorage } from '../shared/storageEconomics.js';

test('Data quality - stores full schema, never converts missing data to zero, and enforces expiry/independence', () => {
  const res = validateIntelObservation(
    {
      sourceUrl: 'https://agroru.com/doska/luk/rg-243620-p1.htm',
      observationDate: '2026-11-10',
      publicationDate: '2026-11-11',
      location: 'Волгоградская обл., Городищенский р-н',
      currency: 'RUB',
      unit: 'RUB/kg',
      value: 15.5,
      valueExVat: 15.5,
      onionQuality: { grade: '1 сорт', sizeMm: '50+', packaging: 'сетка 25 кг' },
      quantityT: null,
      deliveryTerms: 'EXW',
      paymentTerms: 'предоплата 100%',
      evidenceType: 'executable_bid',
      verified: true,
    },
    { today: '2026-11-13' }
  );

  assert.equal(res.ok, true);
  assert.equal(res.record.quantityT, null, 'missing quantity must stay null, never 0');
  assert.equal(res.record.evidenceType, 'executable_bid');
  assert.equal(res.record.verificationStatus, 'verified');
  assert.equal(res.record.independenceGroup, 'agroru.com');
  assert.equal(res.record.terms.deliveryBasis, 'EXW');
  assert.equal(res.record.terms.paymentTerms, 'предоплата 100%');

  // Zero quantity is rejected back to null with a warning
  const zeroQty = validateIntelObservation(
    {
      sourceUrl: 'https://example.org/deal',
      observationDate: '2026-11-10',
      publicationDate: '2026-11-10',
      location: 'Волгоград',
      value: 16,
      quantityT: 0,
      evidenceType: 'completed_transaction',
      verified: true,
    },
    { today: '2026-11-13' }
  );
  assert.equal(zeroQty.record.quantityT, null);

  // Independence deduplicates same domain
  const indep = countIndependentSources([
    { sourceUrl: 'https://agroru.com/offer/1' },
    { sourceUrl: 'https://www.agroru.com/offer/2' },
    { sourceUrl: 'https://agroserver.ru/offer/9' },
  ]);
  assert.equal(indep, 2);
});

test('Data quality - never presents advertised offers or social leads as completed transactions', () => {
  const mpOffer = validateIntelObservation(
    {
      sourceUrl: 'https://agroru.com/doska/luk/1',
      observationDate: '2026-11-12',
      publicationDate: '2026-11-12',
      location: 'Волгоградская обл.',
      value: 16.0,
      evidenceType: 'completed_transaction',
      channel: 'marketplace',
      isAdvertised: true,
    },
    { today: '2026-11-13' }
  );
  assert.equal(mpOffer.record.evidenceType, 'indicative_offer');
  assert.equal(mpOffer.record.verificationStatus, 'unverified_lead');
  assert.equal(mpOffer.record.requiresVerification, true);

  const tgLead = validateIntelObservation(
    {
      sourceUrl: 'https://t.me/onion_market_vlg/123',
      observationDate: '2026-11-12',
      publicationDate: '2026-11-12',
      location: 'Волгоградская обл.',
      value: 17.0,
      evidenceType: 'completed_transaction',
      channel: 'telegram',
    },
    { today: '2026-11-13' }
  );
  assert.equal(tgLead.record.evidenceType, 'media_claim');
  assert.equal(tgLead.record.verificationStatus, 'unverified_lead');
});

test('Data quality - historical HS 070310 trade statistics are never interpreted as current shipments', () => {
  const stat = validateIntelObservation(
    {
      sourceUrl: 'https://comtradeplus.un.org/',
      observationDate: '2025-12-31',
      publicationDate: '2026-04-15',
      location: 'KZ -> RU',
      evidenceType: 'official_statistic',
      verified: true,
    },
    { today: '2026-11-13' }
  );
  assert.equal(stat.record.hsCode, HS_ONION_CODE);
  assert.equal(stat.record.isHistoricalStatistic, true);
  assert.equal(stat.record.isCurrentShipment, false);
});

test('Forecasting & Decision Support - 7, 30, 90-day forecasts with backtest and evidence-gated recommendations', () => {
  const signals = buildDefaultMarketSignals('2026-11-13', 15.5);

  // Without verified local Volgograd deals -> recommendation is blocked (INSUFFICIENT_EVIDENCE)
  const intelNoDeals = buildVolgogradOnionIntelligence({
    today: '2026-11-13',
    observations: [],
    signals,
    storageParams: BENCHMARK_STORAGE,
    assumptions: {},
  });

  assert.equal(intelNoDeals.volgogradPriceRange.verified.minExVatRubKg, null);
  assert.ok(intelNoDeals.volgogradPriceRange.indicativeOffers.countOffers > 0);
  assert.equal(intelNoDeals.kazakhstanComparison.spreadVsVerifiedVolgogradRubKg, null);
  assert.equal(
    intelNoDeals.tradeAndSupplyIndicators.corridorPolicy.provesRussianPriceRise,
    false
  );
  assert.deepEqual(
    intelNoDeals.forecast7_30_90.horizons.map((h) => h.horizonDays),
    [7, 30, 90]
  );
  for (const h of intelNoDeals.forecast7_30_90.horizons) {
    assert.ok(h.lo80 < h.pointExVatRubKg && h.pointExVatRubKg < h.hi80);
    assert.ok(h.backtest.nHoldout > 20);
    assert.ok(h.backtest.maeRubKg > 0);
  }
  assert.equal(intelNoDeals.farmerDecision.recommendation.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(intelNoDeals.farmerDecision.recommendation.action, null);
  assert.ok(intelNoDeals.farmerDecision.recommendation.missingEvidence.length > 0);

  // With a verified local Volgograd transaction -> actionable recommendation with traceable source
  const intelWithDeal = buildVolgogradOnionIntelligence({
    today: '2026-11-13',
    observations: [
      {
        id: 'deal-vlg-1',
        market: 'volgograd_warehouse',
        kind: 'transaction',
        geography: 'Волгоградская обл., Городище',
        observationDate: '2026-11-12',
        publishedDate: '2026-11-12',
        priceRubKg: 14.5,
        priceExVatRubKg: 14.5,
        deliveryBasis: 'EXW',
        source: 'Договор поставки №42 СПК Городище',
        sourceRef: 'https://example.org/contracts/42',
        verification: { status: 'verified' },
      },
    ],
    signals,
    storageParams: BENCHMARK_STORAGE,
    assumptions: { lotVolumeT: 200 },
  });

  assert.equal(intelWithDeal.volgogradPriceRange.verified.status, 'verified');
  assert.equal(intelWithDeal.volgogradPriceRange.verified.medianExVatRubKg, 14.5);
  assert.notEqual(intelWithDeal.kazakhstanComparison.spreadVsVerifiedVolgogradRubKg, null);
  assert.equal(intelWithDeal.farmerDecision.recommendation.status, 'ACTIONABLE');
  assert.ok(['HOLD_LOT', 'SELL_NOW'].includes(intelWithDeal.farmerDecision.recommendation.action));
});

test('P0.1 - unconfirmed Agroserver records in observations.json are reclassified to indicative_offer with audit history', () => {
  const rec1 = observationsData.find((r) => r.id === '407527e2');
  const rec2 = observationsData.find((r) => r.id === '8d86fc42');
  assert.ok(rec1 && rec2);
  assert.equal(rec1.kind, 'indicative_offer');
  assert.equal(rec1.originalKind, 'transaction');
  assert.equal(rec2.kind, 'indicative_offer');
  assert.equal(rec2.originalKind, 'transaction');
});

test('P0.2 - variety filter excludes red, white, purple, Yalta, sweet, and shallot onions across Russian word forms', () => {
  assert.equal(isStandardYellowOnion('Продам лук репчатый жёлтый 50+ сетка 25 кг'), true);
  assert.equal(isStandardYellowOnion('Лук красного сорта 35 руб/кг'), false);
  assert.equal(isStandardYellowOnion('Продаем белого лука оптом'), false);
  assert.equal(isStandardYellowOnion('Лук фиолетовый салатный'), false);
  assert.equal(isStandardYellowOnion('Лук ялтинский сладкий'), false);
  assert.equal(isStandardYellowOnion('Лук шалот фермерский'), false);

  const html = `
    <div class="tovar-list__card">
      <a class="tovar-list__card-link" href="/doska/1">Продам лук репчатый 50+ оптом</a>
      <div class="tovar-list__card-price">15.5 ₽ / кг</div>
      <div class="tovar-list__card-desc">Сетка 25 кг, без НДС</div>
      <div class="tovar-list__card-meta">Волгоград · 01 ноября 2026</div>
    </div>
    <div class="tovar-list__card">
      <a class="tovar-list__card-link" href="/doska/2">Продам красного лука оптом</a>
      <div class="tovar-list__card-price">28 ₽ / кг</div>
      <div class="tovar-list__card-desc">Отличное качество</div>
      <div class="tovar-list__card-meta">Волгоград · 01 ноября 2026</div>
    </div>
    <div class="tovar-list__card">
      <a class="tovar-list__card-link" href="/doska/3">Лук шалот сухой</a>
      <div class="tovar-list__card-price">32 ₽ / кг</div>
      <div class="tovar-list__card-desc">Сетка</div>
      <div class="tovar-list__card-meta">Волгоград · 01 ноября 2026</div>
    </div>
  `;
  const parsed = parseAgroRuVolgogradHtml(html);
  assert.equal(parsed.acceptedCount, 1);
  assert.equal(parsed.offers[0].priceExVat, 15.5);
});

test('P0.3 & P0.4 - walk-forward selector at lead=5..7 uses common pre-holdout periods and rounds forecasts to 0.1 RUB/kg', () => {
  const lead5to7 = officialForecastData.rows.filter((r) => r.lead >= 5 && r.lead <= 7);
  assert.equal(lead5to7.length, 3);
  for (const row of lead5to7) {
    assert.notEqual(row.validation.selected, 'seasonal', `lead=${row.lead} must not fall back to seasonal`);
    assert.ok(['catboost', 'eq_carry'].includes(row.validation.selected));
    assert.ok(row.validation.comparisons[0].commonPeriodN >= 32);
  }

  const signals = buildDefaultMarketSignals('2026-11-13', 15.5);
  const fc = buildVolgogradHorizonsForecast({
    today: '2026-11-13',
    verifiedVolgogradDeals: [],
    indicativeMedianExVat: 15.5,
    signals,
  });
  assert.equal(fc.isConditionalForecast, true);
  assert.equal(fc.conditionalWarning, CONDITIONAL_FORECAST_WARNING);
  for (const h of fc.horizons) {
    assert.equal(Number(h.pointExVatRubKg.toFixed(1)), h.pointExVatRubKg);
    assert.equal(Number(h.lo80.toFixed(1)), h.lo80);
    assert.equal(Number(h.hi80.toFixed(1)), h.hi80);
  }
});

test('P1.1-P1.7 - CBR 14% key rate, CBR FX 0.186573, KZ 34/55/75 KZT scenarios, storage break-even matrix, and no -2°C dump', () => {
  const signals = buildDefaultMarketSignals('2026-11-13', 15.5);
  assert.equal(signals.fx.keyRate.value, 14.0);
  assert.equal(signals.fx.keyRate.asOf, '2026-11-13');
  assert.equal(signals.fx.kztRub.value, 0.186573);
  assert.equal(signals.fx.kztRub.asOf, '2026-11-13');

  // P1.7: Outdoor -2°C does not trigger automatic frost dump
  const analyticsAtMinus2 = computeMarketFactorAnalytics({
    today: '2026-11-13',
    baseWarehouseExVat: 15.5,
    weatherHubs: { volgograd: { minTemp10d: -2, frostDays: 2 } },
    fx: signals.fx,
  });
  assert.equal(analyticsAtMinus2.impulses.vlgFrostDumpPct, 0);
  assert.equal(analyticsAtMinus2.hubAlerts.volgograd.active, false);

  // P1.2-P1.5: Kazakhstan parity scenarios 34 / 55 / 75 KZT/kg
  const kz = computeKazakhstanParityScenarios({
    kztRub: 0.186573,
    kztAsOf: '2026-11-13',
    truckCostRubPer20t: 116000,
    freightConfirmedByQuotes: false,
    verifiedLocalExVatRubKg: null,
  });
  assert.equal(kz.freightAssumption.status, 'assumption_pending_quotes');
  assert.deepEqual(
    kz.scenarios.map((s) => s.purchaseKztKg),
    [34, 55, 75]
  );
  assert.deepEqual(
    kz.scenarios.map((s) => s.dapExVatRounded01),
    [14.2, 18.3, 22.1]
  );
  assert.deepEqual(
    kz.scenarios.map((s) => s.cashOutflowRounded01),
    [15.7, 20.1, 24.3]
  );
  for (const sc of kz.scenarios) {
    assert.equal(sc.evidenceType, 'scenario_assumption');
    assert.equal(sc.isConfirmedTransaction, false);
    assert.equal(sc.unrecoverableTaxLoadRubKg.osnoRecoverableVat, 0);
    assert.ok(sc.unrecoverableTaxLoadRubKg.usnNonRecoverableVat > 1.0);
  }

  // P1.6: Storage break-even matrix for 30 / 60 / 90 / 120 / 150 days across 8% / 14% / 19%
  const matrix = computeStorageBreakEvenMatrix({ basePriceExVatRubKg: 15.5 });
  assert.deepEqual(
    matrix.rows.map((r) => r.horizonDays),
    [30, 60, 90, 120, 150]
  );
  assert.deepEqual(matrix.financingRatesPctYear, [8, 14, 19]);
  assert.equal(matrix.rows.length, 5);
  assert.equal(matrix.rows[2].horizonDays, 90);
  assert.equal(matrix.rows[2].rates[8].breakEvenRounded01, 19.2);
  assert.equal(matrix.rows[2].rates[14].breakEvenRounded01, 19.5);
  assert.equal(matrix.rows[2].rates[19].breakEvenRounded01, 19.7);
});

test('P2 Audit Section 6.1 - Unified target forecast, screen point-and-interval consistency, tier independence, and 3-calendar-day holding', () => {
  const today = '2026-11-13';
  const nextMonday = '2026-11-16'; // exactly 3 calendar days (Fri -> Mon)
  const fcMonday = evaluateVolgogradOnionTargetForecast({
    issueAsOf: today,
    targetDate: nextMonday,
    baseWarehousePrice: 15.5,
    hasVerifiedWarehouseDeal: false,
  });

  // Verify target spec matches VOLGOGRAD_ONION_TARGET_SPEC
  assert.equal(fcMonday.targetSpec.targetId, 'volgograd_yellow_onion_exw_20t');
  assert.equal(fcMonday.targetSpec.grade, '1 сорт');
  assert.equal(fcMonday.targetSpec.caliberMm, '50+');
  assert.equal(fcMonday.targetSpec.deliveryBasis, 'EXW склад Волгоградской области');
  assert.equal(fcMonday.targetSpec.vat, 'excluded');
  assert.equal(fcMonday.daysToTarget, 3);
  assert.equal(fcMonday.point, 15.2);
  assert.equal(fcMonday.lo80, 6.9);
  assert.equal(fcMonday.hi80, 23.6);

  // Compare with 26-week plan W+1 (starts from startMonday, target 2026-11-16)
  const plan = buildWeeklyDecisionPlan({
    cropId: 'onion',
    today,
    baseWarehousePrice: 15.5,
    hasVerifiedWarehouseDeal: false,
  });
  const w1 = plan.weeks[0];
  assert.equal(w1.targetDate, nextMonday);
  assert.equal(w1.whPrice, fcMonday.point);
  assert.equal(w1.lo80, fcMonday.lo80);
  assert.equal(w1.hi80, fcMonday.hi80);

  // Compare with Intel Panel view nextMonday
  const intel = buildVolgogradOnionIntelligence({
    today,
    observations: [],
    storageParams: BENCHMARK_STORAGE,
  });
  assert.equal(intel.forecast7_30_90.nextMonday.targetDate, nextMonday);
  assert.equal(intel.forecast7_30_90.nextMonday.pointExVatRubKg, fcMonday.point);
  assert.equal(intel.forecast7_30_90.nextMonday.lo80, fcMonday.lo80);
  assert.equal(intel.forecast7_30_90.nextMonday.hi80, fcMonday.hi80);

  // Verify that changing storageTierId NEVER changes market price forecast
  const planVentilated = buildWeeklyDecisionPlan({
    cropId: 'onion',
    today,
    baseWarehousePrice: 15.5,
    storageTierId: 'ventilated',
  });
  const planUnventilated = buildWeeklyDecisionPlan({
    cropId: 'onion',
    today,
    baseWarehousePrice: 15.5,
    storageTierId: 'unventilated',
  });
  const planRefrigerated = buildWeeklyDecisionPlan({
    cropId: 'onion',
    today,
    baseWarehousePrice: 15.5,
    storageTierId: 'refrigerated',
  });
  for (let i = 0; i < 26; i++) {
    assert.equal(planVentilated.weeks[i].whPrice, planUnventilated.weeks[i].whPrice);
    assert.equal(planVentilated.weeks[i].whPrice, planRefrigerated.weeks[i].whPrice);
    assert.equal(planVentilated.weeks[i].lo80, planUnventilated.weeks[i].lo80);
    assert.equal(planVentilated.weeks[i].hi80, planUnventilated.weeks[i].hi80);
  }

  // Verify separate anchors: statistical benchmark is NOT averaged with conditional price
  assert.equal(fcMonday.anchors.statisticalBenchmark.rfProducerPriceExVat, 18.11816);
  assert.equal(fcMonday.anchors.statisticalBenchmark.sfdProducerPriceExVat, 17.53219);
  assert.equal(fcMonday.anchors.effectiveAnchorPrice, 15.5);
});

test('P2 Audit Section 6.2 - Point-in-time CBR KZT/RUB daily series prevents future leakage and handles weekends', () => {
  // Query rate on Saturday 2026-10-24 -> 0.179797
  const r24 = lookupCbrKztRate('2026-10-24');
  assert.equal(r24.value, 0.179797);
  assert.equal(r24.nominal, 100);
  assert.equal(r24.rawValue, 17.9797);
  assert.equal(r24.date, '2026-10-24');

  // Query rate on Sunday 2026-11-01 -> resolves to Saturday 2026-10-31 (0.177552)
  const r01Nov = lookupCbrKztRate('2026-11-01');
  assert.equal(r01Nov.value, 0.177552);
  assert.equal(r01Nov.date, '2026-10-31');

  // Query rate on 2026-11-13 -> 0.186573
  const r13Nov = lookupCbrKztRate('2026-11-13');
  assert.equal(r13Nov.value, 0.186573);
  assert.equal(r13Nov.nominal, 100);
  assert.equal(r13Nov.rawValue, 18.6573);
  assert.equal(r13Nov.date, '2026-11-13');

  // Query on 2026-10-20 respects boundary without future leakage
  const rPast = lookupCbrKztRate('2026-10-20');
  assert.ok(rPast.date <= '2026-10-20');
});

test('P2 Audit Section 6.3 - 3x3 Kazakhstan Logistics & Purchase Matrix matches Table 3 within 0.01 RUB/kg', () => {
  const kz = computeKazakhstanParityScenarios({
    today: '2026-11-13',
    kztRub: 0.186573,
    contractBasis: 'EXW_separate_freight',
  });

  // Check all 9 combinations match Table 3 of the audit report
  // Row 1: 116 000 ₽ / 20 т (5.80 ₽/кг)
  const row116 = kz.matrix3x3.find((r) => r.freightId === 'app_baseline_116k');
  assert.equal(row116.results[34].dapExVatRubKg, 14.23);
  assert.equal(row116.results[55].dapExVatRubKg, 18.25);
  assert.equal(row116.results[75].dapExVatRubKg, 22.07);

  // Row 2: 160 000 ₽ / 20 т (8.00 ₽/кг)
  const row160 = kz.matrix3x3.find((r) => r.freightId === 'intermediate_160k');
  assert.equal(row160.results[34].dapExVatRubKg, 16.48);
  assert.equal(row160.results[55].dapExVatRubKg, 20.50);
  assert.equal(row160.results[75].dapExVatRubKg, 24.33);

  // Row 3: 232 200 ₽ / 20 т (11.61 ₽/кг)
  const row232 = kz.matrix3x3.find((r) => r.freightId === 'aggregator_upper_232k');
  assert.equal(row232.results[34].dapExVatRubKg, 20.18);
  assert.equal(row232.results[55].dapExVatRubKg, 24.21);
  assert.equal(row232.results[75].dapExVatRubKg, 28.03);

  // EAEU customs import VAT base under EXW: assessed on purchase only
  const sc55 = kz.scenarios.find((s) => s.purchaseKztKg === 55);
  assert.equal(sc55.eaeuContractImportVatRubKg, 1.05); // exactly 1.05 per Audit §3
  assert.equal(sc55.spotSecurityDepositRubKg, 1.05); // advance deposit, not double-expensed
});

test('P2 Audit Section 6.5 - Storage economics mass balance and directive gating', () => {
  const pNow = 15.5;
  const pFuture = 20.0;
  const params = {
    months: 3.0,
    shrinkPct: 5.0,
    rotPct: 4.0,
    downgradeSharePct: 10.0,
    downgradeDiscountPct: 20.0,
    energyRubKgMonth: 0.35,
    handlingRubKg: 0.50,
    sortingRubKgSold: 0.60,
    sellNowCostRubKg: 0.20,
    packagingRubKg: 0.80,
    alreadyPackaged: true,
    financingRatePctYear: 14.0,
  };

  const ev = evaluateStorage(pNow, pFuture, params);
  assert.equal(ev.status, 'ok');

  // 1. When Pf == BE, Gain must be exactly 0
  const evAtBE = evaluateStorage(pNow, ev.breakEvenFuturePrice, params);
  assert.ok(Math.abs(evAtBE.gain) < 1e-4);

  // 2. Under zero physical loss and zero costs, BE must equal pNow
  const zeroLossParams = {
    months: 0,
    shrinkPct: 0,
    rotPct: 0,
    downgradeSharePct: 0,
    downgradeDiscountPct: 0,
    energyRubKgMonth: 0,
    handlingRubKg: 0,
    sortingRubKgSold: 0,
    sellNowCostRubKg: 0,
    financingRatePctYear: 0,
  };
  const evZero = evaluateStorage(pNow, pNow, zeroLossParams);
  assert.equal(evZero.breakEvenFuturePrice, pNow);
  assert.equal(evZero.gain, 0);

  // 3. 100% waste eliminates saleable yield -> calculation blocked per validation
  const totalWasteParams = { ...params, rotPct: 100 };
  const evWaste = evaluateStorage(pNow, 50, totalWasteParams);
  assert.equal(evWaste.status, 'incomplete');
  assert.ok(evWaste.invalid.some((m) => m.includes('100 %')));

  // 4. Downgrade without discount causes 0 value loss (gradeFactor = 1.0)
  const noDiscountParams = { ...params, downgradeDiscountPct: 0 };
  const evNoDiscount = evaluateStorage(pNow, pFuture, noDiscountParams);
  assert.equal(evNoDiscount.gradeFactor, 1.0);

  // 5. Already packaged goods are not double-charged for packaging
  assert.equal(ev.components.packaging, 0);

  // 6. Directive recommendation gating:
  // Empty chamber measurement blocks directive recommendation
  const decEmptyChamber = evaluateFarmerLotDecision({
    lot: { id: 'lot-1', verifiedBidRubKg: 15.5 },
    anchor: { hasVerifiedLocalAnchor: true, priceExVatRubKg: 15.5 },
    storageParams: params,
    warehouseConditions: { empty: true },
  });
  assert.equal(decEmptyChamber.recommendation.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(decEmptyChamber.recommendation.action, null);

  // Expired bid blocks directive recommendation
  const decExpiredBid = evaluateFarmerLotDecision({
    lot: { id: 'lot-1', verifiedBidRubKg: 16.0, bidExpiresAt: '2026-11-01' },
    anchor: { hasVerifiedLocalAnchor: false },
    storageParams: params,
    today: '2026-11-13',
  });
  assert.equal(decExpiredBid.recommendation.status, 'INSUFFICIENT_EVIDENCE');

  // Incomplete costs block directive recommendation
  const decIncompleteCosts = evaluateFarmerLotDecision({
    lot: { id: 'lot-1', verifiedBidRubKg: 16.0 },
    anchor: { hasVerifiedLocalAnchor: true, priceExVatRubKg: 16.0 },
    storageParams: { incompleteCosts: true },
  });
  assert.equal(decIncompleteCosts.recommendation.status, 'INSUFFICIENT_EVIDENCE');
});

