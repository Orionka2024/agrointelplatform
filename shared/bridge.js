/**
 * Moscow-wholesale ↔ Volgograd-warehouse cost bridge.
 *
 * No fixed multiplier. Every component is explicit and user-editable; components that are not
 * provided make the bridge "incomplete" instead of silently defaulting to zero.
 *
 * All prices below are RUB/kg of SOLD product.
 *   W  warehouse price, EXW, ex-VAT, per kg bought at the warehouse
 *   ℓ  loss share between warehouse and sale (shrink, trim, rejects) — cost is carried by the seller:
 *        cost per sold kg = W/(1-ℓ)   (so the loss allowance = W/(1-ℓ) − W)
 *   M_ex   = W/(1-ℓ) + packaging + handling + freight + margin          (Moscow, delivered, ex-VAT)
 *   M_incl = M_ex × (1+vat)                                              (Moscow, delivered, incl. VAT)
 *
 * VAT is a pass-through and is excluded from the "gross geographic difference" (M_ex − W).
 * Achievable margin = M_ex − W/(1-ℓ) − packaging − handling − freight (what remains for the intermediary).
 */
import { weeksBetween } from './dates.js';

export const BRIDGE_REQUIRED = ['truckCostRub', 'truckPayloadKg', 'packagingRubKg', 'handlingRubKg', 'lossPct', 'marginRubKg', 'vatRate'];

export const BRIDGE_LABELS = {
  truckCostRub: 'Фура Волгоград–Москва, ₽ за рейс',
  truckPayloadKg: 'Загрузка фуры, кг',
  packagingRubKg: 'Фасовка / упаковка, ₽/кг',
  handlingRubKg: 'Погрузка / сортировка / разгрузка, ₽/кг',
  lossPct: 'Потери и отбраковка до продажи, % от закупленного',
  marginRubKg: 'Маржа посредника, ₽/кг',
  vatRate: 'Ставка НДС (доля)',
};

export function validateBridge(b) {
  const missing = [];
  const invalid = [];
  for (const k of BRIDGE_REQUIRED) {
    const v = b?.[k];
    if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) { missing.push(k); continue; }
    const n = Number(v);
    if (n < 0) invalid.push(`${k}: отрицательное значение`);
    if (k === 'truckPayloadKg' && n <= 0) invalid.push('truckPayloadKg: должна быть > 0');
    if (k === 'lossPct' && n >= 100) invalid.push('lossPct: должна быть < 100');
    if (k === 'vatRate' && n > 0.3) invalid.push('vatRate: ожидается доля (например 0.10)');
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

export function freightRubKg(b) {
  return Number(b.truckCostRub) / Number(b.truckPayloadKg);
}

function parts(W, b) {
  const loss = Number(b.lossPct) / 100;
  const base = W / (1 - loss);
  return {
    warehousePrice: W,
    lossAllowance: base - W,
    packaging: Number(b.packagingRubKg),
    handling: Number(b.handlingRubKg),
    freight: freightRubKg(b),
    margin: Number(b.marginRubKg),
  };
}

/** Warehouse (EXW, ex-VAT) → Moscow delivered. */
export function warehouseToMoscow(W, bridge) {
  const v = validateBridge(bridge);
  if (!v.ok) return { status: 'incomplete', missing: v.missing, invalid: v.invalid };
  if (!Number.isFinite(W) || W <= 0) return { status: 'invalid_input', reason: 'Цена склада должна быть > 0' };
  const c = parts(W, bridge);
  const moscowExVat = c.warehousePrice + c.lossAllowance + c.packaging + c.handling + c.freight + c.margin;
  return {
    status: 'ok', components: c,
    moscowExVat, moscowInclVat: moscowExVat * (1 + Number(bridge.vatRate)),
    grossDifferenceExVat: moscowExVat - W,
    achievableMargin: c.margin,
  };
}

/** Moscow delivered (incl. VAT) → implied warehouse EXW ex-VAT. */
export function moscowToWarehouse(Mincl, bridge) {
  const v = validateBridge(bridge);
  if (!v.ok) return { status: 'incomplete', missing: v.missing, invalid: v.invalid };
  if (!Number.isFinite(Mincl) || Mincl <= 0) return { status: 'invalid_input', reason: 'Цена Москвы должна быть > 0' };
  const loss = Number(bridge.lossPct) / 100;
  const Mex = Mincl / (1 + Number(bridge.vatRate));
  const W = (Mex - Number(bridge.packagingRubKg) - Number(bridge.handlingRubKg) - freightRubKg(bridge) - Number(bridge.marginRubKg)) * (1 - loss);
  if (W <= 0) return { status: 'infeasible', reason: 'Издержки и маржа превышают цену Москвы — склад не определён', warehouseExVat: W };
  return { status: 'ok', warehouseExVat: W, moscowExVat: Mex, grossDifferenceExVat: Mex - W };
}

/** Margin that actually remains given an observed warehouse and Moscow price (both ex-VAT). */
export function impliedMargin(W, MexVat, bridge) {
  const v = validateBridge({ ...bridge, marginRubKg: 0 });
  if (!v.ok) return { status: 'incomplete', missing: v.missing };
  const c = parts(W, bridge);
  return { status: 'ok', grossDifference: MexVat - W, impliedMargin: MexVat - c.warehousePrice - c.lossAllowance - c.packaging - c.handling - c.freight };
}

/**
 * Empirical gross difference (Moscow ex-VAT − warehouse ex-VAT) from matched weekly observations.
 * Needs >= minPairs weeks present in both series, otherwise returns null (use the explicit bridge).
 */
export function estimateDifferenceFromMatched(warehousePoints, moscowPoints, { minPairs = 12, maxPairs = 104 } = {}) {
  const mMap = new Map(moscowPoints.map(p => [p.week, p.value]));
  const pairs = warehousePoints.filter(p => mMap.has(p.week)).map(p => ({ week: p.week, diff: mMap.get(p.week) - p.value }));
  if (pairs.length < minPairs) return { status: 'insufficient', nPairs: pairs.length, minPairs };
  const recent = pairs.slice(-maxPairs);
  const d = recent.map(p => p.diff).sort((a, b) => a - b);
  const q = f => d[Math.min(d.length - 1, Math.max(0, Math.floor(f * (d.length - 1))))];
  return {
    status: 'ok', nPairs: recent.length, firstWeek: recent[0].week, lastWeek: recent[recent.length - 1].week,
    medianDiff: q(0.5), p25: q(0.25), p75: q(0.75),
    ageWeeksOfLast: null,
  };
}

export { weeksBetween };
