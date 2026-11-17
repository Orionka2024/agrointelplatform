/**
 * Module 1: Market Intelligence & Price Formation Engine
 *
 * Implements domain requirements from Yulia K (Onion Market Intelligence):
 * 1. 5-Tier Source Hierarchy for Current Market Index:
 *    - Tier 1: Closed verified transactions (volume-weighted)
 *    - Tier 2: Confirmed buyer bids (e.g., federal retail, wholesale buyers)
 *    - Tier 3: Verified physical asks (inspected lot availability)
 *    - Tier 4: Public marketplace listings (unverified asks)
 *    - Tier 5: Official indices (Rosstat, EMISS regional series)
 *    NEVER mixes categories or invents fake transaction prices when only asks exist.
 *
 * 2. Regional Delivery Netbacks:
 *    - EXW Volgograd (farm gate)
 *    - DAP Moscow (freight ~5.50 ₽/kg, transit shrinkage ~0.5%)
 *    - DAP St. Petersburg (freight ~8.20 ₽/kg, transit shrinkage ~0.8%)
 *    - DAP Krasnodar / South (freight ~3.80 ₽/kg, transit shrinkage ~0.4%)
 *    - DAP Ural / Ekaterinburg (freight ~9.40 ₽/kg, transit shrinkage ~0.9%)
 *    - Export Parity (Central Asia / Transcaucasia customs & logistics bridge)
 *
 * 3. Supply Pressure Index (I_sp):
 *    Monitors competing active offers, weeks of inventory supply, and listing velocity.
 *    Flags early warning signal when listings surge while sales velocity slows.
 *
 * 4. Quality-Adjusted Deficit Index (Q_товарный):
 *    Q_товарный(t) = Q_остаток(t) * (1 - потери(t)) * доля_товарного_качества(t)
 *    Tracks real marketable supply degradation across storage horizons.
 */

export const SOURCE_TIERS = {
  CLOSED_DEAL: 1,      // Закрытые подтверждённые сделки
  BUYER_BID: 2,        // Подтверждённые заявки покупателей
  VERIFIED_ASK: 3,     // Оферты с подтверждённым наличием товара
  MARKETPLACE_ASK: 4,  // Объявления продавцов (неподтверждённые)
  OFFICIAL_INDEX: 5,   // Региональные и национальные индексы
};

export const REGIONAL_DESTINATIONS = {
  DAP_MOSCOW: {
    key: 'dapMoscow',
    label: 'DAP Москва',
    freightRubKg: 5.50,
    transitLossPct: 0.5,
    wholesalePremiumRubKg: 6.20,
    typicalDistanceKm: 1050,
  },
  DAP_SPB: {
    key: 'dapSpb',
    label: 'DAP Санкт-Петербург',
    freightRubKg: 8.20,
    transitLossPct: 0.8,
    wholesalePremiumRubKg: 9.10,
    typicalDistanceKm: 1720,
  },
  DAP_KRASNODAR: {
    key: 'dapKrasnodar',
    label: 'DAP Краснодар / ЮФО',
    freightRubKg: 3.80,
    transitLossPct: 0.4,
    wholesalePremiumRubKg: 4.40,
    typicalDistanceKm: 760,
  },
  DAP_URAL: {
    key: 'dapUral',
    label: 'DAP Екатеринбург / Урал',
    freightRubKg: 9.40,
    transitLossPct: 0.9,
    wholesalePremiumRubKg: 10.60,
    typicalDistanceKm: 1810,
  },
  EXPORT_PARITY: {
    key: 'exportParity',
    label: 'Экспортный паритет (ЕАЭС / Закавказье)',
    freightRubKg: 4.20,
    transitLossPct: 0.6,
    wholesalePremiumRubKg: 4.80,
    typicalDistanceKm: 850,
  },
};

/**
 * Computes 5-tier current market index and regional DAP netbacks.
 *
 * @param {Object} options
 * @param {Array} options.observations - Market observations and transactions
 * @param {string} [options.today] - ISO date string
 * @param {number} [options.benchmarkBasePrice] - Fallback regional reference price if no deals
 * @returns {Object}
 */
