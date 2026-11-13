/**
 * Storage economics: sell now vs store and sell later, on consistent quantities and costs.
 *
 * Quantity bases (explicit):
 *   per kg STORED   — one kg physically put into storage on day 0 (the decision unit)
 *   per kg SOLD     — one kg actually sold after losses
 *
 *   saleableYield   = (1 − shrinkPct)(1 − rotPct)            (losses compound, they do not simply add)
 *   kgSold          = saleableYield                          per kg stored
 *   realisation     = kgSold × P_future × (1 − downgradeShare × downgradeDiscount)
 *   costs (per kg stored): energy×months + handling + sorting×kgSold + financing
 *   financing       = P_now × annualRate × months/12         (opportunity cost of cash not received today)
 *   netLater        = realisation − costs
 *   netNow          = P_now − sellNowCost
 *   gain            = netLater − netNow                      (the decision metric)
 *
 * Acquisition / production cost is SUNK for this decision. It is reported separately
 * (profit vs cost) and never enters the gain; the opportunity cost of selling today is netNow.
 * All prices are ex-VAT RUB/kg on the same basis (warehouse, EXW).
 *
 * No "best week" is chosen: the caller sees break-even prices and sensitivities.
 */

export const STORAGE_REQUIRED = [
  'months', 'shrinkPct', 'rotPct', 'downgradeSharePct', 'downgradeDiscountPct',
  'energyRubKgMonth', 'handlingRubKg', 'sortingRubKgSold', 'financingRatePctYear', 'sellNowCostRubKg',
];

export const STORAGE_LABELS = {
  months: 'Срок хранения, мес.',
  shrinkPct: 'Усушка / естественная убыль, %',
  rotPct: 'Гниль, проращивание, отход, %',
  downgradeSharePct: 'Доля проданного, ушедшая в более низкий сорт, %',
  downgradeDiscountPct: 'Скидка на пониженный сорт, %',
  energyRubKgMonth: 'Энергия и содержание, ₽/кг заложенного в мес.',
  handlingRubKg: 'Закладка/выгрузка, ₽/кг заложенного',
  sortingRubKgSold: 'Сортировка / доработка, ₽/кг проданного',
  financingRatePctYear: 'Стоимость денег, % годовых',
  sellNowCostRubKg: 'Затраты продажи сейчас, ₽/кг',
  acquisitionCostRubKg: 'Себестоимость / закупка, ₽/кг (только для отчёта о прибыли)',
};

/**
 * 3-Tier Warehouse Segmentation for the Russian Onion Market:
 * 1) Unventilated temporary hangars (Жизненный цикл — до 1 декабря; сброс при заморозках)
 * 2) Insulated ventilated warehouses (Жизненный цикл — декабрь – февраль; стабильный плановый рост)
 * 3) Refrigerated cold rooms 0..+1°C (Жизненный цикл — февраль – конец марта; максимальная премия)
 */
