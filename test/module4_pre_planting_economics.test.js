import test from 'node:test';
import assert from 'node:assert/strict';

test('Module 4: Pre-Planting Economics calculates profit per hectare using quality categories and full costs', async () => {
  const mod = await import('../shared/prePlantingEconomics.js');

  assert.equal(typeof mod.calculateProfitPerHectare, 'function');

  // Input for 1 hectare of onion cultivation
  const hectareInput = {
    grossYieldTHa: 55, // 55 t/ha gross harvest
    marketableSharePct: 85, // 85% marketable -> 46.75 t/ha
    categoryShares: {
      earlyHarvestPct: 15,  // 15% sold early at 15 ₽/kg
      standardPct: 45,      // 45% sold mid-season at 19 ₽/kg
      premiumKeepingPct: 40,// 40% sold in spring at 25 ₽/kg
    },
    categoryPricesRubKg: {
      earlyHarvestPrice: 15.0,
      standardPrice: 19.0,
      premiumKeepingPrice: 25.0,
    },
    costsRubHa: {
      seedsAndCultivation: 320000, // Seeds, fertilizers, diesel, drip tape
      harvestAndHauling: 140000,   // Labor, tractors, field containers
      sortingAndPackaging: 95000,  // Net bags, grading line
      storageOpexAndFinance: 85000,// Ventilation electricity, credit interest
      logisticsLocal: 40000,
    },
  };

  const res = mod.calculateProfitPerHectare(hectareInput);

  assert.equal(res.grossYieldTHa, 55);
  assert.equal(res.marketableYieldTHa, 46.75);
  assert.equal(res.totalCostRubHa, 680000); // 320 + 140 + 95 + 85 + 40 k

  // Weighted average realization price:
  // 0.15 * 15 + 0.45 * 19 + 0.40 * 25 = 2.25 + 8.55 + 10.0 = 20.80 ₽/kg
  assert.ok(Math.abs(res.weightedPriceRubKg - 20.80) < 0.05);

  // Expected revenue: 46.75 t * 1000 * 20.80 ₽/kg = 972,400 ₽
  assert.ok(Math.abs(res.expectedRevenueRubHa - 972400) < 500);

  // Expected profit: 972,400 - 680,000 = 292,400 ₽/га
  assert.ok(Math.abs(res.expectedProfitRubHa - 292400) < 500);
  assert.ok(res.profitMarginPct > 25);

  // Break-even yield at this cost and weighted price:
  // 680,000 / (20.80 * 1000 * 0.85) = ~38.46 t/ha gross yield
  assert.ok(res.breakEvenGrossYieldTHa >= 37.0 && res.breakEvenGrossYieldTHa <= 40.0);
});

test('Module 4: Pre-Planting Scenarios evaluate Cautious, Base, and Optimistic market conditions and protect farm solvency', async () => {
  const { evaluatePrePlantingScenarios } = await import('../shared/prePlantingEconomics.js');

  const farmProfile = {
    totalArableLandHa: 100,
    currentOnionAreaHa: 50,
    storageCapacityTons: 1500,
    fixedOverheadsRub: 1200000,
  };

  const scenarios = evaluatePrePlantingScenarios({
    farmProfile,
    productionCostRubHa: 680000,
  });

  assert.equal(scenarios.length, 3);

  // Scenario 1: Cautious (overproduction risk, prices close to production cost)
  const cautious = scenarios[0];
  assert.equal(cautious.id, 'cautious');
  assert.equal(cautious.marketContext, 'Перепроизводство, избыток предложения, дешёвый импорт');
  assert.ok(cautious.realizationPriceRubKg <= 14.5);
  assert.ok(cautious.recommendedOnionAreaHa <= 30, 'Cautious scenario must recommend contracting area to contract limits');
  assert.ok(cautious.recommendationRu.includes('Не расширять площади') || cautious.recommendationRu.includes('Сократить площадь'));

  // Scenario 2: Base (standard demand and normal yields)
  const base = scenarios[1];
  assert.equal(base.id, 'base');
  assert.ok(base.realizationPriceRubKg >= 16.5 && base.realizationPriceRubKg <= 19.5);
  assert.ok(base.recommendedOnionAreaHa >= 30 && base.recommendedOnionAreaHa <= 50);

  // Scenario 3: Optimistic (regional deficit, high export demand)
  const opt = scenarios[2];
  assert.equal(opt.id, 'optimistic');
  assert.ok(opt.realizationPriceRubKg >= 22.0);
  assert.ok(
    opt.recommendedOnionAreaHa <= 35,
    'Even in optimistic scenario, agronomic rotation must cap onion area at 33% of arable land (33 ha)'
  );
  assert.ok(opt.rotationCapEnforced, 'Must enforce agronomic crop rotation cap (33% of arable land)');
});

test('Module 4: Diversification Model allocates land between onion, carrot, and watermelon to hedge monoculture collapse', async () => {
  const { calculateCropDiversification } = await import('../shared/prePlantingEconomics.js');

  const farm100Ha = {
    totalArableLandHa: 100,
    crops: {
      onion: { targetAreaHa: 30, expectedProfitPerHa: 290000, riskIndex: 0.65 },
      carrot: { targetAreaHa: 30, expectedProfitPerHa: 190000, riskIndex: 0.35 },
      watermelon: { targetAreaHa: 20, expectedProfitPerHa: 240000, riskIndex: 0.45 },
      fallowCoverCrop: { targetAreaHa: 20, expectedProfitPerHa: -15000, riskIndex: 0.05 },
    },
  };

  const portfolio = calculateCropDiversification(farm100Ha);

  assert.equal(portfolio.totalAllocatedHa, 100);
  assert.ok(portfolio.totalExpectedProfitRub > 16000000);
  assert.ok(portfolio.portfolioRiskScore < 0.50, 'Diversified portfolio risk must be lower than pure onion monoculture (0.65)');
  assert.ok(portfolio.onionMonocultureLossProtectionRu.includes('снижает риск банкротства'));
});