export function computeCurrentMarketIndex({
  observations = [],
  today = new Date().toISOString().slice(0, 10),
  benchmarkBasePrice = 16.0,
} = {}) {
  // Separate observations by type and source tier
  const closedDeals = [];
  const buyerBids = [];
  const verifiedAsks = [];
  const marketplaceAsks = [];
  const officialIndices = [];

  for (const obs of observations) {
    if (!obs) continue;
    const isVerified = obs.verification?.status === 'verified';
    const isExwVolgograd = !obs.market || obs.market === 'warehouse_volgograd' || obs.deliveryBasis === 'EXW';

    if (obs.kind === 'transaction' && isVerified && isExwVolgograd) {
      closedDeals.push(obs);
    } else if (obs.kind === 'buyer_bid' && isExwVolgograd) {
      buyerBids.push(obs);
    } else if (obs.kind === 'indicative_offer' && isVerified && isExwVolgograd) {
      verifiedAsks.push(obs);
    } else if (obs.kind === 'indicative_offer' && isExwVolgograd) {
      marketplaceAsks.push(obs);
    } else if (obs.kind === 'official_index') {
      officialIndices.push(obs);
    }
  }

  let exwVolgograd = null;
  let referencePrice = benchmarkBasePrice;

  if (closedDeals.length > 0) {
    // Tier 1: Real closed deals exist -> Volume-weighted price
    let totalWeight = 0;
    let sumWeightedPrice = 0;
    for (const d of closedDeals) {
      const vol = Number(d.volumeT || 20);
      const pr = Number(d.priceExVatRubKg);
      if (Number.isFinite(pr) && pr > 0) {
        sumWeightedPrice += pr * vol;
        totalWeight += vol;
      }
    }

    const vwap = totalWeight > 0 ? +(sumWeightedPrice / totalWeight).toFixed(2) : Number(closedDeals[0].priceExVatRubKg);
    referencePrice = vwap;

    exwVolgograd = {
      tier: SOURCE_TIERS.CLOSED_DEAL,
      sourceTierName: 'Закрытые подтверждённые сделки',
      status: 'closed_deals',
      uncertainty: false,
      priceRubKg: vwap,
      dealsCount: closedDeals.length,
      totalVolumeT: totalWeight,
      note: `Средневзвешенная цена по ${closedDeals.length} подтверждённым сделкам (${totalWeight} т).`,
      timestamp: today,
    };
  } else if (buyerBids.length > 0) {
    // Tier 2: Buyer bids available
    const bidPrices = buyerBids.map(b => Number(b.priceExVatRubKg)).filter(p => Number.isFinite(p) && p > 0);
    const bestBid = bidPrices.length > 0 ? Math.max(...bidPrices) : null;

    const askPool = [...verifiedAsks, ...marketplaceAsks];
    const askPrices = askPool.map(a => Number(a.priceExVatRubKg)).filter(p => Number.isFinite(p) && p > 0);
    const lowestAsk = askPrices.length > 0 ? Math.min(...askPrices) : null;

    const spread = bestBid !== null && lowestAsk !== null ? +(lowestAsk - bestBid).toFixed(2) : null;
    if (bestBid !== null) referencePrice = bestBid;

    exwVolgograd = {
      tier: SOURCE_TIERS.BUYER_BID,
      sourceTierName: 'Подтверждённые заявки покупателей',
      status: 'bids_available',
      uncertainty: true,
      priceRubKg: null, // Do not publish fake fixed transaction price
      bestBidRubKg: bestBid,
      lowestAskRubKg: lowestAsk,
      spreadRubKg: spread,
      bidsCount: buyerBids.length,
      note: 'Сделок не зафиксировано. Доступны подтверждённые заявки покупателей и оферты рынка.',
      timestamp: today,
    };
  } else if (verifiedAsks.length > 0) {
    // Tier 3: Verified physical inventory asks
    const askPrices = verifiedAsks.map(a => Number(a.priceExVatRubKg)).filter(p => Number.isFinite(p) && p > 0);
    const lowestAsk = Math.min(...askPrices);
    referencePrice = lowestAsk;

    exwVolgograd = {
      tier: SOURCE_TIERS.VERIFIED_ASK,
      sourceTierName: 'Оферты с подтверждённым наличием товара',
      status: 'verified_offers_only',
      uncertainty: true,
      priceRubKg: null,
      lowestAskRubKg: lowestAsk,
      asksCount: verifiedAsks.length,
      note: 'Сделок и заявок покупателей нет. Зафиксированы проверенные оферты хозяйств с подтверждённым складом.',
      timestamp: today,
    };
  } else if (marketplaceAsks.length > 0) {
    // Tier 4: Public marketplace asks only
    const askPrices = marketplaceAsks.map(a => Number(a.priceExVatRubKg)).filter(p => Number.isFinite(p) && p > 0);
    const lowestAsk = askPrices.length > 0 ? Math.min(...askPrices) : null;
    if (lowestAsk !== null) referencePrice = lowestAsk;

    exwVolgograd = {
      tier: SOURCE_TIERS.MARKETPLACE_ASK,
      sourceTierName: 'Объявления продавцов (неподтверждённые)',
      status: 'indicative_offers_only',
      uncertainty: true,
      priceRubKg: null, // NEVER invent a deal price from unverified asks
      lowestAskRubKg: lowestAsk,
      asksCount: marketplaceAsks.length,
      note: 'Сделок и подтверждённых заявок нет. Отображаются только ориентировочные объявления продавцов.',
      timestamp: today,
    };
  } else if (officialIndices.length > 0) {
    // Tier 5: Official indices
    const latestOfficial = officialIndices[0];
    referencePrice = Number(latestOfficial.priceExVatRubKg || benchmarkBasePrice);

    exwVolgograd = {
      tier: SOURCE_TIERS.OFFICIAL_INDEX,
      sourceTierName: 'Региональные и национальные индексы',
      status: 'official_index',
      uncertainty: true,
      priceRubKg: referencePrice,
      note: 'Фактические сделки отсутствуют. Используется официальный индекс Росстат / ЕМИСС.',
      timestamp: today,
    };
  } else {
    // No data
    exwVolgograd = {
      tier: SOURCE_TIERS.OFFICIAL_INDEX,
      sourceTierName: 'Референтный ориентир',
      status: 'no_data',
      uncertainty: true,
      priceRubKg: null,
      note: 'Данные отсутствуют. Необходима калибровка от реальных сделок хозяйства.',
      timestamp: today,
    };
  }

  // Calculate Regional Destinations and Netbacks
  const destinations = {};
  for (const [keyName, cfg] of Object.entries(REGIONAL_DESTINATIONS)) {
    const dapPrice = +(referencePrice + cfg.wholesalePremiumRubKg).toFixed(2);
    const transitShrinkageLossRubKg = +(dapPrice * (cfg.transitLossPct / 100)).toFixed(2);
    const otherDeductionsRubKg = Number(cfg.otherDeductionsRubKg || 0);
    const totalDeductionsRubKg = +(cfg.freightRubKg + transitShrinkageLossRubKg + otherDeductionsRubKg).toFixed(2);
    const exwNetback = +(dapPrice - totalDeductionsRubKg).toFixed(2);

    destinations[cfg.key] = {
      key: cfg.key,
      name: cfg.label,
      dapPriceRubKg: dapPrice,
      freightRubKg: cfg.freightRubKg,
      transitLossPct: cfg.transitLossPct,
      transitLossRubKg: transitShrinkageLossRubKg,
      otherDeductionsRubKg,
      totalDeductionsRubKg,
      exwNetbackRubKg: exwNetback,
      premiumOverExwRubKg: +(exwNetback - referencePrice).toFixed(2),
      formula: `${dapPrice.toFixed(2)} - ${cfg.freightRubKg.toFixed(2)} (фрахт) - ${transitShrinkageLossRubKg.toFixed(2)} (усушка в пути ${cfg.transitLossPct}%) = ${exwNetback.toFixed(2)} ₽/кг`,
    };
  }

  return {
    asOfDate: today,
    exwVolgograd,
    destinations,
  };
}

