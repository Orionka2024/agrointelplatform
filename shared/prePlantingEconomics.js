/**
 * Module 4: Pre-Planting Acreage Economics & Next-Crop Planning
 *
 * Implements domain expertise from Yulia K (Onion Market Intelligence):
 * 1. Hectare Profitability Formula with Quality Tiers:
 *    Profit/ha = \sum_i (Y_i * P_i * S_i) - C_total
 *    Where:
 *      Y_i: marketable yield by quality tier (t/ha -> kg/ha);
 *      P_i: expected realization price for that category (RUB/kg);
 *      S_i: share of volume realized in each window;
 *      C_total: complete cost per hectare (seeds, drip, diesel, harvest, sorting, storage, finance).
 *
 * 2. Break-Even Gross Yield Calculation:
 *    Break-even yield = C_total / (WeightedPrice * 1000 * MarketableShare)
 *
 * 3. Pre-Planting Scenarios (Cautious / Base / Optimistic):
 *    Protects farmer solvency and prevents catastrophic overproduction traps.
 *    Enforces agronomic crop rotation cap (onion <= 33% of arable land) even in optimistic scenarios.
 *
 * 4. Crop Diversification & Rotation Risk Shield:
 *    Allocates arable land between onion, carrot, watermelon, and green manure fallow,
 *    substantially reducing bankruptcy risk compared to pure monoculture.
 */

/**
 * Calculates expected profit per hectare based on quality tiers, weighted realization, and complete cost breakdown.
 *
 * @param {Object} input
 * @param {number} input.grossYieldTHa - e.g. 55 t/ha
 * @param {number} input.marketableSharePct - e.g. 85%
 * @param {Object} input.categoryShares - { earlyHarvestPct, standardPct, premiumKeepingPct }
 * @param {Object} input.categoryPricesRubKg - { earlyHarvestPrice, standardPrice, premiumKeepingPrice }
 * @param {Object} input.costsRubHa - { seedsAndCultivation, harvestAndHauling, sortingAndPackaging, storageOpexAndFinance, logisticsLocal }
 * @returns {Object}
 */
export function calculateProfitPerHectare({
  grossYieldTHa = 50,
  marketableSharePct = 85,
  categoryShares = { earlyHarvestPct: 15, standardPct: 45, premiumKeepingPct: 40 },
  categoryPricesRubKg = { earlyHarvestPrice: 15.0, standardPrice: 19.0, premiumKeepingPrice: 25.0 },
  costsRubHa = {},
} = {}) {
  const grossYield = Number(grossYieldTHa);
  const mShare = Number(marketableSharePct) / 100;
  const marketableYieldTHa = +(grossYield * mShare).toFixed(2);

  const ePct = Number(categoryShares.earlyHarvestPct ?? 15) / 100;
  const sPct = Number(categoryShares.standardPct ?? 45) / 100;
  const pPct = Number(categoryShares.premiumKeepingPct ?? 40) / 100;

  const pEarly = Number(categoryPricesRubKg.earlyHarvestPrice ?? 15.0);
  const pStd = Number(categoryPricesRubKg.standardPrice ?? 19.0);
  const pPrem = Number(categoryPricesRubKg.premiumKeepingPrice ?? 25.0);

  // Weighted realization price
  const weightedPriceRubKg = +(ePct * pEarly + sPct * pStd + pPct * pPrem).toFixed(2);

  // Complete cost breakdown
  const cSeeds = Number(costsRubHa.seedsAndCultivation ?? 320000);
  const cHarvest = Number(costsRubHa.harvestAndHauling ?? 140000);
  const cSorting = Number(costsRubHa.sortingAndPackaging ?? 95000);
  const cStorage = Number(costsRubHa.storageOpexAndFinance ?? 85000);
  const cLogistics = Number(costsRubHa.logisticsLocal ?? 40000);
  const totalCostRubHa = cSeeds + cHarvest + cSorting + cStorage + cLogistics;

  // Revenue & Profit per hectare
  const expectedRevenueRubHa = Math.round(marketableYieldTHa * 1000 * weightedPriceRubKg);
  const expectedProfitRubHa = expectedRevenueRubHa - totalCostRubHa;
  const grossMarginRubHa = expectedRevenueRubHa - (cSeeds + cHarvest + cSorting + cLogistics);
  const returnOnSalesPct = expectedRevenueRubHa > 0 ? +((expectedProfitRubHa / expectedRevenueRubHa) * 100).toFixed(1) : 0;
  const returnOnCostsPct = totalCostRubHa > 0 ? +((expectedProfitRubHa / totalCostRubHa) * 100).toFixed(1) : 0;

  // Break-even yields: marketable (32.69 t/ha) and gross (38.46 t/ha at 85% marketability)
  const breakEvenMarketableYieldTHa = +(totalCostRubHa / (weightedPriceRubKg * 1000)).toFixed(2);
  const breakEvenGrossYieldTHa = +(breakEvenMarketableYieldTHa / mShare).toFixed(2);
  const yieldSafetyMarginPct = +(((grossYield / breakEvenGrossYieldTHa) - 1) * 100).toFixed(1);

  return {
    grossYieldTHa: grossYield,
    marketableSharePct: Number(marketableSharePct),
    marketableYieldTHa,
    weightedPriceRubKg,
    totalCostRubHa,
    costBreakdown: {
      seedsAndCultivation: cSeeds,
      harvestAndHauling: cHarvest,
      sortingAndPackaging: cSorting,
      storageOpexAndFinance: cStorage,
      logisticsLocal: cLogistics,
    },
    expectedRevenueRubHa,
    grossMarginRubHa,
    netProfitRubHa: expectedProfitRubHa,
    expectedProfitRubHa,
    profitMarginPct: returnOnSalesPct,
    returnOnSalesPct,
    returnOnCostsPct,
    breakEvenMarketableYieldTHa,
    breakEvenGrossYieldTHa,
    yieldSafetyMarginPct,
  };
}

