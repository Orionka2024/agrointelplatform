/**
 * Module 2: Central Asian Trade Corridors, Flow Redistribution, and Currency Triggers
 *
 * Implements domain expertise from Yulia K:
 * 1. Flow Redistribution Transmission Engine (Kazakhstan, Uzbekistan, Iran, Iraq):
 *    - Uses multi-stage evidence gating for foreign demand shocks.
 *    - Never allows an uncorroborated headline in the Gulf/Middle East to inflate Russian farmgate prices.
 *    - Each stage must be confirmed:
 *      Stage 1: Verified import tender/query
 *      Stage 2: Confirmed exporter purchases in origin country (e.g., Uzbekistan)
 *      Stage 3: Verified transit diversion away from Russian rail/road corridors
 *      Stage 4: Quantified drop in border customs inflow into Russia
 *    - Transmission blocked if any stage is unverified (effective impact = 0.0 ₽/kg).
 *
 * 2. Import Parity & Competitiveness Regimes (Kazakhstan Taraz, Uzbekistan Tashkent):
 *    - Delivered Eq = (Purchase * FX / (1 - transitLoss)) + freight + customs/phyto + importerMargin
 *    - Determines Competitiveness Gap vs Volgograd Farmgate (EXW):
 *      - domestic_advantage: delivered > EXW + 1.5 ₽/kg
 *      - parity_zone: |delivered - EXW| <= 1.5 ₽/kg
 *      - import_pressure_glut: delivered < EXW - 1.5 ₽/kg
 *
 * 3. Currency (FX) Sensitivity & Critical Thresholds:
 *    - Computes exact KZT/RUB and USD/RUB rates where import undercuts local warehouse.
 *
 * 4. Spring Arrival Calendar Window:
 *    - Influx of new-crop winter-sown southern onions (March 20 – April) creates hard exit boundary.
 */

import { daysBetween } from './dates.js';

export const CENTRAL_ASIAN_ORIGINS = {
  KAZAKHSTAN_TARAZ: {
    id: 'KAZAKHSTAN_TARAZ',
    name: 'Казахстан (Жамбылская обл., Тараз)',
    currency: 'KZT',
    defaultFreightRubKg: 6.20,
    defaultCustomsPhytoRubKg: 0.35,
    defaultTransitLossPct: 3.0,
    typicalTransitDays: 5,
  },
  UZBEKISTAN_TASHKENT: {
    id: 'UZBEKISTAN_TASHKENT',
    name: 'Узбекистан (Ташкент / Фергана / Сурхандарья)',
    currency: 'USD',
    defaultFreightRubKg: 8.50,
    defaultCustomsPhytoRubKg: 0.60,
    defaultTransitLossPct: 4.5,
    typicalTransitDays: 9,
  },
};

/**
 * Evaluates whether a foreign demand shock (e.g. Iraq tender) translates into price support in Volgograd.
 * Enforces strict multi-stage corroboration.
 *
 * @param {Object} options
 * @param {string} options.triggerEvent
 * @param {Object} options.evidence
 * @param {boolean} options.evidence.stage1_iraqTenderAnnounced
 * @param {boolean} options.evidence.stage2_uzbekExportConfirmed
 * @param {boolean} options.evidence.stage3_kazakhTransitDiverted
 * @param {boolean} options.evidence.stage4_russianInflowReduced
 * @param {number} [options.localVolgogradPriceRubKg]
 * @returns {Object}
 */
export function evaluateFlowRedistributionChain({
  triggerEvent = 'iraq_import_tender',
  evidence = {},
  localVolgogradPriceRubKg = 16.5,
} = {}) {
  const s1 = Boolean(evidence.stage1_iraqTenderAnnounced);
  const s2 = Boolean(evidence.stage2_uzbekExportConfirmed);
  const s3 = Boolean(evidence.stage3_kazakhTransitDiverted);
  const s4 = Boolean(evidence.stage4_russianInflowReduced);

  const stages = [s1, s2, s3, s4];
  const confirmedStagesCount = stages.filter(Boolean).length;
  const isFullyCorroborated = confirmedStagesCount === 4;

  if (!isFullyCorroborated) {
    const missing = [];
    if (!s1) missing.push('Запрос/тендер покупателя в Ираке');
    if (!s2) missing.push('Подтверждённые контракты экспортёров в Узбекистане');
    if (!s3) missing.push('Фактическое перенаправление транзитных партий из Казахстана');
    if (!s4) missing.push('Снижение объёмов на пограничных переходах РФ');

    return {
      triggerEvent,
      status: 'transmission_blocked',
      confirmedStagesCount,
      effectivePriceImpulseRubKg: 0.0,
      missingStages: missing,
      warningRu:
        'Импульс спроса в Ираке не подтверждён отгрузками из Узбекистана и перенаправлением казахстанских партий: ' +
        'влияние на цену в Волгограде = 0,0 ₽/кг.',
      recommendationRu:
        'Не закладывать спекулятивный рост цены на основании зарубежных новостей. Продавать по графику спроса.',
    };
  }

  return {
    triggerEvent,
    status: 'corroborated_diversion',
    confirmedStagesCount: 4,
    effectivePriceImpulseRubKg: 1.2,
    missingStages: [],
    warningRu: null,
    recommendationRu:
      'Снижение импортного давления подтверждено по всей цепочке поставок. ' +
      'Перенаправление среднеазиатских потоков даёт расчётную поддержку цене в ЮФО на +1.2 ₽/кг.',
  };
}