/**
 * Computes Supply Pressure Index (I_sp).
 * Never infers critical market pressure from missing/zero market offer observations.
 */
export function computeSupplyPressureIndex({
  activeOffersCount = 0,
  availableTonnage = 0,
  salesVelocityTonsPerWeek = 1,
  importTonnageMonth = 0,
  weeklyListingsGrowthPct = 0,
  marketableGradeShare = 0.85,
} = {}) {
  const safeVelocity = Math.max(1, Number(salesVelocityTonsPerWeek));
  const weeksOfSupply = Number(availableTonnage) / safeVelocity;
  const growthMultiplier = 1 + Number(weeklyListingsGrowthPct) / 100;
  const indexValue = +(weeksOfSupply * growthMultiplier).toFixed(2);
  const offers = Number(activeOffersCount || 0);

  let pressureLevel = 'moderate';
  let earlyWarningSignal = false;
  let confidence = 'medium';
  let dataStatus = 'verified_offers';
  let interpretationRu = '';

  if (offers <= 0) {
    pressureLevel = 'unverified';
    earlyWarningSignal = false;
    confidence = 'low';
    dataStatus = 'insufficient_offers';
    interpretationRu =
      `Нет активных рыночных оферт (activeOffersCount = 0). Расчётное значение I_sp = ${indexValue} (${weeksOfSupply.toFixed(1)} нед. запаса) ` +
      'отражает только внутреннюю оборачиваемость склада и не является подтверждением критического рыночного давления.';
  } else if (indexValue > 1.5 || weeklyListingsGrowthPct > 20 || weeksOfSupply > 3.5) {
    pressureLevel = 'critical';
    earlyWarningSignal = true;
    confidence = offers >= 10 ? 'high' : 'medium';
    interpretationRu =
      'Давление предложения критическое: объёмы активных предложений и товарные остатки опережают темп реализации. ' +
      'Это ранний сигнал снижения цены — покупатели диктуют условия, риск накопления скрытого брака на складах.';
  } else if (indexValue < 0.8) {
    pressureLevel = 'low';
    earlyWarningSignal = false;
    confidence = offers >= 10 ? 'high' : 'medium';
    interpretationRu =
      'Давление предложения низкое: спрос превышает входящие объёмы, дефицит качественных партий. ' +
      'Хозяйства имеют переговорную силу и могут удерживать ценовую премию.';
  } else {
    pressureLevel = 'moderate';
    earlyWarningSignal = false;
    confidence = offers >= 10 ? 'high' : 'medium';
    interpretationRu =
      'Давление предложения умеренное: баланс спроса и предложения стабилен. ' +
      'Реализация идёт в плановом темпе.';
  }

  return {
    indexValue,
    weeksOfSupply: +weeksOfSupply.toFixed(1),
    pressureLevel,
    earlyWarningSignal,
    confidence,
    dataStatus,
    criticalThreshold: 1.5,
    formula: '(availableTonnage / salesVelocityTonsPerWeek) * (1 + weeklyListingsGrowthPct / 100)',
    interpretationRu,
    metrics: {
      activeOffersCount: offers,
      availableTonnage,
      salesVelocityTonsPerWeek: safeVelocity,
      importTonnageMonth,
      weeklyListingsGrowthPct,
      marketableGradeShare,
    },
  };
}

