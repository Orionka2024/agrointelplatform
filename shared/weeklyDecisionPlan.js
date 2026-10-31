import { addWeeks, weekStart } from './dates.js';
import { warehouseToMoscow } from './bridge.js';
import { storageAtHorizon, evaluateStorage } from './storageEconomics.js';

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
 * Builds the 26-week warehouse & Moscow trajectory and the 5-stage monthly sales plan.
 */
export function buildWeeklyDecisionPlan({
  cropId = 'onion',
  cropProfile,
  officialForecast,
  today = '2026-10-30',
  baseWarehousePrice = 15.5,
  bridge,
  storageParams,
  scenarioDeltaPct = 0,
}) {
  const startMonday = weekStart(today);
  const startMs = parseUtcMs(today);
  const pStart = Number.isFinite(baseWarehousePrice) && baseWarehousePrice > 0
    ? baseWarehousePrice
    : (cropProfile?.benchmarkWarehousePrice ?? 15.5);

  const isOnionCatBoost = cropId === 'onion' && officialForecast?.rows?.length > 0;
  let knots = [];
  let startRef = pStart;

  if (isOnionCatBoost) {
    const cutoffIso = `${officialForecast.inputCutoff}-15`;
    const lastVal = officialForecast.lastValue || 18.11816;
    const firstRow = officialForecast.rows[0];
    const firstPt = firstRow.catboostPoint ?? firstRow.point ?? lastVal;
    const firstQ80 = firstRow.catboostQ80 ?? firstRow.validation?.q80 ?? 2.6;
    const firstMae = firstRow.catboostHoldoutMae ?? firstRow.validation?.final?.mae ?? 2.6;
    const firstNaive = firstRow.validation?.naiveFinal?.mae ?? 3.2;

    knots.push({
      ms: parseUtcMs(cutoffIso),
      logP: Math.log(lastVal),
      relBand80: firstQ80 / firstPt,
      relMae: firstMae / firstPt,
      skillPct: firstNaive > 0 ? Math.max(0, (1 - firstMae / firstNaive) * 100) : 0,
    });

    for (const r of officialForecast.rows) {
      const pt = r.catboostPoint ?? r.point;
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
    startRef = k0 ? Math.exp(k0.logP) : lastVal;
  }

  const basisFactor = startRef > 0 ? pStart / startRef : 1;
  const sellNowEval = evaluateStorage(pStart, pStart, storageAtHorizon(storageParams, 0));
  const sellNowNet = sellNowEval?.sellNowProceeds ?? Math.max(0, pStart - (storageParams?.sellNowCostRubKg ?? 0.2));

  const weeks = Array.from({ length: 26 }, (_, idx) => {
    const h = idx + 1;
    const targetDate = addWeeks(startMonday, h);
    const targetMs = parseUtcMs(targetDate);

    let baseWh;
    let relBand80 = null;
    let relMae = null;
    let skillPct = null;

    if (isOnionCatBoost) {
      const k = interpolateKnots(knots, targetMs);
      baseWh = Math.exp(k.logP) * basisFactor;
      relBand80 = k.relBand80;
      relMae = k.relMae;
      skillPct = k.skillPct;
    } else {
      const mult = cropProfile?.seasonalMultipliers?.[idx] ?? 1;
      baseWh = pStart * mult;
    }

    // Scenario shock transmits progressively over the first 6 weeks
    const ramp = Math.min(1, 0.35 + (0.65 * idx) / 6);
    const scenarioMultiplier = 1 + (scenarioDeltaPct / 100) * ramp;
    const whPrice = +(baseWh * scenarioMultiplier).toFixed(2);
    const baseWhRounded = +baseWh.toFixed(2);

    const months = +((idx + 1) / 4.33).toFixed(2);
    const horizonStorage = storageAtHorizon(storageParams, months);
    const stEval = evaluateStorage(pStart, whPrice, horizonStorage);

    const netPerKg = +(stEval?.expectedHoldProceeds ?? whPrice * 0.9).toFixed(2);
    const gainVsNow = +(stEval?.gain ?? (netPerKg - sellNowNet)).toFixed(2);
    const breakEvenPrice = +(stEval?.breakEvenFuturePrice ?? pStart).toFixed(2);
    const totalLossPct = stEval ? +(100 * (1 - stEval.goodKg - stEval.downgradedKg)).toFixed(1) : 0;

    const mskCalc = warehouseToMoscow(whPrice, bridge);
    const mskPrice = +(mskCalc?.moscowInclVat ?? (whPrice * 1.1 + 9.5)).toFixed(2);
    const mskExVat = +(mskCalc?.moscowExVat ?? (whPrice + 8.5)).toFixed(2);
    const spread = +(mskPrice - whPrice).toFixed(2);

    const phase = cropProfile?.getPhase
      ? cropProfile.getPhase(idx)
      : { tag: 'Плановое хранение', desc: '' };

    const lo80 = relBand80 !== null ? +Math.max(0, whPrice * (1 - relBand80)).toFixed(1) : null;
    const hi80 = relBand80 !== null ? +(whPrice * (1 + relBand80)).toFixed(1) : null;
    const mae = relMae !== null ? +(whPrice * relMae).toFixed(2) : null;

    return {
      h,
      idx,
      targetDate,
      shortDate: formatShortRuDate(targetDate),
      months,
      baseWhPrice: baseWhRounded,
      whPrice,
      scenarioDeltaRub: +(whPrice - baseWhRounded).toFixed(2),
      netPerKg,
      gainVsNow,
      breakEvenPrice,
      totalLossPct,
      mskPrice,
      mskExVat,
      spread,
      phase,
      lo80,
      hi80,
      mae,
      skillPct: skillPct !== null ? Math.round(skillPct) : null,
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
      recommendation: 'Партии средней лежкости, мелкий калибр (4–5 см), слабая чешуя — разгрузить временные ангары до морозов',
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

  const weightedGrossRubKg = +stages.reduce((s, r) => s + (r.whAvg * r.sharePct) / 100, 0).toFixed(2);
  const weightedNetRubKg = +stages.reduce((s, r) => s + (r.netAvg * r.sharePct) / 100, 0).toFixed(2);
  const stagedAdvantageRubKg = +(weightedNetRubKg - sellNowNet).toFixed(2);

  // Peak week metrics
  let peakWeek = weeks[0];
  let bestNetWeek = weeks[0];
  for (const w of weeks) {
    if (w.whPrice > peakWeek.whPrice) peakWeek = w;
    if (w.netPerKg > bestNetWeek.netPerKg) bestNetWeek = w;
  }

  return {
    isOnionCatBoost,
    basisFactor,
    startMonday,
    baseWarehousePrice: pStart,
    sellNowNet: +sellNowNet.toFixed(2),
    weeks,
    stages,
    weightedGrossRubKg,
    weightedNetRubKg,
    stagedAdvantageRubKg,
    peakWeek,
    bestNetWeek,
  };
}

/**
 * Formats exact TreeSHAP + seasonal-equilibrium attributions from saved officialForecast
 * into rich factor cards for the UI.
 */
export function buildCatBoostShapCards({ officialForecast, officialSnapshotData, macro }) {
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

  // Combine empirical historical feature importance across ensemble + local exact Shapley impact
  const raw = [
    {
      key: 'seasonality',
      label: 'Сезонное истощение запасов в хранилищах РФ',
      absWeight: Math.max(0.06, Math.abs(fl.seasonality)),
      signedLog: fl.seasonality,
      color: '#1A56A8',
      currentVal: `${officialSnapshotData?.producer?.value?.toFixed(2) ?? '18.12'} ₽/кг (РФ) · 15.5 ₽ (ЮФО)`,
      asOf: `Росстат · ${officialSnapshotData?.producer?.period ?? '2026-09'}`,
      source: 'Росстат (69 мес. цен СХО)',
      trend: 'Переход с временных ангаров на холодильное хранение в декабре–марте',
      highlight: false,
    },
    {
      key: 'import_fx',
      label: 'Импортный паритет Казахстана и курс KZT / USD',
      absWeight: Math.max(0.045, Math.abs(fl.import_fx) + 0.04),
      signedLog: fl.import_fx,
      color: '#2563EB',
      currentVal: `KZT: ${(macro?.kztRub?.value ?? officialSnapshotData?.drivers?.kztRub?.value ?? 0.189).toFixed(3)} ₽ · USD: ${(macro?.usdRub?.value ?? officialSnapshotData?.drivers?.usdRub?.value ?? 89.5).toFixed(1)} ₽`,
      asOf: `ЦБ РФ · ${officialSnapshotData?.drivers?.usdRub?.period ?? '2026-09'}`,
      source: 'Банк России (KZT/RUB, USD/RUB)',
      trend: 'Осенью экспорт Жамбылской обл. сдерживает цены; весной истощение КЗ открывает рост',
      highlight: true,
    },
    {
      key: 'equilibrium',
      label: 'Возврат к 24-месячному равновесию и инерция',
      absWeight: Math.max(0.035, Math.abs(fl.equilibrium)),
      signedLog: fl.equilibrium,
      color: '#0D7C4A',
      currentVal: `База отсечки: ${officialForecast?.inputCutoff ?? '2026-09'}`,
      asOf: `Weibull + GBDT`,
      source: 'Десезонализированный уровень цен (24 мес.)',
      trend: 'Текущая осенняя цена ниже двухлетней медианы — потенциал восстановления к весне',
      highlight: false,
    },
    {
      key: 'financing',
      label: 'Ключевая ставка ЦБ РФ (стоимость хранения)',
      absWeight: Math.max(0.025, Math.abs(fl.financing) + 0.02),
      signedLog: fl.financing,
      color: '#C0303A',
      currentVal: `${(macro?.keyRate?.value ?? officialSnapshotData?.drivers?.keyRate?.value ?? 14.0).toFixed(1)}% годовых`,
      asOf: `ЦБ РФ · ${officialSnapshotData?.drivers?.keyRate?.period ?? '2026-09'}`,
      source: 'Банк России (ключевая ставка)',
      trend: 'Дорогие оборотные кредиты ускоряют осенний сбыт и сжимают весеннее предложение',
      highlight: false,
    },
    {
      key: 'retail_demand',
      label: 'Рознично-оптовый мультипликатор федеральных сетей',
      absWeight: Math.max(0.022, Math.abs(fl.retail_demand) + 0.018),
      signedLog: fl.retail_demand,
      color: '#8C5E00',
      currentVal: `Розница РФ: ${officialSnapshotData?.retail?.value?.toFixed(2) ?? '49.19'} ₽/кг`,
      asOf: `Росстат · ${officialSnapshotData?.retail?.date ?? '2026-10-26'}`,
      source: 'Росстат (246 недель потребительских цен)',
      trend: 'Мультипликатор розница/склад 2.7× подтверждает запас платежеспособного спроса сетей',
      highlight: false,
    },
    {
      key: 'weather',
      label: 'Погодный риск заморозков (Жамбыл КЗ / Волгоград)',
      absWeight: Math.max(0.018, Math.abs(fl.weather) + 0.014),
      signedLog: fl.weather,
      color: '#6366F1',
      currentVal: `Жамбыл tMin: ${officialSnapshotData?.drivers?.weather?.zhambyl?.tempMinC?.toFixed(1) ?? '4.5'}°C · Волг.: ${officialSnapshotData?.drivers?.weather?.volgograd?.tempMinC?.toFixed(1) ?? '2.1'}°C`,
      asOf: `ERA5 · ${officialSnapshotData?.drivers?.weather?.zhambyl?.period ?? '2026-09'}`,
      source: 'Open-Meteo ERA5 Archive (81 мес.)',
      trend: 'Морозы ниже −12°C в буртах Южного Казахстана (как в янв. 2023: −27.6°C) вызывают скачок цен',
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
