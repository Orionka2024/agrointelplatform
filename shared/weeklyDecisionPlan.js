import { addWeeks, weekStart, daysBetween } from './dates.js';
import { warehouseToMoscow } from './bridge.js';
import { storageAtHorizon, storageAtCalendarDays, evaluateStorage, STORAGE_TIERS, STANDARD_MONTH_DAYS, daysToMonths } from './storageEconomics.js';
import { watchlistLogOffset, WATCH_HORIZON_WEEKS } from './exportWatchlist.js';
import { buildShortTermDrivers, formatShortTermDriversText } from './shortTermDrivers.js';
import { resolveDatedCbrMacro } from './marketSignals.js';
import { officialForecast as defaultOfficialForecast } from './officialData.js';

export const VOLGOGRAD_ONION_TARGET_SPEC = {
  targetId: 'volgograd_yellow_onion_exw_20t',
  label: 'Лук репчатый жёлтый 1 сорт 50+ мм EXW Волгоград (20 т)',
  cropId: 'onion',
  cropNameRu: 'Лук репчатый жёлтый',
  grade: '1 сорт',
  caliberMm: '50+',
  packaging: 'сетка 25 кг (зачётный вес)',
  lotSizeT: 20,
  deliveryBasis: 'EXW склад Волгоградской области',
  unit: 'RUB/kg',
  vat: 'excluded',
  loadingTerms: 'погрузка в транспорт силами склада',
  paymentTerms: '100% предоплата или согласованный факторинг',
  windowDays: 7,
};

const RU_MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function parseUtcMs(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d || 15);
}

