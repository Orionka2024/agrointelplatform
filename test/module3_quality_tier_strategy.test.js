import test from 'node:test';
import assert from 'node:assert/strict';

test('Module 3: Quality Tier Segmentation classifies lots into 3 distinct strategies with custom decay rates', async () => {
  const mod = await import('../shared/qualityTierSalesStrategy.js');

  assert.equal(typeof mod.QUALITY_TIERS, 'object');
  assert.ok(mod.QUALITY_TIERS.RISKY);
  assert.ok(mod.QUALITY_TIERS.STANDARD);
  assert.ok(mod.QUALITY_TIERS.PREMIUM_KEEPING);

  // Risky lot: signs of rot, thick neck, high moisture
  const riskyLot = mod.classifyOnionLot({
    neckStatus: 'thick_or_wet',
    rotSymptomsPresent: true,
    sizeMm: 45,
    firmness: 'soft',
  });
  assert.equal(riskyLot.tierId, 'risky');
  assert.equal(riskyLot.recommendedStrategy, 'SELL_FIRST_IMMEDIATELY');
  assert.ok(riskyLot.monthlyLossRatePct >= 5.0, 'Risky lot must degrade rapidly');
  assert.ok(riskyLot.strategyRu.includes('Продавать первым'));

  // Standard lot: 40-50mm, dry, no rot
  const standardLot = mod.classifyOnionLot({
    neckStatus: 'dry_closed',
    rotSymptomsPresent: false,
    sizeMm: 45,
    firmness: 'medium',
  });
  assert.equal(standardLot.tierId, 'standard');
  assert.equal(standardLot.recommendedStrategy, 'FLEXIBLE_DEMAND_SALES');
  assert.ok(standardLot.monthlyLossRatePct >= 2.0 && standardLot.monthlyLossRatePct <= 3.5);

  // Premium lot: 50+ mm, dry closed neck, dense skin
  const premiumLot = mod.classifyOnionLot({
    neckStatus: 'dry_closed',
    rotSymptomsPresent: false,
    sizeMm: 60,
    firmness: 'hard',
  });
  assert.equal(premiumLot.tierId, 'premium_keeping');
  assert.equal(premiumLot.recommendedStrategy, 'HOLD_FOR_WINTER_SPRING_PEAK');
  assert.ok(premiumLot.monthlyLossRatePct <= 1.8, 'Premium keeping lot preserves quality with minimal decay');
  assert.ok(premiumLot.strategyRu.includes('Сохранять возможность продажи зимой и весной'));
});

test('Module 3: The 3 Farmer Questions calculator evaluates cash now, holding costs at 30/60/90 days, and break-even required price', async () => {
  const { evaluateThreeFarmerQuestions } = await import('../shared/qualityTierSalesStrategy.js');

  const pNow = 16.0; // 16 RUB/kg offered today
  const storageOpexMonth = 0.55; // 0.55 RUB/kg/month
  const financingRateYear = 0.19; // 19% loan interest
  const futureForecast90d = 21.0; // 21 RUB/kg expected in 90 days

  // Case A: Risky onion held for 90 days
  const risky90d = evaluateThreeFarmerQuestions({
    lotTierId: 'risky',
    priceNowRubKg: pNow,
    storageCostRubKgMonth: storageOpexMonth,
    financingRateAnnualPct: 19.0,
    futurePriceRubKg: futureForecast90d,
    holdingDays: 90,
  });

  // Question 1: Cash today
  assert.equal(risky90d.question1_cashTodayPerKg, 16.0);

  // Question 2: Explicit holding cost (storage + interest + rot loss)
  assert.ok(risky90d.question2_holdingCostTotalRubKg > 3.5, 'Holding cost includes severe rot loss for risky onion');

  // Question 3: Break-even required price
  assert.ok(
    risky90d.question3_breakEvenFuturePrice > futureForecast90d,
    `Break-even price (${risky90d.question3_breakEvenFuturePrice}) exceeds forecast (${futureForecast90d})`
  );
  assert.equal(risky90d.verdict, 'SELL_NOW_AVOID_ROT');
  assert.ok(risky90d.netGainVsSellNowRubKg < 0, 'Holding risky onion brings negative net gain');

  // Case B: Premium keeping onion held for 90 days
  const premium90d = evaluateThreeFarmerQuestions({
    lotTierId: 'premium_keeping',
    priceNowRubKg: pNow,
    storageCostRubKgMonth: storageOpexMonth,
    financingRateAnnualPct: 19.0,
    futurePriceRubKg: futureForecast90d,
    holdingDays: 90,
  });

  assert.ok(
    premium90d.question3_breakEvenFuturePrice < futureForecast90d,
    `Break-even price (${premium90d.question3_breakEvenFuturePrice}) is below forecast (${futureForecast90d})`
  );
  assert.equal(premium90d.verdict, 'HOLD_FOR_PREMIUM');
  assert.ok(premium90d.netGainVsSellNowRubKg > 1.0, 'Premium keeping onion generates positive storage margin');
});

test('Module 3: Quality-Based Inventory Optimizer allocates 1500t farm stock and prevents catastrophic rot dumps', async () => {
  const { optimizeQualityAllocation } = await import('../shared/qualityTierSalesStrategy.js');

  const farmStock1500t = {
    totalTonnage: 1500,
    shares: {
      riskyPct: 20,       // 300 t risky
      standardPct: 40,    // 600 t standard
      premiumPct: 40,     // 600 t premium
    },
    currentPriceRubKg: 16.0,
    springForecastPriceRubKg: 26.5,
  };

  const schedule = optimizeQualityAllocation(farmStock1500t);

  assert.equal(schedule.totalAllocatedTons, 1500);
  assert.equal(schedule.tranches.length, 3);

  // Tranche 1 (Immediate / Oct-Nov): must contain 100% of risky onion
  const t1 = schedule.tranches[0];
  assert.equal(t1.tierId, 'risky');
  assert.equal(t1.allocatedTons, 300);
  assert.equal(t1.timingWindow, 'Октябрь – Ноябрь (Срочно)');
  assert.ok(t1.purposeRu.includes('Спасение от шейковой гнили'));

  // Tranche 2 (Flexible / Nov-Jan): standard grade
  const t2 = schedule.tranches[1];
  assert.equal(t2.tierId, 'standard');
  assert.equal(t2.allocatedTons, 600);
  assert.equal(t2.timingWindow, 'Ноябрь – Январь');

  // Tranche 3 (Peak / Feb-March): premium grade
  const t3 = schedule.tranches[2];
  assert.equal(t3.tierId, 'premium_keeping');
  assert.equal(t3.allocatedTons, 600);
  assert.equal(t3.timingWindow, 'Февраль – 20 Марта');
  assert.ok(t3.purposeRu.includes('Максимальная сезонная премия'));

  // Comparative financial advantage
  assert.ok(schedule.financialAdvantageVsNaiveHoldAll.totalGainRub > 500000);
  assert.ok(schedule.financialAdvantageVsNaiveHoldAll.gainRubKg > 0.35);
  assert.ok(schedule.financialAdvantageVsNaiveHoldAll.rotSavedTons >= 40);
});
