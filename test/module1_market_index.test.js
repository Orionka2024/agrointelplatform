import test from 'node:test';
import assert from 'node:assert/strict';

test('Module 1: 5-Tier Current Market Index calculates separate EXW and DAP regional netbacks without inventing fake deal prices', async () => {
  const marketIndexMod = await import('../shared/marketIndex.js');

  assert.equal(typeof marketIndexMod.computeCurrentMarketIndex, 'function');
  assert.equal(typeof marketIndexMod.SOURCE_TIERS, 'object');
  assert.equal(marketIndexMod.SOURCE_TIERS.CLOSED_DEAL, 1);
  assert.equal(marketIndexMod.SOURCE_TIERS.BUYER_BID, 2);
  assert.equal(marketIndexMod.SOURCE_TIERS.VERIFIED_ASK, 3);
  assert.equal(marketIndexMod.SOURCE_TIERS.MARKETPLACE_ASK, 4);
  assert.equal(marketIndexMod.SOURCE_TIERS.OFFICIAL_INDEX, 5);

  // Case A: Closed verified deals present
  const observationsWithDeals = [
    {
      id: 'deal-1',
      kind: 'transaction',
      market: 'warehouse_volgograd',
      deliveryBasis: 'EXW',
      observationDate: '2026-11-14',
      priceExVatRubKg: 16.5,
      volumeT: 40,
      verification: { status: 'verified', by: 'attested_user' },
    },
    {
      id: 'deal-2',
      kind: 'transaction',
      market: 'warehouse_volgograd',
      deliveryBasis: 'EXW',
      observationDate: '2026-11-12',
      priceExVatRubKg: 16.0,
      volumeT: 25,
      verification: { status: 'verified', by: 'attested_user' },
    },
  ];

  const idxA = marketIndexMod.computeCurrentMarketIndex({
    observations: observationsWithDeals,
    today: '2026-11-16',
  });

  assert.equal(idxA.exwVolgograd.status, 'closed_deals');
  assert.equal(idxA.exwVolgograd.tier, 1);
  assert.equal(idxA.exwVolgograd.uncertainty, false);
  assert.ok(Math.abs(idxA.exwVolgograd.priceRubKg - 16.31) < 0.1, 'Volume-weighted price of 16.5 (40t) and 16.0 (25t)');
  assert.equal(idxA.exwVolgograd.dealsCount, 2);

  // Case B: No closed deals, but buyer bids exist
  const observationsBidsOnly = [
    {
      id: 'bid-1',
      kind: 'buyer_bid',
      market: 'warehouse_volgograd',
      deliveryBasis: 'EXW',
      observationDate: '2026-11-15',
      priceExVatRubKg: 15.0,
      volumeT: 100,
      buyerType: 'Федеральная сеть',
      verification: { status: 'verified' },
    },
    {
      id: 'ask-1',
      kind: 'indicative_offer',
      market: 'warehouse_volgograd',
      deliveryBasis: 'EXW',
      observationDate: '2026-11-15',
      priceExVatRubKg: 17.0,
    },
  ];

  const idxB = marketIndexMod.computeCurrentMarketIndex({
    observations: observationsBidsOnly,
    today: '2026-11-16',
  });

  assert.equal(idxB.exwVolgograd.status, 'bids_available');
  assert.equal(idxB.exwVolgograd.tier, 2);
  assert.equal(idxB.exwVolgograd.uncertainty, true);
  assert.equal(idxB.exwVolgograd.bestBidRubKg, 15.0);
  assert.equal(idxB.exwVolgograd.lowestAskRubKg, 17.0);
  assert.equal(idxB.exwVolgograd.spreadRubKg, 2.0);
  assert.ok(idxB.exwVolgograd.note.includes('Сделок не зафиксировано'));

  // Case C: No deals and no bids (only marketplace listings) -> must show uncertainty, never a fake transaction price
  const observationsAsksOnly = [
    {
      id: 'ask-public-1',
      kind: 'indicative_offer',
      market: 'warehouse_volgograd',
      deliveryBasis: 'EXW',
      observationDate: '2026-11-15',
      priceExVatRubKg: 16.8,
    },
  ];

  const idxC = marketIndexMod.computeCurrentMarketIndex({
    observations: observationsAsksOnly,
    today: '2026-11-16',
  });

  assert.equal(idxC.exwVolgograd.status, 'indicative_offers_only');
  assert.equal(idxC.exwVolgograd.tier, 4);
  assert.equal(idxC.exwVolgograd.uncertainty, true);
  assert.equal(idxC.exwVolgograd.priceRubKg, null, 'Must NOT output single firm price when only marketplace asks exist');

  // Case D: Regional DAP Destinations and Netback calculation
  assert.ok(idxA.destinations.dapMoscow, 'Must calculate DAP Moscow');
  assert.ok(idxA.destinations.dapSpb, 'Must calculate DAP St. Petersburg');
  assert.ok(idxA.destinations.dapKrasnodar, 'Must calculate DAP Krasnodar');
  assert.ok(idxA.destinations.dapUral, 'Must calculate DAP Ural / Ekaterinburg');
  assert.ok(idxA.destinations.exportParity, 'Must calculate Export Parity');

  // Verify logistics netback arithmetic
  const msk = idxA.destinations.dapMoscow;
  assert.ok(msk.freightRubKg >= 4.5 && msk.freightRubKg <= 6.5);
  assert.ok(msk.exwNetbackRubKg < msk.dapPriceRubKg, 'EXW Netback must deduct freight and shrinkage from DAP price');
});

