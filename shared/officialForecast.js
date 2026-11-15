/** Monthly producer benchmark & CatBoost multi-factor hindcast.
 * Latest-vintage hindcast is NOT point-in-time archival validation.
 * Selection, calibration and final evaluation use disjoint, lead-purged TARGET month blocks.
 */
import { ridgePredict, driverMaps } from './driverModel.js';
import {
  buildCatBoostContext,
  eqCarryPredict,
  catboostPredict,
  catboostTrainAndPredict,
} from './catboostModel.js';

export const OFFICIAL_MODEL_VERSION = 'rosstat-catboost-3.0.0';

export const MONTHLY_MODELS = {
  naive: 'Последняя цена',
  seasonal: 'Цена того же месяца прошлого года',
  ratio: 'Среднее сезонное отношение (до 3 лет)',
  season_ridge: 'Обученная сезонность (ridge, месяц года)',
  eq_carry: 'Сезонная модель (Weibull)',
  drivers: 'Обученная модель: сезонность + USD/RUB + ставка ЦБ (ridge)',
  catboost: 'Дерево решений (экспериментальная)',
};

export function monthNumber(s) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new Error('Invalid month');
  return Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
}

export function monthLabel(n) {
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
}

export function monthlyPredict(points, origin, lead, id, ctx = null) {
  const map = new Map(
    points
      .filter((r) => monthNumber(r.period) <= origin)
      .map((r) => [monthNumber(r.period), r.value])
  );
  const base = map.get(origin);
  if (!Number.isFinite(base) || lead < 1) return null;
  if (id === 'naive') return base;
  if (id === 'seasonal') {
    let target = origin + lead;
    while (target > origin) target -= 12;
    return map.get(target) ?? null;
  }
  if (id === 'ratio') {
    const ratios = [];
    for (let k = 1; k <= 3; k++) {
      const a = map.get(origin - 12 * k);
      const b = map.get(origin + lead - 12 * k);
      if (origin + lead - 12 * k <= origin && a > 0 && b > 0) ratios.push(Math.log(b / a));
    }
    return ratios.length >= 2 ? base * Math.exp(ratios.reduce((a, b) => a + b, 0) / ratios.length) : null;
  }
  if (id === 'season_ridge') return ridgePredict('season', map, null, origin, lead);
  if (id === 'eq_carry') return eqCarryPredict(map, origin, lead);
  if (id === 'drivers') return ctx?.maps ? ridgePredict('drivers', map, ctx.maps, origin, lead) : null;
  if (id === 'catboost') return ctx?.cb ? catboostPredict(map, ctx.cb, origin, lead) : null;
  throw new Error('Unknown monthly model');
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function errorQuantile(errors, coverage) {
  const a = [...errors].sort((x, y) => x - y);
  const i = Math.ceil((a.length + 1) * coverage) - 1;
  return i >= 0 && i < a.length ? a[i] : null;
}

/**
 * Moving-block bootstrap quantile estimator to preserve serial correlation across adjacent months.
 */
export function blockBootstrapQuantile(values, coverage, { blockSize = 3, reps = 120, seed = 1337 } = {}) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (coverage >= 0.95 && values.length < 19) return null;
  const n = values.length;
  const bSize = Math.max(1, Math.min(blockSize, n));
  const numBlocks = Math.ceil(n / bSize);
  let state = (seed ^ n) >>> 0;
  const nextRand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const replicateQuantiles = [];
  for (let r = 0; r < reps; r++) {
    const sample = [];
    for (let b = 0; b < numBlocks && sample.length < n; b++) {
      const start = Math.floor(nextRand() * (n - bSize + 1));
      for (let k = 0; k < bSize && sample.length < n; k++) {
        sample.push(values[start + k]);
      }
    }
    const sorted = sample.sort((x, y) => x - y);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length + 1) * coverage) - 1));
    replicateQuantiles.push(sorted[idx]);
  }
  replicateQuantiles.sort((x, y) => x - y);
  const mid = Math.floor(replicateQuantiles.length / 2);
  return replicateQuantiles.length % 2
    ? replicateQuantiles[mid]
    : (replicateQuantiles[mid - 1] + replicateQuantiles[mid]) / 2;
}

