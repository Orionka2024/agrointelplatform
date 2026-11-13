/**
 * Export-corridor watchlist (4–6 week horizon) for the Volgograd wholesale onion price.
 *
 * Evidence policy: nothing here is invented. A signal only reaches the forecast when its
 * record carries BOTH a confirmed `state` and a sourced, quantified `impactPct` (+ `source`).
 * Direction-only evidence is displayed as "unquantified" and does NOT move the price,
 * mirroring how scenarios without a sourced size are handled elsewhere in the model.
 *
 * Quantified effect is spread over weeks with a ramp -> plateau -> fade profile
 * (WATCH_HORIZON_WEEKS); the shape is a presentation of "short-lived shock", not a
 * statistical estimate.
 */

export const WATCH_HORIZON_WEEKS = 6;

/** Weekly weight profile: ramps in over weeks 1-2, plateau to week 4, fades out by week 6. */
export function watchWeekWeight(h) {
  if (!(h >= 1) || h > WATCH_HORIZON_WEEKS) return 0;
  return [0.4, 0.8, 1, 1, 0.7, 0.35][h - 1];
}

/** Signals from the 4–6 week watch table. `states` hold meaning only, no magnitudes. */
export const WATCH_SIGNALS = [
  {
    id: 'iraqImport',
    title: 'Импорт Ирака из Узбекистана',
    states: {
      up: { dir: 1, label: 'Ирак увеличивает импорт', meaning: 'Положительный сигнал для узбекских экспортных цен' },
      down: { dir: -1, label: 'Ирак снова ограничивает импорт', meaning: 'Риск возврата избыточного предложения на соседние рынки' },
    },
    evidenceNote:
      'В открытой статистике нет достаточных данных за окт–ноя 2026, чтобы доказать, сколько дополнительных тонн Ирак закупил после смены импортных правил.',
  },
  {
    id: 'iranCorridor',
    title: 'Иранские переходы',
    states: {
      restricted: { dir: 1, label: 'Переходы снова ограничены', meaning: 'Возможное усиление спроса на альтернативных поставщиков' },
      open: { dir: 0, label: 'Переходы открыты', meaning: 'Штатные потоки' },
    },
  },
  {
    id: 'cisExportPrices',
    title: 'Экспортные цены Узбекистана и Казахстана',
    states: {
      rising: { dir: 1, label: 'Экспортные цены растут', meaning: 'Вероятное ослабление ценовой конкуренции в России' },
      falling: { dir: -1, label: 'Экспортные цены падают', meaning: 'Усиление ценовой конкуренции в России' },
    },
  },
  {
    id: 'volgogradBids',
    title: 'Реальные ставки волгоградских покупателей',
    states: {
      raised: { dir: 1, label: 'Покупатели повышают реальные ставки', meaning: 'Прямое подтверждение изменения местного рынка' },
      lowered: { dir: -1, label: 'Покупатели снижают реальные ставки', meaning: 'Прямое подтверждение ослабления местного рынка' },
    },
  },
];

/**
 * @param {Record<string,{state?:string, asOf?:string, source?:string, impactPct?:number, context?:string}>} [records]
 */
export function buildExportWatchlist(records = {}, disabled = []) {
  const items = WATCH_SIGNALS.map((s) => {
    const rec = records?.[s.id] || {};
    const def = s.states[rec.state];
    const isDisabled = disabled.includes(s.id);
    const quantified = !isDisabled && !!def && !!rec.source && Number.isFinite(rec.impactPct);
    return {
      disabled: isDisabled,
      evidenceTitle: rec.evidenceTitle || null,
      id: s.id,
      title: s.title,
      state: def ? rec.state : 'unknown',
      label: def ? def.label : 'Нет подтверждённых данных',
      meaning: def ? def.meaning : 'Не влияет на прогноз до подтверждения данными',
      asOf: rec.asOf || null,
      source: rec.source || null,
      context: rec.context || null,
      quantified,
      peakPct: quantified ? rec.impactPct : 0,
      evidenceNote: def && quantified ? null : s.evidenceNote || (def ? 'Направление подтверждено, величина эффекта в источниках не указана — на прогноз не влияет.' : null),
    };
  });
  // Diminishing sum: correlated signals must not stack linearly.
  const totalPeakPct = +Math.max(-5, Math.min(5, items.reduce((a, i) => a + i.peakPct, 0) * 0.8)).toFixed(2);
  return { horizonWeeks: WATCH_HORIZON_WEEKS, items, totalPeakPct };
}

/** Log-price offset contributed by the watchlist for forecast week h (1-based). */
export function watchlistLogOffset(watchlist, h) {
  if (!watchlist) return 0;
  return (watchlist.totalPeakPct / 100) * watchWeekWeight(h);
}
