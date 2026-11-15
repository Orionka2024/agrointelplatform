/**
 * Decision Screen Calculation Engine (P1-8, F-06, F-11).
 * Computes direct farmer-first answers to:
 * 1. "Продавать сейчас или держать?"
 * 2. "Лучший транш"
 * 3. "Точка безубыточности в этом месяце"
 */

import { DEFAULT_FARM_PROFILE } from './marketModel.js';

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export function computeFarmerDecisions(model = {}, userFarmProfile = null) {
  const fp = { ...DEFAULT_FARM_PROFILE, ...(model.farmProfile || {}), ...(userFarmProfile || {}) };
  const today = model.today || new Date().toISOString().slice(0, 10);
  const curMonth = today.slice(0, 7);

  // 1. Current available price (warehouse EXW or benchmark)
  const wh = model.prices?.warehouse;
  const currentPrice = Number(wh?.priceExVat ?? wh?.exVat ?? 15.5);

  // 2. Storage rows and break-evens
  const rows = model.storage?.rows || [];
  const r13 = rows.find((r) => (r.weeks ?? r.h) === 13);
  const r20 = rows.find((r) => (r.weeks ?? r.h) === 20) || rows.at(-1);

  const beSpring = r20?.breakEvenFuturePrice ?? 22.4;
  const beMid = r13?.breakEvenFuturePrice ?? 20.1;

  // 3. Official forecast & seasonal peaks
  const fc = model.officialForecast;
  const horizons = fc?.horizons || [];
  const marchHorizon = horizons.find((h) => h.targetMonth?.endsWith('-03')) || horizons.at(-1);
  const expectedSpringPrice = marchHorizon?.point ?? 27.5;

  // Decision 1: Продавать сейчас или держать?
  const marginOverBreakEven = expectedSpringPrice - beSpring;
  let verdict = 'HOLD';
  let recommendationRu = '';
  let badgeColor = 'green';

  if (marginOverBreakEven > 2.0) {
    verdict = 'HOLD';
    badgeColor = 'green';
    recommendationRu = `Держать в хранилище. Прогноз цены на март (${fmt(expectedSpringPrice)} ₽/кг) существенно превышает точку безубыточности хранения (${fmt(beSpring)} ₽/кг). Ожидаемая чистая премия за хранение: +${fmt(marginOverBreakEven)} ₽/кг.`;
  } else if (marginOverBreakEven >= 0) {
    verdict = 'SPLIT_TRANCHES';
    badgeColor = 'yellow';
    recommendationRu = `Разделить объём. Премия за хранение умеренная (+${fmt(marginOverBreakEven)} ₽/кг). Рекомендуется реализовать 20–25% объёма сейчас для снижения долговой нагрузки и 75–80% заложить на хранение.`;
  } else {
    verdict = 'SELL_NOW';
    badgeColor = 'red';
    recommendationRu = `Продавать сейчас. Текущая цена (${fmt(currentPrice)} ₽/кг) выгоднее с учётом затрат на хранение и усушки (точка безубыточности к весне: ${fmt(beSpring)} ₽/кг).`;
  }

  // Decision 2: Лучший транш
  const bestHorizon = horizons.reduce((best, h) => {
    if (!best || (h.point || 0) > (best.point || 0)) return h;
    return best;
  }, marchHorizon);

  const bestTrancheMonth = bestHorizon?.targetMonth || '2027-03';
  const bestTranchePrice = bestHorizon?.point || expectedSpringPrice;

  const tranchesSchedule = [
    { label: 'Транш 1 (С поля / Октябрь-Ноябрь)', targetMonth: '2026-11', sharePct: 15, purpose: 'Покрытие кассового разрыва и процентов по кредиту' },
    { label: 'Транш 2 (Декабрь перед Новым Годом)', targetMonth: '2026-12', sharePct: 25, purpose: 'Всплеск предновогоднего спроса сетей' },
    { label: 'Транш 3 (Февраль-Март — Сезонный пик)', targetMonth: '2027-03', sharePct: 45, purpose: 'Выход на максимальную годовую цену' },
    { label: 'Транш 4 (Апрель — Окончание сезона)', targetMonth: '2027-04', sharePct: 15, purpose: 'Закрытие остатков до прихода раннего импорта' },
  ];

  // Decision 3: Точка безубыточности в этом месяце
  const currentMonthRow = rows.find((r) => (r.weeks ?? r.h) <= 4) || rows[0];
  const curBreakEven = currentMonthRow?.breakEvenFuturePrice ?? (currentPrice + 1.2);

  const breakEvenBreakdown = {
    basePriceRubKg: currentPrice,
    shrinkageLossRubKg: +(currentPrice * 0.035).toFixed(2),
    electricityRubKg: +(fp.energyTariffRubKwh * 0.04).toFixed(2),
    loanInterestRubKg: +((currentPrice * (fp.loanRatePct / 100)) / 12).toFixed(2),
    totalBreakEvenRubKg: curBreakEven,
  };

  return {
    today,
    currentPrice,
    sellNowOrHold: {
      verdict,
      badgeColor,
      recommendationRu,
      currentPriceRubKg: currentPrice,
      beSpringRubKg: beSpring,
      expectedSpringPriceRubKg: expectedSpringPrice,
      marginOverBreakEvenRubKg: marginOverBreakEven,
    },
    bestTranche: {
      targetMonth: bestTrancheMonth,
      expectedPriceRubKg: bestTranchePrice,
      sharePct: 45,
      recommendationRu: `Наиболее прибыльный период реализации — **${bestTrancheMonth}** (прогноз: **${fmt(bestTranchePrice)} ₽/кг**). Рекомендуется направить в данный транш не менее 40–45% объёма партии.`,
      schedule: tranchesSchedule,
    },
    currentMonthBreakEven: {
      month: curMonth,
      breakEvenRubKg: curBreakEven,
      breakdown: breakEvenBreakdown,
      recommendationRu: `Минимальная цена продажи в текущем месяце для покрытия затрат закладки, усушки и процентов: **${fmt(curBreakEven)} ₽/кг**.`,
    },
    farmProfile: fp,
  };
}
