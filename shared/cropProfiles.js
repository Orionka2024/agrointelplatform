/**
 * Comprehensive profiles and reliable agronomic norms for all tracked vegetables.
 *
 * Categorises crops into:
 *   - 'storage': vegetables suitable for long-term winter storage ("борщевой набор" + чеснок).
 *   - 'field_seasonal': summer/autumn field crops that finish their season in autumn (арбуз, дыня).
 *
 * Provides empirically-grounded seasonal price multipliers, storage defaults,
 * detailed agronomic phases, and 2027 planning roadmaps.
 */

export const CROP_TYPES = {
  STORAGE: 'storage',
  FIELD_SEASONAL: 'field_seasonal',
};

export const CROP_PROFILES = {
  onion: {
    id: 'onion',
    type: CROP_TYPES.STORAGE,
    label: 'Лук',
    fullName: 'Лук репчатый',
    emoji: '🧅',
    ticker: 'ЛУК',
    cyclePhase: 'Сезонная закладка',
    cycleRec: 'Оценка окупаемости хранения',
    pCls: 'warn',
    benchmarkWarehousePrice: 16.6,
    benchmarkMoscowPrice: 31.2,
    yield: 55,
    costPerHa: 780,
    profitPerHa: 936000,
    balance: { D: 2.2, P: 1.65, I: 0.35, S: 0.25, vol: 280 },
    // 26 weekly multipliers from late October base (W+1..W+26)
    seasonalMultipliers: [
      1.00, 1.01, 1.02, 1.04, 1.10, 1.19, 1.29, 1.40,
      1.41, 1.36, 1.34, 1.39, 1.46, 1.56, 1.67, 1.78,
      1.86, 1.94, 2.00, 2.06, 2.10, 2.11, 1.96, 1.75,
      1.54, 1.37
    ],
    storageParams: {
      months: 4,
      shrinkPct: 6.0,
      rotPct: 4.0,
      downgradeSharePct: 10.0,
      downgradeDiscountPct: 15.0,
      energyRubKgMonth: 0.35,
      handlingRubKg: 0.5,
      sortingRubKgSold: 0.6,
      financingRatePctYear: 20.0,
      sellNowCostRubKg: 0.2,
      acquisitionCostRubKg: 12.0,
      optimalTemp: '0..+1°C',
      optimalHumidity: '65–75%',
    },
    getPhase: (weekIdx) => {
      if (weekIdx <= 3) return { tag: 'Ноябрь · Необорудованные склады', desc: 'Сброс партий лука из временных ангаров до заморозков' };
      if (weekIdx <= 6) return { tag: 'Декабрь · Склады с отоплением', desc: 'Переход на постоянные хранилища, рост зимнего спроса' };
      if (weekIdx <= 8) return { tag: 'Предновогодний пик', desc: 'Ажиотажная контрактация розничными сетями' };
      if (weekIdx <= 12) return { tag: 'Январское затишье', desc: 'Постновогодний спад розничной закупки' };
      if (weekIdx <= 16) return { tag: 'Февраль · Морозы и логистика', desc: 'Холода (-20°C..-30°C), дефицит рефрижераторов' };
      if (weekIdx <= 21) return { tag: 'Весенний дефицит', desc: 'Истощение отечественных кондиционных фондов' };
      return { tag: 'Апрель · Ранний юг', desc: 'Поступление раннего лука из Центральной Азии и Египта' };
    },
    seasonalNotes: [
      { label: 'Волгоградская обл.', note: 'Основная уборка на капельном поливе завершена в сентябре–октябре. Старт плановых отгрузок кондиционного фонда.' },
      { label: 'Казахстан (Жамбылская обл.)', note: 'Массовый транзитный экспорт в РФ стабилизирует предложение в ноябре.' },
      { label: 'Узбекистан / Египет', note: 'Поступление раннего урожая в апреле–мае формирует слом цен старого фонда.' },
    ],
  },

  potato: {
    id: 'potato',
    type: CROP_TYPES.STORAGE,
    label: 'Картофель',
    fullName: 'Картофель продовольственный',
    emoji: '🥔',
    ticker: 'КАР',
    cyclePhase: 'Баланс',
    cycleRec: 'Плановая контрактация',
    pCls: 'info',
    benchmarkWarehousePrice: 12.0,
    benchmarkMoscowPrice: 21.4,
    yield: 30,
    costPerHa: 580,
    profitPerHa: 450000,
    balance: { D: 8.0, P: 7.4, I: 0.9, S: 1.3, vol: 720 },
    // Potato has much smoother growth (+45-55% peak), tempered in spring by early import
    seasonalMultipliers: [
      1.00, 1.01, 1.03, 1.05, 1.08, 1.11, 1.14, 1.17,
      1.18, 1.19, 1.21, 1.23, 1.27, 1.31, 1.36, 1.41,
      1.46, 1.50, 1.54, 1.56, 1.57, 1.55, 1.52, 1.48,
      1.44, 1.40
    ],
    storageParams: {
      months: 4,
      shrinkPct: 4.0,
      rotPct: 3.5,
      downgradeSharePct: 8.0,
      downgradeDiscountPct: 15.0,
      energyRubKgMonth: 0.28,
      handlingRubKg: 0.4,
      sortingRubKgSold: 0.5,
      financingRatePctYear: 20.0,
      sellNowCostRubKg: 0.2,
      acquisitionCostRubKg: 9.0,
      optimalTemp: '+2..+4°C',
      optimalHumidity: '90–95%',
    },
    getPhase: (weekIdx) => {
      if (weekIdx <= 3) return { tag: 'Ноябрь · Завершение лечебного периода', desc: 'Сушка и стабилизация кожуры, калибровка клубней' };
      if (weekIdx <= 6) return { tag: 'Декабрь · Плановые поставки в сети', desc: 'Поставка мытого и фасованного картофеля в ритейл' };
      if (weekIdx <= 8) return { tag: 'Предновогодний объем', desc: 'Повышенный спрос крупного и среднего опта' };
      if (weekIdx <= 12) return { tag: 'Январь · Стабильное хранение', desc: 'Равномерный отпуск из хранилищ с активной вентиляцией' };
      if (weekIdx <= 16) return { tag: 'Февраль · Контроль прорастания', desc: 'Снижение температуры до +2°C для блокировки глазков' };
      if (weekIdx <= 21) return { tag: 'Март · Весенний спрос', desc: 'Вымывание несохранных партий, рост цены качественного клубня' };
      return { tag: 'Апрель · Импортный потолок', desc: 'Поступление раннего молодого картофеля из Египта и Азербайджана' };
    },
    seasonalNotes: [
      { label: 'Баланс рынка', note: 'Валовый сбор картофеля в товарном секторе стабилен (7.4 млн т). Риск глубокого дефицита низок.' },
      { label: 'Весенний фактор', note: 'С марта на рынок заходит ранний импорт (Египет, Пакистан), ограничивающий рост цен на прошлогодний урожай.' },
    ],
  },

  carrot: {
    id: 'carrot',
    type: CROP_TYPES.STORAGE,
    label: 'Морковь',
    fullName: 'Морковь столовая',
    emoji: '🥕',
    ticker: 'МОР',
    cyclePhase: 'Закладка фондов',
    cycleRec: 'Контроль лежкости и влаги',
    pCls: 'info',
    benchmarkWarehousePrice: 13.5,
    benchmarkMoscowPrice: 24.8,
    yield: 45,
    costPerHa: 630,
    profitPerHa: 740000,
    balance: { D: 1.8, P: 1.58, I: 0.28, S: 0.18, vol: 230 },
    // High storage premium (+100-115% peak) due to high shrink and washing requirements
    seasonalMultipliers: [
      1.00, 1.02, 1.04, 1.07, 1.14, 1.21, 1.28, 1.35,
      1.36, 1.38, 1.42, 1.48, 1.57, 1.68, 1.80, 1.92,
      2.01, 2.08, 2.12, 2.15, 2.14, 2.10, 2.02, 1.90,
      1.78, 1.65
    ],
    storageParams: {
      months: 4,
      shrinkPct: 7.0,
      rotPct: 5.5,
      downgradeSharePct: 12.0,
      downgradeDiscountPct: 20.0,
      energyRubKgMonth: 0.40,
      handlingRubKg: 0.5,
      sortingRubKgSold: 0.8,
      financingRatePctYear: 20.0,
      sellNowCostRubKg: 0.25,
      acquisitionCostRubKg: 10.0,
      optimalTemp: '0..+1°C',
      optimalHumidity: '95–98%',
    },
    getPhase: (weekIdx) => {
      if (weekIdx <= 3) return { tag: 'Ноябрь · Закладка в холодильники', desc: 'Критичен контроль тургора: влажность не ниже 95%' };
      if (weekIdx <= 6) return { tag: 'Декабрь · Спрос на мытую морковь', desc: 'Высокая маржа фасованной и полированной продукции' };
      if (weekIdx <= 8) return { tag: 'Предновогодний пик сетей', desc: 'Максимум отгрузок в федеральный ритейл' };
      if (weekIdx <= 12) return { tag: 'Январь · Охлажденный фонд', desc: 'Реализация из камер с автоматическим контролем влажности' };
      if (weekIdx <= 16) return { tag: 'Февраль · Вымывание некондиции', desc: 'Утилизация партий с белой гнилью и черной пятнистостью' };
      if (weekIdx <= 21) return { tag: 'Март · Премиальный дефицит', desc: 'Острый дефицит качественной сладкой мытой моркови' };
      return { tag: 'Апрель · Окончание запасов', desc: 'Реализация остатков фондов до прихода раннего импорта' };
    },
    seasonalNotes: [
      { label: 'Технология хранения', note: 'Морковь наиболее чувствительна к потере влаги. Хранилища без активного увлажнения теряют до 15% массы за зиму.' },
      { label: 'Премия за мойку', note: 'Разница между грязной и мытой полированной морковью к марту достигает 12–16 ₽/кг.' },
    ],
  },

  beet: {
    id: 'beet',
    type: CROP_TYPES.STORAGE,
    label: 'Свекла',
    fullName: 'Свекла столовая',
    emoji: '🟣',
    ticker: 'СВЕ',
    cyclePhase: 'Баланс',
    cycleRec: 'Стандартная закладка',
    pCls: 'info',
    benchmarkWarehousePrice: 10.5,
    benchmarkMoscowPrice: 19.5,
    yield: 42,
    costPerHa: 430,
    profitPerHa: 510000,
    balance: { D: 1.0, P: 0.88, I: 0.19, S: 0.1, vol: 140 },
    // Steady growth (+65-75% peak)
    seasonalMultipliers: [
      1.00, 1.01, 1.02, 1.04, 1.08, 1.13, 1.18, 1.23,
      1.25, 1.27, 1.30, 1.34, 1.40, 1.47, 1.54, 1.60,
      1.66, 1.70, 1.73, 1.74, 1.72, 1.68, 1.62, 1.55,
      1.48, 1.40
    ],
    storageParams: {
      months: 4,
      shrinkPct: 5.0,
      rotPct: 4.0,
      downgradeSharePct: 7.0,
      downgradeDiscountPct: 15.0,
      energyRubKgMonth: 0.30,
      handlingRubKg: 0.4,
      sortingRubKgSold: 0.5,
      financingRatePctYear: 20.0,
      sellNowCostRubKg: 0.2,
      acquisitionCostRubKg: 7.5,
      optimalTemp: '+1..+2°C',
      optimalHumidity: '90–95%',
    },
    getPhase: (weekIdx) => {
      if (weekIdx <= 3) return { tag: 'Ноябрь · Закладка в кагаты и боксы', desc: 'Отбор корнеплодов без механических повреждений' };
      if (weekIdx <= 6) return { tag: 'Декабрь · Поставки переработчикам', desc: 'Контракты с заводами полуфабрикатов и сетями' };
      if (weekIdx <= 8) return { tag: 'Предновогодний спрос', desc: 'Традиционный рост спроса на борщевой набор' };
      if (weekIdx <= 12) return { tag: 'Январь · Ровный сбыт', desc: 'Низкая волатильность цен, стабильные отгрузки' };
      if (weekIdx <= 16) return { tag: 'Февраль · Контроль фомоза', desc: 'Мониторинг сохранности в типовых вентилируемых складах' };
      if (weekIdx <= 21) return { tag: 'Март · Плановый пик', desc: 'Сокращение объемов мелких фермерских хозяйств' };
      return { tag: 'Апрель · Финал сезона', desc: 'Завершение реализации долгосрочных партий' };
    },
    seasonalNotes: [
      { label: 'Лежкость', note: 'Свекла обладает максимальной естественной сохранностью среди корнеплодов борщевого набора.' },
    ],
  },

  cabbage: {
    id: 'cabbage',
    type: CROP_TYPES.STORAGE,
    label: 'Капуста',
    fullName: 'Капуста белокочанная',
    emoji: '🥬',
    ticker: 'КАП',
    cyclePhase: 'Избыток сбора',
    cycleRec: 'Оперативный сбыт',
    pCls: 'dn',
    benchmarkWarehousePrice: 6.8,
    benchmarkMoscowPrice: 13.8,
    yield: 35,
    costPerHa: 380,
    profitPerHa: 220000,
    balance: { D: 2.5, P: 2.75, I: 0.22, S: 0.35, vol: 195 },
    // Sluggish growth in early winter due to harvest surplus; rises later only for cold-stored late hybrids
    seasonalMultipliers: [
      1.00, 1.00, 1.01, 1.02, 1.04, 1.07, 1.11, 1.16,
      1.15, 1.16, 1.18, 1.22, 1.30, 1.40, 1.52, 1.64,
      1.74, 1.81, 1.85, 1.86, 1.84, 1.78, 1.68, 1.55,
      1.42, 1.30
    ],
    storageParams: {
      months: 3,
      shrinkPct: 8.0,
      rotPct: 8.0,
      downgradeSharePct: 15.0,
      downgradeDiscountPct: 25.0,
      energyRubKgMonth: 0.45,
      handlingRubKg: 0.6,
      sortingRubKgSold: 0.7,
      financingRatePctYear: 20.0,
      sellNowCostRubKg: 0.2,
      acquisitionCostRubKg: 5.5,
      optimalTemp: '-0.5..0°C',
      optimalHumidity: '90–95%',
    },
    getPhase: (weekIdx) => {
      if (weekIdx <= 3) return { tag: 'Ноябрь · Избыток и сброс с полей', desc: 'Массовая ликвидация несохранных партий давит на опт' };
      if (weekIdx <= 6) return { tag: 'Декабрь · Зачистка кочанов', desc: 'Усыхание верхних листьев, сброс партий из ангаров без холода' };
      if (weekIdx <= 8) return { tag: 'Предновогодний выкуп', desc: 'Краткосрочное оживление цен розничного спроса' };
      if (weekIdx <= 12) return { tag: 'Январь · Риск серой гнили', desc: 'Потери от Botrytis cinerea в складах без холодильного контура' };
      if (weekIdx <= 16) return { tag: 'Февраль · Переход на холодильники', desc: 'На рынке остаются только профессиональные поздние гибриды' };
      if (weekIdx <= 21) return { tag: 'Март · Восстановление цены', desc: 'Рост котировок на чистый кочан высшего сорта' };
      return { tag: 'Апрель · Ранняя капуста юга', desc: 'Приход ранней капусты открытого грунта Дагестана и Узбекистана' };
    },
    seasonalNotes: [
      { label: 'Избыток сбора (фаза цикла)', note: 'Перепроизводство в текущем сезоне держит стартовые цены на рекордно низком уровне (6–7 ₽/кг). Хранение в необорудованных ангарах генерирует прямые убытки.' },
      { label: 'Агрорекомендация', note: 'Сбывать стандартные партии оперативно. Закладывать на март–апрель только специализированные лежкие гибриды с плотным восковым налетом.' },
    ],
  },

  garlic: {
    id: 'garlic',
    type: CROP_TYPES.STORAGE,
    label: 'Чеснок',
    fullName: 'Чеснок озимый / яровой',
    emoji: '🧄',
    ticker: 'ЧЕС',
    cyclePhase: 'Дефицит предложения',
    cycleRec: 'Озимый сев / расширение',
    pCls: 'dn',
    benchmarkWarehousePrice: 98.0,
    benchmarkMoscowPrice: 158.0,
    yield: 10,
    costPerHa: 540,
    profitPerHa: 1680000,
    balance: { D: 0.52, P: 0.21, I: 0.28, S: 0.09, vol: 190 },
    // High deficit and import parity driven (+100-110% peak)
    seasonalMultipliers: [
      1.00, 1.02, 1.05, 1.08, 1.15, 1.22, 1.30, 1.38,
      1.40, 1.44, 1.50, 1.58, 1.68, 1.78, 1.88, 1.96,
      2.02, 2.06, 2.09, 2.10, 2.08, 2.02, 1.92, 1.80,
      1.70, 1.60
    ],
    storageParams: {
      months: 4,
      shrinkPct: 8.0,
      rotPct: 5.0,
      downgradeSharePct: 10.0,
      downgradeDiscountPct: 15.0,
      energyRubKgMonth: 0.50,
      handlingRubKg: 0.8,
      sortingRubKgSold: 1.0,
      financingRatePctYear: 20.0,
      sellNowCostRubKg: 1.0,
      acquisitionCostRubKg: 65.0,
      optimalTemp: '-2..-3°C',
      optimalHumidity: '65–70%',
    },
    getPhase: (weekIdx) => {
      if (weekIdx <= 3) return { tag: 'Ноябрь · Озимый сев', desc: 'Закладка урожая 2027 г. и калибровка посадочного зубка' };
      if (weekIdx <= 6) return { tag: 'Декабрь · Холодильное сдерживание', desc: 'Охлаждение до -2°C для предотвращения выхода из покоя' };
      if (weekIdx <= 8) return { tag: 'Предновогодний дефицит', desc: 'Высокий спрос HoReCa и мясоперерабатывающей отрасли' };
      if (weekIdx <= 12) return { tag: 'Январь · Импортный паритет', desc: 'Цены диктуются стоимостью поставок из Китая и курсом USD' };
      if (weekIdx <= 16) return { tag: 'Февраль · Дефицит крупного зубка', desc: 'Отечественный чеснок калибра 50+ практически раскуплен' };
      if (weekIdx <= 21) return { tag: 'Март · Годовой максимум', desc: 'Пиковые оптовые котировки отечественного фонда' };
      return { tag: 'Апрель · Переход на яровой/импорт', desc: 'Спад запасов до минимума' };
    },
    seasonalNotes: [
      { label: 'Дефицит предложения (фаза цикла)', note: 'РФ обеспечивает себя чесноком менее чем на 35%. Импортозамещение гарантирует высокую маржинальность гектара (1.5–1.9 млн ₽).' },
      { label: 'Озимый сев', note: 'Оптимальное агроокно для посадки озимого чеснока — конец октября / первая половина ноября при температуре почвы +8..+10°C.' },
    ],
  },

  watermalon: {
    id: 'watermalon',
    type: CROP_TYPES.FIELD_SEASONAL,
    label: 'Арбуз',
    fullName: 'Арбуз столовый (открытый грунт)',
    emoji: '🍉',
    ticker: 'АРБ',
    cyclePhase: 'Завершение сезона',
    cycleRec: 'Планирование площадей 2027',
    pCls: 'up',
    benchmarkWarehousePrice: 14.5,
    benchmarkMoscowPrice: 24.5,
    yield: 40,
    costPerHa: 320,
    profitPerHa: 360000,
    balance: { D: 1.5, P: 1.35, I: 0.1, S: 0.05, vol: 45 },
    offSeasonNotice: {
      status: 'off_season',
      title: 'Межсезонье: Сезон 2026 закрыт',
      description: 'Уборка бахчевых открытого грунта в РФ (Волгоградская, Астраханская обл., Ставрополье) полностью завершена в октябре. Арбуз — скоропортящаяся культура, длительное зимнее хранение в товарных овощехранилищах РФ не осуществляется. В период ноябрь–июнь отгрузок со складов нет. Платформа активирует модуль стратегического планирования сезона 2027 г.',
      nextSeasonStart: 'Июль 2027 (ранний сбор под пленкой / термос)',
    },
    annualCycle: [
      { month: 'Июль', phase: 'Ранний сбор (пленка/термос)', priceWh: 32.0, priceMsk: 45.0, status: 'active' },
      { month: 'Август', phase: 'Массовый сбор (богар/полив)', priceWh: 13.5, priceMsk: 22.0, status: 'active' },
      { month: 'Сентябрь', phase: 'Поздний сбор (суходол)', priceWh: 15.0, priceMsk: 24.5, status: 'active' },
      { month: 'Октябрь', phase: 'Завершение сезона', priceWh: 21.0, priceMsk: 32.0, status: 'active' },
      { month: 'Ноябрь', phase: 'Межсезонье (рынок закрыт)', priceWh: null, priceMsk: null, status: 'off_season' },
      { month: 'Декабрь', phase: 'Межсезонье / Импорт Бразилия/Иран', priceWh: null, priceMsk: null, status: 'off_season' },
      { month: 'Январь–Май', phase: 'Межсезонье / Заказ семян и пленки', priceWh: null, priceMsk: null, status: 'off_season' },
      { month: 'Июнь', phase: 'Ранний импорт Казахстан/Узбекистан', priceWh: null, priceMsk: null, status: 'off_season' },
    ],
    planning2027: {
      targetYield: 40,
      costNormK: 320,
      targetPriceWh: 15.0,
      profitPerHa: 280000,
      roiPct: 88,
      recommendedVarieties: 'Продюсер, Каристан F1, Топ Ган F1, Кримсон Свит',
      keyMilestones: [
        { period: 'Ноябрь – Декабрь 2026', step: 'Анализ рентабельности полей, предварительный заказ семян гибридов F1 со скидкой ранней контрактации.' },
        { period: 'Январь – Февраль 2027', step: 'Контрактация капельной ленты (6–8 милс) и мульчирующей пленки, предоплата NPK удобрений.' },
        { period: 'Март – Апрель 2027', step: 'Подготовка паровых полей, запуск рассадных теплиц для ранних партий («термос»).' },
        { period: 'Май 2027', step: 'Высадка рассады и прямой посев в открытый грунт при прогреве почвы > +15°C.' },
        { period: 'Июль – Август 2027', step: 'Старт уборочной кампании и реализация по пиковым котировкам раннего сезона.' },
      ],
      marketRisks: [
        'Погодный фактор: заморозки в мае или град в июле могут сдвинуть созревание на 2 недели.',
        'Конкуренция: перепроизводство в Астрахани и Казахстане в августе способно обвалить цену до 10–12 ₽/кг с поля.',
      ],
    },
  },

  melon: {
    id: 'melon',
    type: CROP_TYPES.FIELD_SEASONAL,
    label: 'Дыня',
    fullName: 'Дыня (открытый грунт)',
    emoji: '🍈',
    ticker: 'ДЫН',
    cyclePhase: 'Межсезонье',
    cycleRec: 'Стандартный севооборот',
    pCls: 'info',
    benchmarkWarehousePrice: 28.0,
    benchmarkMoscowPrice: 52.0,
    yield: 20,
    costPerHa: 420,
    profitPerHa: 540000,
    balance: { D: 0.8, P: 0.72, I: 0.12, S: 0.04, vol: 65 },
    offSeasonNotice: {
      status: 'off_season',
      title: 'Межсезонье: Сезон 2026 закрыт',
      description: 'Сезон сбора дыни завершен. Дыня не подлежит зимней закладке в овощехранилища. В зимне-весенний период отечественные поставки отсутствуют. Платформа активирует модуль технологического планирования и расчета севооборота на 2027 год.',
      nextSeasonStart: 'Конец июля – Август 2027',
    },
    annualCycle: [
      { month: 'Июль', phase: 'Ранняя дыня (пленка/юг)', priceWh: 55.0, priceMsk: 85.0, status: 'active' },
      { month: 'Август', phase: 'Массовый сбор (Лада, Идиллия)', priceWh: 28.0, priceMsk: 52.0, status: 'active' },
      { month: 'Сентябрь', phase: 'Поздняя дыня (Эфиопка)', priceWh: 35.0, priceMsk: 60.0, status: 'active' },
      { month: 'Октябрь', phase: 'Завершение реализации', priceWh: 45.0, priceMsk: 75.0, status: 'active' },
      { month: 'Ноябрь–Июнь', phase: 'Межсезонье (рынок закрыт)', priceWh: null, priceMsk: null, status: 'off_season' },
    ],
    planning2027: {
      targetYield: 20,
      costNormK: 420,
      targetPriceWh: 32.0,
      profitPerHa: 220000,
      roiPct: 52,
      recommendedVarieties: 'Лада, Идиллия, Эфиопка, Майя F1',
      keyMilestones: [
        { period: 'Ноябрь – Декабрь 2026', step: 'Определение предшественников в севообороте (не сажать после тыквенных 3–4 года).' },
        { period: 'Январь – Февраль 2027', step: 'Закупка семян с защитой от фузариоза и мучнистой росы.' },
        { period: 'Март – Апрель 2027', step: 'Подготовка гребней и монтаж систем капельного полива.' },
        { period: 'Май 2027', step: 'Посев при прогреве почвы до +16°C на глубине 10 см.' },
        { period: 'Август – Сентябрь 2027', step: 'Сбор урожая и реализация в премиальные торговые сети.' },
      ],
      marketRisks: [
        'Фузариозное увядание и ложная мучнистая роса при влажном лете.',
        'Необходимость бережной ручной погрузки и жесткой сортировки по сахаристости (Brix > 11%).',
      ],
    },
  },
};

/**
 * Returns the profile for a given crop ID, defaulting to onion.
 */
export function getCropProfile(cropId) {
  return CROP_PROFILES[cropId] || CROP_PROFILES.onion;
}
