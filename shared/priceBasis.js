/**
 * Separated Price Basis Storage & Paired Wholesale/Retail Ratio (Task 2)
 *
 * Strictly separates:
 *  - Calibration series: Rosstat EXW ex-VAT monthly producer prices (national/regional average)
 *  - Target series: Wholesale quotes/transactions for grade 5+ cm in lots >= 20 tonnes
 *
 * Never mixes the two series. Every record preserves explicit basis metadata:
 * { grade, lotSizeT, vat, deliveryTerms, region, date, source }.
 */

import { isVerified } from './observations.js';

const GRADE_5_PLUS_RE = /(5\+|6\+|50\s*мм|50\+|1\s*сорт|ГОСТ\s*34306)/i;

export function isTargetGrade5PlusLot20Plus(obs) {
  if (!obs) return false;
  const lotSizeT = Number(obs.spec?.lotSizeT ?? obs.lotSizeT ?? obs.volumeT);
  if (!Number.isFinite(lotSizeT) || lotSizeT < 20) return false;
  const gradeText = `${obs.spec?.sizeMm || ''} ${obs.spec?.grade || ''} ${obs.caliber || ''} ${obs.grade || ''}`;
  return GRADE_5_PLUS_RE.test(gradeText);
}

/**
 * Normalizes Rosstat EXW ex-VAT series as the calibration series.
 */
export function buildCalibrationSeries(officialMonthly = [], { region = 'РФ (Росстат)', source = 'Росстат СХО (OKPD2 01.13.43)' } = {}) {
  return (officialMonthly || [])
    .filter((r) => r && Number.isFinite(Number(r.value)) && Number(r.value) > 0)
    .map((r) => ({
      seriesRole: 'calibration',
      priceExVat: +Number(r.value).toFixed(2),
      grade: 'Агрегат СХО (все сорта)',
      lotSizeT: null,
      vat: 'excl',
      deliveryTerms: 'EXW',
      region: r.region || region,
      date: r.period ? `${r.period}-15` : r.date,
      period: r.period || null,
      source: r.sourceId || source,
    }));
}

/**
 * Extracts target wholesale series strictly for grade 5+ cm and lots >= 20 tonnes.
 */
export function buildTargetWholesaleSeries(observations = []) {
  return (observations || [])
    .filter((o) => isVerified(o) && !o.quality?.outlier && isTargetGrade5PlusLot20Plus(o))
    .map((o) => ({
      seriesRole: 'target',
      id: o.id,
      priceExVat: +(o.priceExVatRubKg ?? o.priceRubKg).toFixed(2),
      priceRubKg: +o.priceRubKg.toFixed(2),
      grade: o.spec?.sizeMm ? `${o.spec?.grade || '1 сорт'} (${o.spec.sizeMm})` : (o.spec?.grade || '5+ см'),
      lotSizeT: Number(o.spec?.lotSizeT ?? o.volumeT),
      vat: o.vat || 'excl',
      deliveryTerms: o.deliveryBasis || 'EXW',
      region: o.geography || 'Волгоградская обл.',
      date: o.observationDate,
      source: o.source,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function summarizeRatios(ratios) {
  if (!ratios.length) {
    return {
      available: false,
      n: 0,
      min: null,
      p25: null,
      median: null,
      p75: null,
      max: null,
      rangeText: 'Недостаточно парных данных',
    };
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  const q = (p) => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
    return +sorted[idx].toFixed(3);
  };
  const min = q(0);
  const p25 = q(0.25);
  const median = q(0.5);
  const p75 = q(0.75);
  const max = q(1);
  return {
    available: true,
    n: sorted.length,
    min,
    p25,
    median,
    p75,
    max,
    rangeText: `${(p25 * 100).toFixed(1)}%–${(p75 * 100).toFixed(1)}% (IQR, медиана ${(median * 100).toFixed(1)}%, диапазон ${(min * 100).toFixed(1)}%–${(max * 100).toFixed(1)}%)`,
  };
}

/**
 * Computes wholesale / retail ratio as a range from date-paired observations (+/- 7 days).
 */
export function computeWholesaleRetailRatioRange(wholesaleSeries = [], retailWeekly = []) {
  if (!wholesaleSeries.length || !retailWeekly.length) {
    return summarizeRatios([]);
  }
  const retailPts = retailWeekly
    .filter((r) => r && r.date && Number.isFinite(Number(r.value)) && Number(r.value) > 0)
    .map((r) => ({ ms: Date.parse(r.date), value: Number(r.value) }));

  const maxGapMs = 7 * 86400 * 1000;
  const ratios = [];

  for (const w of wholesaleSeries) {
    const wMs = Date.parse(w.date);
    if (!Number.isFinite(wMs) || !(w.priceExVat > 0)) continue;
    let best = null;
    let bestDist = Infinity;
    for (const r of retailPts) {
      const dist = Math.abs(wMs - r.ms);
      if (dist <= maxGapMs && dist < bestDist) {
        best = r;
        bestDist = dist;
      }
    }
    if (best && best.value > 0) {
      ratios.push(w.priceExVat / best.value);
    }
  }
  return summarizeRatios(ratios);
}

/**
 * Computes paired producer / retail ratio range from official Rosstat monthly producer & weekly retail series.
 */
export function computeOfficialProducerRetailRatioRange(officialMonthly = [], retailWeekly = []) {
  const retByMonth = new Map();
  for (const r of retailWeekly || []) {
    if (!r?.date || !(r.value > 0)) continue;
    const m = r.date.slice(0, 7);
    if (!retByMonth.has(m)) retByMonth.set(m, []);
    retByMonth.get(m).push(Number(r.value));
  }
  const ratios = [];
  for (const p of officialMonthly || []) {
    const arr = retByMonth.get(p.period);
    if (arr && arr.length && p.value > 0) {
      const retAvg = arr.reduce((s, x) => s + x, 0) / arr.length;
      if (retAvg > 0) ratios.push(p.value / retAvg);
    }
  }
  return summarizeRatios(ratios);
}

export function buildSeparatedPriceBasis({ officialMonthly = [], retailWeekly = [], observations = [] } = {}) {
  const calibrationSeries = buildCalibrationSeries(officialMonthly);
  const targetSeries = buildTargetWholesaleSeries(observations);
  const wholesaleRetailRatio = computeWholesaleRetailRatioRange(targetSeries, retailWeekly);
  const officialProducerRetailRatio = computeOfficialProducerRetailRatioRange(officialMonthly, retailWeekly);
  return {
    calibrationSeries,
    targetSeries,
    wholesaleRetailRatio,
    officialProducerRetailRatio,
  };
}