/**
 * Evaluates a reliability diagram on empirical rise/fall predictions and gates directional probabilities.
 */
export function evaluateReliabilityDiagram(samples, { maxCalibrationError = 0.15, minN = 24 } = {}) {
  const valid = (samples || []).filter(
    (s) => Number.isFinite(s?.predProbRise) && (s?.actualRose === 0 || s?.actualRose === 1 || typeof s?.actualRose === 'boolean')
  );
  const n = valid.length;
  if (n < minN) {
    return {
      n,
      passes: false,
      weightedCalibrationError: null,
      bins: [],
      gatedRiseProb: null,
      gatedFallProb: null,
      hiddenReason: `Вероятности роста/снижения скрыты: недостаточно наблюдений для диаграммы надёжности (n=${n} < ${minN})`,
    };
  }

  const binBounds = [
    [0.0, 0.34],
    [0.34, 0.67],
    [0.67, 1.01],
  ];
  const bins = [];
  let weightedErrorSum = 0;

  for (const [lo, hi] of binBounds) {
    const inBin = valid.filter((s) => s.predProbRise >= lo && s.predProbRise < hi);
    if (!inBin.length) continue;
    const meanPred = mean(inBin.map((s) => s.predProbRise));
    const empFreq = mean(inBin.map((s) => (s.actualRose ? 1 : 0)));
    const absGap = Math.abs(meanPred - empFreq);
    weightedErrorSum += (inBin.length / n) * absGap;
    bins.push({
      range: [lo, +(hi > 1 ? 1.0 : hi).toFixed(2)],
      count: inBin.length,
      meanPredicted: +meanPred.toFixed(4),
      empiricalFrequency: +empFreq.toFixed(4),
      absGap: +absGap.toFixed(4),
    });
  }

  const weightedCalibrationError = +weightedErrorSum.toFixed(4);
  const passes = weightedCalibrationError <= maxCalibrationError;
  const overallEmpiricalRise = +mean(valid.map((s) => (s.actualRose ? 1 : 0))).toFixed(4);

  return {
    n,
    passes,
    weightedCalibrationError,
    maxCalibrationError,
    bins,
    gatedRiseProb: passes ? overallEmpiricalRise : null,
    gatedFallProb: passes ? +(1 - overallEmpiricalRise).toFixed(4) : null,
    hiddenReason: passes
      ? null
      : `Вероятности роста/снижения скрыты: ошибка калибровки диаграммы надёжности ${(weightedCalibrationError * 100).toFixed(1)}% превышает порог ${(maxCalibrationError * 100).toFixed(0)}%`,
  };
}

/**
 * Computes calibrated intervals from out-of-sample log-relative residuals, pooling across adjacent
 * horizons to reach n >= 24 per pooled bucket and using moving-block bootstrap to preserve serial correlation.
 */