/**
 * Computes import delivered parity and competitiveness regime.
 *
 * @param {Object} params
 * @param {string} params.origin
 * @param {number} params.purchasePriceForeignCurrency
 * @param {string} params.currency
 * @param {number} params.fxRateToRub
 * @param {number} [params.freightRubKg]
 * @param {number} [params.customsPhytoRubKg]
 * @param {number} [params.transitLossPct]
 * @param {number} [params.importerMarginRubKg]
 * @param {number} [params.localVolgogradExwRubKg]
 * @returns {Object}
 */
export function computeCentralAsianParity({
  origin = 'KAZAKHSTAN_TARAZ',
  purchasePriceForeignCurrency = 55,
  currency = 'KZT',
  fxRateToRub = 0.1865,
  freightRubKg = 6.20,
  customsPhytoRubKg = 0.35,
  transitLossPct = 3.0,
  importerMarginRubKg = 1.0,
  localVolgogradExwRubKg = 16.5,
} = {}) {
  const pForeign = Number(purchasePriceForeignCurrency);
  const fx = Number(fxRateToRub);

  // Convert foreign price to base RUB/kg
  let baseRubKg = 0;
  if (currency === 'USD') {
    // If quote is > 20, it's USD/ton -> divide by 1000
    const perKgUsd = pForeign > 20 ? pForeign / 1000 : pForeign;
    baseRubKg = perKgUsd * fx;
  } else {
    // KZT per kg
    baseRubKg = pForeign * fx;
  }

  // Adjust for transit physical loss
  const lossFactor = Math.max(0.7, 1 - Number(transitLossPct) / 100);
  const purchaseDeliveredBasis = baseRubKg / lossFactor;
  const transitLossCostRubKg = +(purchaseDeliveredBasis - baseRubKg).toFixed(2);
  const pureLandedCostRubKg = +(
    purchaseDeliveredBasis +
    Number(freightRubKg) +
    Number(customsPhytoRubKg)
  ).toFixed(2);

  // Total delivered price at buyer's gate including optional importer margin
  const deliveredPriceRubKg = +(pureLandedCostRubKg + Number(importerMarginRubKg)).toFixed(2);

  const localExw = Number(localVolgogradExwRubKg);
  const competitivenessGapRubKg = +(deliveredPriceRubKg - localExw).toFixed(2);
  const importAdvantageRubKg = +(localExw - pureLandedCostRubKg).toFixed(2);

  let regime = 'parity_zone';
  let summaryRu = '';

  if (competitivenessGapRubKg > 1.5) {
    regime = 'domestic_advantage';
    summaryRu = `Отечественный лук имеет ценовое преимущество: импорт из ${origin} дороже местного на +${competitivenessGapRubKg.toFixed(2)} ₽/кг с учётом доставки.`;
  } else if (competitivenessGapRubKg < -1.5) {
    regime = 'import_pressure_glut';
    summaryRu = `Ценовое давление импорта: ввезённый лук из ${origin} дешевле местного склада на ${Math.abs(competitivenessGapRubKg).toFixed(2)} ₽/кг. Риск демпинга.`;
  } else {
    regime = 'parity_zone';
    summaryRu = `Паритетная зона: импортный лук из ${origin} конкурирует на равных с местным продуктом (разница ${competitivenessGapRubKg.toFixed(2)} ₽/кг).`;
  }

  return {
    origin,
    currency,
    fxRateToRub: fx,
    basePurchaseRubKg: +baseRubKg.toFixed(2),
    transitLossCostRubKg,
    purchaseAdjustedForLossRubKg: +purchaseDeliveredBasis.toFixed(2),
    freightRubKg: Number(freightRubKg),
    customsPhytoRubKg: Number(customsPhytoRubKg),
    pureLandedCostRubKg,
    importerMarginRubKg: Number(importerMarginRubKg),
    deliveredPriceRubKg,
    localVolgogradExwRubKg: localExw,
    competitivenessGapRubKg,
    importAdvantageRubKg,
    regime,
    summaryRu,
  };
}

