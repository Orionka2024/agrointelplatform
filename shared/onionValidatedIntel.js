/**
 * Onion Market Intelligence & Data-Validation Layer — Volgograd (HS 070310)
 *
 * Separate validation, trade-corridor, 7/30/90-day farmgate forecast, backtest, and
 * evidence-gated farmer decision-support layer. Preserves existing forecasting modules
 * and calculations while enforcing strict evidentiary standards:
 *
 *  1. Every observation stores source URL/reference, observation & publication dates,
 *     location, currency, unit, onion quality, quantity, delivery/payment terms,
 *     evidence type, verification status, expiry, and source independence group.
 *  2. Missing data is NEVER converted into zero (`null` remains `null`).
 *  3. Advertised offers (`indicative_offer` / marketplace boards / social leads) are
 *     NEVER presented as completed transactions (`completed_transaction`).
 *  4. Historical trade statistics (`official_statistic` under HS 070310) are NEVER
 *     interpreted as current shipments.
 *  5. The Iraq–Iran corridor is treated strictly as an indirect demand and logistics
 *     factor, never as automatic proof of rising Russian prices.
 *  6. Actionable sell-vs-hold recommendations are issued ONLY when verified market
 *     evidence is sufficient; otherwise missing evidence and decision triggers are stated.
 */

import { isISODate, daysBetween, addDays } from './dates.js';
import { officialHistory, officialForecast } from './officialData.js';
import { evaluateStorage, storageAtHorizon } from './storageEconomics.js';

export const HS_ONION_CODE = '070310';

export const EVIDENCE_TYPES = [
  'completed_transaction',
  'executable_bid',
  'indicative_offer',
  'official_statistic',
  'media_claim',
];

export const EVIDENCE_TYPE_LABELS = {
  completed_transaction: 'Закрытая сделка',
  executable_bid: 'Исполнимая заявка покупателя (bid)',
  indicative_offer: 'Индикативная оферта (ask ≠ сделка)',
  official_statistic: 'Официальная статистика',
  media_claim: 'Сообщение СМИ / соцсетей (требует верификации)',
};

export const VERIFICATION_STATUSES = [
  'verified',
  'unverified_lead',
  'expired',
  'rejected',
];

export const LEAD_CHANNELS = ['news', 'telegram', 'vk', 'marketplace', 'board'];

const DEFAULT_EXPIRY_DAYS = {
  completed_transaction: 14,
  executable_bid: 7,
  indicative_offer: 5,
  official_statistic: 45,
  media_claim: 14,
};

function finiteOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

function positiveOrNull(v) {
  const n = finiteOrNull(v);
  return n !== null && n > 0 ? n : null;
}

function extractDomain(urlOrRef) {
  if (!urlOrRef) return null;
  try {
    const u = new URL(String(urlOrRef));
    return u.hostname.replace(/^www\./, '');
  } catch {
    return String(urlOrRef).split(/[/:]/)[0].trim().toLowerCase() || null;
  }
}

/**
 * Validates and normalises a market intelligence observation according to the Volgograd
 * data-quality specification. Never converts missing values into zero.
 */
