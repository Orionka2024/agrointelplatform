/**
 * Weekly series construction from observations with point-in-time filtering.
 *
 * Leakage control: a forecast issued on `asOf` may only use observations whose AVAILABLE date is
 * <= asOf, where availableDate = published_date if known, otherwise observation_date + publishLagDays.
 * `retrieved_date` is deliberately not used for point-in-time filtering, because historical data
 * bulk-imported today would otherwise be invisible to every historical backtest origin.
 * (If you know when each price became public, supply published_date.)
 */
import { weekStart, addWeeks, weeksBetween, daysBetween } from './dates.js';
import { availableDate } from './observations.js';
import { TARGET_SPECS } from './spec.js';

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {object[]} observations stored price observations
 * @param {{basis:'warehouse'|'moscow', kind?:string, asOf?:string, publishLagDays?:number,
 *          excludeOutliers?:boolean, spec?:object}} opts
 * @returns {{points:{week:string,value:number,n:number,sources:string[]}[], excluded:object, used:number}}
 */
export function buildWeeklySeries(observations, opts) {
  const { basis, kind = 'transaction', asOf = null, publishLagDays = 0, excludeOutliers = true } = opts;
  const target = TARGET_SPECS[basis];
  if (!target) throw new Error(`Unknown basis ${basis}`);
  const specFields = opts.spec?.fields || target.fields;
  const excluded = { notAvailableYet: 0, vatUnknown: 0, basisMismatch: 0, outlier: 0, specMismatch: 0, otherMarketOrKind: 0 };
  let specUnknown = 0;
  const buckets = new Map();
  const usedIds = [];
  for (const o of observations) {
    if (o.market !== target.market || o.kind !== kind) { excluded.otherMarketOrKind++; continue; }
    if (asOf && availableDate(o, publishLagDays) > asOf) { excluded.notAvailableYet++; continue; }
    if (o.priceExVatRubKg == null) { excluded.vatUnknown++; continue; }
    if (!target.deliveryBasis.includes(o.deliveryBasis)) { excluded.basisMismatch++; continue; }
    if (excludeOutliers && o.quality?.outlier) { excluded.outlier++; continue; }
    // Spec match: only enforced when BOTH the target field is set and the observation states it.
    let mismatch = false;
    for (const key of ['grade', 'packaging']) {
      const want = specFields[key]?.value;
      const have = o.spec?.[key];
      if (want && have && String(want).toLowerCase() !== String(have).toLowerCase()) mismatch = true;
      if (want && !have) specUnknown++;
    }
    if (mismatch) { excluded.specMismatch++; continue; }
    const wk = weekStart(o.observationDate);
    if (!buckets.has(wk)) buckets.set(wk, []);
    buckets.get(wk).push(o);
    usedIds.push(o.id);
  }
  const points = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, list]) => ({
      week,
      value: median(list.map(o => o.priceExVatRubKg)),
      n: list.length,
      sources: [...new Set(list.map(o => o.source))].sort(),
    }));
  return { points, excluded: { ...excluded, specUnknown }, used: usedIds.length, usedIds: usedIds.sort() };
}

export function pointsToMap(points) {
  return new Map(points.map(p => [p.week, p.value]));
}

/** Value at a week or nearest within ±tol weeks (preferring exact). */
export function valueNear(map, week, tol = 1) {
  if (map.has(week)) return map.get(week);
  for (let d = 1; d <= tol; d++) {
    const a = map.get(addWeeks(week, -d));
    const b = map.get(addWeeks(week, d));
    if (a !== undefined && b !== undefined) return (a + b) / 2;
    if (a !== undefined) return a;
    if (b !== undefined) return b;
  }
  return undefined;
}

/** Summary of series coverage used for sufficiency checks and the UI. */
export function describeSeries(points) {
  if (!points.length) return { n: 0, firstWeek: null, lastWeek: null, spanWeeks: 0, gaps: 0 };
  const first = points[0].week;
  const last = points[points.length - 1].week;
  const span = weeksBetween(first, last) + 1;
  return { n: points.length, firstWeek: first, lastWeek: last, spanWeeks: span, gaps: span - points.length };
}

export function ageDays(week, asOf) {
  return daysBetween(week, asOf);
}
