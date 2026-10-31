import { USER_PRICE_MARKETS } from '../../shared/localBasis.js';

const PRICES_KEY = 'agro_user_prices';
const ASSUMPTIONS_KEY = 'agro_user_assumptions';

const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

export function isValidUserPriceEntry(e) {
  return Boolean(
    e &&
      USER_PRICE_MARKETS[e.basis] &&
      isIso(e.date) &&
      Number(e.price) > 0 &&
      ['excl', 'incl'].includes(e.vat)
  );
}

export function loadStoredUserPrices() {
  try {
    const raw = JSON.parse(localStorage.getItem(PRICES_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(isValidUserPriceEntry) : [];
  } catch {
    return [];
  }
}

export function saveStoredUserPrices(list) {
  try {
    localStorage.setItem(PRICES_KEY, JSON.stringify(list.filter(isValidUserPriceEntry)));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Adds or updates a user-attested price for (basis, date) in browser storage
 * so repeated edits on the same day update cleanly instead of averaging old typos.
 */
export function upsertStoredUserPrice(entry) {
  if (!isValidUserPriceEntry(entry)) return loadStoredUserPrices();
  const list = loadStoredUserPrices().filter(
    (x) => !(x.basis === entry.basis && x.date === entry.date)
  );
  list.push({
    basis: entry.basis,
    date: entry.date,
    price: Number(entry.price),
    vat: entry.vat,
  });
  saveStoredUserPrices(list);
  return list;
}

export function clearStoredUserPrices() {
  try {
    localStorage.removeItem(PRICES_KEY);
    localStorage.removeItem(ASSUMPTIONS_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function loadStoredAssumptions() {
  try {
    const raw = JSON.parse(localStorage.getItem(ASSUMPTIONS_KEY) || 'null');
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

export function mergeStoredAssumptions(patch) {
  if (!patch || typeof patch !== 'object') return loadStoredAssumptions();
  const prev = loadStoredAssumptions() || {};
  const next = {
    ...prev,
    ...patch,
    bridge: patch.bridge ? { ...(prev.bridge || {}), ...patch.bridge } : prev.bridge,
    storage: patch.storage ? { ...(prev.storage || {}), ...patch.storage } : prev.storage,
    manualPrices: patch.manualPrices
      ? { ...(prev.manualPrices || {}), ...patch.manualPrices }
      : prev.manualPrices,
  };
  try {
    localStorage.setItem(ASSUMPTIONS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return next;
}
