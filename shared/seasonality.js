/**
 * Seasonal selling pressure.
 *
 * Nothing here is derived from a forecast row number or a fixed month narrative. A seasonal pressure is
 * reported as ACTIVE only when a dated, recent observation supports it; the reason and the supporting
 * observation date are returned with it. Phases may overlap and are evaluated per region / crop year /
 * storage type. The strength of the effect on PRICE is never asserted unless a lag/response was estimated
 * from history (estimateLag); otherwise priceImpact is null and the UI must say "not quantified".
 *
 * Selling timing (when onions are sold) and price response (when the market price moves) are different
 * things; the lag between them is estimated from data, never assumed.
 */
import { daysBetween, parseISODate, weekStart, addWeeks } from './dates.js';

export const SEASONAL_PHASES = {
  field_sales: {
    label: 'Активная уборка и продажи с поля',
    indicators: ['harvest_progress_pct', 'field_sales_volume_t'],
  },
  temp_storage_liquidation: {
    label: 'Ликвидация запасов из временного / неподходящего хранения',
    indicators: ['temp_storage_stock_t'],
  },
  quality_driven: {
    label: 'Вынужденные продажи из-за потери качества (гниль, влага, проращивание, подмерзание)',
    indicators: ['quality_loss_share_pct'],
  },
  planned_release: {
    label: 'Плановые отгрузки из долгосрочного хранения',
    indicators: ['long_term_release_t'],
  },
  incoming_supply: {
    label: 'Импорт и поступления нового урожая',
    indicators: ['import_arrivals_t', 'newcrop_arrivals_t'],
  },
};

export const SEASONAL_STALE_DAYS = 21;

/**
 * Candidate calendar windows that were mentioned in undated secondary web summaries. They are NOT verified against
 * dated primary sources and are NOT used in any calculation or forecast. They are scenario assumptions to be
 * verified (e.g. Минсельхоз Волгоградской области, Росстат, Минсельхоз РК, EastFruit bulletins).
 */
export const UNVERIFIED_CALENDAR_LEADS = [
  { region: 'Волгоградская обл.', event: 'Основная уборка репчатого лука', window: 'август – сентябрь (по разным годам различается)', status: 'unverified', verify: 'ежегодные сводки комитета сельского хозяйства Волгоградской обл. (даты уборки по годам)' },
  { region: 'Казахстан (Жамбылская обл.)', event: 'Основная уборка и закладка лука', window: 'август – октябрь', status: 'unverified', verify: 'Минсельхоз РК, статистика по областям' },
  { region: 'Узбекистан', event: 'Ранний лук нового урожая на экспорт', window: 'апрель – май', status: 'unverified', verify: 'EastFruit, статистика экспорта Узбекистана' },
];

export function calendarFeatures(isoDate) {
  const d = parseISODate(isoDate);
  if (!d) throw new Error(`Invalid date ${isoDate}`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - start) / 86400000) + 1;
  return { date: isoDate, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, dayOfYear, weekStart: weekStart(isoDate) };
}

function groupKey(o) {
  return [o.indicator, o.region, o.cropYear || '', o.storageType || ''].join('|');
}

/**
 * @param {{asOf:string, indicators:object[], staleDays?:number, lagEvidence?:Record<string,{lagWeeks:number,corr:number,n:number}>}} p
 */
