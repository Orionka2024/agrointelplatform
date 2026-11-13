/**
 * User-controlled factor switches. A disabled factor contributes nothing to the forecast,
 * so the user can see the price without that influence.
 *
 * Factor ids = 4 watchlist signals + 4 model drivers. Each model driver maps to the
 * existing impulse keys it feeds (see computeMarketFactorAnalytics).
 */

export const FACTOR_DEFS = [
  { id: 'iraqImport', title: 'Импорт Ирака из Узбекистана', group: 'export' },
  { id: 'iranCorridor', title: 'Иранские переходы', group: 'export' },
  { id: 'cisExportPrices', title: 'Экспортные цены Узбекистана и Казахстана', group: 'export' },
  { id: 'volgogradBids', title: 'Реальные ставки волгоградских покупателей', group: 'export' },
  { id: 'weather', title: 'Погода (Волгоград, Тараз)', group: 'model', impulses: ['vlgFrostDumpPct', 'vlgWinterTighteningPct', 'kzFrostShockPct'] },
  { id: 'fx', title: 'Курс USD/RUB, KZT/RUB', group: 'model', impulses: ['fxParityShiftPct'] },
  { id: 'kzParity', title: 'Импортный паритет Казахстана', group: 'model', impulses: ['kzAutumnCapPct'] },
  { id: 'uzParity', title: 'Импортный паритет Узбекистана (ранний лук)', group: 'model', impulses: ['uzWarmSpringShiftPct'] },
];

export const FACTOR_IDS = FACTOR_DEFS.map((f) => f.id);

/** Keeps only known ids, de-duplicated. */
export function sanitizeDisabledFactors(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((id) => FACTOR_IDS.includes(id)))];
}

/** Zeroes the impulses fed by disabled model drivers. */
export function applyDisabledToImpulses(impulses, disabled) {
  const out = { ...impulses };
  for (const f of FACTOR_DEFS) {
    if (f.impulses && disabled.includes(f.id)) for (const k of f.impulses) out[k] = 0;
  }
  return out;
}
