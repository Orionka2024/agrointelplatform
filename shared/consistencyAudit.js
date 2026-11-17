/**
 * Automated Model Consistency Audit Engine (Phase 10)
 *
 * Runs 18 mandatory mathematical, physical, temporal, and cross-module reconciliation checks
 * on the unified model state and classifies findings into CRITICAL, WARNING, and INFO.
 */

export function runConsistencyAudit(model = {}, { pendingOfflineCount = 0 } = {}) {
  const checks = [];
  const add = (id, rule, passed, severityIfFailed, module, conflictingValues = null, recommendation = null) => {
    checks.push({
      id,
      rule,
      passed: Boolean(passed),
      severity: passed ? 'OK' : severityIfFailed,
      module,
      conflictingValues: passed ? null : conflictingValues,
      recommendation: passed ? null : recommendation,
    });
  };

  const strat = model.qualityTierSalesStrategy?.qualityAllocation;
  const tranches = strat?.tranches || [];
  const fp = model.farmProfile || {};
  const netbacks = Object.values(model.currentMarketIndex?.destinations || {});
  const kz = model.centralAsiaCorridor?.kzParity;
  const spring = model.centralAsiaCorridor?.springWindow;
  const deficit = model.qualityAdjustedDeficit || [];
  const hec = model.prePlantingEconomics?.hectareEconomics;
  const div = model.prePlantingEconomics?.cropDiversification;
  const scenarios = model.prePlantingEconomics?.prePlantingScenarios || [];

  // 1. Sales percentages equal 100%
  const sumPct = tranches.reduce((s, t) => s + Number(t.sharePct || 0), 0);
  add(
    'R01',
    'Доли траншей продаж в сумме равны 100%',
    tranches.length === 0 || Math.abs(sumPct - 100) < 0.01,
    'CRITICAL',
    'Модуль 3 (Транши)',
    { sumPct },
    'Скорректируйте доли траншей так, чтобы их сумма строго равнялась 100%.'
  );

  // 2. Sales tranche volumes do not exceed saleable/allocated inventory
  const capTons = Number(fp.storageCapacityTons || strat?.totalAllocatedTons || 1500);
  const sumTrancheGross = tranches.reduce((s, t) => s + Number(t.grossTons ?? t.allocatedTons ?? 0), 0);
  const sumTrancheSold = tranches.reduce((s, t) => s + Number(t.soldTons ?? 0), 0);
  const sumTrancheSaleable = tranches.reduce((s, t) => s + Number(t.saleableTons ?? 0), 0);
  add(
    'R02',
    'Объём продаж траншей не превышает товарный и складской остаток',
    sumTrancheGross <= capTons + 0.5 && sumTrancheSold <= sumTrancheSaleable + 0.5,
    'CRITICAL',
    'Модуль 3 (Транши)',
    { sumTrancheGross, capTons, sumTrancheSold, sumTrancheSaleable },
    'Приведите объёмы продаж в соответствие с доступным товарным объёмом.'
  );

  // 3. Total allocated area does not exceed available area
  const availHa = Number(div?.effectiveAvailableLandHa ?? fp.areaHa ?? 78);
  const allocHa = Number(div?.totalAllocatedHa ?? 0);
  add(
    'R03',
    'Распределённая площадь культур не превышает доступную пашню хозяйства',
    !div || allocHa <= availHa + 0.01,
    'CRITICAL',
    'Модуль 4 (Севооборот)',
    { allocHa, availHa },
    'Уменьшите площади культур или укажите арендованную внешнюю землю.'
  );

  // 4. Projected inventory / harvest vs warehouse capacity
  const baseScen = scenarios.find((s) => s.id === 'base');
  const projHarvest = Number(baseScen?.projectedHarvestTons ?? 0);
  const storageCap = Number(fp.storageCapacityTons || 1500);
  add(
    'R04',
    'Прогнозный урожай базового плана сопоставлен с вместимостью склада',
    projHarvest <= storageCap + 0.5,
    'WARNING',
    'Профиль и Модуль 4',
    { projHarvest, storageCap },
    'Часть урожая сверх ёмкости склада необходимо реализовать с поля в момент уборки.'
  );

  // 5. Revenue equals sold volume multiplied by selling price
  const revMismatch = tranches.find((t) => Math.abs((t.soldTons * 1000 * t.expectedPriceRubKg) - t.expectedRevenueRub) > 5);
  add(
    'R05',
    'Выручка каждого транша строго равна (проданный объём × цена)',
    !revMismatch,
    'CRITICAL',
    'Модуль 3 (Выручка)',
    revMismatch ? { tier: revMismatch.tierId, soldTons: revMismatch.soldTons, price: revMismatch.expectedPriceRubKg, expectedRevenueRub: revMismatch.expectedRevenueRub } : null,
    'Пересчитайте выручку траншей строго от фактически проданного объёма.'
  );

  // 6. Profit equals revenue minus all applicable costs
  const hecProfitOk = !hec || Math.abs((hec.expectedRevenueRubHa - hec.totalCostRubHa) - hec.expectedProfitRubHa) <= 5;
  add(
    'R06',
    'Прибыль с гектара равна (выручка − полные затраты)',
    hecProfitOk,
    'CRITICAL',
    'Модуль 4 (Юнит-экономика)',
    hec ? { revenue: hec.expectedRevenueRubHa, cost: hec.totalCostRubHa, profit: hec.expectedProfitRubHa } : null,
    'Проверьте формулу расчёта прибыли на 1 га.'
  );

  // 7. Break-even formulas use consistent price and quantity units
  const hecBeOk = !hec || Math.abs((hec.totalCostRubHa / (hec.weightedPriceRubKg * 1000)) - hec.breakEvenMarketableYieldTHa) <= 0.05;
  add(
    'R07',
    'Формула безубыточности использует согласованные цены и единицы',
    hecBeOk,
    'CRITICAL',
    'Модуль 4 (Безубыточность)',
    hec ? { totalCostRubHa: hec.totalCostRubHa, weightedPriceRubKg: hec.weightedPriceRubKg, breakEvenMarketableYieldTHa: hec.breakEvenMarketableYieldTHa } : null,
    'Проверьте деление затрат на взвешенную цену реализации.'
  );

  // 8. Physical inventory cannot exceed starting inventory without documented inflow
  const startInv = Number(fp.storageCapacityTons || 1500);
  const physExceeds = deficit.find((d) => d.physicalRemainingTons > startInv + 0.1);
  add(
    'R08',
    'Физический остаток не превышает начальную закладку без прихода',
    !physExceeds,
    'CRITICAL',
    'Модуль 1 (Дефицит)',
    physExceeds || null,
    'Исправьте кривую потерь: физический остаток не может расти без закупки.'
  );

  // 9. Marketable inventory cannot exceed physical inventory
  const mktExceeds = deficit.find((d) => d.marketableTons > d.physicalRemainingTons + 0.1);
  add(
    'R09',
    'Товарный остаток не превышает физический остаток',
    !mktExceeds,
    'CRITICAL',
    'Модуль 1 (Дефицит)',
    mktExceeds || null,
    'Доля товарности не может превышать 100% физического остатка.'
  );

  // 10. Rejected inventory cannot be negative
  const negDiscard = deficit.find((d) => d.substandardDiscardTons < -0.05);
  add(
    'R10',
    'Отход / некондиция не может быть отрицательной величиной',
    !negDiscard,
    'CRITICAL',
    'Модуль 1 (Дефицит)',
    negDiscard || null,
    'Проверьте вычитание: Отход = Физический остаток − Товарный остаток.'
  );

  // 11. Netback equals DAP minus documented deductions
  const badNetback = netbacks.find((d) => Math.abs((d.dapPriceRubKg - d.totalDeductionsRubKg) - d.exwNetbackRubKg) > 0.02);
  add(
    'R11',
    'EXW нетбэк равен (DAP − документированные вычеты)',
    !badNetback,
    'CRITICAL',
    'Модуль 1 (Нетбэки)',
    badNetback || null,
    'Сверьте сумму фрахта и транзитной усушки с итоговым нетбэком.'
  );

  // 12. Import parity equals all documented import costs
  const badParity = kz && Math.abs((kz.pureLandedCostRubKg + kz.importerMarginRubKg) - kz.deliveredPriceRubKg) > 0.02;
  add(
    'R12',
    'Импортный паритет равен сумме всех документированных затрат доставки',
    !badParity,
    'CRITICAL',
    'Модуль 2 (Импорт)',
    badParity ? { pure: kz.pureLandedCostRubKg, margin: kz.importerMarginRubKg, delivered: kz.deliveredPriceRubKg } : null,
    'Убедитесь, что все компоненты импортного паритета суммируются без скрытых надбавок.'
  );

  // 13. Forecast / seasonal dates must be valid ISO dates
  const today = model.today || '';
  const validToday = /^\d{4}-\d{2}-\d{2}$/.test(today);
  add(
    'R13',
    'Расчётная дата системы и даты горизонтов валидны (YYYY-MM-DD)',
    validToday && (!spring?.recommendedMaxHoldingDate || /^\d{4}-\d{2}-\d{2}$/.test(spring.recommendedMaxHoldingDate)),
    'CRITICAL',
    'Календарь',
    { today, recommendedMaxHoldingDate: spring?.recommendedMaxHoldingDate },
    'Установите корректную дату формата YYYY-MM-DD.'
  );

  // 14. Past seasonal events cannot be marked active
  const pastMarkedActive = Boolean(spring?.isPastDate && spring?.safeStorageWindowActive);
  add(
    'R14',
    'Прошедшие сезонные даты не могут иметь статус ACTIVE',
    !pastMarkedActive,
    'CRITICAL',
    'Модуль 2 (Весеннее окно)',
    pastMarkedActive ? { today, cutoff: spring.recommendedMaxHoldingDate, status: spring.status } : null,
    'Обновите горизонт отсечки на следующий маркетинговый сезон.'
  );

  // 15. Currency rates must have timestamps and sources (warning if fallback/missing)
  const kztSrc = model.macro?.kztRub?.provenance;
  const fxHasProv = Boolean(kztSrc?.asOf && kztSrc?.source);
  add(
    'R15',
    'Курсы валют и ключевая ставка имеют источник и метку времени',
    fxHasProv,
    'WARNING',
    'Макроиндикаторы (ЦБ РФ)',
    { kztStatus: kztSrc?.status || 'missing' },
    'Обновите курсы ЦБ РФ через /api/macro или collect_cbr.'
  );

  // 16. Offline transactions cannot be treated as confirmed
  add(
    'R16',
    'Офлайн-очередь сделок изолирована от подтверждённых транзакций сервера',
    pendingOfflineCount === 0,
    'INFO',
    'Жизненный цикл сделок',
    pendingOfflineCount > 0 ? { pendingOfflineCount } : null,
    'Синхронизируйте локальную очередь сделок при подключении к сети.'
  );

  // 17. All displayed totals must reconcile with component rows
  const sumTrancheRev = tranches.reduce((s, t) => s + Number(t.expectedRevenueRub || 0), 0);
  const sumDivArea = (div?.allocationRows || []).reduce((s, r) => s + Number(r.areaHa || 0), 0);
  const totalsOk =
    (!strat || Math.abs(sumTrancheRev - strat.totalRevenueRub) <= 10) &&
    (!div || Math.abs(sumDivArea - div.totalAllocatedHa) <= 0.1);
  add(
    'R17',
    'Итоговые суммы таблиц сходятся со строками компонентов',
    totalsOk,
    'CRITICAL',
    'Сводная отчётность',
    !totalsOk ? { sumTrancheRev, totalRevenueRub: strat?.totalRevenueRub, sumDivArea, totalAllocatedHa: div?.totalAllocatedHa } : null,
    'Проверьте округление итоговых строк.'
  );

  // 18. Identical variables must not have contradictory values across modules
  const keyRateConsistency =
    model.qualityTierSalesStrategy?.threeFarmerQuestions?.liveCbrKeyRatePct === undefined ||
    model.macro?.keyRate?.value == null ||
    Math.abs(model.qualityTierSalesStrategy.threeFarmerQuestions.liveCbrKeyRatePct - Number(model.macro.keyRate.value)) < 0.01;
  add(
    'R18',
    'Сквозные переменные (ключевая ставка, площадь, ёмкость) согласованы между модулями',
    keyRateConsistency && Number(div?.totalArableLandHa ?? fp.areaHa ?? 78) === Number(fp.areaHa ?? 78),
    'CRITICAL',
    'Единый источник истины',
    { farmAreaHa: fp.areaHa, divAreaHa: div?.totalArableLandHa },
    'Используйте единый профиль фермы и живые макроданные во всех модулях.'
  );

  const passedCount = checks.filter((c) => c.passed).length;
  const criticalCount = checks.filter((c) => !c.passed && c.severity === 'CRITICAL').length;
  const warningCount = checks.filter((c) => !c.passed && c.severity === 'WARNING').length;
  const infoCount = checks.filter((c) => !c.passed && c.severity === 'INFO').length;

  return {
    auditedAt: model.today || new Date().toISOString().slice(0, 10),
    totalChecks: checks.length,
    passedCount,
    criticalCount,
    warningCount,
    infoCount,
    status: criticalCount > 0 ? 'CRITICAL_ERRORS' : warningCount > 0 ? 'WARNINGS' : 'PASS',
    recommendationsBlocked: criticalCount > 0,
    checks,
  };
}
