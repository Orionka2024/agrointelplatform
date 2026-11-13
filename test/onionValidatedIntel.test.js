import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HS_ONION_CODE,
  validateIntelObservation,
  countIndependentSources,
  backtestFarmgateHorizons,
  buildVolgogradHorizonsForecast,
  evaluateFarmerLotDecision,
  buildVolgogradOnionIntelligence,
} from '../shared/onionValidatedIntel.js';
import { BENCHMARK_STORAGE } from '../shared/marketModel.js';
import { buildDefaultMarketSignals } from '../shared/marketSignals.js';

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
