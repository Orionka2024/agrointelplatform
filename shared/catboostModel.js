/**
 * Weibull Seasonal-Equilibrium + CatBoost Oblivious Decision Tree Residual Boosting
 * with Exact Interventional TreeSHAP attributions.
 *
 * Strictly causal (point-in-time): at any origin month `o`, both the seasonal equilibrium
 * and every CatBoost oblivious tree see ONLY observations and macro/weather/retail data
 * with period <= o.
 */

export const WEIBULL_DEFAULTS = {
  scale: 3.5,
  power: 1.4,
  seasonShrink: 0.45,
};

export const CATBOOST_FEATURE_META = [
  { idx: 0, key: 'anom0', group: 'equilibrium', label: 'Отклонение от сезонной нормы' },
  { idx: 1, key: 'mom2', group: 'equilibrium', label: 'Ценовая инерция (2 мес.)' },
  { idx: 2, key: 'horizon', group: 'equilibrium', label: 'Горизонт упреждения' },
  { idx: 3, key: 'sinM', group: 'seasonality', label: 'Гармоника сезона (sin)' },
  { idx: 4, key: 'cosM', group: 'seasonality', label: 'Гармоника сезона (cos)' },
  { idx: 5, key: 'fxParity', group: 'import_fx', label: 'Импортный паритет KZT/RUB и USD/RUB' },
  { idx: 6, key: 'keyRate', group: 'financing', label: 'Ключевая ставка ЦБ РФ (стоимость хранения)' },
  { idx: 7, key: 'retailSpread', group: 'retail_demand', label: 'Рознично-оптовый спред Росстата' },
  { idx: 8, key: 'frostShock', group: 'weather', label: 'Морозы в Жамбыле (КЗ) и Волгограде (ERA5)' },
];

const mIdx = (p) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Builds month-indexed lookup maps from official drivers & weekly retail observations.
 */
export function buildCatBoostContext(drivers, retailWeekly = []) {
  if (!drivers) return null;
  const toMap = (arr = []) => new Map(arr.map((r) => [mIdx(r.period), r.value]));
  const toObjMap = (arr = []) => new Map(arr.map((r) => [mIdx(r.period), r]));

  const retailBuckets = new Map();
  for (const r of retailWeekly || []) {
    if (!r?.date || !(r.value > 0)) continue;
    const k = mIdx(r.date.slice(0, 7));
    if (!retailBuckets.has(k)) retailBuckets.set(k, []);
    retailBuckets.get(k).push(r.value);
  }
  const retailMonthly = new Map([...retailBuckets.entries()].map(([k, vals]) => [k, mean(vals)]));

  return {
    usd: toMap(drivers.usdRub),
    kzt: toMap(drivers.kztRub),
    key: toMap(drivers.keyRate),
    vlg: toObjMap(drivers.weather?.volgograd),
    zhm: toObjMap(drivers.weather?.zhambyl),
    retail: retailMonthly,
  };
}

/**
 * Fits rolling 24-month log-median level and centered calendar-month median seasonality
 * strictly using months <= cutoff.
 */
export function fitSeasonalEquilibrium(byMonth, cutoff) {
  const entries = [...byMonth.entries()]
    .filter(([k, v]) => k <= cutoff && v > 0)
    .sort((a, b) => a[0] - b[0]);
  if (entries.length < 12) return null;

  const levelAt = new Map();
  for (let i = 0; i < entries.length; i++) {
    const win = entries.slice(Math.max(0, i - 23), i + 1).map(([, v]) => Math.log(v));
    levelAt.set(entries[i][0], median(win));
  }

  const byCal = Array.from({ length: 12 }, () => []);
  for (const [k, v] of entries) {
    byCal[k % 12].push(Math.log(v) - levelAt.get(k));
  }
  const rawS = byCal.map((arr) => (arr.length ? median(arr) : 0));
  const sMean = mean(rawS);
  const season = rawS.map((v) => v - sMean);
  const curLevel = levelAt.get(entries.at(-1)[0]);

  return { levelAt, season, curLevel };
}

/**
 * Weibull-damped seasonal equilibrium log-price forecast (`eq_carry`).
 */
