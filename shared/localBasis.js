/** Seasonal month-of-year local basis curve B(m) = local price / national price (P1-1 / F-05).
 *
 * Replaces the single static scalar ratio with hierarchical shrinkage across calendar months m = 1..12:
 *  - Starts from a seasonal prior curve B_prior(m) (sourced from regional series when available, or
 *    Southern Russia harvest-to-storage seasonal profile with wide uncertainty labelled "no regional prior"
 *    when no regional series is ingested yet).
 *  - Updates each calendar month with verified user transactions weighted by lot size and recency,
 *    with Winsorized bounds [0.65, 1.15] so a single noisy/distressed lot cannot collapse the curve.
 *  - Months with no user data shrink toward the prior and neighbouring calendar months via circular kernel.
 *  - Propagates basis uncertainty sigma_basis(m) into localized 80% forecast intervals.
 */
const HEADER = 'observation_date,retrieved_date,kind,market,geography,price,unit,vat,vat_rate,delivery_basis,grade,size_mm,packaging,lot_size_t,payment_terms,volume_t,source,source_ref,published_date,notes,verification_status,verified_by,verified_at';
export const USER_PRICE_MARKETS = {
  warehouse: {market: 'warehouse_volgograd', geo: 'Волгоградская обл.', delivery: 'EXW', vat: 'excl', label: 'Склад, Волгоград (EXW)'},
  moscow: {market: 'moscow_wholesale', geo: 'Москва', delivery: 'DAP', vat: 'incl', label: 'Опт, Москва (с доставкой)'},
};
const LISTING_GUARD_RE = /(agroru|agro\.ru|agroserver|агросервер|avito|авито|food\s*star|доск[аи]|оферт|объявлен|listing|classified|spot[-_]?ask|unverified[-_]?ask)/i;

export const BASIS_WINSOR_MIN = 0.65;
export const BASIS_WINSOR_MAX = 1.15;

// Southern Russia / Volgograd EXW seasonal prior B_prior(m):
// Field/shed harvest discount in Aug-Oct (~0.70-0.74), narrowing through winter into cold-storage spring parity (~0.94).
export const VOLGOGRAD_SEASONAL_PRIOR_CURVE = {
  1: 0.89,
  2: 0.92,
  3: 0.94,
  4: 0.95,
  5: 0.94,
  6: 0.92,
  7: 0.85,
  8: 0.74,
  9: 0.70,
  10: 0.72,
  11: 0.76,
  12: 0.84,
};

