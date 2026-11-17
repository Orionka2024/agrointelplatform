/**
 * Honest Walk-Forward Backtest Engine (Task 1)
 *
 * Implements:
 * 1. "Last price + historical seasonal adjustment" benchmark (`naive_seasonal_adj`)
 *    computed strictly from point-in-time history <= origin (no lookahead).
 * 2. Block bootstrap by agricultural crop-year season (August-July), NOT overlapping points,
 *    reporting effectiveSeasons.
 * 3. Directional accuracy baseline: "sign of the average seasonal change" (`seasonal_direction`).
 * 4. Disaggregated season reporting: Shortage 2024/25 (Aug 2024 - Jul 2025) vs Glut 2025/26 (Aug 2025 - Jul 2026).
 */

import { monthlyPredict, monthNumber } from './officialForecast.js';

/**
 * Maps a YYYY-MM period to its agricultural crop year (August-July).
 * E.g. 2024-08..2025-07 -> '2024/25'.
 */
export function cropYearOf(period) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Computes point-in-time historical seasonal indices S(1..12) using only observations <= originIndex.
 */
export function computeSeasonalIndices(points, maxIndex) {
  const slice = points.slice(0, maxIndex + 1);
  if (slice.length < 12) return null;

  // Compute 12-month centered/trailing mean ratio per month
  const byMonth = Array.from({ length: 12 }, () => []);
  for (let i = 11; i < slice.length; i++) {
    let sum12 = 0;
    for (let k = i - 11; k <= i; k++) sum12 += slice[k].value;
    const mean12 = sum12 / 12;
    if (mean12 > 0) {
      const m = Number(slice[i].period.slice(5, 7)) - 1;
      byMonth[m].push(slice[i].value / mean12);
    }
  }

  const indices = byMonth.map((arr) => {
    if (!arr.length) return 1;
    return arr.reduce((s, x) => s + x, 0) / arr.length;
  });
  const avg = indices.reduce((s, x) => s + x, 0) / 12 || 1;
  return indices.map((v) => v / avg);
}

/**
 * Predicts target price using "last price + historical seasonal adjustment" (strictly causal).
 */
export function predictLastPlusSeasonal(points, originIndex, lead) {
  const targetIndex = originIndex + lead;
  if (originIndex < 11 || targetIndex >= points.length) return null;
  const indices = computeSeasonalIndices(points, originIndex);
  if (!indices) return null;
  const originMonth = Number(points[originIndex].period.slice(5, 7)) - 1;
  const targetMonth = (originMonth + lead) % 12;
  const ratio = indices[originMonth] > 0 ? indices[targetMonth] / indices[originMonth] : 1;
  return points[originIndex].value * ratio;
}

/**
 * Returns the sign (+1, -1, or 0) of the historical average seasonal change between origin and target month.
 */
export function predictSeasonalDirection(points, originIndex, lead) {
  const indices = computeSeasonalIndices(points, originIndex);
  if (!indices) return 0;
  const originMonth = Number(points[originIndex].period.slice(5, 7)) - 1;
  const targetMonth = (originMonth + lead) % 12;
  return Math.sign(indices[targetMonth] - indices[originMonth]);
}

/**
 * Block bootstrap by agricultural crop-year season (August-July) for MAE difference:
 * mean(|e_model| - |e_ref|).
 */
export function seasonBlockBootstrapDiff(modelRecords, refRecords, { B = 2000, seed = 42 } = {}) {
  const refMap = new Map(refRecords.map((r) => [r.target, Math.abs(r.p - r.a)]));
  const bySeason = new Map();

  for (const r of modelRecords) {
    if (!refMap.has(r.target)) continue;
    const diff = Math.abs(r.p - r.a) - refMap.get(r.target);
    const cy = cropYearOf(r.target);
    if (!bySeason.has(cy)) bySeason.set(cy, []);
    bySeason.get(cy).push(diff);
  }

  const seasons = [...bySeason.keys()].sort();
  const effectiveSeasons = seasons.length;
  const allDiffs = [...bySeason.values()].flat();
  if (!allDiffs.length) {
    return { effectiveSeasons: 0, n: 0, mean: null, lo90: null, hi90: null, seasons: [] };
  }

  const mean = allDiffs.reduce((s, x) => s + x, 0) / allDiffs.length;
  if (effectiveSeasons < 2) {
    return { effectiveSeasons, n: allDiffs.length, mean: +mean.toFixed(2), lo90: null, hi90: null, seasons };
  }

  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  const bootMeans = [];
  const seasonArrays = seasons.map((k) => bySeason.get(k));
  for (let b = 0; b < B; b++) {
    let sum = 0;
    let count = 0;
    for (let k = 0; k < effectiveSeasons; k++) {
      const picked = seasonArrays[Math.floor(rnd() * effectiveSeasons)];
      for (let i = 0; i < picked.length; i++) {
        sum += picked[i];
        count++;
      }
    }
    bootMeans.push(sum / (count || 1));
  }
  bootMeans.sort((a, b) => a - b);

  return {
    effectiveSeasons,
    n: allDiffs.length,
    mean: +mean.toFixed(2),
    lo90: +bootMeans[Math.floor(0.05 * B)].toFixed(2),
    hi90: +bootMeans[Math.floor(0.95 * B)].toFixed(2),
    seasons,
  };
}

