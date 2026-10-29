/**
 * Structured snapshot given to the AI adviser. It is built from the SAME market model the screens use,
 * so the adviser sees the same numbers (and the same provenance / freshness / validation status) as the user.
 *
 * sanitizeSnapshot() is applied server-side: the snapshot (and every string in it, e.g. imported source names
 * or notes) is untrusted data — bounded, stripped of control characters and never treated as instructions.
 */

const r2 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

function priceBrief(p) {
  return {
    basis: p.basis, unit: p.unit, priceExVat: r2(p.exVat), priceInclVat: r2(p.inclVat),
    status: p.provenance.status, asOf: p.provenance.asOf || null, ageDays: p.provenance.ageDays ?? null,
    kind: p.kind, source: p.provenance.source || null,
  };
}

function forecastBrief(f) {
  if (!f) return { status: 'none', note: 'Прогноз не выпущен' };
  return {
    status: f.status, mode: f.mode, issueDate: f.issueDate, inputCutoff: f.inputCutoff, ageDays: f.ageDays ?? null,
    modelVersion: f.modelVersion, reasons: f.reasons?.slice(0, 3) || [],
    horizons: (f.horizons || []).filter(h => [1, 4, 8, 13, 26].includes(h.h)).map(h => ({
      weeks: h.h, targetDate: h.targetDate, point: r2(h.point), model: h.modelId, validated: !!h.validated,
      lo80: r2(h.interval?.lo80), hi80: r2(h.interval?.hi80), lo95: r2(h.interval?.lo95), hi95: r2(h.interval?.hi95),
    })),
    validation: f.validation?.byHorizon
      ? Object.fromEntries(Object.entries(f.validation.byHorizon).map(([h, v]) => [h, v && v.final ? {
        status: v.status, n: v.final.n, period: v.final.period, maeRubKg: r2(v.final.mae), biasRubKg: r2(v.final.bias),
        naiveMaeRubKg: r2(v.final.naiveMae), skillVsNaive: r2(v.final.skillVsNaive),
        coverage80: v.final.coverage80, coverage95: v.final.coverage95,
      } : { status: v?.status || 'none', reason: v?.reason || null }]))
      : null,
  };
}

export function buildSnapshot(model, { selectedBasis = 'warehouse', selectedScenario = 'base' } = {}) {
  const sc = model.scenarios.results.find(s => s.id === selectedScenario) || model.scenarios.results[0];
  return {
    schema: 1,
    mode: model.mode,
    today: model.today,
    selectedBasis, selectedScenario,
    targetDefinition: {
      unit: 'RUB/kg', warehouse: 'EXW склад Волгоградская обл., без НДС', moscow: 'опт Москва, с доставкой; показатель с НДС и без',
      specConfirmed: false,
    },
    prices: { warehouse: priceBrief(model.prices.warehouse), moscow: priceBrief(model.prices.moscow) },
    forecast: { warehouse: forecastBrief(model.forecasts.warehouse), moscow: forecastBrief(model.forecasts.moscow) },
    bridge: {
      status: model.bridgeResult.status, missing: model.bridgeResult.missing || [],
      observedGrossDifferenceExVat: r2(model.spread.observedGrossDifferenceExVat),
      bridgeGrossDifferenceExVat: r2(model.spread.bridgeGrossDifferenceExVat),
      impliedMargin: r2(model.spread.impliedMargin),
      empiricalPairs: model.empirical.nPairs ?? 0,
    },
    scenario: {
      id: sc.id, label: sc.label, inputs: sc.inputs, complete: sc.complete, unquantified: sc.unquantified,
      totalPriceEffectPct: sc.complete ? r2(sc.totalPct) : null,
      parts: Object.fromEntries(Object.entries(sc.parts).map(([k, e]) => [k, { pct: r2(e.pct), status: e.status }])),
      probabilities: 'не определены',
    },
    balance: { index: r2(model.balance.result.index), status: model.balance.result.status, reason: model.balance.result.reason || null, provenance: model.balance.provenance.status, inputs: model.balance.inputs },
    storage: {
      note: model.storage.note,
      rows: model.storage.rows.filter(r => [4, 8, 13, 26].includes(r.h)).map(r => ({
        weeks: r.h, futurePrice: r2(r.futurePrice),
        gainPerKgStored: r.result.status === 'ok' ? r2(r.result.gain) : null,
        breakEvenFuturePrice: r.result.status === 'ok' ? r2(r.result.breakEvenFuturePrice) : null,
      })),
    },
    seasonalPressure: {
      status: model.seasonal.status,
      active: model.seasonal.pressures.filter(p => p.active).map(p => ({ phase: p.phase, reason: p.reason, since: p.supportingObservationDate, region: p.region, priceImpact: p.priceImpact })),
      note: model.seasonal.note || null,
    },
    macro: Object.fromEntries(Object.entries(model.macro).map(([k, v]) => [k, { value: r2(v.value), status: v.provenance.status, asOf: v.provenance.asOf || null }])),
    dataStatus: model.dataStatus.map(d => ({ id: d.id, status: d.status, asOf: d.asOf || null, n: d.n ?? null })),
    limitations: [
      'Пока нет валидированного прогноза, цены в прогнозе — не оценка рынка.',
      'Рыночные балансовые данные, сезонные индикаторы и издержки могут быть демо или введены вручную — см. статусы.',
    ],
  };
}

const MAX_DEPTH = 7;
const MAX_ARRAY = 60;
const MAX_STR = 200;
export const MAX_SNAPSHOT_BYTES = 24 * 1024;

function cleanStr(s) {
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/`{3,}/g, "'''").slice(0, MAX_STR);
}

export function sanitizeSnapshot(input) {
  function walk(v, depth) {
    if (depth > MAX_DEPTH) return null;
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') return cleanStr(v);
    if (Array.isArray(v)) return v.slice(0, MAX_ARRAY).map(x => walk(x, depth + 1));
    if (typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v).slice(0, 60)) {
        if (!/^[A-Za-z0-9_.-]{1,40}$/.test(k)) continue;
        out[k] = walk(val, depth + 1);
      }
      return out;
    }
    return null;
  }
  const out = walk(input, 0);
  const size = Buffer.byteLength(JSON.stringify(out ?? null));
  return size > MAX_SNAPSHOT_BYTES ? { error: 'snapshot_too_large' } : out;
}