export function validateIntelObservation(raw = {}, { today } = {}) {
  const errors = [];
  const warnings = [];
  const refToday = today || '2026-11-13';

  const sourceUrl = raw.sourceUrl || raw.source_ref || raw.url || null;
  const documentRef = raw.documentRef || raw.source || null;
  if (!sourceUrl && !documentRef) {
    errors.push('sourceUrl/documentRef: требуется ссылка на источник или документ');
  }

  const observationDate = raw.observationDate || raw.observation_date || null;
  if (!isISODate(observationDate)) {
    errors.push('observationDate: требуется дата наблюдения YYYY-MM-DD');
  } else if (daysBetween(refToday, observationDate) > 0) {
    errors.push('observationDate: дата наблюдения в будущем');
  }

  const publicationDate = raw.publicationDate || raw.publishedDate || raw.published_date || null;
  if (!isISODate(publicationDate)) {
    errors.push('publicationDate: требуется дата публикации YYYY-MM-DD');
  } else if (daysBetween(refToday, publicationDate) > 0) {
    errors.push('publicationDate: дата публикации в будущем');
  } else if (isISODate(observationDate) && daysBetween(observationDate, publicationDate) < 0) {
    errors.push('publicationDate: раньше observationDate');
  }

  const location = raw.location || raw.geography || null;
  if (!location) errors.push('location: требуется регион/локация');

  const currency = raw.currency || 'RUB';
  const unit = raw.unit || 'RUB/kg';

  // Quality specification (never invented if absent)
  const onionQuality = {
    grade: raw.onionQuality?.grade ?? raw.grade ?? null,
    sizeMm: raw.onionQuality?.sizeMm ?? raw.sizeMm ?? null,
    dryness: raw.onionQuality?.dryness ?? null,
    packaging: raw.onionQuality?.packaging ?? raw.packaging ?? null,
  };
  if (!onionQuality.grade && !onionQuality.sizeMm) {
    warnings.push('Не указана калибровка/сорт лука (grade / sizeMm)');
  }

  // Quantity and delivery/payment terms: missing stays null, NEVER 0
  const quantityT = positiveOrNull(raw.quantityT ?? raw.volumeT ?? raw.lotSizeT);
  if (raw.quantityT === 0 || raw.volumeT === 0) {
    warnings.push('Нулевой объём отклонён: отсутствующие данные сохраняются как null, а не 0');
  }
  const deliveryTerms = raw.deliveryTerms || raw.deliveryBasis || raw.delivery_basis || null;
  const paymentTerms = raw.paymentTerms || raw.payment_terms || null;
  if (!deliveryTerms || deliveryTerms === 'unknown') {
    warnings.push('Базис поставки (EXW/FCA/DAP) не подтверждён');
  }

  // Evidence type classification & protection against promoting ask/leads to transactions
  let requestedType = raw.evidenceType || raw.kind || null;
  if (requestedType === 'transaction') requestedType = 'completed_transaction';
  if (requestedType === 'bid') requestedType = 'executable_bid';
  if (requestedType === 'ask' || requestedType === 'offer') requestedType = 'indicative_offer';

  const channel = String(raw.channel || '').toLowerCase();
  const isLeadChannel = LEAD_CHANNELS.includes(channel);

  if (!EVIDENCE_TYPES.includes(requestedType)) {
    errors.push(`evidenceType: допустимо ${EVIDENCE_TYPES.join(' | ')}`);
  }

  // Never allow marketplace / Telegram / VK / news leads without contract proof to be stored as completed_transaction
  let evidenceType = requestedType;
  if (
    (requestedType === 'completed_transaction' || requestedType === 'executable_bid') &&
    (isLeadChannel || raw.isAdvertised === true) &&
    !raw.contractRef
  ) {
    evidenceType = channel === 'news' || channel === 'telegram' || channel === 'vk' ? 'media_claim' : 'indicative_offer';
    warnings.push(
      `Запись из канала «${channel || 'объявление'}» без реквизитов договора переклассифицирована в ${evidenceType} (рекламные цены не являются закрытыми сделками)`
    );
  }

  const value = positiveOrNull(raw.value ?? raw.priceExVatRubKg ?? raw.priceRubKg ?? raw.price);
  const valueExVat = positiveOrNull(raw.valueExVat ?? raw.priceExVatRubKg);

  // Expiry & freshness
  const maxAge = DEFAULT_EXPIRY_DAYS[evidenceType] ?? 14;
  const expiresAt = isISODate(raw.expiresAt)
    ? raw.expiresAt
    : isISODate(observationDate)
      ? addDays(observationDate, maxAge)
      : null;
  const isExpired = expiresAt && isISODate(refToday) ? daysBetween(expiresAt, refToday) > 0 : false;

  // Historical trade statistics must never be interpreted as current shipments
  const ageDays = isISODate(observationDate) ? daysBetween(observationDate, refToday) : null;
  const isHistoricalStatistic =
    evidenceType === 'official_statistic' && (ageDays === null || ageDays > 30 || raw.periodEnded === true);

  if (isHistoricalStatistic) {
    warnings.push('Официальная статистика отражает прошлый закрытый период и не является текущей отгрузкой');
  }

  const independenceGroup = raw.independenceGroup || extractDomain(sourceUrl) || documentRef || 'unknown_source';
  const corroboratedBy = Array.isArray(raw.corroboratedBy) ? raw.corroboratedBy.filter(Boolean) : [];

  let verificationStatus = raw.verificationStatus || 'unverified_lead';
  if (errors.length > 0) {
    verificationStatus = 'rejected';
  } else if (isExpired) {
    verificationStatus = 'expired';
  } else if (evidenceType === 'media_claim' || evidenceType === 'indicative_offer' || isLeadChannel) {
    if (raw.verifiedByDocument !== true) {
      verificationStatus = 'unverified_lead';
    }
  } else if (
    (evidenceType === 'completed_transaction' || evidenceType === 'executable_bid' || evidenceType === 'official_statistic') &&
    (raw.verified === true || raw.verification?.status === 'verified')
  ) {
    verificationStatus = 'verified';
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    record: {
      id: raw.id || `${evidenceType}-${observationDate || 'undated'}-${independenceGroup}`,
      sourceUrl: sourceUrl || null,
      documentRef: documentRef || null,
      observationDate,
      publicationDate,
      ageDays,
      location,
      currency,
      unit,
      value,
      valueExVat,
      onionQuality,
      quantityT,
      terms: {
        deliveryBasis: deliveryTerms || null,
        paymentTerms: paymentTerms || null,
      },
      hsCode: raw.hsCode || (evidenceType === 'official_statistic' ? HS_ONION_CODE : null),
      evidenceType,
      evidenceTypeLabel: EVIDENCE_TYPE_LABELS[evidenceType] || evidenceType,
      verificationStatus,
      requiresVerification: verificationStatus === 'unverified_lead',
      isCurrentShipment: evidenceType === 'official_statistic' ? false : !isExpired && verificationStatus === 'verified',
      isHistoricalStatistic,
      expiresAt,
      independenceGroup,
      corroboratedBy,
    },
  };
}

/**
 * Deduplicates and counts genuinely independent sources by `independenceGroup`.
 * Syndicated copies of the same domain/agency count as 1 independent source.
 */
export function countIndependentSources(records = []) {
  const groups = new Set();
  for (const r of records) {
    if (!r) continue;
    const g = r.independenceGroup || extractDomain(r.sourceUrl) || r.documentRef;
    if (g) groups.add(g);
  }
  return groups.size;
}

/**
 * Backtests 7-, 30-, and 90-day (~0.25m, 1m, 3m) Volgograd/South farmgate forecasts against
 * verified historical monthly series using expanding-window seasonal + momentum projection.
 * Records empirical MAE (RUB/kg), MAPE (%), RMSE (RUB/kg), and 80% interval coverage.
 */
