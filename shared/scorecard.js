/**
 * Forecast Scorecard: tracking realized performance of immutable issued forecasts
 * against actual arrival prices (Rosstat producer or user transactions).
 * Benchmarks against naive (last price) and seasonal-naive baselines.
 */
import { monthNumber } from './officialForecast.js';

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

/**
 * Computes realized error and baseline benchmarks for a single target period prediction.
 */
export function computeRealizedErrors({
  targetMonth,
  point,
  baseValue,
  actualsMap,
  historyMap,
}) {
  const actual = actualsMap.get(targetMonth);
  if (!Number.isFinite(actual)) {
    return {
      targetMonth,
      point,
      actual: null,
      status: 'pending',
      error: null,
      absError: null,
      ape: null,
      naivePoint: baseValue,
      naiveError: null,
      seasonalPoint: null,
      seasonalError: null,
      directionMatched: null,
    };
  }

  const error = point - actual;
  const absError = Math.abs(error);
  const ape = actual > 0 ? (absError / actual) * 100 : null;

  // Naive benchmark: value at last observation cutoff
  const naivePoint = Number.isFinite(baseValue) ? baseValue : null;
  const naiveError = naivePoint !== null ? Math.abs(naivePoint - actual) : null;

  // Seasonal naive benchmark: same month of prior year (12 months prior)
  let seasonalPoint = null;
  let seasonalError = null;
  try {
    const priorTargetMonthNum = monthNumber(targetMonth) - 12;
    const priorPeriod = `${Math.floor(priorTargetMonthNum / 12)}-${String((priorTargetMonthNum % 12) + 1).padStart(2, '0')}`;
    seasonalPoint = historyMap.get(priorPeriod) ?? null;
    if (Number.isFinite(seasonalPoint)) {
      seasonalError = Math.abs(seasonalPoint - actual);
    }
  } catch {
    // Non-standard period format fallback
  }

  const directionMatched =
    Number.isFinite(baseValue) && baseValue > 0
      ? Math.sign(point - baseValue) === Math.sign(actual - baseValue)
      : null;

  return {
    targetMonth,
    point,
    actual,
    status: 'realized',
    error: +error.toFixed(4),
    absError: +absError.toFixed(4),
    ape: ape !== null ? +ape.toFixed(2) : null,
    naivePoint,
    naiveError: naiveError !== null ? +naiveError.toFixed(4) : null,
    seasonalPoint,
    seasonalError: seasonalError !== null ? +seasonalError.toFixed(4) : null,
    directionMatched,
  };
}

/**
 * Builds the complete forecast scorecard from issued forecasts and actual arrival series.
 */
