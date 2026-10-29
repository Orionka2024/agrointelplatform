/**
 * Data provenance / freshness classification shared by every screen.
 *
 *   observed    – imported market observation (stored on the server), fresh
 *   live        – fetched from an external API in this session / today
 *   cached      – previously fetched value, not re-verified in this session
 *   manual      – typed in by the user (an assumption, not a market observation)
 *   demo        – illustrative number shipped with the app, NOT market data
 *   stale       – older than the freshness limit for that kind of data (whatever its origin)
 *   unavailable – no value
 */
import { daysBetween } from './dates.js';

export const STATUS_LABELS = {
  observed: 'наблюдение',
  live: 'live',
  cached: 'кэш',
  manual: 'вручную',
  demo: 'ДЕМО',
  stale: 'устарело',
  unavailable: 'нет данных',
};

export const FRESHNESS_DAYS = {
  priceObservation: 21,
  macroDaily: 3,
  manualPrice: 30,
  indicator: 21,
};

/**
 * @param {{origin:'observed'|'live'|'cached'|'manual'|'demo', value:any, asOf?:string|null, today:string, staleDays:number}} p
 */
export function classifyFreshness({ origin, value, asOf = null, today, staleDays }) {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
    return { status: 'unavailable', origin: null, asOf: null, ageDays: null };
  }
  if (origin === 'demo') return { status: 'demo', origin, asOf, ageDays: null };
  const ageDays = asOf ? daysBetween(asOf, today) : null;
  if (ageDays === null) {
    // value without a date can never be called fresh
    return { status: origin === 'manual' ? 'manual' : 'stale', origin, asOf: null, ageDays: null, undated: true };
  }
  if (ageDays > staleDays) return { status: 'stale', origin, asOf, ageDays };
  return { status: origin, asOf, ageDays, origin };
}
