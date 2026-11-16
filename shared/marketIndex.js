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
    const exwNetback = +(dapPrice - cfg.freightRubKg - transitShrinkageLossRubKg).toFixed(2);

    destinations[cfg.key] = {
      key: cfg.key,
      name: cfg.label,
      dapPriceRubKg: dapPrice,
      freightRubKg: cfg.freightRubKg,
      transitLossPct: cfg.transitLossPct,
      transitLossRubKg: transitShrinkageLossRubKg,
      exwNetbackRubKg: exwNetback,
      premiumOverExwRubKg: +(exwNetback - referencePrice).toFixed(2),
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
 *
 * Formula:
 * I_sp = (availableTonnage / (salesVelocityTonsPerWeek * 1.0)) * (1 + weeklyListingsGrowthPct / 100)
 *
 * @param {Object} params
 * @param {number} params.activeOffersCount
 * @param {number} params.availableTonnage
 * @param {number} params.salesVelocityTonsPerWeek
 * @param {number} [params.importTonnageMonth]
 * @param {number} [params.weeklyListingsGrowthPct]
 * @param {number} [params.marketableGradeShare]
 * @returns {Object}
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

  // Normalized composite index
  const indexValue = +(weeksOfSupply * growthMultiplier).toFixed(2);

  let pressureLevel = 'moderate';
  let earlyWarningSignal = false;
  let interpretationRu = '';

  if (indexValue > 1.5 || weeklyListingsGrowthPct > 20 || weeksOfSupply > 3.5) {
    pressureLevel = 'critical';
    earlyWarningSignal = true;
    interpretationRu =
      'Давление предложения критическое: объёмы активных предложений и товарные остатки опережают темп реализации. ' +
      'Это ранний сигнал снижения цены — покупатели диктуют условия, риск накопления скрытого брака на складах.';
  } else if (indexValue < 0.8) {
    pressureLevel = 'low';
    earlyWarningSignal = false;
    interpretationRu =
      'Давление предложения низкое: спрос превышает входящие объёмы, дефицит качественных партий. ' +
      'Хозяйства имеют переговорную силу и могут удерживать ценовую премию.';
  } else {
    pressureLevel = 'moderate';
    earlyWarningSignal = false;
    interpretationRu =
      'Давление предложения умеренное: баланс спроса и предложения стабилен. ' +
      'Реализация идёт в плановом темпе.';
  }

  return {
    indexValue,
    weeksOfSupply: +weeksOfSupply.toFixed(1),
    pressureLevel,
    earlyWarningSignal,
    interpretationRu,
    metrics: {
      activeOffersCount,
      availableTonnage,
      salesVelocityTonsPerWeek: safeVelocity,
      importTonnageMonth,
      weeklyListingsGrowthPct,
      marketableGradeShare,
    },
  };
}

/**
 * Computes Quality-Adjusted Deficit Index Q_товарный.
 *
 * Formula:
 * Q_товарный(t) = Q_остаток(t) * (1 - потери(t)) * доля_товарного_качества(t)
 *
 * @param {Object} farmStock
 * @param {number} farmStock.totalHarvestTons
 * @param {number} farmStock.initialQualityGradeShare
 * @param {string} [farmStock.storageType]
 * @param {Object} options
 * @param {Array<number>} [options.horizonsMonths]
 * @returns {Array<Object>}
 */
export function computeQualityAdjustedDeficit(
  farmStock,
  { horizonsMonths = [1, 2, 3, 5] } = {}
) {
  const harvest = Number(farmStock?.totalHarvestTons || 1000);
  const initialGrade = Number(farmStock?.initialQualityGradeShare || 0.85);
  const storageType = farmStock?.storageType || 'ventilated';

  const results = [];

  for (const m of horizonsMonths) {
    const monthHorizon = Number(m);

    // Physical shrinkage and rot curve
    // Base monthly physical shrinkage rate (~2.5% compounded)
    let physicalLossPct = +(100 * (1 - Math.pow(1 - 0.025, monthHorizon))).toFixed(1);

    // Storage tier specific degradation
    if (storageType === 'ventilated' && monthHorizon >= 4) {
      // Spring warming in ventilated storage accelerates physical loss
      physicalLossPct = +(physicalLossPct + (monthHorizon - 3.5) * 1.2).toFixed(1);
    } else if (storageType === 'unventilated' && monthHorizon > 1.2) {
      physicalLossPct = +(physicalLossPct + (monthHorizon - 1.2) * 5.0).toFixed(1);
    }

    const physicalRemainingTons = +(harvest * (1 - physicalLossPct / 100)).toFixed(1);

    // Quality degradation: neck rot, sprout initiation, disease progression
    // In ventilated storage without cooling, marketable grade decays from initial 85% to ~70% by March (month 5)
    let gradeDecayFactor = 1.0;
    if (monthHorizon === 1) {
      gradeDecayFactor = 0.99;
    } else if (monthHorizon === 2) {
      gradeDecayFactor = 0.96;
    } else if (monthHorizon === 3) {
      gradeDecayFactor = 0.92;
    } else {
      // monthHorizon >= 4: spring sprouting risk
      gradeDecayFactor = Math.max(0.5, 0.92 - (monthHorizon - 3) * 0.085);
    }

    const marketableGradeShare = +(initialGrade * gradeDecayFactor).toFixed(3);
    const marketableTons = +(physicalRemainingTons * (marketableGradeShare / initialGrade) * initialGrade).toFixed(1);
    const qualityScarcityRatio = +(marketableTons / harvest).toFixed(3);

    results.push({
      monthHorizon,
      physicalLossPct,
      physicalRemainingTons,
      marketableGradeShare,
      marketableTons,
      qualityScarcityRatio,
      substandardDiscardTons: +(physicalRemainingTons - marketableTons).toFixed(1),
    });
  }

  return results;
}
