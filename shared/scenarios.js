/**
 * Scenarios: base / surplus-supply / tight-supply with EXPLICIT inputs. No probabilities are attached.
 *
 * Price effects need sensitivities (% price change per +1 % change in a driver).
 *   - empirical sensitivities come from estimateElasticity() on real matched series (n and R² are stored);
 *   - otherwise the user may enter an ASSUMPTION, which is labelled as such;
 *   - with no sensitivity the effect is "not quantified" — we never invent a number.
 *
 * Import volume and exchange rate are separate drivers with separate labels. The import scope
 * (Kazakhstan only vs total imports) is part of both the scenario input and the sensitivity; a mismatch
 * suppresses the effect rather than mixing scopes.
 */

export const IMPORT_SCOPES = {
  total: 'Весь импорт лука в РФ',
  kz_only: 'Импорт только из Казахстана',
};

export const SCENARIO_IDS = ['base', 'surplus', 'tight'];

/** Illustrative scenario magnitudes (editable). They are inputs, not forecasts. */
export const DEFAULT_SCENARIOS = {
  base: { id: 'base', label: 'Базовый', importScope: 'total', importDeltaPct: 0, domesticSupplyDeltaPct: 0, fxDeltaPct: 0 },
  surplus: { id: 'surplus', label: 'Избыток предложения', importScope: 'total', importDeltaPct: 20, domesticSupplyDeltaPct: 10, fxDeltaPct: 0 },
  tight: { id: 'tight', label: 'Дефицит предложения', importScope: 'total', importDeltaPct: -20, domesticSupplyDeltaPct: -10, fxDeltaPct: 0 },
};

export const EMPTY_SENSITIVITIES = {
  importVolume: { pctPerPct: null, scope: 'total', source: null, note: '' },
  domesticSupply: { pctPerPct: null, source: null, note: '' },
  fx: { pctPerPct: null, source: null, note: '' },
};

function effect(delta, sens, scopeOk = true) {
  if (!delta) return { pct: 0, status: 'no_change' };
  if (!scopeOk) return { pct: null, status: 'scope_mismatch' };
  if (sens?.pctPerPct === null || sens?.pctPerPct === undefined || !Number.isFinite(sens.pctPerPct)) return { pct: null, status: 'not_quantified' };
  return { pct: sens.pctPerPct * delta, status: sens.source === 'empirical' ? 'empirical' : 'assumption' };
}

export function evaluateScenario(scenario, sensitivities = EMPTY_SENSITIVITIES) {
  const imp = effect(scenario.importDeltaPct, sensitivities.importVolume, (sensitivities.importVolume?.scope ?? 'total') === scenario.importScope);
  const dom = effect(scenario.domesticSupplyDeltaPct, sensitivities.domesticSupply);
  const fx = effect(scenario.fxDeltaPct, sensitivities.fx);
  const parts = { importVolume: imp, domesticSupply: dom, fx };
  const unquantified = Object.entries(parts).filter(([, e]) => e.status === 'not_quantified' || e.status === 'scope_mismatch').map(([k, e]) => `${k}:${e.status}`);
  const totalPct = Object.values(parts).reduce((s, e) => s + (e.pct ?? 0), 0);
  return {
    id: scenario.id, label: scenario.label, inputs: { ...scenario },
    parts, totalPct,
    complete: unquantified.length === 0,
    unquantified,
    basisNote: 'Эффекты суммируются линейно; импорт и курс — раздельные драйверы.',
  };
}

/** Applies a scenario shift to forecast rows. If lagWeeks is unknown the shift is NOT time-shaped (labelled). */
export function applyScenarioToRows(rows, result, lagWeeks = null) {
  return rows.map(r => {
    const active = lagWeeks === null || r.h >= lagWeeks;
    const shift = active ? result.totalPct : 0;
    return {
      ...r,
      scenarioPoint: +(r.point * (1 + shift / 100)).toFixed(2),
      scenarioShiftPct: shift,
      lagKnown: lagWeeks !== null,
    };
  });
}

/** Log-log OLS: elasticity of y (price) w.r.t. x (driver). Requires n >= minN, otherwise null. */
export function estimateElasticity(xs, ys, { minN = 30 } = {}) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y));
  const n = pairs.length;
  if (n < minN) return { status: 'insufficient', n, minN };
  const lx = pairs.map(p => Math.log(p[0]));
  const ly = pairs.map(p => Math.log(p[1]));
  const mx = lx.reduce((s, v) => s + v, 0) / n;
  const my = ly.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (lx[i] - mx) ** 2; sxy += (lx[i] - mx) * (ly[i] - my); syy += (ly[i] - my) ** 2; }
  if (sxx === 0) return { status: 'degenerate', n };
  const slope = sxy / sxx;
  const resid = ly.map((v, i) => v - (my + slope * (lx[i] - mx)));
  const sse = resid.reduce((s, r) => s + r * r, 0);
  const se = Math.sqrt(sse / (n - 2) / sxx);
  return { status: 'ok', n, slope, se, r2: syy > 0 ? 1 - sse / syy : null, note: 'Корреляционная оценка по историческим данным, не причинная эластичность.' };
}