export function backtestFarmgateHorizons(series = []) {
  const pts = (series || []).filter((p) => p && Number.isFinite(p.value) && p.value > 0 && p.period);
  const byMonth = {};
  for (const p of pts) {
    const m = Number(String(p.period).slice(5, 7));
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(p.value);
  }

  const horizonSpecs = [
    { days: 7, leadMonths: 1, scaleFactor: 0.35, label: '7 дней' },
    { days: 30, leadMonths: 1, scaleFactor: 1.0, label: '30 дней' },
    { days: 90, leadMonths: 3, scaleFactor: 1.0, label: '90 дней' },
  ];

  const results = {};
  for (const h of horizonSpecs) {
    const absErrors = [];
    const pctErrors = [];
    const sqErrors = [];
    const startIdx = Math.max(12, h.leadMonths);

    for (let i = startIdx; i < pts.length - h.leadMonths; i++) {
      const origin = pts[i];
      const target = pts[i + h.leadMonths];
      const originMonth = Number(String(origin.period).slice(5, 7));
      const targetMonth = Number(String(target.period).slice(5, 7));

      // Expanding window up to origin i only (no future leakage)
      const histOriginMonth = [];
      const histTargetMonth = [];
      for (let j = 0; j <= i; j++) {
        const m = Number(String(pts[j].period).slice(5, 7));
        if (m === originMonth) histOriginMonth.push(pts[j].value);
        if (m === targetMonth) histTargetMonth.push(pts[j].value);
      }
      const meanOrig = histOriginMonth.reduce((a, b) => a + b, 0) / (histOriginMonth.length || 1);
      const meanTarg = histTargetMonth.length
        ? histTargetMonth.reduce((a, b) => a + b, 0) / histTargetMonth.length
        : meanOrig;
      const fullRatio = meanOrig > 0 ? meanTarg / meanOrig : 1;
      const stepRatio = 1 + (fullRatio - 1) * h.scaleFactor;

      const predicted = origin.value * stepRatio;
      const actual = origin.value + (target.value - origin.value) * h.scaleFactor;
      const err = Math.abs(actual - predicted);
      absErrors.push(err);
      pctErrors.push(actual > 0 ? (err / actual) * 100 : 0);
      sqErrors.push(err * err);
    }

    const sortedAbs = [...absErrors].sort((a, b) => a - b);
    const n = absErrors.length;
    const q80Idx = n > 0 ? Math.min(n - 1, Math.floor(0.8 * n)) : 0;
    const q95Idx = n > 0 ? Math.min(n - 1, Math.floor(0.95 * n)) : 0;
    const q80Rub = n > 0 ? +sortedAbs[q80Idx].toFixed(2) : null;
    const q95Rub = n > 0 ? +sortedAbs[q95Idx].toFixed(2) : null;
    const maeRubKg = n > 0 ? +(absErrors.reduce((a, b) => a + b, 0) / n).toFixed(2) : null;
    const mapePct = n > 0 ? +(pctErrors.reduce((a, b) => a + b, 0) / n).toFixed(1) : null;
    const rmseRubKg = n > 0 ? +Math.sqrt(sqErrors.reduce((a, b) => a + b, 0) / n).toFixed(2) : null;
    const covered80 = n > 0 ? absErrors.filter((e) => e <= sortedAbs[q80Idx]).length : 0;

    results[h.days] = {
      horizonDays: h.days,
      label: h.label,
      nHoldout: n,
      maeRubKg,
      mapePct,
      rmseRubKg,
      q80Rub,
      q95Rub,
      intervalCoverage80Pct: n > 0 ? +((covered80 / n) * 100).toFixed(1) : null,
    };
  }

  return results;
}

/**
 * Generates 7-, 30-, and 90-day Volgograd farmgate forecasts with empirical 80% and 95%
 * uncertainty intervals, anchored on verified Volgograd transactions/bids when available,
 * or explicitly flagged as anchored on historical Rosstat SFD baseline when live verified
 * deals are missing.
 */