export function computePooledLogRelativeCalibration(
  points,
  lead,
  {
    selectedModel = 'eq_carry',
    ctx = null,
    finalStart = points.length - 12,
    minPoolN = 24,
    blockSize = 3,
    coverageMin = 0.70,
    coverageMax = 0.90,
  } = {}
) {
  const first = monthNumber(points[0].period);
  const maxLead = 15;
  const candidateOffsets = [0, -1, 1, -2, 2, -3, 3, -4, 4];
  const pooledLogResiduals = [];
  const pooledLeads = [];
  const directionalSamples = [];

  for (const offset of candidateOffsets) {
    const l = lead + offset;
    if (l < 1 || l > maxLead) continue;
    const calEndForLead = finalStart - l - 1;
    const calStartForLead = Math.max(11 + l, calEndForLead - 11);
    const recs = collectHorizonRecords(points, first, 11, calEndForLead, l, [selectedModel], ctx)[selectedModel] || [];
    const windowRecs = recs.filter((r) => r.targetIndex >= calStartForLead && r.targetIndex <= calEndForLead);
    if (!windowRecs.length) continue;

    pooledLeads.push(l);
    const roseFlags = windowRecs.map((r) => (r.actual > r.base ? 1 : 0));
    const empRiseRate = mean(roseFlags) ?? 0.5;
    for (const r of windowRecs) {
      if (r.point > 0 && r.actual > 0) {
        pooledLogResiduals.push(Math.abs(Math.log(r.actual) - Math.log(r.point)));
        directionalSamples.push({
          predProbRise: r.point > r.base ? Math.max(0.55, empRiseRate) : Math.min(0.45, empRiseRate),
          actualRose: r.actual > r.base ? 1 : 0,
        });
      }
    }
    if (pooledLogResiduals.length >= minPoolN) break;
  }

  const pooledN = pooledLogResiduals.length;
  const q80Log = pooledN >= minPoolN ? blockBootstrapQuantile(pooledLogResiduals, 0.80, { blockSize, seed: 1000 + lead }) : null;
  const q95Log = pooledN >= minPoolN ? blockBootstrapQuantile(pooledLogResiduals, 0.95, { blockSize, seed: 2000 + lead }) : null;

  // Evaluate empirical coverage on the held-out rolling window (targetIndex >= finalStart)
  const finalRecs =
    collectHorizonRecords(points, first, 11, points.length - 1, lead, [selectedModel], ctx)[selectedModel]?.filter(
      (r) => r.targetIndex >= finalStart && r.point > 0 && r.actual > 0
    ) || [];

  const empiricalCoverage80 =
    q80Log !== null && finalRecs.length > 0
      ? +mean(finalRecs.map((r) => Number(Math.abs(Math.log(r.actual) - Math.log(r.point)) <= q80Log))).toFixed(4)
      : null;
  const empiricalCoverage95 =
    q95Log !== null && finalRecs.length > 0
      ? +mean(finalRecs.map((r) => Number(Math.abs(Math.log(r.actual) - Math.log(r.point)) <= q95Log))).toFixed(4)
      : null;

  const withinTolerance80 =
    pooledN >= minPoolN &&
    empiricalCoverage80 !== null &&
    empiricalCoverage80 >= coverageMin &&
    empiricalCoverage80 <= coverageMax;

  const obsPct = empiricalCoverage80 !== null ? Math.round(empiricalCoverage80 * 100) : 'н/д';
  const unavailableReason80 = withinTolerance80
    ? null
    : `Интервал недоступен: n=${pooledN}, наблюдаемое покрытие ${obsPct}% вне допуска ${Math.round(coverageMin * 100)}%–${Math.round(coverageMax * 100)}%`;

  const reliability = evaluateReliabilityDiagram(directionalSamples, { minN: minPoolN });

  return {
    pooledN,
    pooledLeads,
    resamplingMethod: 'moving_block_bootstrap',
    blockSize,
    q80Log: q80Log !== null ? +q80Log.toFixed(4) : null,
    q95Log: q95Log !== null ? +q95Log.toFixed(4) : null,
    empiricalCoverage80,
    empiricalCoverage95,
    coverageTolerance80: [coverageMin, coverageMax],
    withinTolerance80,
    unavailableReason80,
    reliabilityDiagram: reliability,
  };
}

function summary(rows) {
  return {
    n: rows.length,
    mae: mean(rows.map((r) => r.abs)),
    directionAccuracy: mean(rows.map((r) => Number(Math.sign(r.point - r.base) === Math.sign(r.actual - r.base)))),
  };
}