export function buildUserPriceCsv(entries, verifiedAt) {
  const rows = entries.map(e => {
    if (
      e?.sourceType === 'listing' ||
      e?.isListing ||
      e?.sessionOnly ||
      (e?.kind && e.kind !== 'transaction') ||
      LISTING_GUARD_RE.test(`${e?.source || ''} ${e?.source_ref || ''} ${e?.notes || ''}`)
    ) {
      throw new Error('Оферта с доски объявлений (unverified ask / listing) не может быть записана как подтверждённая сделка');
    }
    const m = USER_PRICE_MARKETS[e.basis];
    const geo = String(e.region || e.geography || m.geo).replace(/"/g, '""');
    const delivery = String(e.deliveryBasis || e.deliveryTerms || m.delivery).toUpperCase();
    const grade = e.grade ? `"${String(e.grade).replace(/"/g, '""')}"` : '';
    const sizeMm = e.sizeMm || e.caliber || '';
    const packaging = e.packaging ? `"${String(e.packaging).replace(/"/g, '""')}"` : '';
    const lotSizeT = e.lotSizeT ?? e.volumeT ?? '';
    const paymentTerms = e.paymentTerms ? `"${String(e.paymentTerms).replace(/"/g, '""')}"` : '';
    const notes = e.buyerType ? `"Покупатель: ${e.buyerType}"` : '';
    return [
      e.date,
      e.date,
      'transaction',
      m.market,
      `"${geo}"`,
      Number(e.price),
      'RUB/kg',
      e.vat,
      '0.10',
      delivery,
      grade,
      sizeMm,
      packaging,
      lotSizeT,
      paymentTerms,
      lotSizeT,
      'Собственная сделка (ввод в приложении)',
      `entry-${e.date}-${e.basis}-${Number(e.price)}`,
      e.date,
      notes,
      'verified',
      'Пользователь (ввод в приложении)',
      verifiedAt,
    ].join(',');
  });
  return [HEADER, ...rows].join('\n');
}

export function applySpotAskPreview(priceExVat, { today = null, basis = 'warehouse' } = {}) {
  const num = Number(priceExVat);
  if (!(num > 0)) return null;
  return {
    basis,
    date: today,
    priceExVat: num,
    vat: 'excl',
    kind: 'unverified_ask',
    verification_status: 'unverified',
    sessionOnly: true,
    persisted: false,
    label: `Предпросмотр оферты ask (${num.toFixed(1)} ₽/кг без НДС · unverified ask, не сделка, только сессия)`,
  };
}

const monthNum = p => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
const calMonthOf = p => Number(String(p).slice(5, 7));
const median = a => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const circularMonthDist = (m1, m2) => {
  const d = Math.abs(m1 - m2);
  return Math.min(d, 12 - d);
};

function buildPriorCurve(nationalMap, regionalSeries) {
  const hasRegional = Array.isArray(regionalSeries) && regionalSeries.length > 0;
  const priorCurve = { ...VOLGOGRAD_SEASONAL_PRIOR_CURVE };
  if (hasRegional) {
    const byCalMonth = new Map();
    for (const r of regionalSeries) {
      const ref = nationalMap.get(r.period);
      if (!(r.value > 0) || !(ref > 0)) continue;
      const cm = calMonthOf(r.period);
      if (!byCalMonth.has(cm)) byCalMonth.set(cm, []);
      byCalMonth.get(cm).push(clamp(r.value / ref, BASIS_WINSOR_MIN, BASIS_WINSOR_MAX));
    }
    for (let m = 1; m <= 12; m++) {
      const vals = byCalMonth.get(m);
      if (vals && vals.length > 0) {
        const emp = median(vals);
        const w = vals.length / (vals.length + 2);
        priorCurve[m] = clamp( Math.exp(w * Math.log(emp) + (1 - w) * Math.log(priorCurve[m])), BASIS_WINSOR_MIN, BASIS_WINSOR_MAX );
      }
    }
  }
  return {
    priorCurve,
    priorStatus: hasRegional ? 'regional_series_prior' : 'no regional prior',
    priorSigma0: hasRegional ? 0.10 : 0.16,
  };
}

/**
 * @param points [{week:'YYYY-MM-DD', value, lotSizeT?}] user weekly prices (ex-VAT)
 * @param national [{period, value}]
 * @param options {maxGapMonths?: number, regionalSeries?: Array<{period:string, value:number}>}
 */
export function localBasis(points, national, { maxGapMonths = 2, regionalSeries = null } = {}) {
  if (!points?.length || !national?.length) return null;
  const nat = new Map(national.map(r => [r.period, r.value]));
  const last = national.reduce((a, b) => (a.period > b.period ? a : b));
  const byMonth = new Map();
  const txRecords = [];

  for (const p of points) {
    if (!(p.value > 0)) continue;
    const m = p.week.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(p.value);

    let ref = nat.get(m);
    let isApprox = false;
    if (ref === undefined) {
      const gap = monthNum(m) - monthNum(last.period);
      if (gap < 1 || gap > maxGapMonths) continue;
      ref = last.value;
      isApprox = true;
    }
    if (ref > 0) {
      const lotSizeT = Number(p.lotSizeT ?? p.volumeT ?? 20);
      const lotWeight = clamp((Number.isFinite(lotSizeT) && lotSizeT > 0 ? lotSizeT : 20) / 20, 0.5, 3.0);
      txRecords.push({
        period: m,
        calMonth: calMonthOf(m),
        monthIdx: monthNum(m),
        value: p.value,
        ref,
        rawRatio: p.value / ref,
        winsorRatio: clamp(p.value / ref, BASIS_WINSOR_MIN, BASIS_WINSOR_MAX),
        lotWeight,
        approx: isApprox,
      });
    }
  }

  const ratios = [];
  let approx = 0;
  for (const [m, vals] of byMonth) {
    const user = median(vals);
    let ref = nat.get(m), isApprox = false;
    if (ref === undefined) {
      const gap = monthNum(m) - monthNum(last.period);
      if (gap < 1 || gap > maxGapMonths) continue;
      ref = last.value;
      isApprox = true;
    }
    if (!(ref > 0)) continue;
    ratios.push({ month: m, user, ref, log: Math.log(user / ref), approx: isApprox });
    if (isApprox) approx++;
  }
  if (!ratios.length) return null;

  const logs = ratios.map(r => r.log);
  const med = median(logs);
  const spread = median(logs.map(l => Math.abs(l - med)));

  // Hierarchical shrinkage across calendar months m = 1..12
  const { priorCurve, priorStatus, priorSigma0 } = buildPriorCurve(nat, regionalSeries);
  const maxMonthIdx = Math.max(...txRecords.map(t => t.monthIdx));
  const tau0 = 2.5; // Prior precision
  const kernelLambda = 1.25; // Neighbouring month smoothing scale (in months)

  const curve = {};
  const uncertaintyCurve = {};

  for (let m = 1; m <= 12; m++) {
    const logPrior = Math.log(priorCurve[m]);
    let weightedDeltaSum = 0;
    let totalEffectiveWeight = 0;

    for (const tx of txRecords) {
      const ageMonths = Math.max(0, maxMonthIdx - tx.monthIdx);
      const recencyWeight = Math.exp(-ageMonths / 6.0);
      const dist = circularMonthDist(m, tx.calMonth);
      const kernelWeight = Math.exp(-dist / kernelLambda);
      const w = tx.lotWeight * recencyWeight * kernelWeight;
      const logObsPrior = Math.log(priorCurve[tx.calMonth]);
      const delta = Math.log(tx.winsorRatio) - logObsPrior;
      weightedDeltaSum += w * delta;
      totalEffectiveWeight += w;
    }

    const postLog = logPrior + weightedDeltaSum / (tau0 + totalEffectiveWeight);
    curve[m] = +clamp(Math.exp(postLog), BASIS_WINSOR_MIN, BASIS_WINSOR_MAX).toFixed(4);
    const postSigma = priorSigma0 / Math.sqrt(1 + totalEffectiveWeight / tau0);
    uncertaintyCurve[m] = +Math.max(0.025, postSigma + spread * 0.25).toFixed(4);
  }

  const observedMonthsList = [...new Set(ratios.map(r => r.month))].sort();
  const txCount = txRecords.length;
  const labelEn = `calibrated on ${txCount} transactions in months ${observedMonthsList.join(', ')}; other months use the prior (${priorStatus})`;
  const labelRu = `Калибровано по ${txCount} сделкам в мес. ${observedMonthsList.join(', ')}; остальные месяцы используют априор (${priorStatus === 'no regional prior' ? 'без регионального ряда Росстата' : 'региональный ряд ЮФО'}) — ${labelEn}`;

  return {
    n: ratios.length,
    transactionCount: txCount,
    approx,
    factor: Math.exp(med),
    spread,
    strength: ratios.length >= 6 ? 'calibrated' : ratios.length >= 3 ? 'weak' : 'anchor',
    months: ratios,
    observedMonths: observedMonthsList,
    curve,
    priorCurve,
    priorStatus,
    uncertaintyCurve,
    label: labelRu,
    labelEn,
    basisForMonth(periodOrMonth) {
      const cm = typeof periodOrMonth === 'number' ? periodOrMonth : calMonthOf(periodOrMonth);
      return curve[cm] ?? Math.exp(med);
    },
  };
}

/**
 * Applies local basis to a national forecast row.
 * - When `row.targetMonth` (or `options.targetMonth`) is present, uses the seasonal curve B(m)
 *   and widens `interval80` by the basis uncertainty variance term.
 * - When called on a bare `{point, interval80}` without targetMonth (legacy scalar test), uses `basis.factor`.
 */
export function applyBasis(row, basis, options = {}) {
  if (!basis || !row || !Number.isFinite(row.point)) return null;
  const targetMonth = row.targetMonth || row.month || options.targetMonth || null;
  const cm = targetMonth ? calMonthOf(targetMonth) : null;
  const useSeasonal = Boolean(cm && basis.curve && basis.curve[cm] !== undefined);
  const f = useSeasonal ? basis.curve[cm] : basis.factor;
  const basisSigma = useSeasonal ? (basis.uncertaintyCurve?.[cm] ?? 0) : (options.propagateUncertainty ? (basis.spread || 0.08) : 0);

  const band = b => {
    if (!b || !Number.isFinite(b.lo) || !Number.isFinite(b.hi)) return null;
    if (!(basisSigma > 0)) {
      return { lo: b.lo * f, hi: b.hi * f };
    }
    // Widen 80% interval in log space by combining forecast log half-width and basis uncertainty (z_80 = 1.28155)
    const z80 = 1.28155;
    const pt = Math.max(0.01, row.point);
    const loClamped = Math.max(0.01, b.lo);
    const hiClamped = Math.max(pt, b.hi);
    const fcDeltaLo = Math.max(0, Math.log(pt) - Math.log(loClamped));
    const fcDeltaHi = Math.max(0, Math.log(hiClamped) - Math.log(pt));
    const basisHalfWidth80 = z80 * basisSigma;
    const totalDeltaLo = Math.sqrt(fcDeltaLo * fcDeltaLo + basisHalfWidth80 * basisHalfWidth80);
    const totalDeltaHi = Math.sqrt(fcDeltaHi * fcDeltaHi + basisHalfWidth80 * basisHalfWidth80);
    const localPoint = row.point * f;
    return {
      lo: +(localPoint * Math.exp(-totalDeltaLo)).toFixed(2),
      hi: +(localPoint * Math.exp(totalDeltaHi)).toFixed(2),
      basisSigma,
      widenedByBasisVariance: true,
    };
  };

  return {
    point: row.point * f,
    factorUsed: f,
    targetMonth: targetMonth || null,
    interval80: band(row.interval80),
  };
}

/**
 * Synthetic seasonal backtest (P1-1 / F-05):
 * True basis is ~0.71 in autumn (Sep/Oct) and 0.94 in spring (March).
 * Compares the legacy static scalar ratio (-24.8% March error) against the seasonal hierarchical shrinkage curve B(m),
 * and evaluates robustness against a single noisy/distressed autumn transaction (9.50 RUB/kg, n=1).
 */
export function runSeasonalBasisBacktest() {
  const national = [
    { period: '2026-09', value: 18.12 },
    { period: '2026-10', value: 18.12 },
  ];
  const autumnPoints = [
    { week: '2026-09-14', value: 12.56, lotSizeT: 20 },
    { week: '2026-10-12', value: 13.05, lotSizeT: 20 },
  ];
  const rfMarch = 24.05;
  const trueSpringBasis = 0.94;
  const trueMarchLocal = +(rfMarch * trueSpringBasis).toFixed(2); // 22.61 RUB/kg

  const cal = localBasis(autumnPoints, national);
  const oldStaticMarchPred = +(rfMarch * cal.factor).toFixed(2); // 16.99 RUB/kg
  const oldStaticErrorRub = +(oldStaticMarchPred - trueMarchLocal).toFixed(2); // -5.62 RUB/kg
  const oldStaticErrorPct = +(((oldStaticMarchPred - trueMarchLocal) / trueMarchLocal) * 100).toFixed(1); // -24.8%

  const newSeasonalMarchPred = +applyBasis({ targetMonth: '2027-03', point: rfMarch }, cal).point.toFixed(2);
  const newSeasonalErrorRub = +(newSeasonalMarchPred - trueMarchLocal).toFixed(2);
  const newSeasonalErrorPct = +(((newSeasonalMarchPred - trueMarchLocal) / trueMarchLocal) / 1 * 100).toFixed(2);

  // Sparse / noisy test: single distressed lot at 9.50 RUB/kg in October (n = 1)
  const baselinePriorMarch = +(rfMarch * VOLGOGRAD_SEASONAL_PRIOR_CURVE[3]).toFixed(2);
  const noisyCal = localBasis([{ week: '2026-10-12', value: 9.50, lotSizeT: 20 }], national);
  const noisyMarchPred = +applyBasis({ targetMonth: '2027-03', point: rfMarch }, noisyCal).point.toFixed(2);
  const noisySingleEntryShiftPct = +(((noisyMarchPred - baselinePriorMarch) / baselinePriorMarch) * 100).toFixed(2);

  return {
    trueAutumnBasis: 0.71,
    trueSpringBasis,
    rfMarch,
    trueMarchLocal,
    oldStaticMarchPred,
    oldStaticErrorRub,
    oldStaticErrorPct,
    newSeasonalMarchPred,
    newSeasonalErrorRub,
    newSeasonalErrorPct,
    noisyMarchPred,
    noisySingleEntryShiftPct,
  };
}
