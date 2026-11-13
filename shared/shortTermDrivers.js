/**
 * Short-term (weeks 1–6) driver panel: weather, USD/RUB & KZT, key rate, Kazakh and Uzbek
 * import parity. Reports the CURRENT observed values and the effect the existing model
 * actually applies in that week's seasonal phase. It introduces no new coefficients:
 * the multipliers below mirror evaluateOnionSeasonalRegime in weeklyDecisionPlan.js.
 */

import { WATCH_HORIZON_WEEKS } from './exportWatchlist.js';

const COEF = {
  kzAutumnCapPct: 0.0035,
  vlgFrostDumpPct: 0.0045,
  vlgWinterTighteningPct: 0.004,
  kzFrostShockPct: 0.0045,
  fxParityShiftPct: 0.0025,
  uzWarmSpringShiftPct: 0.005,
};

/** Share of each impulse applied by the seasonal regime, per driverTag (mirrors the regime code). */
const APPLIED_BY_TAG = {
  KZ_TRANSIT_SHEDS: { kzAutumnCapPct: 1, vlgFrostDumpPct: 1 },
  STORAGE_SHIFT: { kzAutumnCapPct: 0.4, vlgWinterTighteningPct: 0.5 },
  PRE_NY_SURGE: { vlgWinterTighteningPct: 1 },
  WINTER_RESTOCK: { vlgWinterTighteningPct: 1, kzFrostShockPct: 0.6, fxParityShiftPct: 0.5 },
  SPRING_DEFICIT_PEAK: { vlgWinterTighteningPct: 1, kzFrostShockPct: 1, fxParityShiftPct: 1 },
  PRE_UZ_TURN: { fxParityShiftPct: 1, uzWarmSpringShiftPct: 1 },
  UZ_EG_EARLY_CROP: { uzWarmSpringShiftPct: 1, fxParityShiftPct: 0.8 },
};

function appliedPct(imp, tag, keys) {
  const w = APPLIED_BY_TAG[tag] || {};
  return +keys.reduce((s, k) => s + (imp[k] ?? 0) * COEF[k] * (w[k] ?? 0) * 100, 0).toFixed(2);
}

const fmt = (v, d = 1) => (Number.isFinite(v) ? Number(v).toFixed(d) : 'н/д');
const sgn = (v) => (v > 0 ? `+${v}` : `${v}`);

export function buildShortTermDrivers(liveSignals, h, driverTag) {
  if (!(h >= 1 && h <= WATCH_HORIZON_WEEKS) || !liveSignals) return null;
  const a = liveSignals.analytics || {};
  const imp = a.impulses || {};
  const fx = liveSignals.fx || {};
  const hubs = liveSignals.weatherHubs || {};
  const parity = a.parity || {};

  const items = [
    {
      id: 'weather',
      title: 'Погода (Open-Meteo, 10 дней)',
      value: `Волгоград min ${fmt(hubs.volgograd?.minTemp10d)}°C · Тараз min ${fmt(hubs.zhambyl?.minTemp10d)}°C · Москва min ${fmt(hubs.moscow?.minTemp10d)}°C`,
      appliedPct: appliedPct(imp, driverTag, ['vlgFrostDumpPct', 'vlgWinterTighteningPct', 'kzFrostShockPct']),
      note: h > 2 ? 'прогноз погоды покрывает только ~10 дней; для этой недели это последнее известное значение, не прогноз' : null,
    },
    {
      id: 'fx',
      title: 'USD/RUB и KZT/RUB (ЦБ РФ)',
      value: `USD ${fmt(fx.usdRub?.value, 2)} ₽ · 100 KZT ${fmt((fx.kztRub?.value ?? NaN) * 100, 2)} ₽`,
      appliedPct: appliedPct(imp, driverTag, ['fxParityShiftPct']),
      note: null,
    },
    {
      id: 'kzParity',
      title: 'Импортный паритет Казахстана → Волгоград',
      value: `${fmt(parity.kzLandedVolgogradExVat, 2)} ₽/кг без НДС (спред к местной цене ${sgn(parity.kzSpreadVsLocal ?? 0)} ₽)`,
      appliedPct: appliedPct(imp, driverTag, ['kzAutumnCapPct']),
      note: null,
    },
    {
      id: 'uzParity',
      title: 'Импортный паритет Узбекистана',
      value: `ранний лук (апрель) ${fmt(parity.uzEarlyLandedSouthExVat, 2)} ₽/кг без НДС, юг РФ`,
      appliedPct: appliedPct(imp, driverTag, ['uzWarmSpringShiftPct']),
      note: 'узбекский ранний лук приходит в апреле — в 6-недельном окне до апреля прямого влияния нет',
    },
    {
      id: 'keyRate',
      title: 'Ключевая ставка ЦБ РФ',
      value: `${fmt(fx.keyRate?.value)}% · ~${fmt(a.macroTransmission?.monthlyFinancingCostRubKg, 2)} ₽/кг в месяц стоимость удержания товара`,
      appliedPct: 0,
      note: 'влияет на экономику хранения (порог безубыточности), а не на рыночную цену',
    },
  ];
  const off = a.disabledFactors || [];
  return {
    items: items.map((i) => (off.includes(i.id) ? { ...i, appliedPct: 0, note: 'отключено пользователем' } : i)),
  };
}

export function formatShortTermDriversText(panel) {
  if (!panel) return '';
  return panel.items
    .map(
      (i) =>
        `• ${i.title}: ${i.value}; эффект в прогнозе этой недели ${i.appliedPct ? `${sgn(i.appliedPct)}%` : '0%'}${i.note ? ` (${i.note})` : ''}.`
    )
    .join(' ');
}
