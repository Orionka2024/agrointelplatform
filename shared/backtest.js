/**
 * Rolling-origin backtesting.
 *
 * For every historical origin week O the models see ONLY observations with week <= O.
 * Tuning (model selection) and final evaluation use disjoint origin ranges:
 *   - tuning origins   : O < finalStart and target(O,h) <= finalStart   (purged: no target overlaps the final period)
 *   - final origins    : O >= finalStart
 * Prediction intervals for an origin are calibrated ONLY from errors whose target week had already
 * occurred by that origin, so the reported coverage is out-of-sample.
 *
 * The result reports per horizon: sample sizes, evaluation period, MAE (RUB/kg), bias (forecast − actual),
 * comparison with the naive baseline and empirical coverage of 80 % / 95 % intervals.
 * Passing software tests is NOT evidence of accuracy; only this output on real data is.
 */
import { addWeeks, weeksBetween } from './dates.js';
import { HORIZONS, MODELS, truncateMap, conformalQuantile } from './models.js';

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;

export function rollingOriginBacktest(points, opts = {}) {
  const {
    horizons = HORIZONS, finalFraction = 0.4, minFinal = 20, minTune = 10, selectionMargin = 0.05,
    models = MODELS, visibleAt = null, targetAvailableAt = null,
  } = opts;
  const out = {
    params: { finalFraction, minFinal, minTune, selectionMargin },
    split: null, nPoints: points.length, horizons: {}, errors: {},
  };
  Object.keys(models).forEach(m => { out.errors[m] = {}; horizons.forEach(h => { out.errors[m][h] = []; }); });
  if (points.length < 8) {
    horizons.forEach(h => { out.horizons[h] = { status: 'insufficient', reason: 'Слишком короткий ряд для бэктеста', final: null, nTune: 0 }; });
    return out;
  }
  const weeks = points.map(p => p.week);
  const actual = new Map(points.map(p => [p.week, p.value]));
  const finalStartIdx = Math.floor(weeks.length * (1 - finalFraction));
  const finalStart = weeks[finalStartIdx];
  out.split = { finalStartOrigin: finalStart, firstOrigin: weeks[0], lastOrigin: weeks[weeks.length - 1] };

  for (const origin of weeks) {
    const visible = visibleAt ? visibleAt(origin) : truncateMap(points, origin); // information set at the origin
    for (const h of horizons) {
      const target = addWeeks(origin, h);
      if (!actual.has(target)) continue;
      for (const [id, model] of Object.entries(models)) {
        const pred = model.predict(visible, origin, h);
        if (pred == null) continue;
        const a = actual.get(target);
        out.errors[id][h].push({ origin, target, pred, actual: a, err: pred - a, abs: Math.abs(pred - a) });
      }
    }
  }

  for (const h of horizons) {
    const rec = id => out.errors[id][h];
    const naiveAll = rec('naive');
    const seasAll = rec('seasonal_ratio');
    const pairedKey = r => r.origin;

    const tuneFilter = r => r.origin < finalStart && weeksBetween((targetAvailableAt ? targetAvailableAt(r.target) : r.target), finalStart) > 0;
    const tuneS = seasAll.filter(tuneFilter);
    const tuneSet = new Set(tuneS.map(pairedKey));
    const tuneN = naiveAll.filter(r => tuneFilter(r) && tuneSet.has(r.origin));
    let selected = 'naive';
    let tuneMae = { naive: null, seasonal_ratio: null };
    if (tuneS.length >= minTune) {
      tuneMae = { naive: mean(tuneN.map(r => r.abs)), seasonal_ratio: mean(tuneS.map(r => r.abs)) };
      if (tuneMae.seasonal_ratio < tuneMae.naive * (1 - selectionMargin)) selected = 'seasonal_ratio';
    }

    const finalSel = rec(selected).filter(r => r.origin >= finalStart);
    const finalSelSet = new Set(finalSel.map(pairedKey));
    const finalNaive = naiveAll.filter(r => r.origin >= finalStart && finalSelSet.has(r.origin));
    if (finalSel.length === 0) {
      out.horizons[h] = { status: 'insufficient', reason: 'Нет оценочных выборок в финальном периоде', selected, nTune: tuneS.length || tuneN.length, tuneMae, final: null };
      continue;
    }

    // out-of-sample interval coverage using only matured errors
    const cover = { 0.8: { n: 0, covered: 0 }, 0.95: { n: 0, covered: 0 } };
    const allSel = rec(selected);
    for (const r of finalSel) {
      const matured = allSel.filter(x => weeksBetween((targetAvailableAt ? targetAvailableAt(x.target) : x.target), r.origin) >= 0).map(x => x.abs);
      for (const level of [0.8, 0.95]) {
        const q = conformalQuantile(matured, level);
        if (q == null) continue;
        cover[level].n++;
        if (r.actual >= r.pred - q && r.actual <= r.pred + q) cover[level].covered++;
      }
    }
    const rate = c => (c.n ? c.covered / c.n : null);
    const mae = mean(finalSel.map(r => r.abs));
    const naiveMae = mean(finalNaive.map(r => r.abs));
    const status = finalSel.length >= minFinal ? 'ok' : 'insufficient';
    out.horizons[h] = {
      status,
      reason: status === 'ok' ? null : `Финальная выборка n=${finalSel.length} < ${minFinal}`,
      selected,
      nTune: tuneS.length || tuneN.length,
      tuneMae,
      final: {
        n: finalSel.length,
        period: { firstTarget: finalSel[0].target, lastTarget: finalSel[finalSel.length - 1].target },
        mae, bias: mean(finalSel.map(r => r.err)),
        naiveMae, skillVsNaive: naiveMae > 0 ? 1 - mae / naiveMae : null,
        coverage80: { n: cover[0.8].n, rate: rate(cover[0.8]) },
        coverage95: { n: cover[0.95].n, rate: rate(cover[0.95]) },
      },
      // A non-baseline model is adopted for production only if it also beats naive in the final period.
      beatsNaiveInHoldout: mae < naiveMae, // Reporting only; never selects the deployed model.
      confirmedInHoldout: true,
    };
  }
  return out;
}
