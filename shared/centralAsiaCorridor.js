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

  // Total delivered price at buyer's gate in Southern Russia / Volgograd region
  const deliveredPriceRubKg = +(
    purchaseDeliveredBasis +
    Number(freightRubKg) +
    Number(customsPhytoRubKg) +
    Number(importerMarginRubKg)
  ).toFixed(2);

  const localExw = Number(localVolgogradExwRubKg);
  const competitivenessGapRubKg = +(deliveredPriceRubKg - localExw).toFixed(2);

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
    purchaseAdjustedForLossRubKg: +purchaseDeliveredBasis.toFixed(2),
    freightRubKg: Number(freightRubKg),
    customsPhytoRubKg: Number(customsPhytoRubKg),
    importerMarginRubKg: Number(importerMarginRubKg),
    deliveredPriceRubKg,
    localVolgogradExwRubKg: localExw,
    competitivenessGapRubKg,
    regime,
    summaryRu,
  };
}

/**
 * Calculates the critical break-even FX rate where foreign import undercuts local warehouse price.
 *
 * @param {Object} params
 * @param {number} params.purchaseKztKg
 * @param {number} params.freightRubKg
 * @param {number} params.customsPhytoRubKg
 * @param {number} params.transitLossPct
 * @param {number} params.importerMarginRubKg
 * @param {number} params.targetLocalExwRubKg
 * @returns {Object}
 */
export function calculateCriticalFxTrigger({
  purchaseKztKg = 55,
  freightRubKg = 6.20,
  customsPhytoRubKg = 0.35,
  transitLossPct = 3.0,
  importerMarginRubKg = 1.0,
  targetLocalExwRubKg = 17.0,
} = {}) {
  const pKzt = Number(purchaseKztKg);
  const target = Number(targetLocalExwRubKg);
  const fixedCosts = Number(freightRubKg) + Number(customsPhytoRubKg) + Number(importerMarginRubKg);

  const allowableNetBase = Math.max(0, target - fixedCosts);
  const lossFactor = 1 - Number(transitLossPct) / 100;
  const criticalKztRubRate = +( (allowableNetBase * lossFactor) / pKzt ).toFixed(4);

  return {
    purchaseKztKg: pKzt,
    targetLocalExwRubKg: target,
    criticalKztRubRate,
    interpretationRu:
      `Критический курс KZT/RUB: ${criticalKztRubRate}. ` +
      `Если курс KZT/RUB опустится ниже этого порога (рубль окрепнет против тенге), ` +
      `казахстанский лук станет дешевле волгоградского на местном рынке.`,
  };
}

/**
 * Evaluates safe storage horizon against the spring arrival wave of new-crop Uzbek/Tajik onions.
 *
 * @param {Object} options
 * @param {string} options.today
 * @param {string} options.plannedSaleDate
 * @param {string} [options.storageType]
 * @returns {Object}
 */
export function evaluateSpringArrivalWindow({
  today = '2027-02-10',
  plannedSaleDate = '2027-03-15',
  storageType = 'ventilated',
} = {}) {
  const currentYear = today.slice(0, 4);
  const springCutoff = `${currentYear}-03-20`;
  const daysUntilSpringWave = Math.max(0, daysBetween(today, springCutoff));
  const isAfterCutoff = plannedSaleDate > springCutoff;

  let safeStorageWindowActive = true;
  let importHazardLevel = 'low';
  let hazardWarningRu = '';

  if (isAfterCutoff) {
    safeStorageWindowActive = false;
    importHazardLevel = 'critical';
    hazardWarningRu =
      'Высокий риск прихода раннего лука из Средней Азии (март–апрель): новый озимый урожай ' +
      'из Узбекистана и Таджикистана начинает вытеснять прошлогодний складской фонд. Рекомендуется завершить основные отгрузки до 20 марта.';
  } else if (daysUntilSpringWave <= 14) {
    safeStorageWindowActive = true;
    importHazardLevel = 'moderate';
    hazardWarningRu =
      `До начала поступления раннего лука из Средней Азии осталось ${daysUntilSpringWave} дней. Окно стабильных цен закрывается.`;
  } else {
    safeStorageWindowActive = true;
    importHazardLevel = 'low';
    hazardWarningRu =
      `Безопасное окно хранения активно: до массового прихода раннего урожая ${daysUntilSpringWave} дней.`;
  }

  return {
    today,
    plannedSaleDate,
    recommendedMaxHoldingDate: springCutoff,
    daysUntilSpringWave,
    safeStorageWindowActive,
    importHazardLevel,
    hazardWarningRu,
  };
}