export function baselineLogPred(byMonth, eq, origin, lead, params = WEIBULL_DEFAULTS) {
  const p0 = byMonth.get(origin);
  if (!(p0 > 0) || !eq || lead < 1) return null;
  const { scale = 3.5, power = 1.4, seasonShrink = 0.45 } = params;
  const lvl = eq.levelAt.get(origin) ?? eq.curLevel;
  const w = Math.exp(-Math.pow(lead / scale, power));
  const effS = seasonShrink * (1 - 0.5 * Math.exp(-0.7 * (lead - 1)));
  const s0 = effS * eq.season[origin % 12];
  const st = effS * eq.season[(origin + lead) % 12];
  const anom0 = Math.log(p0) - (lvl + s0);
  return lvl + st + w * anom0;
}

export function eqCarryPredict(byMonth, origin, lead, params = WEIBULL_DEFAULTS) {
  const eq = fitSeasonalEquilibrium(byMonth, origin);
  if (!eq) return null;
  const lp = baselineLogPred(byMonth, eq, origin, lead, params);
  return lp === null ? null : Math.exp(lp);
}

/**
 * Strictly causal feature vector at origin `o` (never reads any key > o).
 */
export function buildCatBoostFeatures(byMonth, ctx, eq, o, lead) {
  const p0 = byMonth.get(o);
  if (!(p0 > 0) || !eq) return null;

  const getMap = (m, k) => (m && k <= o ? m.get(k) : undefined);

  const lvl0 = eq.levelAt.get(o) ?? eq.curLevel;
  const anom0 = Math.log(p0) - (lvl0 + eq.season[o % 12]);
  const kPrev = byMonth.has(o - 2) ? o - 2 : byMonth.has(o - 1) ? o - 1 : o;
  const pPrev = byMonth.get(kPrev) ?? p0;
  const anomPrev = Math.log(pPrev) - ((eq.levelAt.get(kPrev) ?? lvl0) + eq.season[kPrev % 12]);

  const tm = (o + lead) % 12;
  const u0 = getMap(ctx?.usd, o);
  const u3 = getMap(ctx?.usd, o - 3) ?? u0;
  const kz0 = getMap(ctx?.kzt, o);
  const kz3 = getMap(ctx?.kzt, o - 3) ?? kz0;
  const usdChg = u0 > 0 && u3 > 0 ? Math.log(u0 / u3) : 0;
  const kztChg = kz0 > 0 && kz3 > 0 ? Math.log(kz0 / kz3) : usdChg;
  const fxParity = 0.6 * kztChg + 0.4 * usdChg;

  const kr = ((getMap(ctx?.key, o) ?? 12) - 12) / 10;
  const ret0 = getMap(ctx?.retail, o);
  const retailSpread = ret0 > 0 ? Math.log(ret0 / p0) - Math.log(2.35) : 0;

  let frostDays = 0;
  for (let j = 0; j <= 2; j++) {
    const zf = getMap(ctx?.zhm, o - j)?.frostDays12C ?? 0;
    const vf = getMap(ctx?.vlg, o - j)?.frostDays12C ?? 0;
    frostDays += zf + 0.5 * vf;
  }

  return [
    anom0,
    anom0 - anomPrev,
    lead / 12,
    Math.sin((2 * Math.PI * tm) / 12),
    Math.cos((2 * Math.PI * tm) / 12),
    fxParity,
    kr,
    retailSpread,
    (frostDays / 20) * Math.exp(-0.15 * lead),
  ];
}

function evalTree(tree, x) {
  let b = 0;
  for (const s of tree.splits) b = (b << 1) | (x[s.f] > s.thr ? 1 : 0);
  return tree.leafValues[b];
}

/**
 * Fits CatBoost oblivious decision tree ensemble on residuals from `baselineLogPred`,
 * using chronological inner early stopping (`od_type = 'Iter'`).
 */
