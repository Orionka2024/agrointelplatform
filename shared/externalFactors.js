/**
 * External (non-price-feed) factors that can move the Russian onion price:
 * Iran / Iraq trade policy and border crossings, Uzbek & Kazakh export prices,
 * Volgograd buyer bids, data gaps. These have no free daily API, so they are kept
 * as dated entries in data/market-events.json and evaluated here.
 *
 * impact:     +1 = better for the Russian farmer (supports price), -1 = worse, 0 = neutral/watch
 * confirmed:  true = backed by an official/statistical source, false = report or inference only
 */

export const EVENT_STALE_DAYS = 14;

const WEIGHT_CONFIRMED = 3;
const WEIGHT_UNCONFIRMED = 1;
const MAX_ADJUSTMENT = 15;

function daysBetween(fromIso, toIso) {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.floor((b - a) / 86400000);
}

export function evaluateExternalFactors(events, todayIso) {
  const list = Array.isArray(events) ? events : [];
  const active = [];
  const stale = [];

  for (const e of list) {
    const ageDays = daysBetween(e.asOf, todayIso);
    const item = { ...e, ageDays };
    if (ageDays > EVENT_STALE_DAYS) stale.push(item);
    else active.push(item);
  }

  const rawScore = active.reduce(
    (sum, e) => sum + (Number(e.impact) || 0) * (e.confirmed ? WEIGHT_CONFIRMED : WEIGHT_UNCONFIRMED),
    0
  );
  const adjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, rawScore));

  return {
    adjustment,
    active,
    stale,
    positives: active.filter((e) => e.impact > 0),
    negatives: active.filter((e) => e.impact < 0),
    watch: active.filter((e) => !e.impact),
  };
}

/**
 * Trend of the Volgograd spot price versus the previous recorded observation.
 * `history` is an array of { date, value } sorted ascending; returns null if not enough data.
 */
export function computeSpotTrend(history, windowDays = 7) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const last = history[history.length - 1];
  const past = [...history]
    .reverse()
    .find((h) => h.date !== last.date && daysBetween(h.date, last.date) >= windowDays);
  const ref = past || history[0];
  if (!ref || ref.date === last.date || !(ref.value > 0)) return null;
  const changePct = +(((last.value - ref.value) / ref.value) * 100).toFixed(1);
  return { from: ref.date, to: last.date, fromValue: ref.value, toValue: last.value, changePct };
}