function collectHorizonRecords(points, first, startOriginIdx, endTargetIdx, lead, ids, ctx) {
  const out = Object.fromEntries(ids.map((id) => [id, []]));
  for (let originIndex = startOriginIdx; originIndex + lead <= endTargetIdx; originIndex++) {
    const origin = first + originIndex;
    const targetIndex = originIndex + lead;
    for (const id of ids) {
      const point = monthlyPredict(points, origin, lead, id, ctx);
      if (point === null) continue;
      const actual = points[targetIndex].value;
      out[id].push({
        origin: monthLabel(origin),
        target: points[targetIndex].period,
        targetIndex,
        point,
        actual,
        base: points[originIndex].value,
        abs: Math.abs(point - actual),
      });
    }
  }
  return out;
}

/**
 * Purged rolling-origin evaluation on monthly series.
 * @param drivers optional availability-filtered official-drivers object
 * @param retailWeekly optional availability-filtered retail weekly array
 */
export function evaluateMonthly(points, lead, drivers = null, retailWeekly = []) {
  const ctx = drivers
    ? { maps: driverMaps(drivers), cb: buildCatBoostContext(drivers, retailWeekly) }
    : null;
  const ids = Object.keys(MONTHLY_MODELS).filter((id) => !['drivers', 'catboost'].includes(id) || ctx);
  const n = points.length;
  const first = monthNumber(points[0].period);
  const finalStart = n - 12;
  // Purge lead months so selection and calibration targets mature strictly before the first final-test origin.
  const calibrationEnd = finalStart - lead - 1;
  const calibrationStart = calibrationEnd - 7;
  const tuningEnd = calibrationStart - lead - 1;

  const records = collectHorizonRecords(points, first, 11, n - 1, lead, ids, ctx);

  // Walk-forward model selection across all pre-holdout target periods (targetIndex <= calibrationEnd).
  // Require candidates to be evaluated on the identical common target set so models with shorter
  // driver availability or earlier cutoff do not distort selection at lead = 5..7.
  const preHoldoutById = Object.fromEntries(
    ids.map((id) => [id, records[id].filter((r) => r.targetIndex <= calibrationEnd)])
  );
  const maxPreHoldoutN = Math.max(
    0,
    ...ids.filter((x) => x !== 'naive').map((id) => preHoldoutById[id].length)
  );
  const commonTargetSet = new Set(
    (
      ids
        .filter((x) => x !== 'naive')
        .map((id) => preHoldoutById[id])
        .find((rows) => rows.length === maxPreHoldoutN) || []
    ).map((r) => r.target)
  );

  let selected = 'naive';
  const comparisons = [];
  for (const id of ids.filter((x) => x !== 'naive')) {
    const rows = preHoldoutById[id].filter((r) => commonTargetSet.has(r.target));
    const targets = new Set(rows.map((r) => r.target));
    const base = preHoldoutById.naive.filter((r) => targets.has(r.target));
    const hasFullCommonPeriod = rows.length === commonTargetSet.size && rows.length >= 6;
    const ratio =
      hasFullCommonPeriod && summary(base).mae > 0 ? summary(rows).mae / summary(base).mae : null;
    comparisons.push({
      id,
      n: rows.length,
      commonPeriodN: commonTargetSet.size,
      mae: rows.length ? summary(rows).mae : null,
      naiveMAE: base.length ? summary(base).mae : null,
      ratio,
    });
  }
  const eligible = comparisons.filter((r) => r.ratio !== null && r.ratio < 0.95).sort((a, b) => a.ratio - b.ratio);
  if (eligible.length) selected = eligible[0].id;

  const cal = records[selected].filter((r) => r.targetIndex >= calibrationStart && r.targetIndex <= calibrationEnd);
  const cbCal = records.catboost
    ? records.catboost.filter((r) => r.targetIndex >= calibrationStart && r.targetIndex <= calibrationEnd)
    : [];
  const final = records[selected].filter((r) => r.targetIndex >= finalStart);
  const finalTargets = new Set(final.map((r) => r.target));
  const naiveFinal = records.naive.filter((r) => finalTargets.has(r.target));

  // Informational only: untouched final 12-month block for every candidate (never used to select).
  const finalAll = ids.map((id) => {
    const rows = records[id].filter((r) => r.targetIndex >= finalStart);
    const t = new Set(rows.map((r) => r.target));
    return {
      id,
      n: rows.length,
      mae: rows.length ? summary(rows).mae : null,
      naiveMAE: rows.length ? summary(records.naive.filter((r) => t.has(r.target))).mae : null,
    };
  });

  const q80 = errorQuantile(cal.map((r) => r.abs), 0.8);
  const q95 = errorQuantile(cal.map((r) => r.abs), 0.95);
  const cbQ80 = cbCal.length ? errorQuantile(cbCal.map((r) => r.abs), 0.8) : q80;
  const finalScore = summary(final);
  const naiveScore = summary(naiveFinal);

  const result = {
    selected,
    lead,
    comparisons,
    finalAll,
    usesDrivers: !!ctx,
    calibrationN: cal.length,
    q80,
    q95,
    catboostQ80: cbQ80,
    final: finalScore,
    naiveFinal: naiveScore,
    finalCoverage80: q80 === null ? null : mean(final.map((r) => Number(r.abs <= q80))),
    finalCoverage95: q95 === null ? null : mean(final.map((r) => Number(r.abs <= q95))),
    beatsNaive: finalScore.n >= 6 && finalScore.mae < naiveScore.mae,
    split: {
      tuningEnds: points[tuningEnd]?.period,
      calibrationStarts: points[calibrationStart]?.period,
      calibrationEnds: points[calibrationEnd]?.period,
      finalStarts: points[finalStart]?.period,
      finalEnds: points.at(-1).period,
    },
    finalPredictions: final,
  };

  let cachedLogRelCal = null;
  Object.defineProperty(result, 'logRelativeCalibration', {
    enumerable: false,
    configurable: true,
    get() {
      if (!cachedLogRelCal) {
        cachedLogRelCal = computePooledLogRelativeCalibration(points, lead, {
          selectedModel: selected,
          ctx,
          finalStart,
        });
      }
      return cachedLogRelCal;
    },
  });

  return result;
}