export function buildForecastScorecard(issuedForecasts = [], actuals = []) {
  const forecasts = Array.isArray(issuedForecasts) ? issuedForecasts : [];
  const actualsArray = Array.isArray(actuals)
    ? actuals
    : Array.isArray(actuals?.producer?.monthly)
      ? actuals.producer.monthly
      : [];

  const actualsMap = new Map();
  const historyMap = new Map();
  for (const item of actualsArray) {
    const key = item.period || item.month || (item.date ? item.date.slice(0, 7) : null);
    const val = Number(item.value ?? item.price);
    if (key && Number.isFinite(val)) {
      actualsMap.set(key, val);
      historyMap.set(key, val);
    }
  }

  const realizedRows = [];
  const pendingRows = [];
  const issueSummaries = [];

  for (const fc of forecasts) {
    const rows = Array.isArray(fc.rows)
      ? fc.rows
      : Array.isArray(fc.points)
        ? fc.points
        : [];
    const baseVal = Number(fc.lastValue ?? fc.baseValue ?? fc.rows?.[0]?.baseValue);
    const issueRealized = [];
    const issuePending = [];

    for (const r of rows) {
      const targetMonth = r.targetMonth || r.month || (r.date ? r.date.slice(0, 7) : null);
      const point = Number(r.point ?? r.price);
      if (!targetMonth || !Number.isFinite(point)) continue;

      const evalResult = computeRealizedErrors({
        targetMonth,
        point,
        baseValue: baseVal,
        actualsMap,
        historyMap,
      });

      const enriched = {
        forecastId: fc.id,
        issueDate: fc.issueDate,
        dataCutoff: fc.dataCutoff || fc.inputCutoff,
        modelVersion: fc.modelVersion,
        inputsHash: fc.inputsHash || fc.provenance?.inputHash,
        lead: r.lead ?? r.h ?? null,
        h: r.h ?? r.lead ?? null,
        ...evalResult,
      };

      if (evalResult.status === 'realized') {
        realizedRows.push(enriched);
        issueRealized.push(enriched);
      } else {
        pendingRows.push(enriched);
        issuePending.push(enriched);
      }
    }

    issueSummaries.push({
      id: fc.id,
      issueDate: fc.issueDate,
      dataCutoff: fc.dataCutoff || fc.inputCutoff,
      modelVersion: fc.modelVersion,
      inputsHash: fc.inputsHash || fc.provenance?.inputHash,
      realizedCount: issueRealized.length,
      pendingCount: issuePending.length,
      modelMae: issueRealized.length ? +mean(issueRealized.map((x) => x.absError)).toFixed(2) : null,
      naiveMae: issueRealized.length ? +mean(issueRealized.filter((x) => x.naiveError !== null).map((x) => x.naiveError)).toFixed(2) : null,
      directionalHitRate:
        issueRealized.filter((x) => x.directionMatched !== null).length > 0
          ? +mean(issueRealized.filter((x) => x.directionMatched !== null).map((x) => (x.directionMatched ? 1 : 0))).toFixed(2)
          : null,
    });
  }

  // Horizon grouping
  const horizonGroups = new Map();
  for (const r of realizedRows) {
    const key = r.lead ?? r.h ?? 1;
    if (!horizonGroups.has(key)) horizonGroups.set(key, []);
    horizonGroups.get(key).push(r);
  }

  const byHorizon = [...horizonGroups.entries()]
    .map(([lead, group]) => {
      const modelMae = +mean(group.map((x) => x.absError)).toFixed(2);
      const naiveErrors = group.filter((x) => x.naiveError !== null).map((x) => x.naiveError);
      const naiveMae = naiveErrors.length ? +mean(naiveErrors).toFixed(2) : null;
      const seasonalErrors = group.filter((x) => x.seasonalError !== null).map((x) => x.seasonalError);
      const seasonalMae = seasonalErrors.length ? +mean(seasonalErrors).toFixed(2) : null;
      const dirItems = group.filter((x) => x.directionMatched !== null);
      const directionalHitRate = dirItems.length ? +mean(dirItems.map((x) => (x.directionMatched ? 1 : 0))).toFixed(2) : null;

      return {
        lead,
        h: lead,
        n: group.length,
        modelMae,
        naiveMae,
        seasonalMae,
        beatsNaive: naiveMae !== null ? modelMae < naiveMae : null,
        beatsSeasonal: seasonalMae !== null ? modelMae < seasonalMae : null,
        directionalHitRate,
      };
    })
    .sort((a, b) => a.lead - b.lead);

  // Rolling 12-month metrics (targetMonth in the latest 12 realized months)
  const allRealizedMonths = [...new Set(realizedRows.map((r) => r.targetMonth))].sort();
  const rolling12CutoffSet = new Set(allRealizedMonths.slice(-12));
  const rollingRows = realizedRows.filter((r) => rolling12CutoffSet.has(r.targetMonth));
  const rollingNaiveErrors = rollingRows.filter((x) => x.naiveError !== null).map((x) => x.naiveError);
  const rollingSeasonalErrors = rollingRows.filter((x) => x.seasonalError !== null).map((x) => x.seasonalError);
  const rollingDirItems = rollingRows.filter((x) => x.directionMatched !== null);

  const rolling12m = {
    monthsIncluded: [...rolling12CutoffSet],
    evaluatedN: rollingRows.length,
    modelMae: rollingRows.length ? +mean(rollingRows.map((x) => x.absError)).toFixed(2) : null,
    naiveMae: rollingNaiveErrors.length ? +mean(rollingNaiveErrors).toFixed(2) : null,
    seasonalMae: rollingSeasonalErrors.length ? +mean(rollingSeasonalErrors).toFixed(2) : null,
    directionalHitRate: rollingDirItems.length ? +mean(rollingDirItems.map((x) => (x.directionMatched ? 1 : 0))).toFixed(2) : null,
  };

  return {
    totalIssues: forecasts.length,
    realizedPointsCount: realizedRows.length,
    pendingPointsCount: pendingRows.length,
    overallModelMae: realizedRows.length ? +mean(realizedRows.map((x) => x.absError)).toFixed(2) : null,
    byHorizon,
    rolling12m,
    issues: issueSummaries,
    realizedRows,
    pendingRows,
  };
}
