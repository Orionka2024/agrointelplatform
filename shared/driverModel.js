/** Small ridge regression used for the trained monthly candidates.
 * Target: log(P[t+lead]/P[t]). Features are known at the forecast origin t only:
 *   - month-of-year of the TARGET (sin/cos)               -> 'season'
 *   - + 3-month log change of USD/RUB, key rate level and 3-month key-rate change -> 'drivers'
 * Training uses only (origin', target') pairs whose target month is <= the current origin,
 * so a prediction never sees data it would not have had. No effect size is hard-coded:
 * coefficients are fitted from the public history and are NOT interpreted as causal.
 */
export const RIDGE_LAMBDA = 5;
export const MIN_TRAIN_ROWS = 24;

export function monthIdx(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Invalid month');
  return Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;
}
export function driverMaps(drivers) {
  if (!drivers) return null;
  const toMap = rows => new Map((rows || []).map(r => [monthIdx(r.period), r.value]));
  return {usd: toMap(drivers.usdRub), key: toMap(drivers.keyRate)};
}
export function featureVector(kind, maps, origin, lead) {
  const m = (origin + lead) % 12;
  const f = [Math.sin(2 * Math.PI * m / 12), Math.cos(2 * Math.PI * m / 12)];
  if (kind === 'season') return f;
  if (!maps) return null;
  const u0 = maps.usd.get(origin), u3 = maps.usd.get(origin - 3);
  const k0 = maps.key.get(origin), k3 = maps.key.get(origin - 3);
  if (!(u0 > 0 && u3 > 0) || !Number.isFinite(k0) || !Number.isFinite(k3)) return null;
  return [...f, Math.log(u0 / u3), k0, k0 - k3];
}
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function fitRidge(X, y, lambda = RIDGE_LAMBDA) {
  const p = X[0].length;
  const mean = Array.from({length: p}, (_, j) => avg(X.map(r => r[j])));
  const sd = Array.from({length: p}, (_, j) => Math.sqrt(avg(X.map(r => (r[j] - mean[j]) ** 2))) || 1);
  const ym = avg(y);
  const Z = X.map(r => r.map((v, j) => (v - mean[j]) / sd[j]));
  const A = Array.from({length: p}, (_, i) => Array.from({length: p}, (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? lambda : 0)));
  const b = Array.from({length: p}, (_, i) => Z.reduce((s, r, k) => s + r[i] * (y[k] - ym), 0));
  const beta = solve(A, b);
  return beta ? {mean, sd, beta, ym} : null;
}
export function predictRidge(model, x) {
  return model.ym + model.beta.reduce((s, b, j) => s + b * (x[j] - model.mean[j]) / model.sd[j], 0);
}
/** @param byMonth Map(monthIdx -> price) containing only months <= origin */
export function ridgePredict(kind, byMonth, maps, origin, lead) {
  const base = byMonth.get(origin);
  if (!(base > 0) || lead < 1) return null;
  const X = [], y = [];
  for (const [o2, p0] of byMonth) {
    const p1 = byMonth.get(o2 + lead);
    if (o2 + lead > origin || !(p0 > 0) || !(p1 > 0)) continue;
    const f = featureVector(kind, maps, o2, lead);
    if (!f) continue;
    X.push(f); y.push(Math.log(p1 / p0));
  }
  if (X.length < MIN_TRAIN_ROWS) return null;
  const model = fitRidge(X, y);
  const f = featureVector(kind, maps, origin, lead);
  if (!model || !f) return null;
  const out = base * Math.exp(predictRidge(model, f));
  return Number.isFinite(out) && out > 0 ? out : null;
}