/**
 * Calculates the critical break-even FX rate where foreign import undercuts local warehouse price
 * and detects if the trigger is already active at currentKztRubRate.
 */
export function calculateCriticalFxTrigger({
  purchaseKztKg = 55,
  freightRubKg = 6.20,
  customsPhytoRubKg = 0.35,
  transitLossPct = 3.0,
  importerMarginRubKg = 1.0,
  targetLocalExwRubKg = 17.0,
  currentKztRubRate = null,
} = {}) {
  const pKzt = Number(purchaseKztKg);
  const target = Number(targetLocalExwRubKg);
  const fixedCosts = Number(freightRubKg) + Number(customsPhytoRubKg) + Number(importerMarginRubKg);

  const allowableNetBase = Math.max(0, target - fixedCosts);
  const lossFactor = 1 - Number(transitLossPct) / 100;
  const criticalKztRubRate = +( (allowableNetBase * lossFactor) / pKzt ).toFixed(4);
  const curFx = currentKztRubRate != null && Number.isFinite(Number(currentKztRubRate)) ? Number(currentKztRubRate) : null;
  const triggerAlreadyActive = curFx != null ? curFx <= criticalKztRubRate : false;

  return {
    purchaseKztKg: pKzt,
    targetLocalExwRubKg: target,
    currentKztRubRate: curFx,
    criticalKztRubRate,
    triggerAlreadyActive,
    status: triggerAlreadyActive ? 'TRIGGER_ACTIVE' : 'TRIGGER_INACTIVE',
    interpretationRu: triggerAlreadyActive
      ? `Триггер УЖЕ АКТИВЕН: текущий курс KZT/RUB (${curFx}) ≤ критического (${criticalKztRubRate}). Казахстанский лук уже проходит по цене ниже локального склада (${target} ₽/кг).`
      : `Критический курс KZT/RUB: ${criticalKztRubRate}. Если курс опустится ниже этого порога, казахстанский лук станет дешевле волгоградского.`,
  };
}

export const DEFAULT_SPRING_ARRIVAL_CUTOFF = '03-20';

/**
 * Returns phase-dependent import pressure weight by calendar month (1..12).
 * Nov-Feb ~0 (0.05), rising from March (0.45) to April-June peak (1.0).
 */
export function getImportPhaseWeight(month) {
  const m = Number(month);
  if (m === 11 || m === 12 || m === 1 || m === 2) return 0.05;
  if (m === 3) return 0.45;
  if (m === 4 || m === 5 || m === 6) return 1.0;
  return 0.15;
}

/**
 * Evaluates import parity and geopolitical/phytosanitary flags strictly as scenario switches
 * (not trained ML features), weighted by seasonal phase.
 */
export function evaluateImportScenarioSwitches({
  month = 3,
  parityDiffRubKg = 0,
  caExportBan = false,
  iranBanStatus = 'none',
  phytoRestrictions = false,
} = {}) {
  const phaseWeight = getImportPhaseWeight(month);
  let scenarioDeltaRubKg = 0;

  if (caExportBan) {
    // Export ban in Kazakhstan/Uzbekistan tightens domestic RF supply
    scenarioDeltaRubKg += 2.2 * Math.max(0.25, phaseWeight);
  } else if (parityDiffRubKg < -1.5) {
    // Import glut pressure scaled by phase (near 0 in Nov-Feb, rising from March)
    scenarioDeltaRubKg += parityDiffRubKg * 0.5 * phaseWeight;
  }

  if (iranBanStatus === 'restricted' || iranBanStatus === 'closed') {
    scenarioDeltaRubKg += 0.9 * Math.max(0.25, phaseWeight);
  }
  if (phytoRestrictions) {
    scenarioDeltaRubKg += 1.1 * Math.max(0.2, phaseWeight);
  }

  return {
    month: Number(month),
    phaseWeight,
    isScenarioSwitchOnly: true,
    switches: { caExportBan: !!caExportBan, iranBanStatus, phytoRestrictions: !!phytoRestrictions },
    scenarioDeltaRubKg: +scenarioDeltaRubKg.toFixed(2),
  };
}

/**
 * Analyzes monthly HS 070310 import volumes by year to detect when early imports actually arrived.
 */
