/**
 * Forecast issuance. A forecast is a dated, immutable record:
 *   issueDate, inputCutoff (last observation week used), target dates, model id/version, validation and provenance.
 * It is created by an explicit call with an explicit issueDate; nothing here reads the wall clock,
 * and an old record is never re-dated to "today".
 */
import { weekStart, addWeeks, weeksBetween } from './dates.js';
import { buildWeeklySeries, pointsToMap, describeSeries } from './series.js';
import { rollingOriginBacktest } from './backtest.js';
import { HORIZONS, MODELS, MODEL_VERSION, conformalQuantile } from './models.js';
import { hash32 } from './observations.js';
import { TARGET_SPECS, PRICE_UNIT } from './spec.js';

export const MAX_DATA_AGE_WEEKS_FOR_ISSUE = 1; // latest observed week may lag the issue week by at most 1 week

export function issueForecast({ observations, basis, issueDate, kind = 'transaction', publishLagDays = 0, now = null, backtestOpts = {}, horizons = HORIZONS }) {
  const target = TARGET_SPECS[basis];
  const series = buildWeeklySeries(observations, { basis, kind, asOf: issueDate, publishLagDays });
  const desc = describeSeries(series.points);
  const issueWeek = weekStart(issueDate);
  const base = {
    schema: 1,
    mode: 'observed',
    basis,
    issueDate,
    issuedAt: now,
    unit: PRICE_UNIT,
    target: { id: target.id, label: target.label, market: target.market, deliveryBasis: target.deliveryBasis, vat: 'excl' /* every series is normalised to ex-VAT */, kind },
    modelVersion: MODEL_VERSION,
    provenance: {
      seriesKey: `${target.market}|${kind}`,
      nObservations: series.used,
      nWeeks: desc.n, firstWeek: desc.firstWeek, lastWeek: desc.lastWeek,
      sources: [...new Set(series.points.flatMap(p => p.sources))].sort(),
      excluded: series.excluded,
      inputHash: hash32(series.usedIds.join(',')),
    },
    inputCutoff: desc.lastWeek,
    horizons: [],
    validation: null,
    reasons: [],
  };
  const idOf = rec => ({ ...rec, id: `fc-${hash32(`${rec.basis}|${rec.issueDate}|${rec.provenance.inputHash}|${rec.modelVersion}`)}` });

  if (desc.n === 0) {
    return idOf({ ...base, status: 'insufficient_data', reasons: ['Нет наблюдений по этому ряду (рынок/тип цены/базис/НДС).'] });
  }
  const lag = weeksBetween(desc.lastWeek, issueWeek);
  if (lag > MAX_DATA_AGE_WEEKS_FOR_ISSUE) {
    return idOf({ ...base, status: 'insufficient_data', reasons: [`Последнее наблюдение: неделя ${desc.lastWeek} (${lag} нед. до даты выпуска) — данные устарели.`] });
  }

  const map = pointsToMap(series.points);
  const origin = desc.lastWeek;
  const bt = rollingOriginBacktest(series.points, backtestOpts);
  const rows = [];
  let anyValidated = false;
  for (const h of horizons) {
    const v = bt.horizons[h];
    const validated = v?.status === 'ok';
    let modelId = validated && v.confirmedInHoldout ? v.selected : 'naive';
    let point = MODELS[modelId].predict(map, origin, h);
    if (point == null) { modelId = 'naive'; point = MODELS.naive.predict(map, origin, h); }
    const abs = bt.errors[modelId]?.[h]?.map(r => r.abs) ?? [];
    let interval = null;
    if (validated) {
      const q80 = conformalQuantile(abs, 0.8);
      const q95 = conformalQuantile(abs, 0.95);
      interval = {
        nCalibration: abs.length,
        lo80: q80 == null ? null : Math.max(0, point - q80), hi80: q80 == null ? null : point + q80,
        lo95: q95 == null ? null : Math.max(0, point - q95), hi95: q95 == null ? null : point + q95,
      };
      anyValidated = true;
    }
    const targetWeek = addWeeks(origin, h);
    rows.push({
      h, targetWeekStart: targetWeek, targetDate: targetWeek,
      point: +point.toFixed(2), modelId, validated, interval,
      note: validated ? null : (v?.reason || 'Нет валидации'),
    });
  }
  return idOf({
    ...base,
    status: anyValidated ? 'validated' : 'baseline_unvalidated',
    horizons: rows,
    validation: {
      method: 'rolling-origin, purged tuning/final split, out-of-sample conformal intervals',
      params: bt.params, split: bt.split,
      byHorizon: Object.fromEntries(horizons.map(h => [h, bt.horizons[h] ? { ...bt.horizons[h] } : null])),
    },
    reasons: anyValidated ? [] : ['История недостаточна для валидации: показана только цена «без изменений», интервалы недоступны.'],
  });
}

/** Is a stored forecast still current relative to the data? Never re-dates the record. */
export function forecastAgeDays(record, todayIso) {
  return Math.round((Date.parse(todayIso) - Date.parse(record.issueDate)) / 86400000);
}