test('Module 1: Supply Pressure Index (I_sp) flags early warning of price drop when active offers outpace sales velocity', async () => {
  const { computeSupplyPressureIndex } = await import('../shared/marketIndex.js');

  // Scenario 1: Balanced healthy market
  const balancedMarket = computeSupplyPressureIndex({
    activeOffersCount: 18,
    availableTonnage: 1200,
    salesVelocityTonsPerWeek: 1100, // ~4.4 weeks of supply
    importTonnageMonth: 4000,
    weeklyListingsGrowthPct: 2.0,
    marketableGradeShare: 0.85,
  });

  assert.equal(balancedMarket.pressureLevel, 'moderate');
  assert.equal(balancedMarket.earlyWarningSignal, false);
  assert.ok(balancedMarket.indexValue >= 0.8 && balancedMarket.indexValue <= 1.3);

  // Scenario 2: Severe supply pressure / glut (lots rising, velocity stalling)
  const glutMarket = computeSupplyPressureIndex({
    activeOffersCount: 48,
    availableTonnage: 5500,
    salesVelocityTonsPerWeek: 450, // > 12 weeks of supply!
    importTonnageMonth: 9500,
    weeklyListingsGrowthPct: 35.0, // surge in offerings
    marketableGradeShare: 0.70,
  });

  assert.equal(glutMarket.pressureLevel, 'critical');
  assert.equal(glutMarket.earlyWarningSignal, true);
  assert.ok(glutMarket.indexValue > 1.8);
  assert.ok(
    glutMarket.interpretationRu.includes('ранний сигнал снижения цены') ||
      glutMarket.interpretationRu.includes('давление предложения критическое')
  );

  // Scenario 3: Tight supply / deficit (velocity outpaces available offers)
  const tightMarket = computeSupplyPressureIndex({
    activeOffersCount: 6,
    availableTonnage: 400,
    salesVelocityTonsPerWeek: 900,
    importTonnageMonth: 1200,
    weeklyListingsGrowthPct: -15.0,
    marketableGradeShare: 0.90,
  });

  assert.equal(tightMarket.pressureLevel, 'low');
  assert.equal(tightMarket.earlyWarningSignal, false);
  assert.ok(tightMarket.indexValue < 0.8);
});

test('Module 1: Quality-Adjusted Deficit Index Q_товарный accounts for progressive shrinkage and grade deterioration across horizons', async () => {
  const { computeQualityAdjustedDeficit } = await import('../shared/marketIndex.js');

  const farmStock1000t = {
    totalHarvestTons: 1000,
    initialQualityGradeShare: 0.85, // 85% is 5+ cm first grade at harvest
    storageType: 'ventilated',
  };

  const trajectory = computeQualityAdjustedDeficit(farmStock1000t, {
    horizonsMonths: [1, 2, 3, 5],
  });

  assert.equal(trajectory.length, 4);

  // Horizon 1 month (October / November)
  const h1 = trajectory[0];
  assert.equal(h1.monthHorizon, 1);
  assert.ok(h1.physicalLossPct >= 2.5 && h1.physicalLossPct <= 3.5);
  assert.ok(h1.marketableTons > 800); // 1000 * (1 - 0.025) * 0.85 = ~828 t

  // Horizon 5 months (March season peak)
  const h5 = trajectory[3];
  assert.equal(h5.monthHorizon, 5);
  assert.ok(h5.physicalLossPct >= 10.0 && h5.physicalLossPct <= 14.0);
  assert.ok(h5.marketableGradeShare < 0.85, 'Marketable grade share declines due to rot and sprout risk');
  assert.ok(h5.marketableTons < h1.marketableTons, 'Marketable tonnage must decay monotonically');
  assert.ok(
    h5.qualityScarcityRatio < 0.70,
    `March quality scarcity ratio (${h5.qualityScarcityRatio}) reveals premium onion scarcity`
  );

  // Verification: divergence between physical warehouse stock and marketable commodity stock
  assert.ok(h5.physicalRemainingTons > h5.marketableTons);
  const gapTons = h5.physicalRemainingTons - h5.marketableTons;
  assert.ok(gapTons > 150, `Substandard/rot discard gap must be significant: got ${gapTons} tons`);
});