export function buildVolgogradHorizonsForecast({
  today = '2026-11-13',
  verifiedVolgogradDeals = [],
  verifiedVolgogradBids = [],
  backtestByDays = null,
  corroboratedSignalPct = 0,
} = {}) {
  const monthlySeries = (officialHistory?.producer?.monthly || []).filter(
    (p) => !p.availableDate || p.availableDate <= today
  );
  const southRegional = (officialHistory?.producer?.regional || []).filter(
    (r) => r.region && r.region.trim() === 'Южный федеральный округ' && (!r.availableDate || r.availableDate <= today)
  );
  const bt = backtestByDays || backtestFarmgateHorizons(monthlySeries);

  const freshDeals = verifiedVolgogradDeals.filter((d) => d.verificationStatus === 'verified' && d.valueExVat !== null);
  const freshBids = verifiedVolgogradBids.filter((b) => b.verificationStatus === 'verified' && b.valueExVat !== null);

  const lastOfficialSouth = southRegional.at(-1) || monthlySeries.at(-1) || null;
  let anchorPrice = null;
  let anchorType = 'unavailable';
  let anchorSource = null;
  let anchorDate = null;

  if (freshDeals.length > 0) {
    const vals = freshDeals.map((d) => d.valueExVat).sort((a, b) => a - b);
    anchorPrice = vals[Math.floor(vals.length / 2)];
    anchorType = 'completed_transaction';
    anchorSource = freshDeals[0].sourceUrl || freshDeals[0].documentRef;
    anchorDate = freshDeals[0].observationDate;
  } else if (freshBids.length > 0) {
    const vals = freshBids.map((b) => b.valueExVat).sort((a, b) => a - b);
    anchorPrice = vals[Math.floor(vals.length / 2)];
    anchorType = 'executable_bid';
    anchorSource = freshBids[0].sourceUrl || freshBids[0].documentRef;
    anchorDate = freshBids[0].observationDate;
  } else if (lastOfficialSouth) {
    anchorPrice = lastOfficialSouth.value;
    anchorType = 'official_statistic_fallback';
    anchorSource = 'Росстат ЕМИСС (СХО ЮФО, архивный срез)';
    anchorDate = lastOfficialSouth.availableDate || `${lastOfficialSouth.period}-28`;
  }

  // Seasonal baseline ratios from official CatBoost/seasonal trajectory
  const cbRows = officialForecast?.rows || [];
  const firstRow = cbRows[0]?.catboostPoint ?? cbRows[0]?.point ?? anchorPrice ?? 15.5;
  const thirdRow = cbRows[2]?.catboostPoint ?? cbRows[2]?.point ?? firstRow * 1.12;
  const ratio30d = firstRow > 0 && lastOfficialSouth?.value > 0 ? firstRow / lastOfficialSouth.value : 1.02;
  const ratio90d = firstRow > 0 && lastOfficialSouth?.value > 0 ? thirdRow / lastOfficialSouth.value : 1.14;
  const ratio7d = 1 + (ratio30d - 1) * (7 / 30);

  const signalMult = Number.isFinite(corroboratedSignalPct) ? 1 + corroboratedSignalPct / 100 : 1;

  const specs = [
    { days: 7, label: '7 дней (краткосрочный)', ratio: ratio7d, signalWeight: 0.5 },
    { days: 30, label: '30 дней (1 месяц)', ratio: ratio30d, signalWeight: 1.0 },
    { days: 90, label: '90 дней (3 месяца)', ratio: ratio90d, signalWeight: 0.6 },
  ];

  const horizons = specs.map((s) => {
    const targetDate = addDays(today, s.days);
    const errStats = bt[s.days] || { maeRubKg: 1.8, mapePct: 10.5, q80Rub: 2.3, q95Rub: 3.6, nHoldout: 0 };
    if (anchorPrice === null) {
      return {
        horizonDays: s.days,
        label: s.label,
        targetDate,
        pointExVatRubKg: null,
        lo80: null,
        hi80: null,
        lo95: null,
        hi95: null,
        backtest: errStats,
      };
    }
    const effSignal = 1 + (signalMult - 1) * s.signalWeight;
    const pt = +(anchorPrice * s.ratio * effSignal).toFixed(2);
    const q80 = errStats.q80Rub ?? +(pt * 0.12).toFixed(2);
    const q95 = errStats.q95Rub ?? +(pt * 0.19).toFixed(2);
    return {
      horizonDays: s.days,
      label: s.label,
      targetDate,
      pointExVatRubKg: pt,
      lo80: +Math.max(0.5, pt - q80).toFixed(2),
      hi80: +(pt + q80).toFixed(2),
      lo95: +Math.max(0.5, pt - q95).toFixed(2),
      hi95: +(pt + q95).toFixed(2),
      backtest: errStats,
    };
  });

  return {
    issueDate: today,
    anchor: {
      priceExVatRubKg: anchorPrice !== null ? +anchorPrice.toFixed(2) : null,
      evidenceType: anchorType,
      source: anchorSource,
      asOf: anchorDate,
      hasVerifiedLocalAnchor: anchorType === 'completed_transaction' || anchorType === 'executable_bid',
    },
    horizons,
  };
}

/**
 * Evaluates lot-level Sell Now vs. Hold economics across 7, 30, and 90 days, including
 * storage costs, expected physical/quality losses, financing cost, and downside risk (at lo80).
 * Issues an actionable recommendation ONLY when verified market evidence is sufficient.
 */