export const STORAGE_TIERS = {
  unventilated: {
    id: 'unventilated',
    name: 'Временный ангар / без вентиляции',
    shortName: 'Без вентиляции',
    lifecycle: 'до 1 декабря',
    badge: 'Контроль микроклимата',
    badgeCls: 'warn',
    desc: 'Жизненный цикл — до 1 декабря. Риск определяется фактической температурой и влажностью внутри склада, отсутствием вентиляции и долей шейковой гнили.',
    recommendation: 'Оценить температуру и влажность внутри помещения, отсутствие активной вентиляции и качество партии (наружная температура −2°C сама по себе не является автоматическим триггером срочной распродажи).',
    priceTrendNote: 'Реализация зависит от фактического состояния партии и микроклимата внутри ангара; после января партия без вентиляции теряет товарность.',
    params: {
      tierId: 'unventilated',
      months: 1.5,
      shrinkPct: 3.5,
      rotPct: 8.0,
      downgradeSharePct: 18.0,
      downgradeDiscountPct: 25.0,
      energyRubKgMonth: 0.08,
      handlingRubKg: 0.40,
      sortingRubKgSold: 0.90,
      financingRatePctYear: 14.0,
      cbrKeyRatePctYear: 14.0,
      commercialCreditRatePctYear: 19.0,
      preferentialCreditRatePctYear: 8.0,
      sellNowCostRubKg: 0.20,
      acquisitionCostRubKg: 12.0,
      optimalTemp: '+4..+8°C (нерегулируемая)',
      optimalHumidity: '85–95% (риск конденсата)',
    },
  },
  ventilated: {
    id: 'ventilated',
    name: 'Стационарный склад с активной вентиляцией (без холода)',
    shortName: 'Вентиляция (без холода)',
    lifecycle: 'декабрь – февраль',
    badge: 'Плановые продажи',
    badgeCls: 'info',
    desc: 'Активная продувка наружным воздухом без холодильных агрегатов. Жизненный цикл — декабрь – февраль (до весеннего потепления > +4°C).',
    recommendation: 'Поддерживать режим внутри камеры (+1..+3°C, влажность 70–75%). Реализовывать партиями по мере подтверждения ставок покупателей выше точки безубыточности.',
    priceTrendNote: 'Защищён от уличных заморозков активной вентиляцией; реализует товарный фонд до прихода весеннего тепла и прорастания пера.',
    params: {
      tierId: 'ventilated',
      months: 3.5,
      shrinkPct: 5.0,
      rotPct: 3.5,
      downgradeSharePct: 8.0,
      downgradeDiscountPct: 15.0,
      energyRubKgMonth: 0.35,
      handlingRubKg: 0.50,
      sortingRubKgSold: 0.60,
      financingRatePctYear: 14.0,
      cbrKeyRatePctYear: 14.0,
      commercialCreditRatePctYear: 19.0,
      preferentialCreditRatePctYear: 8.0,
      sellNowCostRubKg: 0.20,
      acquisitionCostRubKg: 12.0,
      optimalTemp: '+1..+3°C (только зимой)',
      optimalHumidity: '70–75%',
    },
  },
  refrigerated: {
    id: 'refrigerated',
    name: 'Холодильные камеры (0..+1°C)',
    shortName: 'Холодильник (0..+1°C)',
    lifecycle: 'февраль – конец марта',
    badge: 'Максимальная премия',
    badgeCls: 'up',
    desc: 'Жизненный цикл — февраль – конец марта. Снимают максимальную весеннюю премию до прихода Узбекистана.',
    recommendation: 'Плановое хранение при 0..+1°C и влажности 65–70% с продажей по подтверждённым контрактам выше расчётного порога безубыточности.',
    priceTrendNote: 'Максимальная весенняя премия на пике истощения отечественных фондов до прихода раннего узбекского лука.',
    params: {
      tierId: 'refrigerated',
      months: 5.0,
      shrinkPct: 6.0,
      rotPct: 2.5,
      downgradeSharePct: 5.0,
      downgradeDiscountPct: 10.0,
      energyRubKgMonth: 0.65,
      handlingRubKg: 0.55,
      sortingRubKgSold: 0.50,
      financingRatePctYear: 14.0,
      cbrKeyRatePctYear: 14.0,
      commercialCreditRatePctYear: 19.0,
      preferentialCreditRatePctYear: 8.0,
      sellNowCostRubKg: 0.20,
      acquisitionCostRubKg: 12.0,
      optimalTemp: '0..+1°C',
      optimalHumidity: '65–70%',
    },
  },
};

function num(v) {
  return v === null || v === undefined || v === '' ? null : Number(v);
}

