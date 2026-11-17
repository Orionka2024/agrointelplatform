/**
 * Module 3: 3-Tier Quality Sales Strategy & Storage Degradation Allocation
 *
 * Implements domain expertise from Yulia K (Onion Market Intelligence):
 * 1. 3 Quality Tiers:
 *    - Risky onion (рискованный): neck rot, high moisture, soft. Strategy: SELL FIRST IMMEDIATELY (Oct-Nov)
 *      to avoid total rot discard and unlock immediate cash flow.
 *    - Standard grade (среднее качество, 4-5 cm): flexible sales matching network/wholesale bids (Nov-Jan).
 *    - Premium keeping onion (лёжкий, 5+ cm, dry closed neck): hold for winter-spring seasonal peak (Feb-March 20).
 *
 * 2. The 3 Daily Farmer Questions:
 *    - Q1: How much money can I get today? (Cash now)
 *    - Q2: How much will holding cost for 30, 60, or 90 days? (Storage opex + 19% financing + loss of mass)
 *    - Q3: What future price is required to break even and cover quality degradation?
 *
 * 3. Inventory Allocation Optimizer:
 *    Allocates farm harvest across tranches, preventing catastrophic rot dumps and quantifying
 *    the monetary gain over naive "hold everything" strategies.
 */

export const QUALITY_TIERS = {
  RISKY: {
    id: 'risky',
    name: 'Рискованный лук / Некондиция',
    strategyId: 'SELL_FIRST_IMMEDIATELY',
    strategyRu: 'Продавать первым, пока сохраняется товарность (сброс в октябре-ноябре)',
    baseMonthlyLossRatePct: 7.5,
    timingWindow: 'Октябрь – Ноябрь (Срочно)',
  },
  STANDARD: {
    id: 'standard',
    name: 'Среднее качество (4–5 см, опт)',
    strategyId: 'FLEXIBLE_DEMAND_SALES',
    strategyRu: 'Гибкие продажи в зависимости от спроса (ноябрь-январь)',
    baseMonthlyLossRatePct: 2.8,
    timingWindow: 'Ноябрь – Январь',
  },
  PREMIUM_KEEPING: {
    id: 'premium_keeping',
    name: 'Лучший лёжкий лук (5+ см, сети)',
    strategyId: 'HOLD_FOR_WINTER_SPRING_PEAK',
    strategyRu: 'Сохранять возможность продажи зимой и весной (январь-март, захват пика)',
    baseMonthlyLossRatePct: 1.2,
    timingWindow: 'Февраль – 20 Марта',
  },
};

/**
 * Classifies an onion lot into one of 3 quality tiers based on physical inspection.
 *
 * @param {Object} inspection
 * @param {string} inspection.neckStatus - 'dry_closed' | 'thick_or_wet'
 * @param {boolean} inspection.rotSymptomsPresent - true | false
 * @param {number} inspection.sizeMm - bulb diameter in mm
 * @param {string} inspection.firmness - 'hard' | 'medium' | 'soft'
 * @returns {Object}
 */
export function classifyOnionLot({
  neckStatus = 'dry_closed',
  rotSymptomsPresent = false,
  sizeMm = 50,
  firmness = 'medium',
} = {}) {
  const isRisky =
    rotSymptomsPresent === true ||
    neckStatus === 'thick_or_wet' ||
    firmness === 'soft' ||
    sizeMm < 38;

  if (isRisky) {
    const tier = QUALITY_TIERS.RISKY;
    return {
      tierId: tier.id,
      tierName: tier.name,
      recommendedStrategy: tier.strategyId,
      monthlyLossRatePct: tier.baseMonthlyLossRatePct,
      strategyRu: tier.strategyRu,
      timingWindow: tier.timingWindow,
      hazardWarningRu: 'Высокий риск шейковой гнили и потери товарности при длительном хранении.',
    };
  }

  const isPremium = sizeMm >= 50 && firmness === 'hard' && neckStatus === 'dry_closed';
  if (isPremium) {
    const tier = QUALITY_TIERS.PREMIUM_KEEPING;
    return {
      tierId: tier.id,
      tierName: tier.name,
      recommendedStrategy: tier.strategyId,
      monthlyLossRatePct: tier.baseMonthlyLossRatePct,
      strategyRu: tier.strategyRu,
      timingWindow: tier.timingWindow,
      hazardWarningRu: null,
    };
  }

  const tier = QUALITY_TIERS.STANDARD;
  return {
    tierId: tier.id,
    tierName: tier.name,
    recommendedStrategy: tier.strategyId,
    monthlyLossRatePct: tier.baseMonthlyLossRatePct,
    strategyRu: tier.strategyRu,
    timingWindow: tier.timingWindow,
    hazardWarningRu: null,
  };
}