export function fitCatBoostEnsemble(
  rows,
  { maxTrees = 30, depth = 2, lr = 0.035, l2 = 28.0, huberDelta = 0.18, minLeaf = 5 } = {}
) {
  const sorted = [...rows].sort((a, b) => a.target - b.target || a.origin - b.origin);
  const valCount = Math.max(6, Math.floor(sorted.length * 0.25));
  const tr = sorted.slice(0, sorted.length - valCount);
  const va = sorted.slice(sorted.length - valCount);
  if (tr.length < 16) {
    return { ensemble: [], bgX: sorted.slice(-24).map((r) => r.x) };
  }

  const X = tr.map((r) => r.x);
  const y = tr.map((r) => r.y);
  const n = X.length;
  const p = X[0].length;
  const predTr = new Float64Array(n);
  const predVa = new Float64Array(va.length);

  const thresholds = Array.from({ length: p }, (_, f) => {
    const vals = [...new Set(X.map((r) => r[f]))].sort((a, b) => a - b);
    if (vals.length <= 2) return [];
    const ts = new Set();
    for (const q of [0.2, 0.4, 0.6, 0.8]) {
      const idx = Math.min(vals.length - 2, Math.max(0, Math.floor(q * (vals.length - 1))));
      ts.add((vals[idx] + vals[idx + 1]) / 2);
    }
    return [...ts];
  });

  let bestVaLoss = mean(va.map((r) => Math.abs(r.y)));
  let bestCount = 0;
  const allTrees = [];

  for (let t = 0; t < maxTrees; t++) {
    const g = y.map((yi, i) => Math.max(-huberDelta, Math.min(huberDelta, yi - predTr[i])));
    const splits = [];
    let leafIdx = new Int32Array(n);

    for (let d = 0; d < depth; d++) {
      let bestScore = -Infinity;
      let bestSplit = null;
      const numLeaves = 1 << (d + 1);
      for (let f = 0; f < p; f++) {
        for (const thr of thresholds[f]) {
          const sumG = new Float64Array(numLeaves);
          const cnt = new Int32Array(numLeaves);
          for (let i = 0; i < n; i++) {
            const b = (leafIdx[i] << 1) | (X[i][f] > thr ? 1 : 0);
            sumG[b] += g[i];
            cnt[b]++;
          }
          let validLeaves = 0;
          let score = 0;
          for (let b = 0; b < numLeaves; b++) {
            if (cnt[b] > 0 && cnt[b] < minLeaf) {
              validLeaves = -999;
              break;
            }
            if (cnt[b] >= minLeaf) validLeaves++;
            score += (sumG[b] * sumG[b]) / (cnt[b] + l2);
          }
          if (validLeaves >= 2 && score > bestScore) {
            bestScore = score;
            bestSplit = { f, thr };
          }
        }
      }
      if (!bestSplit) break;
      splits.push(bestSplit);
      const nextLeaf = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        nextLeaf[i] = (leafIdx[i] << 1) | (X[i][bestSplit.f] > bestSplit.thr ? 1 : 0);
      }
      leafIdx = nextLeaf;
    }

    if (!splits.length) break;
    const L = 1 << splits.length;
    const sumG = new Float64Array(L);
    const cnt = new Int32Array(L);
    for (let i = 0; i < n; i++) {
      sumG[leafIdx[i]] += g[i];
      cnt[leafIdx[i]]++;
    }
    const leafValues = Array.from({ length: L }, (_, b) => lr * (sumG[b] / (cnt[b] + l2)));
    const tree = { splits, leafValues };
    allTrees.push(tree);

    for (let i = 0; i < n; i++) predTr[i] += leafValues[leafIdx[i]];
    for (let i = 0; i < va.length; i++) predVa[i] += evalTree(tree, va[i].x);
    const vaLoss = mean(va.map((r, i) => Math.abs(r.y - predVa[i])));
    if (vaLoss < bestVaLoss - 1e-4) {
      bestVaLoss = vaLoss;
      bestCount = allTrees.length;
    }
  }

  return {
    ensemble: allTrees.slice(0, bestCount),
    bgX: sorted.slice(-36).map((r) => r.x),
  };
}

export function predictCatBoostResidual(model, x) {
  if (!model?.ensemble?.length || !x) return 0;
  let out = 0;
  for (const tree of model.ensemble) out += evalTree(tree, x);
  return out;
}

/**
 * Exact Interventional TreeSHAP for depth <= 2 oblivious decision trees.
 * Guarantees exact Shapley additivity: sum(phi) === pred(x) - E_bg[pred(Z)].
 */
export function treeShapOblivious(model, x) {
  const p = x.length;
  const phi = new Float64Array(p);
  const bg = model?.bgX?.length ? model.bgX : [new Array(p).fill(0)];
  if (!model?.ensemble?.length) {
    return { phi: Array.from(phi), baseValue: 0, pred: 0 };
  }

  let baseSum = 0;
  for (const z of bg) baseSum += predictCatBoostResidual(model, z);
  const baseValue = baseSum / bg.length;

  for (const tree of model.ensemble) {
    const feats = [...new Set(tree.splits.map((s) => s.f))];
    if (feats.length === 1) {
      const f0 = feats[0];
      const tx = evalTree(tree, x);
      let diff = 0;
      for (const z of bg) diff += tx - evalTree(tree, z);
      phi[f0] += diff / bg.length;
    } else if (feats.length === 2) {
      const [f0, f1] = feats;
      const tx = evalTree(tree, x);
      let d0 = 0;
      let d1 = 0;
      const mix01 = [...x];
      const mix10 = [...x];
      for (const z of bg) {
        const tz = evalTree(tree, z);
        mix01[f0] = x[f0];
        mix01[f1] = z[f1];
        mix10[f0] = z[f0];
        mix10[f1] = x[f1];
        const t10 = evalTree(tree, mix01);
        const t01 = evalTree(tree, mix10);
        d0 += 0.5 * (t10 - tz) + 0.5 * (tx - t01);
        d1 += 0.5 * (t01 - tz) + 0.5 * (tx - t10);
      }
      phi[f0] += d0 / bg.length;
      phi[f1] += d1 / bg.length;
    }
  }

  return {
    phi: Array.from(phi),
    baseValue,
    pred: predictCatBoostResidual(model, x),
  };
}

