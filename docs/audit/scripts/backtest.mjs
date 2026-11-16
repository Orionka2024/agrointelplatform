// Audit backtest (read-only). Reproduces the rosstat-catboost-3.0.0 rolling-origin evaluation on a
// wider window than the app's 12-month final block, adds MAPE/sMAPE, block-bootstrap CIs vs
// seasonal-naive and naive, rolling conformal interval coverage, and permutation tests.
//
// Usage:  node docs/audit/scripts/backtest.mjs [--perm N] > docs/audit/logs/backtest.json
// Deterministic (seeded PRNG). Uses the app's own model code (shared/officialForecast.js).
import fs from 'node:fs';
import { monthlyPredict, monthNumber } from '../../../shared/officialForecast.js';
import { driverMaps } from '../../../shared/driverModel.js';
import { buildCatBoostContext } from '../../../shared/catboostModel.js';

const ISSUE = '2026-10-30'; // issue date of the bundled data/official-forecast.json
const root = new URL('../../../', import.meta.url);
const H = JSON.parse(fs.readFileSync(new URL('data/official-history.json', root)));
const D = JSON.parse(fs.readFileSync(new URL('data/official-drivers.json', root)));
const permN = Number(process.argv[process.argv.indexOf('--perm') + 1]) || 0;

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const points0 = H.producer.monthly.filter((r) => r.availableDate <= ISSUE).sort((a, b) => a.period.localeCompare(b.period));
const filt = (a) => (a || []).filter((r) => r.availableDate <= ISSUE);
const drivers0 = { usdRub: filt(D.usdRub), kztRub: filt(D.kztRub), keyRate: filt(D.keyRate),
  weather: { volgograd: filt(D.weather.volgograd), zhambyl: filt(D.weather.zhambyl) } };
const retail0 = H.retail.weekly.filter((r) => r.availableDate <= ISSUE);
const MODELS = ['naive', 'seasonal', 'season_ridge', 'drivers', 'eq_carry', 'catboost'];
const LEADS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function ctxOf(drivers, retail) { return { maps: driverMaps(drivers), cb: buildCatBoostContext(drivers, retail) }; }

function records(points, ctx, models, leads) {
  const first = monthNumber(points[0].period);
  const out = {};
  for (const lead of leads) {
    out[lead] = Object.fromEntries(models.map((m) => [m, []]));
    for (let oi = 11; oi + lead < points.length; oi++) {
      const origin = first + oi;
      const actual = points[oi + lead].value;
      for (const m of models) {
        const p = monthlyPredict(points, origin, lead, m, ctx);
        if (p == null || !Number.isFinite(p)) continue;
        out[lead][m].push({ origin: points[oi].period, target: points[oi + lead].period, ti: oi + lead, p, a: actual, base: points[oi].value });
      }
    }
  }
  return out;
}

const mae = (r) => r.reduce((s, x) => s + Math.abs(x.p - x.a), 0) / r.length;
const mape = (r) => (100 * r.reduce((s, x) => s + Math.abs(x.p - x.a) / x.a, 0)) / r.length;
const smape = (r) => (100 * r.reduce((s, x) => s + (2 * Math.abs(x.p - x.a)) / (Math.abs(x.p) + Math.abs(x.a)), 0)) / r.length;

// Moving-block bootstrap of mean(|e_m| - |e_ref|) over common targets; block = 6 months.
function blockBootDiff(rm, rref, B = 2000, block = 6) {
  const ref = new Map(rref.map((x) => [x.target, Math.abs(x.p - x.a)]));
  const d = rm.filter((x) => ref.has(x.target)).map((x) => Math.abs(x.p - x.a) - ref.get(x.target));
  const n = d.length;
  if (n < block) return { n, mean: null, lo90: null, hi90: null };
  const stats = [];
  for (let b = 0; b < B; b++) {
    let s = 0, c = 0;
    while (c < n) { const st = Math.floor(rnd() * (n - block + 1)); for (let k = 0; k < block && c < n; k++, c++) s += d[st + k]; }
    stats.push(s / n);
  }
  stats.sort((a, b) => a - b);
  return { n, mean: d.reduce((a, b) => a + b, 0) / n, lo90: stats[Math.floor(0.05 * B)], hi90: stats[Math.floor(0.95 * B)] };
}

// Rolling split-conformal: q80 from the last K matured abs errors (target <= origin) of same model/lead.
function rollingCoverage(r, K = 8) {
  let hit = 0, n = 0, width = 0;
  for (const x of r) {
    const past = r.filter((y) => y.target <= x.origin).slice(-K).map((y) => Math.abs(y.p - y.a)).sort((a, b) => a - b);
    if (past.length < K) continue;
    const i = Math.ceil((K + 1) * 0.8) - 1;
    const q = past[Math.min(i, K - 1)];
    n++; width += 2 * q; if (Math.abs(x.p - x.a) <= q) hit++;
  }
  return n ? { n, coverage80: hit / n, meanWidthRubKg: width / n } : { n: 0 };
}

