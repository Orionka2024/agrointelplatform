/**
 * Transparent baseline forecasting models.
 *
 *  - naive:            "price stays at the latest observed weekly price" (random-walk baseline)
 *  - seasonal_ratio:   latest price × mean historical log-ratio between the target week and the
 *                      origin week in prior years. Needs >= MIN_SEASONAL_YEARS comparable years.
 *
 * Both predictors receive only a Map(week → price) that the caller has already truncated to
 * information available at the origin. They never look at wall-clock time.
 */
import { addWeeks, weeksBetween } from './dates.js';
import { valueNear } from './series.js';

export const HORIZONS = [1, 4, 8, 13, 26];
export const MODEL_VERSION = 'evidence-2.0.0';
export const MAX_STALE_WEEKS = 3;
export const MIN_SEASONAL_YEARS = 2;
export const MAX_SEASONAL_YEARS = 4;

export function lastWeekAtOrBefore(map, week, maxBack = MAX_STALE_WEEKS) {
  for (let d = 0; d <= maxBack; d++) {
    const w = addWeeks(week, -d);
    if (map.has(w)) return { week: w, value: map.get(w) };
  }
  return null;
}

export function predictNaive(map, origin) {
  const last = lastWeekAtOrBefore(map, origin);
  return last ? last.value : null;
}

export function predictSeasonalRatio(map, origin, h) {
  const base = predictNaive(map, origin);
  if (base == null) return null;
  const logs = [];
  for (let k = 1; k <= MAX_SEASONAL_YEARS; k++) {
    const a = valueNear(map, addWeeks(origin, -52 * k));
    const b = valueNear(map, addWeeks(origin, h - 52 * k));
    if (a === undefined || b === undefined || a <= 0 || b <= 0) continue;
    logs.push(Math.log(b / a));
  }
  if (logs.length < MIN_SEASONAL_YEARS) return null;
  const mean = logs.reduce((s, x) => s + x, 0) / logs.length;
  return base * Math.exp(mean);
}

export const MODELS = {
  naive: { id: 'naive', label: 'Без изменений (последняя цена)', predict: (map, origin) => predictNaive(map, origin) },
  seasonal_ratio: { id: 'seasonal_ratio', label: 'Сезонное отношение прошлых лет', predict: predictSeasonalRatio },
};

/** Finite-sample split-conformal quantile of absolute errors. Returns null if n too small. */
export function conformalQuantile(absErrors, level) {
  const n = absErrors.length;
  const k = Math.ceil((n + 1) * level);
  if (n === 0 || k > n) return null;
  const s = [...absErrors].sort((a, b) => a - b);
  return s[k - 1];
}

export function truncateMap(points, origin) {
  const m = new Map();
  for (const p of points) {
    if (weeksBetween(p.week, origin) >= 0) m.set(p.week, p.value);
  }
  return m;
}
