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

export function evaluateStorage(pNow, pFuture, params) {
  const v = validateStorageParams(params);
  if (!v.ok) return { status: 'incomplete', missing: v.missing, invalid: v.invalid };
  if (!Number.isFinite(pNow) || pNow <= 0) return { status: 'invalid_input', reason: 'Цена продажи сейчас должна быть > 0' };
  if (!Number.isFinite(pFuture) || pFuture <= 0) return { status: 'invalid_input', reason: 'Будущая цена должна быть > 0' };
  const P = Object.fromEntries(STORAGE_REQUIRED.map(k => [k, Number(params[k])]));
  const saleableYield = (1 - P.shrinkPct / 100) * (1 - P.rotPct / 100);
  const gradeFactor = 1 - (P.downgradeSharePct / 100) * (P.downgradeDiscountPct / 100);
  const realisation = saleableYield * pFuture * gradeFactor;
  const energy = P.energyRubKgMonth * P.months;
  const sorting = P.sortingRubKgSold * saleableYield;
  const financing = pNow * (P.financingRatePctYear / 100) * (P.months / 12);
  const costsLater = energy + P.handlingRubKg + sorting + financing;
  const netLaterPerKgStored = realisation - costsLater;
  const netNowPerKgStored = pNow - P.sellNowCostRubKg;
  const gain = netLaterPerKgStored - netNowPerKgStored;
  const denom = saleableYield * gradeFactor;
  const fixedLater = energy + P.handlingRubKg + sorting + financing;
  const breakEvenFuturePrice = denom > 0 ? (netNowPerKgStored + fixedLater) / denom : null;
  const out = {
    status: 'ok',
    saleableYield, kgSoldPerKgStored: saleableYield,
    components: { realisation, energy, handling: P.handlingRubKg, sorting, financing },
    costsLater, netLaterPerKgStored, netLaterPerKgSold: saleableYield > 0 ? netLaterPerKgStored / saleableYield : null,
    netNowPerKgStored, gain, breakEvenFuturePrice,
    breakEvenMarkupPct: breakEvenFuturePrice ? (breakEvenFuturePrice / pNow - 1) * 100 : null,
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
export function storageAtHorizon(params, months) {
  const reference = Number(params.referenceMonths ?? params.months);
  if (!(reference > 0) || !(months >= 0)) return { ...params, months, shrinkPct: null, rotPct: null };
  const scale = pct => 100 * (1 - Math.pow(1 - Number(pct) / 100, months / reference));
  return { ...params, months, shrinkPct: scale(params.shrinkPct), rotPct: scale(params.rotPct), downgradeSharePct: scale(params.downgradeSharePct) };
}