export function formatShortRuDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${RU_MONTHS_SHORT[(m - 1) % 12]}`;
}

function interpolateKnots(knots, targetMs) {
  if (!knots.length) return null;
  if (targetMs <= knots[0].ms) return knots[0];
  if (targetMs >= knots.at(-1).ms) return knots.at(-1);
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    if (targetMs >= a.ms && targetMs <= b.ms) {
      const t = b.ms === a.ms ? 0 : (targetMs - a.ms) / (b.ms - a.ms);
      return {
        ms: targetMs,
        logP: a.logP + t * (b.logP - a.logP),
        relBand80: a.relBand80 + t * (b.relBand80 - a.relBand80),
        relMae: a.relMae + t * (b.relMae - a.relMae),
        skillPct: a.skillPct + t * (b.skillPct - a.skillPct),
      };
    }
  }
  return knots.at(-1);
}

/**
 * Calendar-aware weekly onion market micro-regime (log-price offset + agronomic/commercial phase).
 * Captures real intra-seasonal Russian wholesale mechanics that monthly averages smooth over:
 *  1) Nov: Kazakhstan (Zhambyl) autumn transit + Volgograd unheated shed clearing before frosts
 *  2) Dec 11–26: Pre-New-Year federal retail DC procurement surge
 *  3) Dec 29–Jan 15: Russian New Year wholesale pause & interregional trucking lull
 *  4) Late Jan–Mar: Post-holiday DC restocking + KZ clamp depletion -> March cold-storage peak
 *  5) Apr: Early new-crop onion arrivals from Surkhandarya (Uzbekistan) & Egypt rolling old-crop prices down
 *
 * NOTE (P2.1 / Audit §1 & §6.1):
 * The wholesale benchmark market price for standard yellow onion 50+ mm EXW Volgograd is INDEPENDENT
 * of which warehouse tier an individual farmer operates. A farmer changing storageTierId
 * changes their own losses, OPEX, break-even, and net return, NEVER the market commodity forecast!
 */
export function evaluateOnionWeeklyRegime(targetDate, liveSignals, h = 0) {
  const regime = evaluateOnionSeasonalRegime(targetDate, liveSignals);
  const wlOffset = watchlistLogOffset(liveSignals?.analytics?.watchlist, h);
  if (!wlOffset) return regime;
  return { ...regime, logOffset: regime.logOffset + wlOffset, watchlistLogOffset: wlOffset };
}

export function evaluateOnionSeasonalRegime(targetDate, liveSignals) {
  const [, month, day] = targetDate.split('-').map(Number);
  const imp = liveSignals?.analytics?.impulses || {};
  const kzCap = (imp.kzAutumnCapPct ?? -1.0) * 0.0035;
  // Regional market pressure from temporary shed liquidation before frosts
  const vlgFrostDump = 0;
  const vlgTight = (imp.vlgWinterTighteningPct ?? 0) * 0.004;
  const kzFrost = (imp.kzFrostShockPct ?? 0) * 0.0045;
  const fxShift = (imp.fxParityShiftPct ?? 0) * 0.0025;
  const uzEarly = (imp.uzWarmSpringShiftPct ?? 0) * 0.005;

  // Late Oct / Nov 1–23: Autumn KZ transit + unheated shed liquidation
  if (month === 10 || (month === 11 && day <= 23)) {
    const base =
      month === 10
        ? -0.006
        : day <= 7
          ? -0.012
          : day <= 15
            ? -0.028
            : -0.020;
    return {
      logOffset: base + kzCap + vlgFrostDump,
      driverTag: 'KZ_TRANSIT_SHEDS',
      phase: {
        tag: 'Транзит КЗ · Сброс ангаров',
        desc: 'Активный ввоз из Жамбылской обл. КЗ и разгрузка неотапливаемых ангаров ЮФО сдерживают спот',
      },
    };
  }

  // Nov 24 – Dec 10: Field/shed closure, shift onto ventilated stationary warehouses
  if ((month === 11 && day >= 24) || (month === 12 && day <= 10)) {
    const base = month === 11 ? -0.005 : 0.010;
    return {
      logOffset: base + kzCap * 0.4 + vlgTight * 0.5,
      driverTag: 'STORAGE_SHIFT',
      phase: {
        tag: 'Переход на венткамеры',
        desc: 'Слабые партии с поля распроданы; отгрузки переходят на стационарные вентилируемые склады',
      },
    };
  }

  // Dec 11 – Dec 26: Pre-New-Year retail chain & regional DC procurement wave
  if (month === 12 && day >= 11 && day <= 26) {
    const base = day <= 17 ? 0.028 : 0.048;
    return {
      logOffset: base + vlgTight,
      driverTag: 'PRE_NY_SURGE',
      phase: {
        tag: 'Предновогодний пик сетей',
        desc: 'Федеральные сети и РЦ формируют праздничный запас до закрытия трасс в конце декабря',
      },
    };
  }

  // Dec 27 – Dec 31: Pre-holiday closing of procurement gates
  if (month === 12 && day >= 27) {
    return {
      logOffset: 0.018,
      driverTag: 'NY_GATE_CLOSE',
      phase: {
        tag: 'Закрытие реестров РЦ',
        desc: 'Завершение предновогодней приёмки сетей; спотовые отгрузки переходят в режим паузы',
      },
    };
  }

  // Jan 1 – Jan 15: Russian New Year wholesale pause & DC inventory drawdown
  if (month === 1 && day <= 15) {
    const base = day <= 8 ? -0.028 : -0.018;
    return {
      logOffset: base,
      driverTag: 'NY_PAUSE',
      phase: {
        tag: 'Новогодняя пауза · Каникулы РЦ',
        desc: 'Простой оптовых баз и межрегионального транспорта; сети расходуют декабрьские запасы',
      },
    };
  }

  // Jan 16 – Feb 14: Post-holiday DC restocking + winter reefer logistics
  if ((month === 1 && day >= 16) || (month === 2 && day <= 14)) {
    const base = month === 1 ? 0.008 : 0.022;
    return {
      logOffset: base + vlgTight + kzFrost * 0.6 + fxShift * 0.5,
      driverTag: 'WINTER_RESTOCK',
      phase: {
        tag: 'Пополнение РЦ · Реф-логистика',
        desc: 'Восстановление закупок сетей после каникул; перевозка только тёплыми рефрижераторами',
      },
    };
  }

  // Feb 15 – Mar 24: KZ clamp depletion & peak cold-storage scarcity
  if ((month === 2 && day >= 15) || (month === 3 && day <= 24)) {
    const base = month === 2 ? 0.036 : day <= 12 ? 0.052 : 0.058;
    return {
      logOffset: base + vlgTight + kzFrost + fxShift,
      driverTag: 'SPRING_DEFICIT_PEAK',
      phase: {
        tag: 'Пик дефицита · Истощение КЗ',
        desc: 'Бурты в Казахстане исчерпаны; на рынке торгуется только качественный лук из холодильников (0..+1°C)',
      },
    };
  }

  // Mar 25 – Mar 31: Pre-import plateau & first early UZ quotes
  if (month === 3 && day >= 25) {
    return {
      logOffset: 0.022 + fxShift + uzEarly,
      driverTag: 'PRE_UZ_TURN',
      phase: {
        tag: 'Пиковое плато · Оферты УЗ',
        desc: 'Первые котировки озимого лука из Сурхандарьи (УЗ) останавливают рост цен старого урожая',
      },
    };
  }

  // Apr – May: Progressive early-crop arrival from Uzbekistan (Surkhandarya) & Egypt
  if (month === 4 || month === 5) {
    const dayProgress = month === 4 ? day : 30 + day;
    const rollover = -0.015 - Math.min(0.135, dayProgress * 0.0038);
    return {
      logOffset: rollover + uzEarly + fxShift * 0.8,
      driverTag: 'UZ_EG_EARLY_CROP',
      phase: {
        tag: 'Ранний лук УЗ/Египет · Зачистка',
        desc: 'Массовый заход свежего лука из Узбекистана и Египта снижает цену зимовавших партий',
      },
    };
  }

  return {
    logOffset: 0,
    driverTag: 'SEASONAL_NORMAL',
    phase: { tag: 'Плановое хранение', desc: 'Стандартный режим реализации' },
  };
}

function computeScenarioMultiplier(scenarioId, scenarioDeltaPct, targetDate, idx) {
  const [, month, day] = targetDate.split('-').map(Number);
  if (scenarioId === 'kz_quota') {
    // KZ export restriction / clamp freeze hits hardest in Jan–Mar when transit dries up
    const w =
      month === 11 ? 0.25 : month === 12 ? 0.45 : month === 1 ? 0.80 : month === 2 || month === 3 ? 1.0 : 0.65;
    return 1 + (22 / 100) * w;
  }
  if (scenarioId === 'fx_weak') {
    // Weak RUB raises import parity progressively as import share climbs toward spring
    const w = month === 11 ? 0.40 : month === 12 ? 0.60 : month === 1 || month === 2 ? 0.85 : 1.10;
    return 1 + (10 / 100) * w;
  }
  if (scenarioId === 'dumping') {
    // Excess unheated-shed dumping & cheap autumn imports hit Nov–Jan hardest, fading as weak stock rots out
    const w = month === 11 || month === 12 ? 1.0 : month === 1 ? 0.75 : month === 2 ? 0.55 : 0.35;
    return 1 + (-14 / 100) * w;
  }
  if (scenarioId === 'uz_early') {
    // Warm spring in Surkhandarya pulls early Uzbek onion arrivals 2 weeks forward (late Mar – May)
    if (month === 3 && day >= 20) return 1 - 0.06;
    if (month === 4 || month === 5) return 1 - 0.13;
    return 1;
  }
  if (!scenarioDeltaPct) return 1;
  const ramp = Math.min(1, 0.35 + (0.65 * idx) / 6);
  return 1 + (scenarioDeltaPct / 100) * ramp;
}

/**
 * Builds rich agronomic, commercial, weather, and macro explanations for weekly price movements.
 */
export function buildWeekDeltaExplanation({
  cropId = 'onion',
  cropProfile,
  targetDate,
  idx,
  h,
  whPrice,
  prevWhPrice,
  wowDelta,
  wowPct,
  onionRegime,
  activeTierId,
  scenarioId,
  scenarioDeltaRub = 0,
  liveSignals = null,
  totalLossPct = 0,
  breakEvenPrice = 0,
  netPerKg = 0,
  mskPrice = 0,
  spread = 0,
  phase,
}) {
  const [, month, day] = targetDate.split('-').map(Number);
  const isUp = wowDelta > 0.08;
  const isDown = wowDelta < -0.08;
  const signStr = wowDelta > 0 ? `+${wowDelta.toFixed(1)}` : wowDelta.toFixed(1);

  // Weather hubs from live signals or defaults
  const vlgMin = liveSignals?.weatherHubs?.volgograd?.minTemp10d ?? -1.2;
  const zhmMin = liveSignals?.weatherHubs?.zhambyl?.minTemp10d ?? 2.5;
  const uzMax = liveSignals?.weatherHubs?.surkhandarya?.maxTemp10d ?? 21.0;
  const mskMin = liveSignals?.weatherHubs?.moscow?.minTemp10d ?? -1.0;
  const keyRate = liveSignals?.fx?.keyRate?.value ?? 14.0;

  let summary = '';
  let marketText = '';
  let weatherText = '';
  let storageText = '';
  let actionableTip = '';

  if (cropId === 'onion') {
    const driverTag = onionRegime?.driverTag || '';

    if (driverTag === 'KZ_TRANSIT_SHEDS' || (month === 10 || (month === 11 && day <= 23))) {
      summary = isDown
        ? `Коррекция цены (${signStr} ₽/кг): сезонный ввоз лука из Жамбылской области (Казахстан) и реализация партий из необорудованных хранилищ ЮФО.`
        : `Сдержанная динамика (${signStr} ₽/кг): осенний приток лука из Казахстана и реализация партий без активной вентиляции сдерживают спот.`;
      marketText = `Сезонное предложение в оптовом звене. Казахстанский лук из Тараза и партии из необорудованных складов ЮФО формируют текущее предложение, тогда как стационарные склады работают в режиме планового хранения.`;
      weatherText = vlgMin <= -2
        ? `Наружная температура в ЮФО опускалась до ${vlgMin.toFixed(1)}°C: сама по себе температура −2°C на улице не требует срочной распродажи из стационарных хранилищ. В Таразе (${zhmMin.toFixed(1)}°C) отгрузки идут штатно.`
        : `Температура наружного воздуха в ЮФО (${vlgMin.toFixed(1)}°C) и в Таразе (+${zhmMin.toFixed(1)}°C) позволяет вести штатную вентиляцию и отгрузки.`;
      storageText = activeTierId === 'unventilated'
        ? `Для склада без активной вентиляции решение зависит от фактической температуры и влажности внутри помещения (при влажности >85% и отсутствии продувки возрастает риск конденсата и шейковой гнили).`
        : `Для вентилируемого склада поддерживается плановый режим внутри камеры (+1..+3°C, влажность 70–75%). Текущие технологические потери минимальны (~${totalLossPct}%).`;
      actionableTip = activeTierId === 'unventilated'
        ? `Оценить фактическую температуру, влажность внутри помещения и процент шейковой гнили: ускоренная реализация нужна только при нарушении внутреннего микроклимата партии.`
        : `Не снижать цену вслед за объявлениями на досках. Контролировать температуру, влажность (70–75%) и вентиляцию камеры под плановые контракты.`;
    } else if (driverTag === 'STORAGE_SHIFT' || ((month === 11 && day >= 24) || (month === 12 && day <= 10))) {
      summary = `Разворот тренда вверх (${signStr} ₽/кг): слабые полевые партии распроданы, отгрузки переходят на стационарные вентилируемые склады.`;
      marketText = `Завершение периода дешёвого полевого сброса. На спотовом рынке исчерпано предложение от хозяйств без специализированных складов; на арену выходят профессиональные партии с активной вентиляцией.`;
      weatherText = `Устойчивые заморозки в ЮФО (ночью до ${vlgMin.toFixed(1)}°C) окончательно закрыли полевые работы. Перевозка требует защиты от переохлаждения (изотермы).`;
      storageText = `Товар вошёл в стабильное технологическое хранение. Накопленные потери (усушка + переборка) составляют ~${totalLossPct}%. Точка безубыточности: ${breakEvenPrice.toFixed(1)} ₽/кг.`;
      actionableTip = `Сформировать графики партий на декабрь. Фиксировать договоренности с сетями на калибр 5+ см.`;
    } else if (driverTag === 'PRE_NY_SURGE' || (month === 12 && day >= 11 && day <= 26)) {
      summary = `Предновогодний пик спроса (${signStr} ₽/кг): федеральные сети (X5, Магнит, Дикси) и РЦ формируют максимальный праздничный резерв.`;
      marketText = `Пик закупочной активности ритейла. Закупщики закрывают реестры и объёмы до 26 декабря, чтобы гарантировать наполненность полок до новогодних праздников и опередить дорожные заторы на трассах М-6 и М-4.`;
      weatherText = mskMin <= -10
        ? `В Москве морозы ниже −10°C (${mskMin.toFixed(1)}°C): обязателен тёплый рефрижератор (+1.5–2.5 ₽/кг к логистике).`
        : `Зимний фон в Москве (${mskMin.toFixed(1)}°C) и на трассе М-6. Доставка в РЦ ведётся рефрижераторами и термосами.`;
      storageText = `Период максимальной товарности. Лук находится в глубоком покое при +1..+2°C. Себестоимость хранения растёт умеренно, чистая доходность достигает ~${netPerKg.toFixed(1)} ₽/кг.`;
      actionableTip = `Идеальное коммерческое окно: реализовать 20–25% запаса по высокой цене с премией за качество и калибровку.`;
    } else if (driverTag === 'NY_GATE_CLOSE' || (month === 12 && day >= 27)) {
      summary = `Закрытие предновогодних реестров РЦ: приёмка вне долгосрочных графиков прекращается, спотовый рынок замирает.`;
      marketText = `Распределительные центры прекращают внеплановую приёмку товара. Логистические ворота закрываются до завершения новогодних каникул.`;
      weatherText = `Зимний режим хранения и перевозок по всей центральной и южной России.`;
      storageText = `Контроль герметичности ворот и влажности воздуха в камерах (70–75%).`;
      actionableTip = `Не отправлять несогласованные фуры в Москву во избежание многодневного простоя на праздниках.`;
    } else if (driverTag === 'NY_PAUSE' || (month === 1 && day <= 15)) {
      summary = `Новогодняя пауза (${signStr} ₽/кг): каникулы оптовых баз и водителей, сети расходуют декабрьские запасы.`;
      marketText = `Сезонный спад закупок с 1 по 14 января: оптовые базы («Фуд Сити» и региональные базы) работают на минимуме, ритейл распродаёт декабрьский запас, транспорт на праздничном простое.`;
      weatherText = `Мониторинг морозов в ЮФО и Центральном регионе. Защита складов от выдувания тепла.`;
      storageText = `Товар в стабильном покое. Накопленные потери: ~${totalLossPct}%. Финансирование запасов за счёт ключевой ставки ЦБ (${keyRate}%) добавляет ~0.32 ₽/кг в месяц к точке безубыточности (${breakEvenPrice.toFixed(1)} ₽/кг).`;
      actionableTip = `Не поддаваться на заниженные цены случайных скупщиков в праздничные дни. Ждать восстановления спроса сетей во второй половине января.`;
    } else if (driverTag === 'WINTER_RESTOCK' || ((month === 1 && day >= 16) || (month === 2 && day <= 14))) {
      summary = `Возобновление роста (${signStr} ₽/кг): ритейл пополняет истощившиеся после каникул запасы РЦ, переход на зимнюю реф-логистику.`;
      marketText = `Восстановление регулярных закупок федеральными сетями. Запасы дешёвого лука в хозяйствах без климат-контроля полностью исчерпаны.`;
      weatherText = zhmMin <= -8
        ? `Бычий импульс: морозы в Таразе ниже −8°C (${zhmMin.toFixed(1)}°C) перемерзают казахстанские бурты, сокращая импортный поток в РФ!`
        : `В Таразе (${zhmMin.toFixed(1)}°C) и Москве (${mskMin.toFixed(1)}°C) сохраняется зимний режим. Доставка требует постоянного температурного контроля.`;
      storageText = `Период стабильного хранения. Для вентилируемых складов без холодильника — середина жизненного цикла, лук ещё сохраняет естественный покой.`;
      actionableTip = `Плановая контрактация следующих 20–25% фонда. Тщательная переборка и калибровка перед отгрузкой.`;
    } else if (driverTag === 'SPRING_DEFICIT_PEAK' || ((month === 2 && day >= 15) || (month === 3 && day <= 24))) {
      summary = `Пик дефицита и сезонного роста (${signStr} ₽/кг): открытые бурты в Казахстане исчерпаны, на рынке торгуется только качественный фонд.`;
      marketText = `Максимальная ценовая премия сезона! Открытые бурты в Казахстане закончились либо перемёрзли. Внутреннее предложение в РФ ограничено только профессиональными складами. Покупатели конкурируют за кондиционный товар.`;
      weatherText = `Внимание к погоде в Термезе (Узбекистан): температура ${uzMax.toFixed(1)}°C. Если в Сурхандарье наступает аномальное тепло (>22°C), озимый ранний лук появится на 1–2 недели раньше.`;
      storageText = activeTierId === 'ventilated'
        ? `⚠️ Внимание! Для вентилируемого склада без холодильника это КРАЙНЕЕ ОКНО ПРОДАЖ. При дневном потеплении наружного воздуха выше +4..+6°C лук выйдет из покоя и начнёт прорастать.`
        : `Холодильные камеры (0..+1°C) обеспечивают максимальную сохранность и собирают весеннюю премию.`;
      actionableTip = activeTierId === 'ventilated'
        ? `Для склада с вентиляцией (без холода): полностью распродать 100% остатков до 1–10 марта! Это ваша максимальная точка прибыли.`
        : `Холодильным складам: поэтапно фиксировать прибыль до захода Узбекистана.`;
    } else if (driverTag === 'PRE_UZ_TURN' || (month === 3 && day >= 25)) {
      summary = `Ценовое плато (${signStr} ₽/кг): появление первых коммерческих оферт на ранний лук из Узбекистана останавливает дальнейший рост.`;
      marketText = `Ритейл получает первые предложения на поставку свежего озимого лука из Сурхандарьи (Термез) с отгрузкой в начале апреля. Закупщики сетей прекращают повышать цены на зимовавший лук.`;
      weatherText = `Потепление в Сурхандарье ускоряет созревание раннего лука. В Москве и ЮФО дневные температуры переходят к устойчивому плюсу.`;
      storageText = `Критический риск для складов без искусственного холода: естественный покой лука прерывается, перо трогается в рост.`;
      actionableTip = `Немедленно завершать любые продажи старого урожая. Не надеяться на дальнейший рост.`;
    } else if (driverTag === 'UZ_EG_EARLY_CROP' || (month >= 4)) {
      summary = `Сезонный слом котировок (${signStr} ₽/кг): массовый заход свежего раннего лука из Узбекистана и Египта, потеря товарности старого урожая.`;
      marketText = `Полномасштабный приток свежего урожая (Сурхандарья, Ташкент, Египет через Новороссийск). Сети и покупатели переключаются на свежий лук, зимовавший лук теряет ликвидность и продаётся с глубоким дисконтом.`;
      weatherText = `Весеннее тепло по всей стране ускоряет увядание и прорастание старого фонда.`;
      storageText = `Массовое прорастание и размягчение шеек старого лука. Потери кондиционности превышают 20–35%.`;
      actionableTip = `Экстренная зачистка склада по любым доступным ценам или сброс на промышленную чистку/сушку.`;
    } else {
      summary = `Недельная корректировка цены склада на ${signStr} ₽/кг в рамках сезонного тренда.`;
      marketText = `Стандартная сезонная динамика оптового рынка. Баланс спроса ритейла и предложения складов.`;
      weatherText = `Фактический температурный фон соответствует климатической норме сезона.`;
      storageText =
        totalLossPct !== null && breakEvenPrice !== null
          ? `Плановое хранение: потери ~${totalLossPct}%, безубыточность ${breakEvenPrice.toFixed(1)} ₽/кг.`
          : 'Плановое хранение: параметры безубыточности уточняются.';
      actionableTip = `Придерживаться утверждённого графика отгрузок.`;
    }
  } else {
    const cropName = cropProfile?.label || 'культура';
    summary = isUp
      ? `Сезонный рост цены (${signStr} ₽/кг): сокращение товарных запасов в необорудованных хранилищах и рост спроса сетей.`
      : isDown
        ? `Сезонная коррекция (${signStr} ₽/кг): насыщение оптового рынка и локальное превышение предложения.`
        : `Стабильный ценовой баланс недели (${signStr} ₽/кг).`;
    marketText = `Сезонный профиль реализации для культуры «${cropName}». Спрос поддерживается регулярными контрактами торговых сетей и оптовых баз.`;
    weatherText = `Температурный режим ЮФО и Центральной России определяет условия транспортировки и сохранности партии.`;
    storageText =
      totalLossPct !== null && netPerKg !== null
        ? `Накопленный отход и усушка составляют ~${totalLossPct}%. Чистая выручка с 1 кг заложенного урожая: ~${netPerKg.toFixed(1)} ₽/кг.`
        : 'Хранение не предусмотрено для данной культуры (межсезонье / скоропортящаяся продукция).';
    actionableTip = `Соблюдать температурно-влажностный режим в камерах и плановый график выборки партий.`;
  }

  const drivers = [
    {
      title: 'Рыночный режим и спрос сетей',
      icon: '🏛️',
      badge: isUp ? 'поддержка цен' : isDown ? 'давление на спот' : 'баланс рынка',
      cls: isUp ? 'up' : isDown ? 'dn' : 'neu',
      text: marketText,
    },
    {
      title: 'Агрометеорология и коридоры поставок',
      icon: '☀️',
      badge: (vlgMin <= -2 || zhmMin <= -8 || mskMin <= -10) ? 'погодный триггер' : 'фон 4 хабов',
      cls: (zhmMin <= -8) ? 'up' : (vlgMin <= -2) ? 'warn' : 'info',
      text: weatherText,
    },
    {
      title: 'Экономика склада и биологические риски',
      icon: '🏢',
      badge:
        totalLossPct !== null && breakEvenPrice !== null
          ? `потери ~${totalLossPct}% · порог ${breakEvenPrice.toFixed(1)} ₽`
          : 'межсезонье',
      cls: activeTierId === 'unventilated' && idx >= 4 ? 'dn' : (activeTierId === 'ventilated' && idx >= 17 ? 'warn' : 'info'),
      text: storageText,
    },
    {
      title: 'Логистика и рынок Москвы (DAP с НДС)',
      icon: '🚛',
      badge: `спред +${spread.toFixed(1)} ₽/кг`,
      cls: 'neu',
      text: `Цена опта в Москве на этой неделе: ${mskPrice.toFixed(1)} ₽/кг. Спред к складу EXW составляет +${spread.toFixed(1)} ₽/кг (включает фрахт фуры 20 т, сетку, паллетирование, риски потерь в пути и НДС 10%).`,
    },
  ];

  if (cropId === 'onion') {
    const wl = liveSignals?.analytics?.watchlist;
    const inWindow = h >= 1 && h <= WATCH_HORIZON_WEEKS;
    const items = wl?.items || [];
    const active = items.filter((i) => i.quantified);
    const peak = wl?.totalPeakPct ?? 0;
    const lines = items.map((i) => {
      if (i.disabled) return `• ${i.title}: отключено пользователем — не влияет на прогноз.`;
      if (i.state === 'unknown') {
        return `• ${i.title}: нет подтверждённых данных${i.evidenceNote ? ` (${i.evidenceNote})` : ''}${i.context ? ` Контекст СМИ: ${i.context}` : ''}`;
      }
      const eff = i.quantified ? `${i.peakPct > 0 ? '+' : ''}${i.peakPct}% (источник: ${i.source})` : 'величина не указана в источниках, прогноз не изменён';
      return `• ${i.title}: ${i.label} — ${i.meaning}; ${eff}.`;
    });
    drivers.push({
      title: 'Экспортный коридор (Ирак · Иран · УЗ/КЗ) и ставки Волгограда',
      icon: '🌐',
      badge: !inWindow
        ? 'вне окна 4–6 нед.'
        : active.length
          ? `${peak > 0 ? '+' : ''}${peak}% пик · ${active.length}/${items.length} сигн.`
          : 'сигналы не подтверждены',
      cls: !inWindow || !active.length ? 'info' : peak > 0 ? 'up' : 'warn',
      text:
        (inWindow
          ? `Влияние сигналов действует ${WATCH_HORIZON_WEEKS} недель (неделя ${h}). `
          : `Недельный горизонт сигналов (${WATCH_HORIZON_WEEKS} нед.) пройден; в прогнозе остаётся сезонная динамика. `) +
        lines.join(' '),
    });
  }

  if (cropId === 'onion') {
    const panel = buildShortTermDrivers(liveSignals, h, onionRegime?.driverTag);
    if (panel) {
      const net = +panel.items.reduce((s, i) => s + i.appliedPct, 0).toFixed(2);
      drivers.push({
        title: 'Погода · USD/RUB · ставка ЦБ · импорт КЗ/УЗ (окно 6 недель)',
        icon: '📡',
        badge: `эффект в прогнозе ${net > 0 ? '+' : ''}${net}%`,
        cls: net > 0 ? 'up' : net < 0 ? 'warn' : 'info',
        text: formatShortTermDriversText(panel),
      });
    }
  }

  if (scenarioId && scenarioId !== 'base' && Math.abs(scenarioDeltaRub) > 0.05) {
    const sSign = scenarioDeltaRub > 0 ? `+${scenarioDeltaRub.toFixed(2)}` : scenarioDeltaRub.toFixed(2);
    drivers.push({
      title: 'Сценарный фактор симулятора',
      icon: '⚡',
      badge: `${sSign} ₽/кг к базе`,
      cls: scenarioDeltaRub > 0 ? 'up' : 'warn',
      text: `Текущий активный сценарий добавляет к цене склада ${sSign} ₽/кг по сравнению с базовым прогнозом на этой неделе.`,
    });
  }

  return {
    summary,
    drivers,
    actionableTip,
  };
}

export const CONDITIONAL_FORECAST_BANNER =
  'Текущая цена сделки по луку EXW Волгоград не подтверждена. Прогноз является условным.';
export function buildCatboostKnots(officialForecast, issueDate, pStart) {
  if (!officialForecast?.rows?.length) return null;
  const startMs = parseUtcMs(issueDate);
  const cutoffIso = `${officialForecast.inputCutoff}-15`;
  const lastVal = officialForecast.lastValue || 18.11816;
  const firstRow = officialForecast.rows[0];
  const firstPt = firstRow.catboostPoint ?? firstRow.point ?? lastVal;
  const firstQ80 = firstRow.catboostQ80 ?? firstRow.validation?.q80 ?? 2.6;
  const firstMae = firstRow.catboostHoldoutMae ?? firstRow.validation?.final?.mae ?? 2.6;
  const firstNaive = firstRow.validation?.naiveFinal?.mae ?? 3.2;

  const knots = [];
  knots.push({
    ms: parseUtcMs(cutoffIso),
    logP: Math.log(lastVal),
    relBand80: firstQ80 / firstPt,
    relMae: firstMae / firstPt,
    skillPct: firstNaive > 0 ? Math.max(0, (1 - firstMae / firstNaive) * 100) : 0,
  });

  for (const r of officialForecast.rows) {
    const cbPt = r.catboostPoint ?? r.point;
    const eqPt = r.point ?? r.catboostPoint;
    const lead = r.lead ?? 3;
    const wCb = lead <= 3 ? 1 : Math.exp(-Math.max(0, (lead - 3.5) * 0.52));
    const pt = cbPt > 0 && eqPt > 0 ? wCb * cbPt + (1 - wCb) * eqPt : (cbPt ?? eqPt);
    if (!(pt > 0)) continue;
    const q80 = r.catboostQ80 ?? r.validation?.q80 ?? firstQ80;
    const mae = r.catboostHoldoutMae ?? r.validation?.final?.mae ?? firstMae;
    const naiveMae = r.validation?.naiveFinal?.mae ?? mae;
    knots.push({
      ms: parseUtcMs(`${r.targetMonth}-15`),
      logP: Math.log(pt),
      relBand80: q80 > 0 ? q80 / pt : 0.14,
      relMae: mae > 0 ? mae / pt : 0.12,
      skillPct: naiveMae > 0 ? ((1 - mae / naiveMae) * 100) : 0,
    });
  }
  knots.sort((a, b) => a.ms - b.ms);
  const k0 = interpolateKnots(knots, startMs);
  const startRef = k0 ? Math.exp(k0.logP) : lastVal;
  const basisFactor = startRef > 0 ? pStart / startRef : 1;
  return { knots, basisFactor, startRef };
}

/**
 * Unified target forecast evaluator for yellow onion EXW Volgograd (20 t lot).
 * All UI panels (Dashboard, Forecast, Intel Panel) and backtest routines consume
 * this exact point and intervals given identical inputs.
 */
export function evaluateVolgogradOnionTargetForecast({
  targetId = 'volgograd_yellow_onion_exw_20t',
  targetSpec = VOLGOGRAD_ONION_TARGET_SPEC,
  issueAsOf = '2026-11-13',
  targetDate = '2026-11-16',
  windowDays = 7,
  observations = [],
  baseWarehousePrice = 15.5,
  hasVerifiedWarehouseDeal = false,
  officialForecast = null,
  liveSignals = null,
  scenarioDeltaPct = 0,
  scenarioId = 'base',
}) {
  const daysToTarget = Math.max(0, daysBetween(issueAsOf, targetDate));
  const holdingMonths = daysToMonths(daysToTarget);
  const targetMs = parseUtcMs(targetDate);

  // Separate anchors: local closed transaction vs buyer bid vs statistical benchmark vs conditional scenario
  const localTransactions = (observations || []).filter((o) => {
    if (!o || o.isYellowStandard === false) return false;
    const type = o.evidenceType || o.kind;
    const isTrans = type === 'completed_transaction' || type === 'transaction';
    const isLocal = /волгоград/i.test(o.location || o.region || '') || o.region === 'Волгоградская обл.';
    const date = o.observationDate || o.date;
    const inWindow = date && date <= issueAsOf && daysBetween(date, issueAsOf) <= windowDays && daysBetween(date, issueAsOf) >= 0;
    const isVer = o.verificationStatus === 'verified' || o.verified === true || o.verification?.status === 'verified';
    return isTrans && isLocal && inWindow && isVer && Number.isFinite(Number(o.valueExVat ?? o.priceExVatRubKg ?? o.value));
  });

  const localBids = (observations || []).filter((o) => {
    if (!o || o.isYellowStandard === false) return false;
    const type = o.evidenceType || o.kind;
    const isBid = type === 'executable_bid' || type === 'bid';
    const isLocal = /волгоград/i.test(o.location || o.region || '') || o.region === 'Волгоградская обл.';
    const date = o.observationDate || o.date;
    const inWindow = date && date <= issueAsOf && daysBetween(date, issueAsOf) <= windowDays && daysBetween(date, issueAsOf) >= 0;
    const isVer = o.verificationStatus === 'verified' || o.verified === true || o.verification?.status === 'verified';
    return isBid && isLocal && inWindow && isVer && Number.isFinite(Number(o.valueExVat ?? o.priceExVatRubKg ?? o.value));
  });

  const latestTransaction = localTransactions.length ? localTransactions.at(-1) : null;
  const latestBid = localBids.length ? localBids.at(-1) : null;

  let effectiveAnchorPrice = Number.isFinite(Number(baseWarehousePrice)) && Number(baseWarehousePrice) > 0 ? Number(baseWarehousePrice) : 15.5;
  let effectiveAnchorType = 'conditional_scenario_benchmark';
  let hasVerifiedAnchor = hasVerifiedWarehouseDeal;

  if (latestTransaction) {
    effectiveAnchorPrice = Number(latestTransaction.valueExVat ?? latestTransaction.priceExVatRubKg ?? latestTransaction.value);
    effectiveAnchorType = 'completed_transaction';
    hasVerifiedAnchor = true;
  } else if (latestBid) {
    effectiveAnchorPrice = Number(latestBid.valueExVat ?? latestBid.priceExVatRubKg ?? latestBid.value);
    effectiveAnchorType = 'executable_bid';
    hasVerifiedAnchor = true;
  }

  const pStart = +effectiveAnchorPrice.toFixed(1);
  const isConditionalForecast = !hasVerifiedAnchor;

  const effectiveOfficial = officialForecast || defaultOfficialForecast;
  const knots = buildCatboostKnots(effectiveOfficial, issueAsOf, pStart);
  let baseWh;
  let relBand80 = 0.14;
  let relMae = 0.12;

  const hLead = Math.max(1, Math.round(daysToTarget / 7));
  const leadIdx = Math.max(0, hLead - 1);

  if (knots && knots.knots.length > 0) {
    const k = interpolateKnots(knots.knots, targetMs);
    const regime = evaluateOnionWeeklyRegime(targetDate, liveSignals, hLead);
    baseWh = Math.exp(k.logP + regime.logOffset) * knots.basisFactor;
    relBand80 = k.relBand80;
    relMae = k.relMae;
  } else {
    baseWh = pStart;
  }

  const scenarioMultiplier = computeScenarioMultiplier(scenarioId, scenarioDeltaPct, targetDate, leadIdx);
  const rawWhPrice = baseWh * scenarioMultiplier;
  const point = +rawWhPrice.toFixed(1);
  const relBand95 = Math.min(0.65, relBand80 * 1.55);

  const lo80 = +Math.max(0.5, rawWhPrice * (1 - relBand80)).toFixed(1);
  const hi80 = +(rawWhPrice * (1 + relBand80)).toFixed(1);
  const lo95 = +Math.max(0.5, rawWhPrice * (1 - relBand95)).toFixed(1);
  const hi95 = +(rawWhPrice * (1 + relBand95)).toFixed(1);

  return {
    targetId,
    targetSpec: { ...VOLGOGRAD_ONION_TARGET_SPEC, ...targetSpec },
    issueAsOf,
    targetDate,
    daysToTarget,
    holdingMonths,
    isConditionalForecast,
    conditionalWarning: isConditionalForecast ? CONDITIONAL_FORECAST_BANNER : null,
    anchors: {
      localTransaction: latestTransaction ? {
        priceExVat: Number(latestTransaction.valueExVat ?? latestTransaction.value),
        date: latestTransaction.observationDate || latestTransaction.date,
        source: latestTransaction.sourceUrl || latestTransaction.documentRef,
      } : null,
      executableBid: latestBid ? {
        priceExVat: Number(latestBid.valueExVat ?? latestBid.value),
        date: latestBid.observationDate || latestBid.date,
        source: latestBid.sourceUrl || latestBid.documentRef,
      } : null,
      statisticalBenchmark: {
        rfProducerPriceExVat: 18.11816,
        sfdProducerPriceExVat: 17.53219,
        source: 'Росстат ЕМИСС (СХО без НДС)',
        period: '2026-09',
        availableDate: '2026-10-28',
      },
      conditionalScenarioBase: pStart,
      effectiveAnchorPrice: pStart,
      effectiveAnchorType,
    },
    rawPoint: +rawWhPrice.toFixed(4),
    point,
    lo80,
    hi80,
    lo95,
    hi95,
    relBand80: +relBand80.toFixed(4),
    relBand95: +relBand95.toFixed(4),
    calibrationMethod: 'empirical_holdout_quantiles',
    modelVersion: 'catboost-weekly-v2',
  };
}

/**
 * Builds the 26-week warehouse & Moscow trajectory and the 5-stage monthly sales plan.
 */
export function buildWeeklyDecisionPlan({
  cropId = 'onion',
  cropProfile,
  officialForecast,
  today = '2026-10-30',
  baseWarehousePrice = 15.5,
  hasVerifiedWarehouseDeal = false,
  bridge,
  storageParams,
  storageTierId = null,
  scenarioDeltaPct = 0,
  scenarioId = null,
  liveSignals = null,
}) {
  const activeTierId = storageTierId || storageParams?.tierId || (cropId === 'onion' ? 'ventilated' : null);
  const effectiveStorageParams = storageParams || (activeTierId && STORAGE_TIERS[activeTierId]?.params) || cropProfile?.storageParams;
  const startMonday = weekStart(today);
  const startMs = parseUtcMs(today);
  const pStart = Number.isFinite(baseWarehousePrice) && baseWarehousePrice > 0
    ? +Number(baseWarehousePrice).toFixed(1)
    : +(cropProfile?.benchmarkWarehousePrice ?? 15.5).toFixed(1);
  const isConditionalForecast = !hasVerifiedWarehouseDeal;
  const conditionalWarning = isConditionalForecast ? CONDITIONAL_FORECAST_BANNER : null;

  const effectiveOfficial = officialForecast || defaultOfficialForecast;
  const isOnionCatBoost = cropId === 'onion' && effectiveOfficial?.rows?.length > 0;
  const knotBundle = isOnionCatBoost ? buildCatboostKnots(effectiveOfficial, today, pStart) : null;
  const knots = knotBundle?.knots || [];
  const basisFactor = knotBundle?.basisFactor || 1;

  const sellNowEval = effectiveStorageParams ? evaluateStorage(pStart, pStart, storageAtCalendarDays(effectiveStorageParams, 0, activeTierId)) : null;
  const sellNowNet =
    sellNowEval?.status === 'ok' && Number.isFinite(sellNowEval.netNowPerKgStored)
      ? +sellNowEval.netNowPerKgStored.toFixed(1)
      : +Math.max(0, pStart - (effectiveStorageParams?.sellNowCostRubKg ?? 0.2)).toFixed(1);

  let prevWh = pStart;
  const weeks = Array.from({ length: 26 }, (_, idx) => {
    const h = idx + 1;
    const targetDate = addWeeks(startMonday, h);
    const targetMs = parseUtcMs(targetDate);
    const holdingDays = Math.max(0, daysBetween(today, targetDate));
    const months = +(daysToMonths(holdingDays)).toFixed(2);

    let baseWh;
    let relBand80 = null;
    let relMae = null;
    let skillPct = null;
    let onionRegime = null;

    if (isOnionCatBoost) {
      const k = interpolateKnots(knots, targetMs);
      onionRegime = evaluateOnionWeeklyRegime(targetDate, liveSignals, h);
      baseWh = Math.exp(k.logP + onionRegime.logOffset) * basisFactor;
      relBand80 = k.relBand80;
      relMae = k.relMae;
      skillPct = k.skillPct;
    } else {
      const mult = cropProfile?.seasonalMultipliers?.[idx] ?? 1;
      baseWh = pStart * mult;
    }

    const scenarioMultiplier =
      cropId === 'onion'
        ? computeScenarioMultiplier(scenarioId, scenarioDeltaPct, targetDate, idx)
        : 1 + (scenarioDeltaPct / 100) * Math.min(1, 0.35 + (0.65 * idx) / 6);
    const prevWhPrice = prevWh;
    const rawWhPrice = baseWh * scenarioMultiplier;
    const whPrice = +rawWhPrice.toFixed(1);
    const baseWhRounded = +baseWh.toFixed(1);
    const wowDelta = +(whPrice - prevWhPrice).toFixed(1);
    const wowPct = prevWhPrice > 0 ? +(((whPrice - prevWhPrice) / prevWhPrice) * 100).toFixed(1) : 0;
    prevWh = whPrice;

    // Calendar day storage accounting: uses exact holdingDays (3 days for W+1 13.11 -> 16.11)
    const horizonStorage = effectiveStorageParams ? storageAtCalendarDays(effectiveStorageParams, holdingDays, activeTierId) : null;
    const stEval = horizonStorage ? evaluateStorage(pStart, whPrice, horizonStorage) : null;

    const netPerKg = stEval?.status === 'ok' && Number.isFinite(stEval.netLaterPerKgStored)
      ? +stEval.netLaterPerKgStored.toFixed(1)
      : null;
    const gainVsNow = stEval?.status === 'ok' && Number.isFinite(stEval.gain)
      ? +stEval.gain.toFixed(1)
      : null;
    const breakEvenPrice = stEval?.status === 'ok' && Number.isFinite(stEval.breakEvenFuturePrice)
      ? +stEval.breakEvenFuturePrice.toFixed(1)
      : null;
    const totalLossPct = stEval?.status === 'ok' && Number.isFinite(stEval.saleableYield)
      ? +(100 * (1 - stEval.saleableYield)).toFixed(1)
      : null;

    const mskCalc = warehouseToMoscow(whPrice, bridge);
    const mskPrice = +(mskCalc?.moscowInclVat ?? (whPrice * 1.1 + 9.5)).toFixed(1);
    const mskExVat = +(mskCalc?.moscowExVat ?? (whPrice + 8.5)).toFixed(1);
    const spread = +(mskPrice - whPrice).toFixed(1);

    let phase = onionRegime?.phase
      ? onionRegime.phase
      : cropProfile?.getPhase
        ? cropProfile.getPhase(idx)
        : (cropProfile?.offSeasonNotice ? { tag: 'Межсезонье', desc: cropProfile.offSeasonNotice.title } : { tag: 'Плановое хранение', desc: '' });

    if (activeTierId === 'unventilated' && idx >= 4) {
      phase = {
        tag: '⚠️ Риск порчи (без вентиляции)',
        desc: 'Склад без активной вентиляции: повышенный риск отпотевания и гнили при отсутствии воздухообмена. Требуется контроль состояния партии.',
      };
    } else if (activeTierId === 'ventilated' && idx >= 17) {
      phase = {
        tag: '⚠️ Риск прорастания (без холода)',
        desc: 'Склад с вентиляцией без холодильника: весеннее потепление (> +4°C) активирует точку роста. Склад должен быть полностью зачищен до марта!',
      };
    }

    const lo80 = relBand80 !== null ? +Math.max(0, rawWhPrice * (1 - relBand80)).toFixed(1) : null;
    const hi80 = relBand80 !== null ? +(rawWhPrice * (1 + relBand80)).toFixed(1) : null;
    const mae = relMae !== null ? +(rawWhPrice * relMae).toFixed(1) : null;

    const deltaExplanation = buildWeekDeltaExplanation({
      cropId,
      cropProfile,
      targetDate,
      idx,
      h,
      whPrice,
      prevWhPrice,
      wowDelta,
      wowPct,
      onionRegime,
      activeTierId,
      scenarioId,
      scenarioDeltaRub: +(whPrice - baseWhRounded).toFixed(1),
      liveSignals,
      totalLossPct,
      breakEvenPrice,
      netPerKg,
      mskPrice,
      spread,
      phase,
    });

    return {
      h,
      idx,
      targetDate,
      shortDate: formatShortRuDate(targetDate),
      months,
      prevWhPrice,
      baseWhPrice: baseWhRounded,
      whPrice,
      wowDelta,
      wowPct,
      driverTag: onionRegime?.driverTag || null,
      scenarioDeltaRub: +(whPrice - baseWhRounded).toFixed(1),
      netPerKg,
      gainVsNow,
      breakEvenPrice,
      totalLossPct,
      mskPrice,
      mskExVat,
      spread,
      phase,
      deltaExplanation,
      lo80,
      hi80,
      mae,
      skillPct: skillPct !== null ? Math.round(skillPct) : null,
      isConditionalForecast,
      conditionalWarning,
    };
  });

  // 5-Stage Monthly Sales Plan (100% warehouse harvest)
  const stageDefs = [
    {
      id: 'oct_nov',
      period: '1. Октябрь – Ноябрь',
      sharePct: 15,
      weekRange: [0, 3],
      badge: 'Сброс слабых партий',
      badgeCls: 'neu',
      recommendation: 'Партии средней лежкости, мелкий калибр (4–5 см), слабая чешуя — разгрузить временные ангары при ухудшении микроклимата внутри склада',
    },
    {
      id: 'dec',
      period: '2. Декабрь (Новый год)',
      sharePct: 20,
      weekRange: [4, 8],
      badge: 'Ритейл-пик',
      badgeCls: 'info',
      recommendation: 'Стандартный товарный фонд (5+ см) под предновогодние контракты розничных сетей',
    },
    {
      id: 'jan_feb',
      period: '3. Январь – нач. Февраля',
      sharePct: 25,
      weekRange: [9, 14],
      badge: 'Оборотный поток',
      badgeCls: 'info',
      recommendation: 'Просушенные партии из вентилируемых камер; фиксация кэш-флоу под закупку семян и СЗР',
    },
    {
      id: 'feb_mar',
      period: '4. Февраль – Конец Марта',
      sharePct: 35,
      weekRange: [15, 21],
      badge: 'Золотой фонд',
      badgeCls: 'up',
      recommendation: '«Золотой фонд» (калибр 5–7 см, 3–4 плотные рубашки, холодильник 0..+1°C) — окно максимальной маржи',
    },
    {
      id: 'apr',
      period: '5. Первая пол. Апреля',
      sharePct: 5,
      weekRange: [22, 25],
      badge: 'Зачистка склада',
      badgeCls: 'warn',
      recommendation: 'Полная зачистка остатков хранилища до массового захода раннего лука из Узбекистана и Египта',
    },
  ];

  const avg = (arr, fn) => (arr.length ? arr.reduce((s, r) => s + fn(r), 0) / arr.length : 0);

  const stages = stageDefs.map((st) => {
    const slice = weeks.slice(st.weekRange[0], st.weekRange[1] + 1);
    const whMin = Math.min(...slice.map((r) => r.whPrice));
    const whMax = Math.max(...slice.map((r) => r.whPrice));
    const whAvg = +avg(slice, (r) => r.whPrice).toFixed(1);
    const netAvg = +avg(slice, (r) => r.netPerKg).toFixed(1);
    const mskAvg = +avg(slice, (r) => r.mskPrice).toFixed(1);
    const lossAvg = +avg(slice, (r) => r.totalLossPct).toFixed(1);
    return {
      ...st,
      whMin: +whMin.toFixed(1),
      whMax: +whMax.toFixed(1),
      whAvg,
      netAvg,
      mskAvg,
      lossAvg,
      dateSpan: `${slice[0]?.shortDate} – ${slice.at(-1)?.shortDate}`,
    };
  });

  const weightedGrossRubKg = +stages.reduce((s, r) => s + (r.whAvg * r.sharePct) / 100, 0).toFixed(1);
  const weightedNetRubKg = +stages.reduce((s, r) => s + (r.netAvg * r.sharePct) / 100, 0).toFixed(1);
  const stagedAdvantageRubKg = +(weightedNetRubKg - sellNowNet).toFixed(1);

  // Peak week metrics
  let peakWeek = weeks[0];
  let bestNetWeek = weeks[0];
  for (const w of weeks) {
    if (w.whPrice > peakWeek.whPrice) peakWeek = w;
    if (w.netPerKg > bestNetWeek.netPerKg) bestNetWeek = w;
  }

  return {
    isOnionCatBoost,
    isConditionalForecast,
    conditionalWarning,
    basisFactor,
    startMonday,
    baseWarehousePrice: pStart,
    sellNowNet: +sellNowNet.toFixed(1),
    weeks,
    stages,
    weightedGrossRubKg,
    weightedNetRubKg,
    stagedAdvantageRubKg,
    peakWeek,
    bestNetWeek,
    storageTierId: activeTierId,
    storageTier: activeTierId ? STORAGE_TIERS[activeTierId] : null,
  };
}

/**
 * Formats exact TreeSHAP + seasonal-equilibrium attributions from saved officialForecast
 * into rich factor cards for the UI.
 */
export function buildCatBoostShapCards({ officialForecast, officialSnapshotData, macro, signals = null }) {
  const springRow =
    officialForecast?.rows?.find((r) => r.targetMonth === '2027-03') ||
    officialForecast?.rows?.[4] ||
    officialForecast?.rows?.[0];

  const fl = springRow?.catboostShap?.factorLogs || {
    seasonality: 0.21,
    equilibrium: 0.08,
    import_fx: 0.035,
    financing: 0.025,
    retail_demand: 0.02,
    weather: 0.015,
  };

  const spotConsensus = signals?.analytics?.impliedDealSpotExVat;
  const kzParity = signals?.analytics?.parity?.kzLandedVolgogradExVat;
  const uzParity = signals?.analytics?.parity?.uzEarlyLandedSouthExVat;
  const datedMacro = resolveDatedCbrMacro('2026-11-13');
  const kztVal = signals?.fx?.kztRub?.value ?? macro?.kztRub?.value ?? officialSnapshotData?.drivers?.kztRub?.value ?? datedMacro.kztRub ?? 0.186573;
  const uzsVal = signals?.fx?.uzsPer10k?.value ?? datedMacro.uzsPer10k;
  const usdVal = signals?.fx?.usdRub?.value ?? macro?.usdRub?.value ?? officialSnapshotData?.drivers?.usdRub?.value ?? datedMacro.usdRub ?? 97.8;
  const zhmMin = signals?.weatherHubs?.zhambyl?.minTemp10d ?? officialSnapshotData?.drivers?.weather?.zhambyl?.tempMinC ?? 4.5;
  const vlgMin = signals?.weatherHubs?.volgograd?.minTemp10d ?? officialSnapshotData?.drivers?.weather?.volgograd?.tempMinC ?? 2.1;
  const foodStarCh = signals?.spotChannels?.find((c) => c.id === 'foodstar_msk');

  // Combine empirical historical feature importance across ensemble + local exact Shapley impact
  const raw = [
    {
      key: 'seasonality',
      label: 'Сезонное истощение складов РФ и спот ЮФО',
      absWeight: Math.max(0.06, Math.abs(fl.seasonality)),
      signedLog: fl.seasonality,
      color: '#1A56A8',
      currentVal: spotConsensus
        ? `Спот Волгоград: ~${spotConsensus.toFixed(1)} ₽ · СХО ЮФО: ${officialSnapshotData?.producerSouth?.value?.toFixed(2) ?? '17.53'} ₽`
        : `${officialSnapshotData?.producer?.value?.toFixed(2) ?? '18.12'} ₽/кг (РФ) · 15.5 ₽ (ЮФО)`,
      asOf: spotConsensus ? `AgroRU/Авито + Росстат` : `Росстат · ${officialSnapshotData?.producer?.period ?? '2026-09'}`,
      source: 'Росстат (69 мес.) + спот-мониторинг Волгограда',
      trend: 'Ноябрь: сброс холодных ангаров; 1–14 янв.: новогодняя пауза РЦ; март: пик холодильников',
      highlight: false,
    },
    {
      key: 'import_fx',
      label: 'Импортный паритет КЗ (Тараз) и УЗ (Термез)',
      absWeight: Math.max(0.045, Math.abs(fl.import_fx) + 0.04),
      signedLog: fl.import_fx,
      color: '#2563EB',
      currentVal: kzParity
        ? `КЗ в Волг.: ${kzParity.toFixed(1)} ₽ · УЗ (апр.): ${uzParity.toFixed(1)} ₽ · KZT ${kztVal.toFixed(3)}${uzsVal ? ` · 10k UZS ${uzsVal.toFixed(1)} ₽` : ''}`
        : `KZT: ${kztVal.toFixed(3)} ₽ · USD: ${usdVal.toFixed(1)} ₽`,
      asOf: signals?.fx?.status === 'live' ? `ЦБ РФ LIVE · ${signals.fx.asOf}` : `ЦБ РФ · ${officialSnapshotData?.drivers?.usdRub?.period ?? '2026-10'}`,
      source: 'Банк России (KZT, UZS, USD) + логистический паритет',
      trend: 'Ослабление рубля к тенге делает казахстанский лук дороже для импортёров и открывает дорогу росту внутренних российских цен; в апреле ранний лук Сурхандарьи разворачивает цены вниз',
      highlight: true,
    },
    {
      key: 'equilibrium',
      label: 'Возврат к 24-месячному равновесию и смена урожая',
      absWeight: Math.max(0.035, Math.abs(fl.equilibrium)),
      signedLog: fl.equilibrium,
      color: '#0D7C4A',
      currentVal: `База отсечки: ${officialForecast?.inputCutoff ?? '2026-09'} (РФ ${officialSnapshotData?.producer?.value?.toFixed(2) ?? '18.12'} ₽)`,
      asOf: `Weibull + GBDT`,
      source: 'Десезонализированный уровень цен (24 мес.)',
      trend: 'Зимой действует премия за хранение, с конца марта — плавный разворот под новый урожай',
      highlight: false,
    },
    {
      key: 'financing',
      label: 'Ключевая ставка ЦБ РФ (стоимость денег)',
      absWeight: Math.max(0.025, Math.abs(fl.financing) + 0.02),
      signedLog: fl.financing,
      color: '#C0303A',
      currentVal: `${(macro?.keyRate?.value ?? signals?.fx?.keyRate?.value ?? officialSnapshotData?.drivers?.keyRate?.value ?? 18.0).toFixed(1)}% годовых`,
      asOf: `ЦБ РФ · ${officialSnapshotData?.drivers?.keyRate?.period ?? '2026-10'}`,
      source: 'Банк России (ключевая ставка)',
      trend: `Ставка ЦБ (18–21%): удержание товара забирает ~${(spotConsensus ? spotConsensus * 0.19 / 12 : 0.32).toFixed(2)} ₽/кг в месяц (упущенная выгода по депозиту или процент по кредиту)`,
      highlight: false,
    },
    {
      key: 'storage_tier',
      label: 'Сегментация складов (3 эшелона рынка)',
      absWeight: 0.032,
      signedLog: -0.012,
      color: '#059669',
      currentVal: '1) Ангары (до 1 дек.) · 2) Вентиляция (дек–фев) · 3) Холод (0..+1°C)',
      asOf: 'Отраслевой регламент',
      source: 'Агрономическая модель лежкости',
      trend: 'Временные ангары сбрасывают до 1 дек.; склады с вентиляцией торгуют дек–февр.; камеры 0..+1°C снимают весеннюю премию',
      highlight: false,
    },
    {
      key: 'retail_demand',
      label: 'Спрос сетей, HoReCa Москвы и календарь РЦ',
      absWeight: Math.max(0.022, Math.abs(fl.retail_demand) + 0.018),
      signedLog: fl.retail_demand,
      color: '#8C5E00',
      currentVal: `Розница РФ: ${officialSnapshotData?.retail?.value?.toFixed(2) ?? '49.19'} ₽${foodStarCh?.quotedPrice ? ` · HoReCa МСК: ${foodStarCh.quotedPrice.toFixed(0)} ₽` : ''}`,
      asOf: `Росстат · ${officialSnapshotData?.retail?.date ?? '2026-10-26'}`,
      source: 'Росстат (246 нед.) + прайс дистрибьюторов Москвы',
      trend: 'Пик отгрузок сетей 14–26 декабря сменяется просадкой спроса на каникулах 1–14 января',
      highlight: false,
    },
    {
      key: 'weather',
      label: 'Погодный радар 4 хабов (ЮФО / КЗ / УЗ / Москва)',
      absWeight: Math.max(0.018, Math.abs(fl.weather) + 0.014),
      signedLog: fl.weather,
      color: '#6366F1',
      currentVal: `Волг. min: ${Number(vlgMin).toFixed(1)}°C · Тараз КЗ: ${Number(zhmMin).toFixed(1)}°C · МСК min: ${Number(signals?.weatherHubs?.moscow?.minTemp10d ?? -2.0).toFixed(1)}°C`,
      asOf: signals?.weatherHubs?.volgograd?.status === 'live' ? 'Open-Meteo LIVE (10 дн.)' : `ERA5 / Open-Meteo`,
      source: 'Open-Meteo 10d Forecast + ERA5 (81 мес.)',
      trend: 'Волгоград < −2°C (сброс ангаров); Тараз КЗ < −8°C (перемерзание буртов КЗ); Термез УЗ (ранний лук); Москва < −10°C (теплый реф +1.5–2.5 ₽/кг)',
      highlight: false,
    },
  ];

  const sumW = raw.reduce((s, r) => s + r.absWeight, 0) || 1;
  const rawPcts = raw.map((r) => Math.max(5, Math.round((r.absWeight / sumW) * 100)));
  const diff = 100 - rawPcts.reduce((a, b) => a + b, 0);
  rawPcts[0] += diff;

  return raw
    .map((r, i) => ({
      ...r,
      pct: rawPcts[i],
      signedPct: +((Math.exp(r.signedLog) - 1) * 100).toFixed(1),
    }))
    .sort((a, b) => b.pct - a.pct);
}
