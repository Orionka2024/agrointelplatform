/**
 * Supply-demand balance and deficit index.
 *
 * Definition (all quantities in million tonnes of the same crop and same marketing year):
 *     availableSupply = P × weatherFactor + I × importFactor + S_open
 *     deficitIndex    = D / availableSupply
 *
 *   D        demand / total use over the period
 *   P        domestic production (marketable)
 *   I        imports in the period (scope must be stated: total imports, not only Kazakhstan)
 *   S_open   OPENING stocks carried in (they ADD to supply)
 *
 * History note: the previous implementation computed D / (P + I − S), i.e. it SUBTRACTED stocks, which has no
 * consistent meaning if S is carry-in stock. With the old defaults it gave 1.257 while the UI showed a hard-coded
 * 1.21. Both were removed; there is now a single computation. The sign convention of S is a business decision that
 * should be confirmed (see docs/FORECASTING.md, "Open questions").
 *
 * index > 1: demand exceeds available supply (tightness); index < 1: supply exceeds demand.
 * It is a balance indicator, NOT a price forecast.
 */

export function deficitIndex({ D, P, I, S, weatherFactor = 1, importFactor = 1 }) {
  const vals = { D, P, I, S, weatherFactor, importFactor };
  for (const [k, v] of Object.entries(vals)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return { status: 'invalid', reason: `Параметр ${k} не задан или не число`, index: null };
    if (v < 0) return { status: 'invalid', reason: `Параметр ${k} не может быть отрицательным`, index: null };
  }
  if (D === 0) return { status: 'invalid', reason: 'Спрос D = 0: индекс не определён', index: null };
  const supply = P * weatherFactor + I * importFactor + S;
  if (supply <= 0) return { status: 'invalid', reason: 'Доступное предложение ≤ 0: индекс не определён', index: null };
  const index = D / supply;
  return { status: 'ok', index, supply, ...classifyDeficit(index) };
}

export function classifyDeficit(idx) {
  if (idx < 1) return { cls: 'up', badge: 'ПРЕДЛОЖЕНИЕ ≥ СПРОСА', text: 'Предложение превышает спрос — давление на цену вниз (индикатор баланса, не прогноз).' };
  if (idx < 1.1) return { cls: 'warn', badge: 'БАЛАНС', text: 'Рынок близок к балансу.' };
  if (idx < 1.2) return { cls: 'warn', badge: 'НАПРЯЖЁННОСТЬ', text: 'Предложения немного не хватает.' };
  return { cls: 'dn', badge: 'ДЕФИЦИТ', text: 'Спрос заметно превышает доступное предложение.' };
}

export function shareOfMarket(myTonnes, productionMt, weatherFactor = 1) {
  const total = productionMt * 1e6 * weatherFactor;
  if (!(total > 0) || !(myTonnes > 0)) return null;
  return (myTonnes / total) * 100;
}