export function analyzeEarlyImportArrivalsByYear(importsMonthly = []) {
  const byYearPartner = new Map();
  for (const row of importsMonthly || []) {
    if (!row?.period || !row?.partner) continue;
    const year = row.period.slice(0, 4);
    const month = Number(row.period.slice(5, 7));
    const key = `${year}|${row.partner}`;
    if (!byYearPartner.has(key)) byYearPartner.set(key, []);
    byYearPartner.get(key).push({ period: row.period, month, tons: Number(row.netWeightTons || 0) });
  }

  const summary = [];
  for (const [key, rows] of byYearPartner.entries()) {
    const [year, partner] = key.split('|');
    if (partner !== 'Узбекистан' && partner !== 'Египет') continue;
    rows.sort((a, b) => a.month - b.month);
    const janFeb = rows.filter((r) => r.month === 1 || r.month === 2);
    const baseline = janFeb.length ? janFeb.reduce((s, r) => s + r.tons, 0) / janFeb.length : 0;
    const surgeRow = rows.find((r) => r.month >= 3 && r.month <= 6 && baseline > 0 && r.tons >= baseline * 3);
    summary.push({
      year,
      partner,
      janFebAvgTons: Math.round(baseline),
      surgeMonth: surgeRow ? surgeRow.period : null,
      surgeTons: surgeRow ? surgeRow.tons : null,
    });
  }
  return summary.sort((a, b) => `${a.year}${a.partner}`.localeCompare(`${b.year}${b.partner}`));
}

export function resolveNextSpringCutoff(today = '2026-11-17', mmdd = DEFAULT_SPRING_ARRIVAL_CUTOFF) {
  const year = Number(String(today).slice(0, 4));
  const cleanMmdd = /^\d{2}-\d{2}$/.test(String(mmdd)) ? mmdd : DEFAULT_SPRING_ARRIVAL_CUTOFF;
  const candidate = `${year}-${cleanMmdd}`;
  if (candidate < today) {
    return `${year + 1}-${cleanMmdd}`;
  }
  return candidate;
}

/**
 * Evaluates safe storage horizon against the spring arrival wave of new-crop Uzbek/Tajik onions.
 * Dynamically resolves the upcoming marketing-season spring cutoff and prevents past dates from being marked ACTIVE.
 */
export function evaluateSpringArrivalWindow({
  today = '2026-11-17',
  plannedSaleDate = null,
  storageType = 'ventilated',
  springArrivalCutoff = DEFAULT_SPRING_ARRIVAL_CUTOFF,
  explicitCutoffDate = null,
} = {}) {
  void storageType;
  const mmdd = /^\d{2}-\d{2}$/.test(String(springArrivalCutoff)) ? springArrivalCutoff : DEFAULT_SPRING_ARRIVAL_CUTOFF;
  const springCutoff = explicitCutoffDate || resolveNextSpringCutoff(today, mmdd);
  const rawDays = daysBetween(today, springCutoff);
  const isPastDate = rawDays < 0 || springCutoff < today;
  const daysUntilSpringWave = Math.max(0, rawDays);
  const targetSaleDate = plannedSaleDate || springCutoff;
  const isAfterCutoff = !isPastDate && targetSaleDate > springCutoff;

  let safeStorageWindowActive = true;
  let importHazardLevel = 'low';
  let status = 'ACTIVE';
  let hazardWarningRu = '';

  if (isPastDate) {
    safeStorageWindowActive = false;
    importHazardLevel = 'expired';
    status = 'EXPIRED_PAST_DATE';
    hazardWarningRu = `Сезонная дата (${springCutoff}) уже прошла относительно ${today}. Используйте актуальный горизонт следующего урожая.`;
  } else if (isAfterCutoff) {
    safeStorageWindowActive = false;
    importHazardLevel = 'critical';
    status = 'CRITICAL_AFTER_CUTOFF';
    hazardWarningRu =
      `Высокий риск прихода раннего лука из Средней Азии: новый озимый урожай ` +
      `начинает вытеснять прошлогодний складской фонд. Рекомендуется завершить основные отгрузки до ${mmdd} (${springCutoff}).`;
  } else if (daysUntilSpringWave <= 14) {
    safeStorageWindowActive = true;
    importHazardLevel = 'moderate';
    status = 'CLOSING_SOON';
    hazardWarningRu =
      `До настроенной отсечки раннего лука (${springCutoff}) осталось ${daysUntilSpringWave} дней. Окно стабильных цен закрывается.`;
  } else {
    safeStorageWindowActive = true;
    importHazardLevel = 'low';
    status = 'ACTIVE';
    hazardWarningRu =
      `Безопасное окно хранения активно: до отсечки прихода раннего урожая (${springCutoff}) ${daysUntilSpringWave} дней.`;
  }

  return {
    today,
    plannedSaleDate: targetSaleDate,
    springArrivalCutoff: mmdd,
    recommendedMaxHoldingDate: springCutoff,
    daysUntilSpringWave,
    calendarMonthsRemaining: +(daysUntilSpringWave / 30.4375).toFixed(1),
    isPastDate,
    status,
    safeStorageWindowActive,
    importHazardLevel,
    hazardWarningRu,
  };
}
