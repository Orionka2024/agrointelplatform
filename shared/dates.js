/**
 * Date helpers. All dates are ISO calendar dates (YYYY-MM-DD) handled in UTC so that
 * results never depend on the machine's time zone or on "now".
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

export function parseISODate(s) {
  if (typeof s !== 'string') return null;
  const m = ISO_RE.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // reject overflow such as 2026-02-31
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return d;
}

export function isISODate(s) {
  return parseISODate(s) !== null;
}

export function toISO(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = parseISODate(iso);
  if (!d) throw new Error(`Invalid ISO date: ${iso}`);
  return toISO(new Date(d.getTime() + n * DAY_MS));
}

export function daysBetween(fromIso, toIso) {
  const a = parseISODate(fromIso);
  const b = parseISODate(toIso);
  if (!a || !b) throw new Error(`Invalid ISO date: ${fromIso} / ${toIso}`);
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Monday of the week containing the date. */
export function weekStart(iso) {
  const d = parseISODate(iso);
  if (!d) throw new Error(`Invalid ISO date: ${iso}`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return toISO(new Date(d.getTime() - dow * DAY_MS));
}

export function addWeeks(weekIso, n) {
  return addDays(weekIso, n * 7);
}

export function weeksBetween(fromWeekIso, toWeekIso) {
  return Math.round(daysBetween(fromWeekIso, toWeekIso) / 7);
}

/** Today's date as ISO from an injectable clock (never call new Date() inside calculations). */
export function todayISO(now = new Date()) {
  return toISO(now);
}