/**
 * Evaluates the 3 core daily questions for a farmer considering holding vs selling today.
 *
 * @param {Object} params
 * @param {string} params.lotTierId - 'risky' | 'standard' | 'premium_keeping'
 * @param {number} params.priceNowRubKg - Current price offered by buyers (e.g. 16.0)
 * @param {number} [params.storageCostRubKgMonth] - Storage opex (e.g. 0.55)
 * @param {number} [params.financingRateAnnualPct] - Loan interest rate (e.g. 19.0%)
 * @param {number} [params.futurePriceRubKg] - Forecasted future price (e.g. 21.0)
 * @param {number} [params.holdingDays] - Holding duration in calendar days (e.g. 30, 60, 90)
 * @returns {Object}
 */
export function evaluateThreeFarmerQuestions({
  lotTierId = 'standard',
  priceNowRubKg = 16.0,
  storageCostRubKgMonth = 0.55,
  financingRateAnnualPct = 19.0,
  futurePriceRubKg = 21.0,
  holdingDays = 90,
} = {}) {
  const pNow = Number(priceNowRubKg);
  const pFuture = Number(futurePriceRubKg);
  const months = Math.max(0.1, Number(holdingDays) / 30.4375);

  // Determine monthly compounding physical + grade deterioration rate
  let monthlyLossPct = 2.8;
  if (lotTierId === 'risky') {
    monthlyLossPct = 7.5;
  } else if (lotTierId === 'premium_keeping') {
    monthlyLossPct = 1.2;
  }

  // Compounded cumulative loss (explicit physical mass loss + marketability loss)
  const cumulativeLossPct = +(100 * (1 - Math.pow(1 - monthlyLossPct / 100, months))).toFixed(1);
  const physicalMassLossPct = +(cumulativeLossPct * 0.6).toFixed(1);
  const marketabilityLossPct = +(cumulativeLossPct - physicalMassLossPct).toFixed(1);
  const saleableYield = Math.max(0.01, +(1 - cumulativeLossPct / 100).toFixed(4));

  // Question 1: Cash today per kg stored
  const question1_cashTodayPerKg = pNow;

  // Question 2: Explicit holding cost breakdown per initial kg stored
  const storageOpex = +(Number(storageCostRubKgMonth) * months).toFixed(2);
  const financingCost = +(pNow * (Number(financingRateAnnualPct) / 100) * (months / 12)).toFixed(2);
  const lostMassCost = +(pNow * (1 - saleableYield)).toFixed(2);
  const question2_holdingCostTotalRubKg = +(storageOpex + financingCost + lostMassCost).toFixed(2);

  // Question 3: Break-even required future price per remaining saleable kg
  // Equation: saleableYield * P_be - (storageOpex + financingCost) = pNow
  const question3_breakEvenFuturePrice = +((pNow + storageOpex + financingCost) / saleableYield).toFixed(2);

  // Realized net outcome per initial kg stored
  const revenueFromRemainingSaleablePerInitialKg = +(saleableYield * pFuture).toFixed(2);
  const netFuturePerKgStored = +(revenueFromRemainingSaleablePerInitialKg - (storageOpex + financingCost)).toFixed(2);
  const netGainVsSellNowRubKg = +(netFuturePerKgStored - pNow).toFixed(2);

  let verdict = 'HOLD_FOR_PREMIUM';
  let recommendationRu = '';

  if (lotTierId === 'risky' || netGainVsSellNowRubKg < 0) {
    verdict = 'SELL_NOW_AVOID_ROT';
    recommendationRu =
      `Продавать прямо сейчас. При удержании на ${holdingDays} дн. потери от брака и усушки ` +
      `составят ${cumulativeLossPct}%, затраты хранения и проценты: +${question2_holdingCostTotalRubKg} ₽/кг. ` +
      `Требуемая цена безубыточности (${question3_breakEvenFuturePrice} ₽/кг) ` +
      (pFuture < question3_breakEvenFuturePrice ? `выше прогноза (${pFuture} ₽/кг). Удержание приносит чистый убыток ${Math.abs(netGainVsSellNowRubKg).toFixed(2)} ₽/кг.` : 'создаёт неоправданный фитосанитарный риск.');
  } else {
    verdict = 'HOLD_FOR_PREMIUM';
    recommendationRu =
      `Держать до планового горизонта. Ожидаемая цена (${pFuture.toFixed(2)} ₽/кг) покрывает ` +
      `точку безубыточности (${question3_breakEvenFuturePrice.toFixed(2)} ₽/кг). Чистая расчётная премия: +${netGainVsSellNowRubKg.toFixed(2)} ₽/кг.`;
  }

  return {
    lotTierId,
    holdingDays,
    holdingMonths: +months.toFixed(1),
    priceBasisNote: 'Цена реализации указана за 1 кг оставшегося товарного лука; итоги приведены на 1 кг исходного заложенного веса.',
    question1_cashTodayPerKg,
    question2_holdingCostTotalRubKg,
    question3_breakEvenFuturePrice,
    costBreakdown: {
      storageOpex,
      financingCost,
      lostMassCost,
      physicalMassLossPct,
      marketabilityLossPct,
      cumulativeLossPct,
      saleableYield: +saleableYield.toFixed(3),
      revenueFromRemainingSaleablePerInitialKg,
    },
    futurePriceRubKg: pFuture,
    netFuturePerKgStored,
    netGainVsSellNowRubKg,
    verdict,
    recommendationRu,
  };
}

