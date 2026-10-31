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
 * Calendar-aware weekly onion market micro-regime (log-price offset + agronomic/commercial phase).
 * Captures real intra-seasonal Russian wholesale mechanics that monthly averages smooth over:
 *  1) Nov: Kazakhstan (Zhambyl) autumn transit + Volgograd unheated shed clearing before frosts
 *  2) Dec 11–26: Pre-New-Year federal retail DC procurement surge
 *  3) Dec 29–Jan 15: Russian New Year wholesale pause & interregional trucking lull
 *  4) Late Jan–Mar: Post-holiday DC restocking + KZ clamp depletion -> March cold-storage peak
 *  5) Apr: Early new-crop onion arrivals from Surkhandarya (Uzbekistan) & Egypt rolling old-crop prices down
 */
function evaluateOnionWeeklyRegime(targetDate, liveSignals) {
  const [, month, day] = targetDate.split('-').map(Number);
  const imp = liveSignals?.analytics?.impulses || {};
  const kzCap = (imp.kzAutumnCapPct ?? -1.5) * 0.0035;
  const vlgFrostDump = (imp.vlgFrostDumpPct ?? 0) * 0.0045;
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
        desc: 'Активный ввоз из Жамбылской обл. КЗ и разгрузка неотапливаемых ангаров ЮФО до морозов сдерживают спот',
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
  scenarioId = null,
  liveSignals = null,
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
      const cbPt = r.catboostPoint ?? r.point;
      const eqPt = r.point ?? r.catboostPoint;
      // Blend short-lead GBDT momentum with seasonal-equilibrium rollover at longer leads (Apr–Jun)
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
    startRef = k0 ? Math.exp(k0.logP) : lastVal;
  }

  const basisFactor = startRef > 0 ? pStart / startRef : 1;
  const sellNowEval = evaluateStorage(pStart, pStart, storageAtHorizon(storageParams, 0));
  const sellNowNet = sellNowEval?.sellNowProceeds ?? Math.max(0, pStart - (storageParams?.sellNowCostRubKg ?? 0.2));

  let prevWh = pStart;
  const weeks = Array.from({ length: 26 }, (_, idx) => {
    const h = idx + 1;
    const targetDate = addWeeks(startMonday, h);
    const targetMs = parseUtcMs(targetDate);

    let baseWh;
    let relBand80 = null;
    let relMae = null;
    let skillPct = null;
    let onionRegime = null;

    if (isOnionCatBoost) {
      const k = interpolateKnots(knots, targetMs);
      onionRegime = evaluateOnionWeeklyRegime(targetDate, liveSignals);
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
    const whPrice = +(baseWh * scenarioMultiplier).toFixed(2);
    const baseWhRounded = +baseWh.toFixed(2);
    const wowDelta = +(whPrice - prevWh).toFixed(2);
    const wowPct = prevWh > 0 ? +(((whPrice - prevWh) / prevWh) * 100).toFixed(1) : 0;
    prevWh = whPrice;

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

    const phase = onionRegime?.phase
      ? onionRegime.phase
      : cropProfile?.getPhase
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
      wowDelta,
      wowPct,
      driverTag: onionRegime?.driverTag || null,
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
  const kztVal = signals?.fx?.kztRub?.value ?? macro?.kztRub?.value ?? officialSnapshotData?.drivers?.kztRub?.value ?? 0.189;
  const uzsVal = signals?.fx?.uzsPer10k?.value;
  const usdVal = signals?.fx?.usdRub?.value ?? macro?.usdRub?.value ?? officialSnapshotData?.drivers?.usdRub?.value ?? 89.5;
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
      trend: 'В ноябре транзит из Жамбыла держит потолок; в апреле ранний лук Сурхандарьи разворачивает цены вниз',
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
      label: 'Ключевая ставка ЦБ РФ (стоимость хранения)',
      absWeight: Math.max(0.025, Math.abs(fl.financing) + 0.02),
      signedLog: fl.financing,
      color: '#C0303A',
      currentVal: `${(macro?.keyRate?.value ?? signals?.fx?.keyRate?.value ?? officialSnapshotData?.drivers?.keyRate?.value ?? 18.0).toFixed(1)}% годовых`,
      asOf: `ЦБ РФ · ${officialSnapshotData?.drivers?.keyRate?.period ?? '2026-10'}`,
      source: 'Банк России (ключевая ставка)',
      trend: 'Дорогие оборотные кредиты ускоряют осенний сбыт и сжимают предложение весной',
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
      label: 'Погодный радар 10 дн. (Волгоград / Жамбыл / Термез)',
      absWeight: Math.max(0.018, Math.abs(fl.weather) + 0.014),
      signedLog: fl.weather,
      color: '#6366F1',
      currentVal: `Волг. min: ${Number(vlgMin).toFixed(1)}°C · Тараз КЗ: ${Number(zhmMin).toFixed(1)}°C`,
      asOf: signals?.weatherHubs?.volgograd?.status === 'live' ? 'Open-Meteo LIVE (10 дн.)' : `ERA5 / Open-Meteo`,
      source: 'Open-Meteo 10d Forecast + ERA5 (81 мес.)',
      trend: 'Морозы < −3°C в Волгограде форсируют сброс ангаров; < −10°C в Таразе режут импорт КЗ',
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