export function validateStorageParams(p) {
  const missing = [];
  const invalid = [];
  for (const k of STORAGE_REQUIRED) {
    const v = num(p?.[k]);
    if (v === null || !Number.isFinite(v)) { missing.push(k); continue; }
    if (v < 0) invalid.push(`${k}: отрицательное значение`);
    if (k.endsWith('Pct') && v > 100) invalid.push(`${k}: > 100 %`);
  }
  if (!missing.includes('shrinkPct') && !missing.includes('rotPct') && num(p.shrinkPct) >= 100) invalid.push('shrinkPct: 100 % убыли — нечего продавать');
  if (!missing.includes('rotPct') && num(p.rotPct) >= 100) invalid.push('rotPct: 100 % отхода — нечего продавать');
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

export const STANDARD_MONTH_DAYS = 30.4375;

export function daysToMonths(days) {
  const d = Number(days);
  return Number.isFinite(d) && d > 0 ? d / STANDARD_MONTH_DAYS : 0;
}

export function storageAtCalendarDays(params, holdingDays, tierId = null) {
  if (!params) return null;
  const months = daysToMonths(holdingDays);
  return storageAtHorizon(params, months, tierId);
}

export function evaluateStorage(pNow, pFuture, params) {
  const v = validateStorageParams(params);
  if (!v.ok) return { status: 'incomplete', missing: v.missing, invalid: v.invalid };
  if (!Number.isFinite(pNow) || pNow <= 0) return { status: 'invalid_input', reason: 'Цена продажи сейчас должна быть > 0' };
  if (!Number.isFinite(pFuture) || pFuture <= 0) return { status: 'invalid_input', reason: 'Будущая цена должна быть > 0' };
  const P = Object.fromEntries(STORAGE_REQUIRED.map(k => [k, Number(params[k])]));

  // 1. Physical mass balance per 1.0 kg stored
  const shrinkPct = Math.max(0, Math.min(100, P.shrinkPct));
  const rotPct = Math.max(0, Math.min(100, P.rotPct));
  const afterShrinkKg = Math.max(0, 1 - shrinkPct / 100);
  const saleableYield = afterShrinkKg * Math.max(0, 1 - rotPct / 100);
  const shrinkLossKg = 1 - afterShrinkKg;
  const rotLossKg = afterShrinkKg - saleableYield;
  const wasteKg = 1 - saleableYield;

  // 2. Commercial grade breakdown (downgrading preserves mass)
  const downgradeSharePct = Math.max(0, Math.min(100, P.downgradeSharePct));
  const downgradeDiscountPct = Math.max(0, Math.min(100, P.downgradeDiscountPct));
  const downgradeShare = downgradeSharePct / 100;
  const grade1Kg = saleableYield * (1 - downgradeShare);
  const grade2Kg = saleableYield * downgradeShare;
  const gradeFactor = 1 - downgradeShare * (downgradeDiscountPct / 100);
  const grade2PriceRubKg = params.grade2PriceRubKg !== undefined && Number.isFinite(Number(params.grade2PriceRubKg))
    ? Number(params.grade2PriceRubKg)
    : pFuture * (1 - downgradeDiscountPct / 100);
  const realisation = saleableYield > 0
    ? (params.grade2PriceRubKg !== undefined ? grade1Kg * pFuture + grade2Kg * grade2PriceRubKg : saleableYield * pFuture * gradeFactor)
    : 0;

  // 3. Explicit cost components with double-charging protection
  const energy = P.energyRubKgMonth * P.months;
  const handling = params.handlingAlreadyIncurred === true || params.handlingIncludedInPrice === true
    ? 0
    : P.handlingRubKg;
  const sorting = params.sortingAlreadyIncurred === true || params.sortingIncludedInPrice === true
    ? 0
    : P.sortingRubKgSold * saleableYield;
  const packaging = params.packagingAlreadyPaid === true || params.packagingIncludedInPrice === true || params.alreadyPackaged === true
    ? 0
    : (Number(params.packagingRubKg ?? 0)) * saleableYield;
  const wasteDisposal = (Number(params.wasteDisposalCostRubKg ?? 0)) * wasteKg;
  const byproductRevenue = (Number(params.byproductPriceRubKg ?? 0)) * wasteKg;
  const financing = pNow * (P.financingRatePctYear / 100) * (P.months / 12);
  const costsLater = energy + handling + sorting + packaging + wasteDisposal + financing - byproductRevenue;

  // 4. Sell now net & decision gain
  const sellNowCost = params.sellNowPackagingPaid === true || params.sellNowCostAlreadyIncurred === true
    ? 0
    : P.sellNowCostRubKg;
  const netNowPerKgStored = pNow - sellNowCost;
  const netLaterPerKgStored = realisation - costsLater;
  const gain = netLaterPerKgStored - netNowPerKgStored;

  // 5. Break-even future price (Pf that gives gain == 0)
  const denom = saleableYield * gradeFactor;
  const fixedLater = energy + handling + sorting + packaging + wasteDisposal + financing - byproductRevenue;
  const breakEvenFuturePrice = denom > 0 ? (netNowPerKgStored + fixedLater) / denom : null;

  const out = {
    status: 'ok',
    saleableYield,
    kgSoldPerKgStored: saleableYield,
    shrinkLossKg,
    rotLossKg,
    wasteKg,
    grade1Kg,
    grade2Kg,
    gradeFactor,
    grade2PriceRubKg,
    storageOpexRubKg: energy + handling + sorting + packaging + wasteDisposal - byproductRevenue,
    financingRubKg: financing,
    totalPhysicalLossPct: +((1 - saleableYield) * 100).toFixed(1),
    components: {
      realisation,
      energy,
      handling,
      sorting,
      packaging,
      wasteDisposal,
      byproductRevenue,
      financing,
    },
    costsLater,
    netLaterPerKgStored,
    netLaterPerKgSold: saleableYield > 0 ? netLaterPerKgStored / saleableYield : null,
    netNowPerKgStored,
    gain,
    breakEvenFuturePrice,
    breakEvenMarkupPct: breakEvenFuturePrice !== null && pNow > 0 ? (breakEvenFuturePrice / pNow - 1) * 100 : null,
  };
  const acq = num(params.acquisitionCostRubKg);
  if (acq !== null && Number.isFinite(acq) && acq >= 0) {
    out.profitReport = {
      note: 'Только отчёт: себестоимость не влияет на решение «хранить / продать».',
      profitNowPerKgStored: netNowPerKgStored - acq,
      profitLaterPerKgStored: netLaterPerKgStored - acq,
    };
  }
  return out;
}

/** Gain across total-loss levels (shrink+rot compounded) at fixed prices. */
export function lossSensitivity(pNow, pFuture, params, totalLossGrid = [0, 5, 10, 15, 20, 30]) {
  return totalLossGrid.map(totalLoss => {
    // keep rot at the user's value, solve shrink so that compounded total loss equals the grid value
    const rot = Number(params.rotPct) || 0;
    const shrink = Math.max(0, (1 - (1 - totalLoss / 100) / (1 - rot / 100)) * 100);
    const r = evaluateStorage(pNow, pFuture, { ...params, shrinkPct: shrink });
    return { totalLossPct: totalLoss, gain: r.status === 'ok' ? r.gain : null, breakEvenFuturePrice: r.status === 'ok' ? r.breakEvenFuturePrice : null };
  });
}

/**
 * Gain at alternative future prices. If the forecast has calibrated intervals they are used (labelled forecast);
 * otherwise symmetric scenario shifts are used and labelled as scenario shifts, not as a forecast distribution.
 */
export function priceSensitivity(pNow, pPoint, params, interval = null, shifts = [-20, -10, 0, 10, 20]) {
  const rows = [];
  if (interval && interval.lo95 != null && interval.hi95 != null) {
    const pts = [['нижн. 95 %', interval.lo95], ['нижн. 80 %', interval.lo80], ['точка', pPoint], ['верхн. 80 %', interval.hi80], ['верхн. 95 %', interval.hi95]];
    for (const [label, p] of pts) if (p != null) rows.push({ label, kind: 'forecast_interval', price: p });
  } else {
    for (const s of shifts) rows.push({ label: `${s > 0 ? '+' : ''}${s} %`, kind: 'scenario_shift', price: pPoint * (1 + s / 100) });
  }
  return rows.map(r => {
    const e = evaluateStorage(pNow, r.price, params);
    return { ...r, gain: e.status === 'ok' ? e.gain : null };
  });
}

export function weeksToMonths(weeks) {
  return weeks / 4.348;
}

/** Loss assumptions are totals over referenceMonths, compounded for the holding duration. */
export function storageAtHorizon(params, months, tierId = null) {
  if (!params) return null;
  const tId = tierId || params.tierId;
  const reference = Number(params.referenceMonths ?? params.months);
  if (!(reference > 0) || !(months >= 0)) return { ...params, months, shrinkPct: null, rotPct: null };
  const scale = pct => 100 * (1 - Math.pow(1 - Number(pct) / 100, months / reference));

  if (tId === 'unventilated' && months > 1.2) {
    // Unventilated storage rot increases rapidly after ~5 weeks
    const extraMonths = months - 1.2;
    const accelRot = Math.min(65, +(scale(params.rotPct) + extraMonths * 7.5).toFixed(1));
    const accelDowngrade = Math.min(80, +(scale(params.downgradeSharePct) + extraMonths * 6.0).toFixed(1));
    return {
      ...params,
      tierId: tId,
      months,
      shrinkPct: scale(params.shrinkPct),
      rotPct: accelRot,
      downgradeSharePct: accelDowngrade,
    };
  }

  if (tId === 'ventilated' && months > 3.8) {
    // Ventilated warehouse without fridge warms up in spring (> +4°C): sprouting and downgrading
    const extraMonths = months - 3.8;
    const accelRot = Math.min(35, +(scale(params.rotPct) + extraMonths * 2.5).toFixed(1));
    const accelDowngrade = Math.min(50, +(scale(params.downgradeSharePct) + extraMonths * 6.5).toFixed(1));
    return {
      ...params,
      tierId: tId,
      months,
      shrinkPct: scale(params.shrinkPct),
      rotPct: accelRot,
      downgradeSharePct: accelDowngrade,
    };
  }

  return { ...params, tierId: tId, months, shrinkPct: scale(params.shrinkPct), rotPct: scale(params.rotPct), downgradeSharePct: scale(params.downgradeSharePct) };
}