function windowSummary(rec, fromTi, label) {
  const rows = [];
  for (const lead of LEADS) {
    const R = Object.fromEntries(MODELS.map((m) => [m, rec[lead][m].filter((x) => x.ti >= fromTi)]));
    // common targets across all models for fair comparison
    const common = MODELS.map((m) => new Set(R[m].map((x) => x.target))).reduce((a, s) => new Set([...a].filter((t) => s.has(t))));
    for (const m of MODELS) R[m] = R[m].filter((x) => common.has(x.target));
    const row = { lead, n: R.naive.length };
    for (const m of MODELS) row[m] = R[m].length ? { mae: +mae(R[m]).toFixed(2), mape: +mape(R[m]).toFixed(1), smape: +smape(R[m]).toFixed(1) } : null;
    for (const m of ['eq_carry', 'catboost']) {
      const vs = blockBootDiff(R[m], R.seasonal), vn = blockBootDiff(R[m], R.naive);
      row[`${m}_minus_seasonal`] = vs.mean == null ? null : { mean: +vs.mean.toFixed(2), ci90: [+vs.lo90.toFixed(2), +vs.hi90.toFixed(2)] };
      row[`${m}_minus_naive`] = vn.mean == null ? null : { mean: +vn.mean.toFixed(2), ci90: [+vn.lo90.toFixed(2), +vn.hi90.toFixed(2)] };
    }
    rows.push(row);
  }
  return { label, rows };
}

const t0 = Date.now();
const points = points0;
const ctx = ctxOf(drivers0, retail0);
const rec = records(points, ctx, MODELS, LEADS);
const n = points.length;
const out = {
  issueDate: ISSUE, nMonths: n, first: points[0].period, last: points.at(-1).period,
  independentSeasons: +(n / 12).toFixed(2),
  windows: [
    windowSummary(rec, n - 12, `last 12 targets (${points[n - 12].period}..${points.at(-1).period}) = app final block`),
    windowSummary(rec, n - 24, `last 24 targets (${points[n - 24].period}..${points.at(-1).period})`),
    windowSummary(rec, n - 36, `last 36 targets (${points[n - 36].period}..${points.at(-1).period})`),
  ],
  coverage: Object.fromEntries(LEADS.map((l) => [l, { eq_carry: rollingCoverage(rec[l].eq_carry), catboost: rollingCoverage(rec[l].catboost) }])),
  runtimeSec: null,
};

// Direction-of-change hit rate (is "rise/fall" better than a coin?) on last 24 targets.
out.directionHitRate = Object.fromEntries(LEADS.map((l) => {
  const r = rec[l].eq_carry.filter((x) => x.ti >= n - 24);
  const c = rec[l].catboost.filter((x) => x.ti >= n - 24);
  const hr = (rr) => rr.length ? +(rr.filter((x) => Math.sign(x.p - x.base) === Math.sign(x.a - x.base)).length / rr.length).toFixed(2) : null;
  return [l, { eq_carry: hr(r), catboost: hr(c), n: r.length }];
}));

// Permutation tests.
if (permN > 0) {
  const pl = [3, 6, 9];
  const shiftDrivers = (k) => {
    const sh = (arr) => arr.map((r, i) => ({ ...r, value: arr[(i + k) % arr.length].value, frostDays12C: arr[(i + k) % arr.length].frostDays12C }));
    return { usdRub: sh(drivers0.usdRub), kztRub: sh(drivers0.kztRub), keyRate: sh(drivers0.keyRate),
      weather: { volgograd: sh(drivers0.weather.volgograd), zhambyl: sh(drivers0.weather.zhambyl) } };
  };
  // (1) Driver-shift: misalign all drivers by k months; if CatBoost skill is unchanged, drivers carry no information.
  out.driverShift = [];
  for (const k of [12, 24, 36]) {
    const r2 = records(points, ctxOf(shiftDrivers(k), retail0), ['catboost', 'drivers'], pl);
    out.driverShift.push({ shiftMonths: k, ...Object.fromEntries(pl.map((l) => [`lead${l}`, {
      catboost: +mae(r2[l].catboost.filter((x) => x.ti >= n - 24)).toFixed(2),
      drivers: +mae(r2[l].drivers.filter((x) => x.ti >= n - 24)).toFixed(2),
      catboostTrue: +mae(rec[l].catboost.filter((x) => x.ti >= n - 24)).toFixed(2),
      driversTrue: +mae(rec[l].drivers.filter((x) => x.ti >= n - 24)).toFixed(2),
    }])) });
  }
  // (2) Shuffled target: permute the monthly price values (destroys seasonality and persistence).
  out.shuffledTarget = [];
  for (let p = 0; p < permN; p++) {
    const vals = points.map((x) => x.value);
    for (let i = vals.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; }
    const pts = points.map((x, i) => ({ ...x, value: vals[i] }));
    const r3 = records(pts, ctx, ['naive', 'seasonal', 'eq_carry', 'catboost'], pl);
    out.shuffledTarget.push(Object.fromEntries(pl.map((l) => {
      const w = (m) => r3[l][m].filter((x) => x.ti >= n - 24);
      return [`lead${l}`, Object.fromEntries(['naive', 'seasonal', 'eq_carry', 'catboost'].map((m) => [m, +mae(w(m)).toFixed(2)]))];
    })));
  }
}
out.runtimeSec = (Date.now() - t0) / 1000;
console.log(JSON.stringify(out, null, 1));