export function evaluateSeasonalPressure({ asOf, indicators = [], staleDays = SEASONAL_STALE_DAYS, lagEvidence = {} }) {
  const usable = indicators.filter(o => o.observationDate <= asOf);
  if (usable.length === 0) {
    return {
      status: 'no_observations', asOf, pressures: [],
      note: 'Нет наблюдений сезонных индикаторов (ход уборки, запасы, поступления, качество). Сезонное давление не определено. Календарные окна ниже — только непроверенные допущения.',
    };
  }
  const latest = new Map();
  for (const o of usable) {
    const k = groupKey(o);
    const cur = latest.get(k);
    if (!cur || o.observationDate > cur.observationDate) latest.set(k, o);
  }
  const pressures = [];
  for (const o of latest.values()) {
    const phaseId = Object.keys(SEASONAL_PHASES).find(p => SEASONAL_PHASES[p].indicators.includes(o.indicator));
    if (!phaseId) continue;
    const age = daysBetween(o.observationDate, asOf);
    const stale = age > staleDays;
    let supports = false;
    let reason = '';
    if (o.indicator === 'harvest_progress_pct') {
      supports = o.value > 0 && o.value < 100;
      reason = supports ? `Уборка идёт: ${o.value}% (регион: ${o.region})` : `Ход уборки ${o.value}% — фаза не активна`;
    } else if (o.indicator === 'quality_loss_share_pct') {
      supports = o.value > 0;
      reason = `Доля партий с потерей качества ${o.value}%${o.cause ? ` (причина: ${o.cause})` : ''}`;
    } else {
      supports = o.value > 0;
      reason = `${o.indicator} = ${o.value} ${o.unit}`;
    }
    const active = supports && !stale;
    const lag = lagEvidence[phaseId] || null;
    pressures.push({
      phase: phaseId, label: SEASONAL_PHASES[phaseId].label,
      active, stale,
      reason: stale ? `${reason} — последнее наблюдение ${age} дн. назад (старше ${staleDays} дн.), не считается активным` : reason,
      region: o.region, cropYear: o.cropYear, storageType: o.storageType,
      supportingObservationDate: o.observationDate, source: o.source, ageDays: age,
      evidence: 'observed',
      priceImpact: lag ? { lagWeeks: lag.lagWeeks, correlation: lag.corr, n: lag.n, kind: 'estimated_from_history' } : null,
      priceImpactNote: lag ? 'Лаг оценён по истории (корреляция ≠ причинность).' : 'Сила и лаг влияния на цену не оценены — количественный эффект не показывается.',
    });
  }
  pressures.sort((a, b) => (a.phase < b.phase ? -1 : a.phase > b.phase ? 1 : 0));
  return { status: 'ok', asOf, pressures };
}

/**
 * Lag between a weekly driver (e.g. field sales volume) and the weekly price, from first differences.
 * Returns the lag with the largest |correlation| only if it exceeds the 2/√n significance heuristic and
 * n >= minN; otherwise no lag is asserted.
 */
export function estimateLag(driverPoints, pricePoints, { maxLag = 8, minN = 40 } = {}) {
  const dMap = new Map(driverPoints.map(p => [p.week, p.value]));
  const pMap = new Map(pricePoints.map(p => [p.week, p.value]));
  const weeks = [...new Set([...dMap.keys(), ...pMap.keys()])].sort();
  if (weeks.length < 3) return { status: 'insufficient', n: 0 };
  const diff = m => {
    const out = new Map();
    for (const w of weeks) {
      const prev = addWeeks(w, -1);
      if (m.has(w) && m.has(prev)) out.set(w, m.get(w) - m.get(prev));
    }
    return out;
  };
  const dd = diff(dMap);
  const dp = diff(pMap);
  let best = null;
  for (let lag = 0; lag <= maxLag; lag++) {
    const xs = [], ys = [];
    for (const [w, x] of dd) {
      const y = dp.get(addWeeks(w, lag));
      if (y !== undefined) { xs.push(x); ys.push(y); }
    }
    const n = xs.length;
    if (n < minN) continue;
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    if (sxx === 0 || syy === 0) continue;
    const r = sxy / Math.sqrt(sxx * syy);
    if (!best || Math.abs(r) > Math.abs(best.corr)) best = { lagWeeks: lag, corr: r, n };
  }
  if (!best) return { status: 'insufficient', n: 0, minN };
  if (Math.abs(best.corr) < 2 / Math.sqrt(best.n)) return { status: 'no_significant_lag', ...best };
  return { status: 'ok', ...best };
}
