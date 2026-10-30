/** Level calibration of the national producer benchmark to the user's OWN verified prices.
 *
 * This is a transparent ratio (user price / national price), not a retrained model:
 *  - each calendar month of user prices is reduced to its median first, so many entries in one
 *    month do not outweigh other months;
 *  - a month is compared with the national value of the SAME month when Rosstat has published it;
 *  - otherwise (the national figure is not out yet) it is compared with the latest national month
 *    if that is at most `maxGapMonths` earlier, and flagged as approximate;
 *  - the result is the median log-ratio over months, with its spread and sample size.
 * Few months mean a weak anchor; the caller must show `n`, `approx` and `spread`.
 */
const HEADER = 'observation_date,retrieved_date,kind,market,geography,price,unit,vat,vat_rate,delivery_basis,grade,size_mm,packaging,lot_size_t,payment_terms,volume_t,source,source_ref,published_date,notes,verification_status,verified_by,verified_at';
export const USER_PRICE_MARKETS = {
  warehouse: {market: 'warehouse_volgograd', geo: 'Волгоградская обл.', delivery: 'EXW', vat: 'excl', label: 'Склад, Волгоград (EXW)'},
  moscow: {market: 'moscow_wholesale', geo: 'Москва', delivery: 'DAP', vat: 'incl', label: 'Опт, Москва (с доставкой)'},
};
export function buildUserPriceCsv(entries, verifiedAt) {
  const rows = entries.map(e => {
    const m = USER_PRICE_MARKETS[e.basis];
    return [e.date, e.date, 'transaction', m.market, `"${m.geo}"`, Number(e.price), 'RUB/kg', e.vat, '0.10', m.delivery, '', '', '', '', '', '', 'Собственная сделка (ввод в приложении)', `entry-${e.date}-${e.basis}-${Number(e.price)}`, e.date, '', 'verified', 'Пользователь (ввод в приложении)', verifiedAt].join(',');
  });
  return [HEADER, ...rows].join('\n');
}

const monthNum = p => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
const median = a => { const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** @param points [{week:'YYYY-MM-DD', value}] user weekly prices (ex-VAT)  @param national [{period, value}] */
export function localBasis(points, national, {maxGapMonths = 2} = {}) {
  if (!points?.length || !national?.length) return null;
  const nat = new Map(national.map(r => [r.period, r.value]));
  const last = national.reduce((a, b) => (a.period > b.period ? a : b));
  const byMonth = new Map();
  for (const p of points) {
    if (!(p.value > 0)) continue;
    const m = p.week.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(p.value);
  }
  const ratios = [];
  let approx = 0;
  for (const [m, vals] of byMonth) {
    const user = median(vals);
    let ref = nat.get(m), isApprox = false;
    if (ref === undefined) {
      const gap = monthNum(m) - monthNum(last.period);
      if (gap < 1 || gap > maxGapMonths) continue;
      ref = last.value; isApprox = true;
    }
    if (!(ref > 0)) continue;
    ratios.push({month: m, user, ref, log: Math.log(user / ref), approx: isApprox});
    if (isApprox) approx++;
  }
  if (!ratios.length) return null;
  const logs = ratios.map(r => r.log), med = median(logs);
  return {
    n: ratios.length, approx, factor: Math.exp(med),
    spread: median(logs.map(l => Math.abs(l - med))), // median absolute deviation of log-ratios
    strength: ratios.length >= 6 ? 'calibrated' : ratios.length >= 3 ? 'weak' : 'anchor',
    months: ratios,
  };
}
export function applyBasis(row, basis) {
  if (!basis || !row || !Number.isFinite(row.point)) return null;
  const f = basis.factor, band = b => b ? {lo: b.lo * f, hi: b.hi * f} : null;
  return {point: row.point * f, interval80: band(row.interval80)};
}