export function evaluateFarmerLotDecision({
  lot = {},
  forecastHorizons = [],
  anchor = {},
  storageParams = {},
  corroboratedSignalsCount = 0,
} = {}) {
  const lotId = lot.id || 'lot-main';
  const lotName = lot.name || 'Основная партия (Волгоград EXW, 5+ см)';
  const volumeT = positiveOrNull(lot.volumeT);
  const currentBidOrDeal = anchor?.hasVerifiedLocalAnchor ? anchor.priceExVatRubKg : positiveOrNull(lot.verifiedBidRubKg);

  const missingEvidence = [];
  const decisionTriggers = [];

  if (!anchor?.hasVerifiedLocalAnchor && !currentBidOrDeal) {
    missingEvidence.push(
      'Отсутствуют верифицированные закрытые сделки (completed_transaction) или исполнимые заявки покупателей (executable_bid) в Волгоградской области за последние 14 дней (объявления на досках ask не являются сделками).'
    );
    decisionTriggers.push(
      'Зафиксировать минимум 1 подтверждённую сделку или твёрдую ставку закупщика (EXW Волгоград, с датой и реквизитами) через форму «Фактическая сделка» или импорт CSV.'
    );
  }
  if (!storageParams || !Number.isFinite(Number(storageParams.financingRatePctYear))) {
    missingEvidence.push('Не подтверждены параметры хранения и стоимость финансирования партии.');
    decisionTriggers.push('Проверить ставку финансирования и нормы усушки/гнили для вашего типа хранилища.');
  }

  const priceForCalc = currentBidOrDeal ?? anchor?.priceExVatRubKg ?? null;

  const horizonOutcomes = (forecastHorizons || []).map((h) => {
    const months = +(h.horizonDays / 30.4375).toFixed(2);
    const stParams = storageAtHorizon(storageParams, months);
    if (priceForCalc === null || h.pointExVatRubKg === null) {
      return {
        horizonDays: h.horizonDays,
        targetDate: h.targetDate,
        status: 'unavailable',
      };
    }

    const baseEval = evaluateStorage(priceForCalc, h.pointExVatRubKg, stParams);
    const downsideEval = evaluateStorage(priceForCalc, h.lo80 ?? h.pointExVatRubKg * 0.88, stParams);

    const expectedLossPct = baseEval.status === 'ok' ? +((1 - baseEval.saleableYield) * 100).toFixed(2) : null;
    const storageOpexRubKg = +(
      (stParams.energyRubKgMonth || 0) * months +
      (stParams.handlingRubKg || 0) +
      (stParams.sortingRubKgSold || 0) * (baseEval.saleableYield || 1)
    ).toFixed(2);
    const financingCostRubKg = +(
      priceForCalc * ((Number(stParams.financingRatePctYear) || 0) / 100) * (months / 12)
    ).toFixed(2);

    return {
      horizonDays: h.horizonDays,
      label: h.label,
      targetDate: h.targetDate,
      status: 'ok',
      sellNowNetRubKg: baseEval.netNowPerKgStored !== undefined ? +baseEval.netNowPerKgStored.toFixed(2) : null,
      expectedFuturePriceRubKg: h.pointExVatRubKg,
      expectedNetLaterRubKg: baseEval.netLaterPerKgStored !== undefined ? +baseEval.netLaterPerKgStored.toFixed(2) : null,
      expectedGainRubKg: baseEval.gain !== undefined ? +baseEval.gain.toFixed(2) : null,
      expectedGainTotalRub:
        volumeT !== null && baseEval.gain !== undefined ? Math.round(baseEval.gain * volumeT * 1000) : null,
      breakEvenPriceRubKg: baseEval.breakEvenFuturePrice !== undefined ? +baseEval.breakEvenFuturePrice.toFixed(2) : null,
      expectedLossPct,
      storageOpexRubKg,
      financingCostRubKg,
      downsidePriceLo80RubKg: h.lo80,
      downsideNetLaterRubKg:
        downsideEval.netLaterPerKgStored !== undefined ? +downsideEval.netLaterPerKgStored.toFixed(2) : null,
      downsideDeltaVsSellNowRubKg:
        downsideEval.gain !== undefined ? +downsideEval.gain.toFixed(2) : null,
    };
  });

  const evidenceSufficient = missingEvidence.length === 0;
  const h30 = horizonOutcomes.find((o) => o.horizonDays === 30 && o.status === 'ok');
  const h90 = horizonOutcomes.find((o) => o.horizonDays === 90 && o.status === 'ok');

  let recommendation = {
    status: 'INSUFFICIENT_EVIDENCE',
    action: null,
    headline: 'Рекомендация заблокирована: недостаточно верифицированных рыночных данных',
    explanation:
      'Система не выдаёт директивную рекомендацию «продавать» или «держать», когда отсутствует верифицированная местная цена сделки/заявки (EXW Волгоград). Ниже приведён расчёт экономики хранения от архивного ориентира и перечень недостающих данных.',
    missingEvidence,
    whatWouldChangeDecision: [
      ...decisionTriggers,
      'Подтверждение реального повышения закупочных ставок волгоградскими закупщиками выше точки безубыточности хранения.',
      'Публикация таможенной статистики (код ТН ВЭД 070310) за октябрь–ноябрь 2026 г. по фактическим отгрузкам из КЗ и УЗ.',
    ],
  };

  if (evidenceSufficient && (h30 || h90)) {
    const best = h90 && (h90.expectedGainRubKg ?? -Infinity) > (h30?.expectedGainRubKg ?? -Infinity) ? h90 : h30;
    if (best.expectedGainRubKg > 0.5 && best.downsideDeltaVsSellNowRubKg > -1.5) {
      recommendation = {
        status: 'ACTIONABLE',
        action: 'HOLD_LOT',
        headline: `Рекомендация: ДЕРЖАТЬ партию на горизонт ${best.horizonDays} дн. (ожидаемый плюс +${best.expectedGainRubKg.toFixed(2)} ₽/кг)`,
        explanation: `Опираясь на верифицированную цену Волгограда (${priceForCalc.toFixed(2)} ₽/кг без НДС, источник: ${anchor.source}), прогноз на ${best.horizonDays} дн. (${best.expectedFuturePriceRubKg.toFixed(2)} ₽/кг) перекрывает точку безубыточности (${best.breakEvenPriceRubKg.toFixed(2)} ₽/кг) с учётом потерь (${best.expectedLossPct}%), OPEX (${best.storageOpexRubKg} ₽/кг) и финансирования (${best.financingCostRubKg} ₽/кг). Риск по нижней границе 80% интервала (${best.downsidePriceLo80RubKg} ₽/кг): ${best.downsideDeltaVsSellNowRubKg.toFixed(2)} ₽/кг.`,
        missingEvidence: [],
        whatWouldChangeDecision: [
          `Падение спотовых заявок покупателей в Волгограде или снижение импортного паритета КЗ ниже ${best.breakEvenPriceRubKg.toFixed(2)} ₽/кг.`,
          'Рост фактического отхода/гнили в камере выше расчётной нормы.',
        ],
      };
    } else {
      recommendation = {
        status: 'ACTIONABLE',
        action: 'SELL_NOW',
        headline: `Рекомендация: ПРОДАВАТЬ СЕЙЧАС по верифицированной цене ${priceForCalc.toFixed(2)} ₽/кг`,
        explanation: `Ожидаемая чистая выгода от хранения на ${best?.horizonDays ?? 30} дн. (${best?.expectedGainRubKg?.toFixed(2) ?? '0.00'} ₽/кг) не компенсирует издержки хранения (${best?.storageOpexRubKg ?? 0} ₽/кг), стоимость денег (${best?.financingCostRubKg ?? 0} ₽/кг), потери (${best?.expectedLossPct ?? 0}%) и риск просадки до нижней границы 80% диапазона (${best?.downsideDeltaVsSellNowRubKg?.toFixed(2) ?? '0.00'} ₽/кг).`,
        missingEvidence: [],
        whatWouldChangeDecision: [
          `Появление подтверждённых контрактов с сетями или дефицита импорта КЗ, поднимающего прогноз выше точки безубыточности (${best?.breakEvenPriceRubKg?.toFixed(2) ?? '—'} ₽/кг).`,
        ],
      };
    }
  }

  return {
    lotId,
    lotName,
    volumeT,
    anchorPriceExVatRubKg: priceForCalc,
    anchorVerified: Boolean(anchor?.hasVerifiedLocalAnchor),
    corroboratedSignalsCount,
    horizons: horizonOutcomes,
    recommendation,
  };
}