/**
 * Evaluates 3 pre-planting scenarios with complete area, yield, cost, storage capacity, and farm profit breakdown.
 */
export function evaluatePrePlantingScenarios({
  farmProfile = {},
  productionCostRubHa = 680000,
  storageCostRubHa = 55000,
  financingCostRubHa = 30000,
} = {}) {
  const arableLand = Number(farmProfile.totalArableLandHa || 78);
  const rotationMaxOnionHa = Math.min(33, Math.floor(arableLand * 0.33));
  const storageCapTons = Number(farmProfile.storageCapacityTons || 1500);
  const baseProdCost = Number(productionCostRubHa) - Number(storageCostRubHa) - Number(financingCostRubHa);

  const buildScenario = ({ id, name, marketContext, priceRubKg, grossYieldTHa, marketableSharePct, areaHa, rotationCapEnforced, recommendationRu }) => {
    const plantedAreaHa = Math.min(arableLand, areaHa);
    const mShare = marketableSharePct / 100;
    const marketableYieldTHa = +(grossYieldTHa * mShare).toFixed(2);
    const revenueRubHa = Math.round(marketableYieldTHa * 1000 * priceRubKg);
    const storCost = Number(storageCostRubHa);
    const finCost = Number(financingCostRubHa);
    const totalCostRubHa = baseProdCost + storCost + finCost;
    const expectedProfitPerHa = revenueRubHa - totalCostRubHa;
    const totalFarmProfitRub = Math.round(expectedProfitPerHa * plantedAreaHa);
    const projectedHarvestTons = +(plantedAreaHa * grossYieldTHa).toFixed(1);
    const exceedsStorageCapacity = projectedHarvestTons > storageCapTons;

    return {
      id,
      name,
      marketContext,
      plantedAreaHa,
      recommendedOnionAreaHa: plantedAreaHa,
      expectedGrossYieldTHa: grossYieldTHa,
      expectedYieldTHa: grossYieldTHa,
      marketableSharePct,
      marketableYieldTHa,
      sellingPriceRubKg: priceRubKg,
      realizationPriceRubKg: priceRubKg,
      revenueRubHa,
      productionCostRubHa: baseProdCost,
      storageCostRubHa: storCost,
      financingCostRubHa: finCost,
      totalCostRubHa,
      expectedProfitPerHa,
      totalFarmProfitRub,
      projectedHarvestTons,
      storageCapacityTons: storageCapTons,
      exceedsStorageCapacity,
      rotationCapEnforced,
      recommendationRu,
    };
  };

  return [
    buildScenario({
      id: 'cautious',
      name: 'Осторожный (Пессимистичный)',
      marketContext: 'Перепроизводство, избыток предложения, дешёвый импорт',
      priceRubKg: 13.5,
      grossYieldTHa: 45,
      marketableSharePct: 82,
      areaHa: Math.min(20, rotationMaxOnionHa),
      rotationCapEnforced: false,
      recommendationRu:
        `Не расширять площади! Сократить площадь сева до ${Math.min(20, rotationMaxOnionHa)} га под подтверждённые твёрдые контракты. ` +
        'Высокий риск перепроизводства в РФ и импортного давления.',
    }),
    buildScenario({
      id: 'base',
      name: 'Базовый (Реалистичный)',
      marketContext: 'Нормальный спрос, стабильный баланс спроса и предложения',
      priceRubKg: 18.0,
      grossYieldTHa: 50,
      marketableSharePct: 85,
      areaHa: rotationMaxOnionHa,
      rotationCapEnforced: true,
      recommendationRu:
        `Сохранять плановую площадь в пределах севооборота (${rotationMaxOnionHa} га из ${arableLand} га). ` +
        `Урожай сопоставлен со складской ёмкостью (${storageCapTons} т) с акцентом на лёжкие гибриды.`,
    }),
    buildScenario({
      id: 'optimistic',
      name: 'Оптимистичный (Дефицитный)',
      marketContext: 'Региональный дефицит в ЮФО, экспортный спрос, высокая товарность',
      priceRubKg: 24.5,
      grossYieldTHa: 55,
      marketableSharePct: 88,
      areaHa: rotationMaxOnionHa,
      rotationCapEnforced: true,
      recommendationRu:
        `Ограничить площадь сева ${rotationMaxOnionHa} га (≤33% от ${arableLand} га): агрономический севооборот защищает ` +
        `почву от фузариоза и предотвращает кризис перепроизводства при смене рыночной конъюнктуры.`,
    }),
  ];
}