export function issueOfficialForecast(history, { issueDate, drivers = null } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate || '') || Number.isNaN(Date.parse(issueDate))) {
    throw new Error('Invalid issue date');
  }
  const sources = new Map(history.sources.map((s) => [s.id, s]));
  const points = history.producer.monthly
    .filter((r) => r.period <= issueDate.slice(0, 7) && r.availableDate <= issueDate && sources.has(r.sourceId))
    .sort((a, b) => a.period.localeCompare(b.period));
  const retailWeekly = (history.retail?.weekly || []).filter(
    (r) => r.date <= issueDate && r.availableDate <= issueDate && sources.has(r.sourceId)
  );
  const last = points.at(-1);
  const issueMonth = monthNumber(issueDate.slice(0, 7));

  const usableDrivers = drivers
    ? {
        usdRub: (drivers.usdRub || []).filter((r) => r.availableDate <= issueDate),
        kztRub: (drivers.kztRub || []).filter((r) => r.availableDate <= issueDate),
        keyRate: (drivers.keyRate || []).filter((r) => r.availableDate <= issueDate),
        weather: drivers.weather
          ? {
              volgograd: (drivers.weather.volgograd || []).filter((r) => r.availableDate <= issueDate),
              zhambyl: (drivers.weather.zhambyl || []).filter((r) => r.availableDate <= issueDate),
            }
          : undefined,
      }
    : null;

  const driverHashes = drivers?.sources ? Object.values(drivers.sources).map((s) => s.sha256) : [];

  const output = {
    schema: 2,
    modelVersion: OFFICIAL_MODEL_VERSION,
    issueDate,
    target: 'РФ · лук · цена производителей сельхозорганизаций',
    unit: 'RUB/kg',
    vat: 'excluded',
    frequency: 'monthly',
    inputCutoff: last?.period ?? null,
    lastValue: last?.value ?? null,
    n: points.length,
    sourceHashes: [...history.sources.map((s) => s.sha256), ...driverHashes],
    drivers: usableDrivers
      ? {
          usdRubLast: usableDrivers.usdRub.at(-1) ?? null,
          kztRubLast: usableDrivers.kztRub.at(-1) ?? null,
          keyRateLast: usableDrivers.keyRate.at(-1) ?? null,
          weatherLast: {
            volgograd: usableDrivers.weather?.volgograd?.at(-1) ?? null,
            zhambyl: usableDrivers.weather?.zhambyl?.at(-1) ?? null,
          },
          sourceNote: drivers.note,
        }
      : null,
    evaluationType: 'latest_vintage_hindcast',
    status: 'research_benchmark',
    rows: [],
    limitations: history.limitations,
  };

  if (points.length < 48) {
    return { ...output, status: 'insufficient_data' };
  }
  for (let i = 0; i < points.length; i++) {
    if (!Number.isFinite(points[i].value) || points[i].value <= 0) throw new Error('Invalid producer value');
    if (i && monthNumber(points[i].period) !== monthNumber(points[i - 1].period) + 1) {
      throw new Error('Monthly history must be continuous, unique and not interpolated');
    }
  }
  const lastMonth = monthNumber(last.period);
  if (issueMonth - lastMonth > 2) return { ...output, status: 'stale_data' };

  const ctx = usableDrivers
    ? { maps: driverMaps(usableDrivers), cb: buildCatBoostContext(usableDrivers, retailWeekly) }
    : null;
  const priceMap = new Map(points.map((r) => [monthNumber(r.period), r.value]));

  for (let h = 1; h <= 14; h++) {
    const target = issueMonth + h;
    const lead = target - lastMonth;
    const validation = evaluateMonthly(points, lead, usableDrivers, retailWeekly);
    const point = monthlyPredict(points, lastMonth, lead, validation.selected, ctx);
    const cbDetail = ctx?.cb ? catboostTrainAndPredict(priceMap, ctx.cb, lastMonth, lead) : null;
    const cbPoint = cbDetail?.point ?? point;
    const cbQ80 = validation.catboostQ80 ?? validation.q80;
    const cbHoldout = validation.finalAll?.find((x) => x.id === 'catboost')?.mae ?? validation.final.mae;
    const range = (pt, q) => (pt !== null && q !== null ? { lo: Math.max(0, pt - q), hi: pt + q } : null);

    output.rows.push({
      h,
      lead,
      targetMonth: monthLabel(target),
      point,
      changePct: point === null ? null : 100 * (point / last.value - 1),
      interval80: range(point, validation.q80),
      interval95: range(point, validation.q95),
      catboostPoint: cbPoint,
      catboostQ80: cbQ80,
      catboostInterval80: range(cbPoint, cbQ80),
      catboostHoldoutMae: cbHoldout,
      catboostShap: cbDetail
        ? {
            treesUsed: cbDetail.treesUsed,
            factorLogs: cbDetail.factorLogs,
            phi: cbDetail.treeShap.phi,
            baseValue: cbDetail.treeShap.baseValue,
          }
        : null,
      validation,
    });
  }
  return output;
}

