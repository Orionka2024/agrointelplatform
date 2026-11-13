/**
 * Sourced records for the export-corridor watchlist. EDIT ONLY WITH CITED EVIDENCE.
 *
 * Record: { state, asOf, source, impactPct?, context? }
 *  - `state` is set only when a reliable source confirms the observation (see WATCH_SIGNALS).
 *  - `impactPct` (peak % effect on the Volgograd price) is set only when a source quantifies it.
 *  - `context` holds reported background that is NOT a confirmed state and does not move the forecast.
 *
 * Status as of 2026-11-13 (web check; secondary media, no official tonnage data):
 *  - Iraq reportedly reopened onion/tomato/potato imports in Oct 2026 after a temporary ban
 *    (theinsightinternational.com). Extra tonnes actually bought: NOT confirmed -> state unset.
 *  - Uzbekistan 2026 onion harvest projected at 1.5 Mt, ~35% above domestic demand (east-fruit.com).
 *  - Regional shipping around Iran / Hormuz disrupted (reliefweb.int); onion-specific land-border
 *    status not confirmed -> state unset.
 *  - No Volgograd real-bid data yet (board `ask` prices are not deal prices).
 */
export const EXPORT_SIGNAL_RECORDS = {
  iraqImport: {
    state: null,
    asOf: '2026-11-13',
    context:
      'По данным СМИ, Ирак в октябре 2026 вновь открыл импорт лука после временного запрета (theinsightinternational.com); объём фактических закупок не подтверждён.',
  },
  iranCorridor: {
    state: null,
    asOf: '2026-11-13',
    context: 'Региональная логистика вокруг Ирана и Ормузского пролива нарушена (reliefweb.int); статус сухопутных переходов для лука не подтверждён.',
  },
  cisExportPrices: {
    state: null,
    asOf: '2026-11-13',
    context: 'Урожай лука в Узбекистане 2026 прогнозируется на 1,5 млн т, ~35% выше внутреннего спроса (east-fruit.com); динамика экспортных цен не подтверждена.',
  },
  volgogradBids: {
    state: null,
    asOf: '2026-11-13',
    context: 'Подтверждённых данных о реальных ставках покупателей нет; цены на досках объявлений — это ask, а не сделки.',
  },
};