/**
 * Calculates farm crop portfolio diversification and reconciles total allocated area against available farm land.
 */
export function calculateCropDiversification({
  totalArableLandHa = 78,
  externalLeasedLandHa = 0,
  crops = {},
} = {}) {
  const arable = Number(totalArableLandHa) + Number(externalLeasedLandHa);
  let totalAllocatedHa = 0;
  let totalExpectedProfitRub = 0;
  let weightedRiskSum = 0;

  const allocationRows = [];
  for (const [cropKey, c] of Object.entries(crops)) {
    const area = Number(c.targetAreaHa || 0);
    const profitHa = Number(c.expectedProfitPerHa || 0);
    const risk = Number(c.riskIndex || 0.5);

    const totalCropProfit = area * profitHa;
    totalAllocatedHa += area;
    totalExpectedProfitRub += totalCropProfit;
    weightedRiskSum += arable > 0 ? risk * (area / arable) : 0;

    allocationRows.push({
      cropKey,
      areaHa: area,
      sharePct: arable > 0 ? +((area / arable) * 100).toFixed(1) : 0,
      expectedProfitPerHa: profitHa,
      totalProfitRub: Math.round(totalCropProfit),
      riskIndex: risk,
    });
  }

  const portfolioRiskScore = +weightedRiskSum.toFixed(2);
  const landOverallocated = totalAllocatedHa > arable + 0.01;

  return {
    totalArableLandHa: Number(totalArableLandHa),
    externalLeasedLandHa: Number(externalLeasedLandHa),
    effectiveAvailableLandHa: arable,
    totalAllocatedHa: +totalAllocatedHa.toFixed(1),
    landOverallocated,
    totalExpectedProfitRub: Math.round(totalExpectedProfitRub),
    portfolioRiskScore,
    isSimulation: true,
    diversificationAssumptionsNote:
      'Оценка риска портфеля — взвешенная линейная симуляция по экспертным индексам волатильности культур (не эконометрическая VaR-модель).',
    allocationRows,
    onionMonocultureLossProtectionRu:
      `Диверсификация портфеля (в пределах ${arable} га) даёт расчётный индекс волатильности ${portfolioRiskScore} вместо 0.65 при монокультуре и снижает риск банкротства при обвале цен на одну культуру (симуляция).`,
  };
}