/**
 * Trains CatBoost + Seasonal Equilibrium strictly on months <= origin and predicts origin + lead.
 */
export function catboostTrainAndPredict(byMonth, ctx, origin, lead, params = WEIBULL_DEFAULTS) {
  const vis = new Map([...byMonth.entries()].filter(([k, v]) => k <= origin && v > 0));
  const eq = fitSeasonalEquilibrium(vis, origin);
  const p0 = vis.get(origin);
  if (!eq || !(p0 > 0) || lead < 1) return null;

  const baseLog = baselineLogPred(vis, eq, origin, lead, params);
  if (baseLog === null) return null;

  const keys = [...vis.keys()].sort((a, b) => a - b);
  const rows = [];
  for (const o2 of keys) {
    if (o2 < keys[0] + 12) continue;
    const eq2 = fitSeasonalEquilibrium(vis, o2);
    if (!eq2) continue;
    for (let h2 = 1; h2 <= 15; h2++) {
      if (o2 + h2 > origin) break;
      if (Math.abs(h2 - lead) > 3) continue;
      const pt = vis.get(o2 + h2);
      if (!(pt > 0)) continue;
      const x = buildCatBoostFeatures(vis, ctx, eq2, o2, h2);
      const b2 = baselineLogPred(vis, eq2, o2, h2, params);
      if (!x || b2 === null) continue;
      rows.push({ origin: o2, target: o2 + h2, x, y: Math.log(pt) - b2 });
    }
  }

  const model = fitCatBoostEnsemble(rows);
  const xNow = buildCatBoostFeatures(vis, ctx, eq, origin, lead);
  const shap = xNow ? treeShapOblivious(model, xNow) : { phi: new Array(9).fill(0), baseValue: 0, pred: 0 };
  const predLog = baseLog + shap.pred;
  const point = Math.exp(predLog);

  // Decompose baseline + CatBoost exact TreeSHAP into interpretable factor groups
  const { scale = 3.5, power = 1.4, seasonShrink = 0.45 } = params;
  const lvl = eq.levelAt.get(origin) ?? eq.curLevel;
  const w = Math.exp(-Math.pow(lead / scale, power));
  const effS = seasonShrink * (1 - 0.5 * Math.exp(-0.7 * (lead - 1)));
  const s0 = effS * eq.season[origin % 12];
  const st = effS * eq.season[(origin + lead) % 12];
  const anom0 = Math.log(p0) - (lvl + s0);

  const seasonalLog = (st - s0) + (shap.phi[3] ?? 0) + (shap.phi[4] ?? 0);
  const equilibriumLog = (w - 1) * anom0 + shap.baseValue + (shap.phi[0] ?? 0) + (shap.phi[1] ?? 0) + (shap.phi[2] ?? 0);
  const fxLog = shap.phi[5] ?? 0;
  const rateLog = shap.phi[6] ?? 0;
  const retailLog = shap.phi[7] ?? 0;
  const weatherLog = shap.phi[8] ?? 0;

  return {
    point,
    eqCarryPoint: Math.exp(baseLog),
    treesUsed: model.ensemble.length,
    trainRows: rows.length,
    treeShap: shap,
    featureValues: xNow,
    factorLogs: {
      seasonality: seasonalLog,
      equilibrium: equilibriumLog,
      import_fx: fxLog,
      financing: rateLog,
      retail_demand: retailLog,
      weather: weatherLog,
    },
  };
}

export function catboostPredict(byMonth, ctx, origin, lead, params = WEIBULL_DEFAULTS) {
  return catboostTrainAndPredict(byMonth, ctx, origin, lead, params)?.point ?? null;
}