function summarizeRecords(recs) {
  if (!recs.length) return null;
  const n = recs.length;
  const mae = recs.reduce((s, r) => s + Math.abs(r.p - r.a), 0) / n;
  const rmse = Math.sqrt(recs.reduce((s, r) => s + (r.p - r.a) ** 2, 0) / n);
  const bias = recs.reduce((s, r) => s + (r.p - r.a), 0) / n;
  const mape = (100 * recs.reduce((s, r) => s + Math.abs(r.p - r.a) / r.a, 0)) / n;
  const dirHits = recs.filter((r) => Math.sign(r.p - r.base) === Math.sign(r.a - r.base)).length;
  return {
    n,
    mae: +mae.toFixed(2),
    rmse: +rmse.toFixed(2),
    mape: +mape.toFixed(1),
    bias: +bias.toFixed(2),
    directionHitRate: +(dirHits / n).toFixed(2),
  };
}

/**
 * Runs the full leakage-safe honest backtest across horizons and seasons.
 */
export function runHonestBacktest(points, ctx, { leads = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] } = {}) {
  const first = monthNumber(points[0].period);
  const models = ['eq_carry', 'naive', 'seasonal', 'naive_seasonal_adj'];
  const horizonRows = [];

  for (const lead of leads) {
    const recs = Object.fromEntries(models.map((m) => [m, []]));
    const seasDirRecs = [];

    for (let oi = 11; oi + lead < points.length; oi++) {
      const origin = first + oi;
      const actual = points[oi + lead].value;
      const base = points[oi].value;
      const target = points[oi + lead].period;
      const cropYear = cropYearOf(target);

      const pEq = monthlyPredict(points, origin, lead, 'eq_carry', ctx);
      const pNaive = monthlyPredict(points, origin, lead, 'naive', ctx);
      const pSeas = monthlyPredict(points, origin, lead, 'seasonal', ctx);
      const pLastSeas = predictLastPlusSeasonal(points, oi, lead);
      const dirSeas = predictSeasonalDirection(points, oi, lead);

      if (pEq == null || pNaive == null || pSeas == null || pLastSeas == null) continue;

      const common = { origin: points[oi].period, target, cropYear, base, a: actual };
      recs.eq_carry.push({ ...common, p: pEq });
      recs.naive.push({ ...common, p: pNaive });
      recs.seasonal.push({ ...common, p: pSeas });
      recs.naive_seasonal_adj.push({ ...common, p: pLastSeas });
      seasDirRecs.push({ ...common, predSign: dirSeas });
    }

    const dirSeasHits = seasDirRecs.filter((r) => r.predSign === Math.sign(r.a - r.base)).length;
    const seasonalDirectionHitRate = seasDirRecs.length ? +(dirSeasHits / seasDirRecs.length).toFixed(2) : null;

    horizonRows.push({
      lead,
      horizonMonths: lead - 1,
      n: recs.eq_carry.length,
      eq_carry: summarizeRecords(recs.eq_carry),
      naive: summarizeRecords(recs.naive),
      seasonal: summarizeRecords(recs.seasonal),
      naive_seasonal_adj: summarizeRecords(recs.naive_seasonal_adj),
      seasonalDirectionHitRate,
      ciVsSeasonal: seasonBlockBootstrapDiff(recs.eq_carry, recs.seasonal),
      ciVsNaive: seasonBlockBootstrapDiff(recs.eq_carry, recs.naive),
      ciVsNaiveSeasonalAdj: seasonBlockBootstrapDiff(recs.eq_carry, recs.naive_seasonal_adj),
      bySeason: {
        '2024/25_shortage': {
          eq_carry: summarizeRecords(recs.eq_carry.filter((r) => r.cropYear === '2024/25')),
          naive: summarizeRecords(recs.naive.filter((r) => r.cropYear === '2024/25')),
          seasonal: summarizeRecords(recs.seasonal.filter((r) => r.cropYear === '2024/25')),
          naive_seasonal_adj: summarizeRecords(recs.naive_seasonal_adj.filter((r) => r.cropYear === '2024/25')),
        },
        '2025/26_glut': {
          eq_carry: summarizeRecords(recs.eq_carry.filter((r) => r.cropYear === '2025/26')),
          naive: summarizeRecords(recs.naive.filter((r) => r.cropYear === '2025/26')),
          seasonal: summarizeRecords(recs.seasonal.filter((r) => r.cropYear === '2025/26')),
          naive_seasonal_adj: summarizeRecords(recs.naive_seasonal_adj.filter((r) => r.cropYear === '2025/26')),
        },
      },
    });
  }

  return {
    nMonths: points.length,
    firstPeriod: points[0].period,
    lastPeriod: points.at(-1).period,
    horizons: horizonRows,
  };
}
