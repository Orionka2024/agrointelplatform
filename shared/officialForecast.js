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
  eq_carry: 'Сезонное равновесие Weibull (медиана 24 мес. + затухание шока)',
  drivers: 'Обученная модель: сезонность + USD/RUB + ставка ЦБ (ridge)',
  catboost: 'CatBoost GBDT: сезонность + KZT/USD + ставка ЦБ + розница + погода ERA5',
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
  // Purge lead months so selection ends before the first calibration origin,
  // and calibration targets mature before the first final-test origin.
  const calibrationEnd = finalStart - lead - 1;
  const calibrationStart = calibrationEnd - 7;
  const tuningEnd = calibrationStart - lead - 1;

  const records = collectHorizonRecords(points, first, 11, n - 1, lead, ids, ctx);

  // If long lead leaves <6 direct tuning targets before tuningEnd, pool medium-horizon
  // predictions (leads >=3) whose targets still mature strictly <= tuningEnd (zero leakage).
  let tuneRecords = records;
  if (tuningEnd - 11 < lead + 5) {
    const maxTuneLead = Math.max(1, Math.min(lead, tuningEnd - 11));
    const minTuneLead = Math.min(3, maxTuneLead);
    tuneRecords = Object.fromEntries(ids.map((id) => [id, []]));
    for (let tl = minTuneLead; tl <= maxTuneLead; tl++) {
      const sub = collectHorizonRecords(points, first, 11, tuningEnd, tl, ids, ctx);
      for (const id of ids) {
        for (const r of sub[id]) tuneRecords[id].push({ ...r, target: `${r.target}@L${tl}` });
      }
    }
  }

  let selected = 'naive';
  const comparisons = [];
  for (const id of ids.filter((x) => x !== 'naive')) {
    const rows = tuneRecords[id].filter((r) => r.targetIndex <= tuningEnd);
    const targets = new Set(rows.map((r) => r.target));
    const base = tuneRecords.naive.filter((r) => targets.has(r.target));
    const ratio = rows.length >= 6 && summary(base).mae > 0 ? summary(rows).mae / summary(base).mae : null;
    comparisons.push({ id, n: rows.length, mae: summary(rows).mae, naiveMAE: summary(base).mae, ratio });
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

  return {
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