/**
 * Optimizes harvest allocation across the 3 quality tranches with exact gross/saleable/sold separation.
 */
export function optimizeQualityAllocation({
  totalTonnage = 1500,
  shares = { riskyPct: 20, standardPct: 40, premiumPct: 40 },
  currentPriceRubKg = 16.0,
  springForecastPriceRubKg = 26.5,
  midSeasonPriceRubKg = null,
} = {}) {
  const total = Number(totalTonnage);
  const rPct = Number(shares.riskyPct ?? 20);
  const sPct = Number(shares.standardPct ?? 40);
  const pPct = Number(shares.premiumPct ?? 40);
  const allocationSumPct = +(rPct + sPct + pPct).toFixed(2);

  const riskyTons = Math.round(total * (rPct / 100));
  const standardTons = Math.round(total * (sPct / 100));
  const premiumTons = total - riskyTons - standardTons;

  const pNow = Number(currentPriceRubKg);
  const pSpring = Number(springForecastPriceRubKg);
  const pMid = midSeasonPriceRubKg != null ? Number(midSeasonPriceRubKg) : +(pNow + (pSpring - pNow) * 0.45).toFixed(2);

  const buildTranche = ({ tierId, name, grossTons, sharePct, timingWindow, lossPct, priceRubKg, storageCostRubKg, purposeRu }) => {
    const lossTons = +(grossTons * (lossPct / 100)).toFixed(1);
    const saleableTons = +(grossTons - lossTons).toFixed(1);
    const soldTons = saleableTons;
    const grossRevenueIfNoLossRub = Math.round(grossTons * 1000 * priceRubKg);
    const expectedRevenueRub = Math.round(soldTons * 1000 * priceRubKg);
    const storageCostRub = Math.round(grossTons * 1000 * storageCostRubKg);
    const netProceedsRub = expectedRevenueRub - storageCostRub;
    return {
      tierId,
      name,
      grossTons,
      allocatedTons: grossTons,
      lossPct,
      lossTons,
      saleableTons,
      soldTons,
      sharePct,
      timingWindow,
      expectedPriceRubKg: priceRubKg,
      grossRevenueIfNoLossRub,
      expectedRevenueRub,
      storageCostRub,
      netProceedsRub,
      purposeRu,
    };
  };

  const t1 = buildTranche({
    tierId: 'risky',
    name: 'Транш 1: Рискованный лук (сброс)',
    grossTons: riskyTons,
    sharePct: rPct,
    timingWindow: 'Октябрь – Ноябрь (Срочно)',
    lossPct: 1.5,
    priceRubKg: pNow,
    storageCostRubKg: 0.0,
    purposeRu: 'Спасение от шейковой гнили, покрытие первоочередных кассовых разрывов и процентов по кредиту.',
  });

  const t2 = buildTranche({
    tierId: 'standard',
    name: 'Транш 2: Средний калибр (4–5 см)',
    grossTons: standardTons,
    sharePct: sPct,
    timingWindow: 'Ноябрь – Январь',
    lossPct: 5.5,
    priceRubKg: pMid,
    storageCostRubKg: 1.2,
    purposeRu: 'Гибкие плановые продажи по подтверждённым контрактам оптовиков и торговых сетей.',
  });

  const t3 = buildTranche({
    tierId: 'premium_keeping',
    name: 'Транш 3: Премиум лёжкий (5+ см)',
    grossTons: premiumTons,
    sharePct: pPct,
    timingWindow: 'Февраль – 20 Марта',
    lossPct: 5.0,
    priceRubKg: pSpring,
    storageCostRubKg: 2.4,
    purposeRu: 'Максимальная сезонная премия на пике истощения запасов до прихода ранней Средней Азии.',
  });

  const tranches = [t1, t2, t3];
  const totalGrossRevenueIfNoLossRub = tranches.reduce((s, t) => s + t.grossRevenueIfNoLossRub, 0);
  const totalRevenueRub = tranches.reduce((s, t) => s + t.expectedRevenueRub, 0);
  const totalStorageCostRub = tranches.reduce((s, t) => s + t.storageCostRub, 0);
  const totalNetProceedsRub = tranches.reduce((s, t) => s + t.netProceedsRub, 0);
  const alternativeMarketableTons = +tranches.reduce((s, t) => s + t.saleableTons, 0).toFixed(1);

  // Baseline comparison: holding everything to spring without quality sorting
  const baseRiskySaleable = +(riskyTons * 0.62).toFixed(1);
  const baseStdSaleable = +(standardTons * 0.88).toFixed(1);
  const basePremSaleable = +(premiumTons * 0.94).toFixed(1);
  const baselineMarketableTons = +(baseRiskySaleable + baseStdSaleable + basePremSaleable).toFixed(1);

  const baselineRevenueRub = Math.round(
    baseRiskySaleable * 1000 * (pSpring * 0.75) +
    baseStdSaleable * 1000 * (pSpring * 0.90) +
    basePremSaleable * 1000 * pSpring
  );
  const baselineStorageCostRub = Math.round(total * 1000 * 2.4);
  const baselineNetProceedsRub = baselineRevenueRub - baselineStorageCostRub;

  const totalGainRub = totalNetProceedsRub - baselineNetProceedsRub;
  const gainRubKg = total > 0 ? +(totalGainRub / (total * 1000)).toFixed(2) : 0;
  const rotSavedTons = +(alternativeMarketableTons - baselineMarketableTons).toFixed(1);

  return {
    strategyType: 'three_tranche_quality_split',
    allocationSumPct,
    allocationValid: Math.abs(allocationSumPct - 100) < 0.01,
    totalAllocatedTons: total,
    alternativeMarketableTons,
    tranches,
    totalGrossRevenueIfNoLossRub,
    totalRevenueRub,
    totalStorageCostRub,
    totalNetProceedsRub,
    isSimulation: true,
    simulationDisclaimerRu:
      'Симуляция модели: расчётный экономический эффект до накопления подтверждённых сделок и бэктеста стратегии хранения.',
    simulationComparison: {
      baselineStrategy: 'Держать весь объём до весны без сортировки по качеству',
      alternativeStrategy: 'Сегментация на 3 транша по качеству (сброс / стандарт / премиум)',
      initialInventoryTons: total,
      baselineMarketableTons,
      alternativeMarketableTons,
      baselineRevenueRub,
      alternativeRevenueRub: totalRevenueRub,
      baselineStorageCostRub,
      alternativeStorageCostRub: totalStorageCostRub,
      baselineNetProceedsRub,
      alternativeNetProceedsRub: totalNetProceedsRub,
      differenceRub: totalGainRub,
    },
    financialAdvantageVsNaiveHoldAll: {
      isSimulation: true,
      totalGainRub,
      gainRubKg,
      rotSavedTons,
      summaryRu:
        `Симуляция (расчётный эффект модели): сегментация по качеству сохраняет ${rotSavedTons} т товарного лука и ` +
        `моделирует ${totalGainRub >= 0 ? '+' : ''}${(totalGainRub / 1000000).toFixed(2)} млн ₽ (${gainRubKg >= 0 ? '+' : ''}${gainRubKg.toFixed(2)} ₽/кг) условной разницы чистой выручки ` +
        `по сравнению со стратегией «держать весь объём до весны» (требует подтверждённых сделок и бэктеста).`,
    },
  };
}