/**
 * Derives honest horizon confidence badge and short-term anchor recommendation
 * dynamically from per-horizon holdout validation metrics (validation.final, naiveFinal, finalAll).
 */
export function evaluateHorizonConfidence(row, lastValue = null) {
  if (!row || !row.validation) {
    return {
      tier: 'unknown',
      badge: 'no better than seasonal',
      badgeRu: 'Не точнее сезонного (низкая надёжность)',
      confidence: 'low',
      defaultShortTermAnchor: 'last_observed_price',
      recommendedAnchorPoint: Number.isFinite(lastValue) ? lastValue : (row?.point ?? null),
      holdoutSummary: 'Недостаточно данных бэктеста',
    };
  }
  const v = row.validation;
  const finalMae = Number(v.final?.mae);
  const naiveMae = Number(v.naiveFinal?.mae ?? v.finalAll?.find((x) => x.id === 'naive')?.mae);
  const seasonalMae = Number(v.seasonalFinal?.mae ?? v.finalAll?.find((x) => x.id === 'seasonal')?.mae);
  const eqCarryMae = Number(v.finalAll?.find((x) => x.id === 'eq_carry')?.mae);
  const treeMae = Number(v.finalAll?.find((x) => x.id === 'catboost')?.mae);
  const selectedPoint =
    v.selected === 'catboost' && Number.isFinite(row.catboostPoint)
      ? row.catboostPoint
      : (row.point ?? row.catboostPoint ?? null);

  // 1. Short-term regime where naive (last observed price) wins or ties on holdout
  if (Number.isFinite(finalMae) && Number.isFinite(naiveMae) && finalMae >= naiveMae) {
    const eqStr = Number.isFinite(eqCarryMae) ? eqCarryMae.toFixed(2) : finalMae.toFixed(2);
    const treeStr = Number.isFinite(treeMae) ? treeMae.toFixed(2) : finalMae.toFixed(2);
    return {
      tier: 'no_better_than_last_price',
      badge: 'no better than last price',
      badgeRu: 'Не точнее последней цены (no better than last price)',
      confidence: 'low_short_term',
      defaultShortTermAnchor: 'last_observed_price',
      recommendedAnchorPoint: Number.isFinite(lastValue) ? lastValue : selectedPoint,
      finalMae,
      naiveMae,
      seasonalMae,
      eqCarryMae,
      treeMae,
      holdoutSummary: `Не точнее последней цены (no better than last price): MAE посл. цены ${naiveMae.toFixed(2)} ₽/кг против ${eqStr}–${treeStr} ₽/кг (выбранная ${finalMae.toFixed(2)} ₽/кг). Ориентир по умолчанию — последняя цена.`,
    };
  }

  // 2. Medium-term regime where model beats both naive and seasonal-naive by a statistically meaningful margin (>= 1.5 RUB/kg)
  const seasonalGain = Number.isFinite(seasonalMae) && Number.isFinite(finalMae) ? seasonalMae - finalMae : 0;
  if (Number.isFinite(finalMae) && Number.isFinite(seasonalMae) && seasonalGain >= 1.5) {
    const gainPct = seasonalMae > 0 ? Math.round((seasonalGain / seasonalMae) * 100) : 0;
    return {
      tier: 'beats_seasonal_naive',
      badge: 'beats seasonal-naive',
      badgeRu: 'Точнее сезонного наивного (beats seasonal-naive)',
      confidence: 'medium',
      defaultShortTermAnchor: 'selected_model',
      recommendedAnchorPoint: selectedPoint,
      finalMae,
      naiveMae,
      seasonalMae,
      eqCarryMae,
      treeMae,
      holdoutSummary: `Точнее сезонного наивного (beats seasonal-naive) на ${seasonalGain.toFixed(2)} ₽/кг (−${gainPct}%: MAE ${finalMae.toFixed(2)} против ${seasonalMae.toFixed(2)} ₽/кг).`,
    };
  }

  // 3. Long-term / low-confidence regime where model does not statistically beat seasonal-naive
  return {
    tier: 'no_better_than_seasonal',
    badge: 'no better than seasonal',
    badgeRu: 'Не точнее сезонного · низкая надёжность (no better than seasonal)',
    confidence: 'low',
    defaultShortTermAnchor: 'seasonal_or_model_low_confidence',
    recommendedAnchorPoint: selectedPoint,
    finalMae,
    naiveMae,
    seasonalMae,
    eqCarryMae,
    treeMae,
    holdoutSummary: `Не точнее сезонного · низкая надёжность (no better than seasonal): MAE ${Number.isFinite(finalMae) ? finalMae.toFixed(2) : '—'} против сезонного ${Number.isFinite(seasonalMae) ? seasonalMae.toFixed(2) : '—'} ₽/кг.`,
  };
}