export const QUALITY_LOSS_CURVES = {
  risky: { monthlyShrinkRate: 0.045, monthlyGradeDecay: 0.065, label: 'Рискованный (толстая шейка / повышенная влажность)' },
  standard: { monthlyShrinkRate: 0.025, monthlyGradeDecay: 0.025, label: 'Стандартный (товарный 4–5 см)' },
  premium_keeping: { monthlyShrinkRate: 0.012, monthlyGradeDecay: 0.012, label: 'Премиум лёжкий (5+ см, сухой)' },
  blended: { monthlyShrinkRate: 0.025, monthlyGradeDecay: 0.025, label: 'Смешанный фонд склада' },
};

/**
 * Computes Quality-Adjusted Deficit Index Q_товарный with quality-specific loss curves
 * and exact reconciliation: physicalRemainingTons === marketableTons + substandardDiscardTons.
 */
export function computeQualityAdjustedDeficit(
  farmStock,
  { horizonsMonths = [1, 2, 3, 5], qualityCategory = 'blended' } = {}
) {
  const harvest = Number(farmStock?.totalHarvestTons || 1000);
  const initialGrade = Number(farmStock?.initialQualityGradeShare || 0.85);
  const storageType = farmStock?.storageType || 'ventilated';
  const curve = QUALITY_LOSS_CURVES[qualityCategory] || QUALITY_LOSS_CURVES.blended;

  const results = [];

  for (const m of horizonsMonths) {
    const monthHorizon = Number(m);

    let physicalLossPct = +(100 * (1 - Math.pow(1 - curve.monthlyShrinkRate, monthHorizon))).toFixed(1);

    if (storageType === 'ventilated' && monthHorizon >= 4) {
      physicalLossPct = +(physicalLossPct + (monthHorizon - 3.5) * 1.2).toFixed(1);
    } else if (storageType === 'unventilated' && monthHorizon > 1.2) {
      physicalLossPct = +(physicalLossPct + (monthHorizon - 1.2) * 5.0).toFixed(1);
    }

    physicalLossPct = Math.min(95, physicalLossPct);
    const physicalRemainingTons = +(harvest * (1 - physicalLossPct / 100)).toFixed(1);

    const gradeDecayFactor = Math.max(0.45, 1 - curve.monthlyGradeDecay * monthHorizon);
    const marketableGradeShare = +(initialGrade * gradeDecayFactor).toFixed(3);
    const marketableTons = +(physicalRemainingTons * marketableGradeShare).toFixed(1);
    const substandardDiscardTons = +(physicalRemainingTons - marketableTons).toFixed(1);
    const qualityScarcityRatio = +(marketableTons / harvest).toFixed(3);

    results.push({
      monthHorizon,
      qualityCategory,
      physicalLossPct,
      physicalRemainingTons,
      marketableGradeShare,
      marketableTons,
      qualityScarcityRatio,
      substandardDiscardTons,
    });
  }

  return results;
}