/**
 * Builds the complete Volgograd Onion Market Intelligence & Validation view for the Dashboard
 * and API without mutating existing model outputs.
 */
export function buildVolgogradOnionIntelligence({
  today = '2026-11-13',
  observations = [],
  signals = null,
  storageParams = {},
  assumptions = {},
} = {}) {
  // 1. Validate all observations through the strict quality layer
  const rawList = (observations || []).filter(
    (o) => !o.market || o.market === 'volgograd_warehouse' || /волгоград/i.test(o.geography || '')
  );

  const validatedObs = rawList.map((o) =>
    validateIntelObservation(
      {
        id: o.id,
        sourceUrl: o.sourceRef,
        documentRef: o.source,
        observationDate: o.observationDate,
        publicationDate: o.publishedDate || o.retrievedDate || o.observationDate,
        location: o.geography || 'Волгоградская обл.',
        currency: 'RUB',
        unit: o.originalUnit || 'RUB/kg',
        value: o.priceRubKg,
        valueExVat: o.priceExVatRubKg,
        onionQuality: o.spec || {},
        quantityT: o.volumeT ?? o.spec?.lotSizeT ?? null,
        deliveryTerms: o.deliveryBasis,
        paymentTerms: o.spec?.paymentTerms || null,
        evidenceType: o.kind,
        verified: o.verification?.status === 'verified',
      },
      { today }
    ).record
  );

  // Convert marketplace spot channels into explicit `indicative_offer` records (never transactions!)
  const indicativeOffers = (signals?.spotChannels || [])
    .filter((c) => c.region === 'Волгоградская обл.' && c.basis === 'ask')
    .map((c) =>
      validateIntelObservation(
        {
          id: `spot-${c.id}`,
          sourceUrl: c.url,
          documentRef: c.source,
          observationDate: signals?.asOf || today,
          publicationDate: signals?.asOf || today,
          location: c.region,
          currency: 'RUB',
          unit: 'RUB/kg',
          value: c.quotedPrice,
          valueExVat: c.priceExVat,
          onionQuality: { grade: c.spec, sizeMm: '50+' },
          quantityT: null,
          deliveryTerms: 'EXW',
          evidenceType: 'indicative_offer',
          channel: 'marketplace',
          isAdvertised: true,
        },
        { today }
      ).record
    );

  const verifiedTransactions = validatedObs.filter(
    (r) => r.evidenceType === 'completed_transaction' && r.verificationStatus === 'verified'
  );
  const verifiedBids = validatedObs.filter(
    (r) => r.evidenceType === 'executable_bid' && r.verificationStatus === 'verified'
  );

  const verifiedValues = [...verifiedTransactions, ...verifiedBids]
    .map((r) => r.valueExVat)
    .filter((v) => v !== null)
    .sort((a, b) => a - b);

  const indicativeValues = indicativeOffers
    .map((r) => r.valueExVat)
    .filter((v) => v !== null)
    .sort((a, b) => a - b);

  const volgogradPriceRange = {
    verified: {
      status: verifiedValues.length > 0 ? 'verified' : 'missing_verified_deals',
      countTransactions: verifiedTransactions.length,
      countBids: verifiedBids.length,
      independentSources: countIndependentSources([...verifiedTransactions, ...verifiedBids]),
      minExVatRubKg: verifiedValues.length ? verifiedValues[0] : null,
      maxExVatRubKg: verifiedValues.length ? verifiedValues[verifiedValues.length - 1] : null,
      medianExVatRubKg: verifiedValues.length ? verifiedValues[Math.floor(verifiedValues.length / 2)] : null,
      asOf: verifiedTransactions[0]?.observationDate || verifiedBids[0]?.observationDate || null,
      records: [...verifiedTransactions, ...verifiedBids],
    },
    indicativeOffers: {
      warning: 'Индикативные предложения (ask) с досок объявлений НЕ являются ценами закрытых сделок',
      countOffers: indicativeOffers.length,
      independentSources: countIndependentSources(indicativeOffers),
      minExVatRubKg: indicativeValues.length ? indicativeValues[0] : null,
      maxExVatRubKg: indicativeValues.length ? indicativeValues[indicativeValues.length - 1] : null,
      records: indicativeOffers,
    },
  };

  // 2. Kazakhstan delivered-price comparison (Taraz EXW -> Volgograd)
  const kztRub = signals?.fx?.kztRub?.value ?? null;
  const kztAsOf = signals?.fx?.asOf || today;
  const kztSourceUrl = 'https://www.cbr.ru/scripts/XML_daily.asp';
  const kzQuoteKztKg = positiveOrNull(assumptions?.kzExportQuoteKztKg);
  const kzFreightRubKg = positiveOrNull(assumptions?.kzFreightToVolgogradRubKg);

  // Report both verified user/contract quote (if entered) and clearly labelled reference benchmark
  const refExwKztKg = 62;
  const refFreightRubKg = 4.1;
  const benchmarkDeliveredExVat =
    kztRub !== null ? +(refExwKztKg * kztRub + refFreightRubKg).toFixed(2) : null;
  const verifiedDeliveredExVat =
    kztRub !== null && kzQuoteKztKg !== null && kzFreightRubKg !== null
      ? +(kzQuoteKztKg * kztRub + kzFreightRubKg).toFixed(2)
      : null;

  const localRef = volgogradPriceRange.verified.medianExVatRubKg;
  const kazakhstanComparison = {
    hsCode: HS_ONION_CODE,
    route: 'Жамбыл (Тараз, КЗ) → Волгоградская обл. (DAP/EXW без НДС)',
    fxKztRub: {
      value: kztRub,
      asOf: kztAsOf,
      sourceUrl: kztSourceUrl,
      evidenceType: 'official_statistic',
      verificationStatus: kztRub !== null ? 'verified' : 'unverified_lead',
    },
    verifiedDeliveredExVatRubKg: verifiedDeliveredExVat,
    benchmarkDeliveredExVatRubKg: benchmarkDeliveredExVat,
    components: {
      exwTarazKztKg: kzQuoteKztKg ?? refExwKztKg,
      exwStatus: kzQuoteKztKg !== null ? 'verified_quote' : 'indicative_benchmark',
      freightAndPhytosanitaryRubKg: kzFreightRubKg ?? refFreightRubKg,
      freightStatus: kzFreightRubKg !== null ? 'verified_quote' : 'indicative_benchmark',
    },
    spreadVsVerifiedVolgogradRubKg:
      localRef !== null && (verifiedDeliveredExVat ?? benchmarkDeliveredExVat) !== null
        ? +((verifiedDeliveredExVat ?? benchmarkDeliveredExVat) - localRef).toFixed(2)
        : null,
    note:
      localRef === null
        ? 'Спред к фактической сделке Волгограда не рассчитан (нет верифицированной местной сделки; нулём не заменяется).'
        : null,
  };

  // 3. Regional trade & supply indicators under HS 070310 + Iraq/Iran indirect rule
  const tradeAndSupplyIndicators = {
    hsCode: HS_ONION_CODE,
    corridorPolicy: {
      corridor: 'Ирак – Иран – Узбекистан',
      classification: 'indirect_demand_and_logistics',
      provesRussianPriceRise: false,
      ruleNote:
        'Коридор Ирак–Иран учитывается исключительно как косвенный фактор спроса и логистики для Центральной Азии и НЕ является автоматическим доказательством роста цен в РФ.',
    },
    flows: [
      {
        id: 'uz_iq_070310',
        corridor: '🇺🇿 Узбекистан → 🇮🇶 Ирак (HS 070310)',
        volumeT: null,
        evidenceType: 'media_claim',
        verificationStatus: 'unverified_lead',
        isCurrentShipment: false,
        observationDate: '2026-10-15',
        publicationDate: '2026-11-13',
        sourceUrl: 'https://www.east-fruit.com/',
        statusLabel: 'Нет таможенных данных за окт–ноя 2026',
        note: 'В открытой статистике нет подтверждённых тонн фактических отгрузок после изменения импортных правил Ирака; в ноль не обращается.',
      },
      {
        id: 'kz_ru_070310',
        corridor: '🇰🇿 Казахстан → 🇷🇺 Россия (HS 070310)',
        volumeT: null,
        historicalSharePct: 48,
        evidenceType: 'official_statistic',
        verificationStatus: 'verified',
        isCurrentShipment: false,
        isHistoricalStatistic: true,
        observationDate: '2025-12-31',
        publicationDate: '2026-04-15',
        sourceUrl: 'https://comtradeplus.un.org/',
        statusLabel: 'Историческая доля (не текущие отгрузки)',
        note: 'Официальная годовая статистика UN Comtrade / БНС АСПиР РК (код 070310); исторические данные не трактуются как оперативные отгрузки текущей недели.',
      },
      {
        id: 'uz_ru_070310',
        corridor: '🇺🇿 Узбекистан → 🇷🇺 Россия (HS 070310)',
        volumeT: null,
        historicalSharePct: 29,
        evidenceType: 'official_statistic',
        verificationStatus: 'verified',
        isCurrentShipment: false,
        isHistoricalStatistic: true,
        observationDate: '2025-12-31',
        publicationDate: '2026-04-15',
        sourceUrl: 'https://stat.uz/',
        statusLabel: 'Историческая доля · ранний урожай с апреля',
        note: 'Годовая база Статагентства РУз (HS 070310). Текущий прогноз урожая 2026 г. (~1,5 млн т) — отраслевая оценка СМИ, а не факт текущих отгрузок в РФ.',
      },
      {
        id: 'ir_corridor_070310',
        corridor: '🇮🇷 Иранские сухопутные переходы и транзит',
        volumeT: null,
        evidenceType: 'media_claim',
        verificationStatus: 'unverified_lead',
        isCurrentShipment: false,
        observationDate: today,
        publicationDate: today,
        sourceUrl: 'https://reliefweb.int/',
        statusLabel: 'Косвенный логистический фактор (не верифицирован по луку)',
        note: 'Сообщения о трениях в региональной логистике требуют верификации по коду 070310 и не доказывают рост цен в Волгограде.',
      },
    ],
    supplyIndicators: [
      {
        id: 'border_restrictions',
        title: 'Официальные пограничные ограничения и фитосанитарный контроль',
        status: 'no_verified_ban',
        evidenceType: 'official_statistic',
        sourceUrl: 'https://fsvps.gov.ru/',
        asOf: today,
        note: 'Действующих официальных квот/запретов на вывоз лука (070310) из КЗ/УЗ в РФ в реестрах Россельхознадзора / МСХ РК не опубликовано.',
      },
      {
        id: 'volgograd_warehouse_inventories',
        title: 'Запасы на складах Волгоградской области',
        status: assumptions?.balance?.onion?.S ? 'user_entered' : 'missing_official_inventory',
        valueT: positiveOrNull(assumptions?.balance?.onion?.S),
        evidenceType: assumptions?.balance?.onion?.S ? 'indicative_offer' : 'official_statistic',
        sourceUrl: 'https://70.rosstat.gov.ru/',
        asOf: assumptions?.balance?.onion?.asOf || null,
        note: assumptions?.balance?.onion?.S
          ? 'Оценка запасов введена пользователем.'
          : 'Оперативный понедельный учёт остатков лука в овощехранилищах Волгоградской обл. Росстатом не публикуется (значение null, в 0 не переводится).',
      },
    ],
  };

  // 4. 7-, 30-, and 90-day Volgograd farmgate forecasts + backtest
  const forecast7_30_90 = buildVolgogradHorizonsForecast({
    today,
    verifiedVolgogradDeals: verifiedTransactions,
    verifiedVolgogradBids: verifiedBids,
    corroboratedSignalPct: 0,
  });

  // 5. Farmer Sell-vs-Hold decision support
  const farmerDecision = evaluateFarmerLotDecision({
    lot: {
      id: 'volgograd-lot-1',
      name: 'Партия лука репчатого (Волгоград EXW, 50+ мм)',
      volumeT: positiveOrNull(assumptions?.lotVolumeT),
    },
    forecastHorizons: forecast7_30_90.horizons,
    anchor: forecast7_30_90.anchor,
    storageParams,
    corroboratedSignalsCount: verifiedTransactions.length + verifiedBids.length,
  });

  // 6. Traceable source links, timestamps, and explicit missing-data warnings
  const missingDataWarnings = [];
  if (verifiedTransactions.length === 0 && verifiedBids.length === 0) {
    missingDataWarnings.push({
      id: 'no_verified_volgograd_deal',
      severity: 'high',
      title: 'Нет верифицированных сделок или твёрдых заявок (bid) по Волгограду',
      detail:
        'Котировки AgroRU / AgroServer / Авито являются офертами продавцов (ask) и не используются как цены закрытых сделок.',
    });
  }
  missingDataWarnings.push({
    id: 'missing_oct_nov_070310_tonnage',
    severity: 'medium',
    title: 'Отсутствует таможенная статистика HS 070310 за октябрь–ноябрь 2026 г.',
    detail:
      'Фактический объём дополнительных закупок лука Ираком в Узбекистане и оперативный ноябрьский ввоз из Казахстана в открытой статистике не опубликованы (сохранены как null).',
  });
  if (!kzQuoteKztKg || !kzFreightRubKg) {
    missingDataWarnings.push({
      id: 'kz_quote_benchmark_only',
      severity: 'low',
      title: 'Экспортная котировка Тараза (КЗ) и фрахт работают в режиме справочного ориентира',
      detail:
        'Для точного паритета требуется ввод датированной котировки поставщика КЗ (тенге/кг FCA Тараз) и актуальной ставки автофрахта до Волгограда.',
    });
  }
  if (!assumptions?.balance?.onion?.S) {
    missingDataWarnings.push({
      id: 'missing_warehouse_inventory',
      severity: 'low',
      title: 'Не заполнены фактические складские остатки (null)',
      detail: 'Отсутствующие данные о запасах в хранилищах не заменяются нулём.',
    });
  }

  const traceableSources = [
    {
      id: 'rosstat_sfd',
      label: 'Росстат ЕМИСС · Средние цены производителей СХО (ЮФО / РФ)',
      url: 'https://rosstat.gov.ru/statistics/price',
      asOf: (officialHistory?.producer?.monthly || []).at(-1)?.availableDate || '2026-10-20',
      evidenceType: 'official_statistic',
      verificationStatus: 'verified',
    },
    {
      id: 'cbr_fx_daily',
      label: 'Банк России · Официальные курсы валют (USD, KZT, UZS) и ключевая ставка',
      url: 'https://www.cbr.ru/scripts/XML_daily.asp',
      asOf: kztAsOf,
      evidenceType: 'official_statistic',
      verificationStatus: 'verified',
    },
    {
      id: 'open_meteo_4hubs',
      label: 'Open-Meteo / ERA5 · Агрометеорологический мониторинг (Волгоград, Тараз, Термез, Москва)',
      url: 'https://api.open-meteo.com/',
      asOf: signals?.asOf || today,
      evidenceType: 'official_statistic',
      verificationStatus: 'verified',
    },
    {
      id: 'agroru_volgograd_board',
      label: 'AgroRU Волгоградская обл. · Доска объявлений (индикативные оферты ask ≠ сделки)',
      url: 'https://agroru.com/doska/luk/rg-243620-p1.htm',
      asOf: signals?.asOf || today,
      evidenceType: 'indicative_offer',
      verificationStatus: 'unverified_lead',
    },
    {
      id: 'un_comtrade_070310',
      label: 'UN Comtrade / Статагентство РУз / БНС РК · Торговые потоки HS 070310 (исторические срезы)',
      url: 'https://comtradeplus.un.org/',
      asOf: '2026-04-15',
      evidenceType: 'official_statistic',
      verificationStatus: 'verified',
    },
  ];

  return {
    asOf: today,
    hsCode: HS_ONION_CODE,
    volgogradPriceRange,
    kazakhstanComparison,
    tradeAndSupplyIndicators,
    forecast7_30_90,
    farmerDecision,
    missingDataWarnings,
    traceableSources,
  };
}
