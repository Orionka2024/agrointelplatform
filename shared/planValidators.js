/**
 * Plan Reconciliation Validation Engine (P1-6, F-12, F-13).
 * Validates financial, physical mass balance, temporal continuity, and agronomic rotation consistency.
 */

/**
 * Validates that sales tranche percentages sum to exactly 100%.
 */
export function validateTrancheShares(tranches = []) {
  if (!Array.isArray(tranches) || tranches.length === 0) {
    return {
      valid: false,
      code: 'TRANCHE_EMPTY',
      totalShare: 0,
      message: 'Список траншей пуст',
    };
  }

  const totalShare = +tranches.reduce((sum, t) => sum + Number(t.sharePct ?? t.share ?? 0), 0).toFixed(2);
  const valid = Math.abs(totalShare - 100) < 0.01;

  return {
    valid,
    code: valid ? 'OK' : 'TRANCHE_SUM_MISMATCH',
    totalShare,
    message: valid
      ? 'Сумма долей траншей корректна (100%)'
      : `Сумма долей траншей должна составлять ровно 100% (фактически: ${totalShare}%)`,
  };
}

/**
 * Validates physical mass balance: gross harvest == sold volume + physical shrinkage/rot + unsold inventory.
 */
export function validateMassBalance({
  harvestedTons = 0,
  soldTons = 0,
  lossTons = 0,
  unsoldTons = 0,
} = {}) {
  const harvested = Number(harvestedTons) || 0;
  const sold = Number(soldTons) || 0;
  const loss = Number(lossTons) || 0;
  const unsold = Number(unsoldTons) || 0;

  const accounted = +(sold + loss + unsold).toFixed(2);
  const discrepancyTons = +(harvested - accounted).toFixed(2);
  const valid = Math.abs(discrepancyTons) < 0.01;

  return {
    valid,
    code: valid ? 'OK' : 'MASS_BALANCE_MISMATCH',
    harvestedTons: harvested,
    accountedTons: accounted,
    discrepancyTons,
    message: valid
      ? 'Баланс физической массы соблюдён'
      : `Баланс массы нарушен: собрано ${harvested} т, но учтено ${accounted} т (продажи ${sold} т + потери ${loss} т + остаток ${unsold} т, расхождение ${discrepancyTons} т)`,
  };
}

/**
 * Validates cash flow timeline continuity and detects duplicate or overlapping calendar periods.
 */
export function validateCashFlowPeriods(periods = []) {
  if (!Array.isArray(periods) || periods.length === 0) {
    return { valid: true, code: 'OK', duplicateMonths: [], message: 'Периоды не заданы' };
  }

  const monthUsage = new Map();
  const duplicateMonths = [];

  for (const p of periods) {
    const months = Array.isArray(p.months)
      ? p.months
      : p.month
        ? [p.month]
        : [];
    for (const m of months) {
      const count = (monthUsage.get(m) || 0) + 1;
      monthUsage.set(m, count);
      if (count === 2) {
        duplicateMonths.push(m);
      }
    }
  }

  const valid = duplicateMonths.length === 0;

  return {
    valid,
    code: valid ? 'OK' : 'PERIOD_DUPLICATION',
    duplicateMonths,
    message: valid
      ? 'Периоды движения денежных средств не перекрываются'
      : `Обнаружено дублирование периодов движения денежных средств: месяцы [${duplicateMonths.join(', ')}] учтены повторно`,
  };
}

/**
 * Validates reconciliation between P&L revenue and Cash Flow sales proceeds.
 */
export function validateRevenueReconciliation({
  pnlRevenueRub = 0,
  cashflowSalesRub = 0,
  pnlVolumeTons = 0,
  cashflowVolumeTons = 0,
} = {}) {
  const pnlRev = Number(pnlRevenueRub) || 0;
  const cfRev = Number(cashflowSalesRub) || 0;
  const pnlVol = Number(pnlVolumeTons) || 0;
  const cfVol = Number(cashflowVolumeTons) || 0;

  const gapRub = +Math.abs(pnlRev - cfRev).toFixed(2);
  const gapTons = +Math.abs(pnlVol - cfVol).toFixed(2);
  const valid = gapRub < 100 && gapTons < 0.01;

  return {
    valid,
    code: valid ? 'OK' : 'REVENUE_GAP',
    gapRub,
    gapTons,
    pnlRevenueRub: pnlRev,
    cashflowSalesRub: cfRev,
    message: valid
      ? 'Выручка P&L и поступления Cash Flow полностью согласованы'
      : `Расхождение между отчётом о прибылях и убытках (P&L) и планом движения денег (Cash Flow): разница ${gapRub.toLocaleString('ru-RU')} ₽ (по объёму: ${gapTons} т)`,
  };
}

/**
 * Validates crop rotation phytopathological sustainability.
 * Yellow onion (Allium cepa) requires a 3–4 year minimum rotation return interval.
 * Share > 25% exceeds safe limits; share > 33% poses severe Fusarium / pink root risk.
 */
export function validateCropRotation({
  totalAreaHa = 0,
  crops = [],
  maxOnionShare = 0.25,
} = {}) {
  const totalArea = Number(totalAreaHa) || 0;
  if (totalArea <= 0 || !Array.isArray(crops) || crops.length === 0) {
    return {
      valid: false,
      code: 'ROTATION_INVALID_INPUT',
      message: 'Площадь севооборота и культуры должны быть заданы',
    };
  }

  let onionHa = 0;
  for (const c of crops) {
    const isAllium = c.isAllium === true || /лук|чеснок/i.test(c.name || '');
    if (isAllium) {
      onionHa += Number(c.ha || 0);
    }
  }

  onionHa = +onionHa.toFixed(2);
  const onionShare = +(onionHa / totalArea).toFixed(4);
  const valid = onionShare <= maxOnionShare;
  const actualReturnYears = onionHa > 0 ? +(totalArea / onionHa).toFixed(2) : 99;

  let severity = 'ok';
  if (!valid) {
    severity = onionShare > 0.33 ? 'critical' : 'warning';
  }

  return {
    valid,
    code: valid ? 'OK' : 'CROP_ROTATION_VIOLATION',
    severity,
    totalAreaHa: totalArea,
    onionHa,
    onionShare,
    maxAllowedShare: maxOnionShare,
    minReturnYears: 4,
    actualReturnYears,
    message: valid
      ? `Севооборот фитосанитарно устойчив: доля лука ${(onionShare * 100).toFixed(1)}% (интервал возврата ${actualReturnYears} года)`
      : `Нарушение фитосанитарного севооборота: доля лука ${(onionShare * 100).toFixed(1)}% (${onionHa} из ${totalArea} га) превышает допустимый порог ${(maxOnionShare * 100).toFixed(0)}%. Интервал возврата составляет всего ${actualReturnYears} года (требуется 3–4 года), что ведёт к экспоненциальному накоплению фузариоза донца (Fusarium oxysporum) и гнилей в хранилище.`,
  };
}

/**
 * Unified strategy validation runner evaluating all 5 core checks.
 */
export function validateFarmStrategyPlan(strategyPlan = {}) {
  const checks = {
    tranches: validateTrancheShares(strategyPlan.tranches),
    massBalance: validateMassBalance(strategyPlan.massBalance),
    periods: validateCashFlowPeriods(strategyPlan.cashFlowPeriods),
    revenue: validateRevenueReconciliation(strategyPlan.revenue),
    rotation: validateCropRotation({
      totalAreaHa: strategyPlan.totalAreaHa,
      crops: strategyPlan.crops,
    }),
  };

  const violations = [];
  const warnings = [];

  for (const [name, result] of Object.entries(checks)) {
    if (!result.valid) {
      const issue = { check: name, code: result.code, message: result.message };
      if (result.severity === 'warning') {
        warnings.push(issue);
      } else {
        violations.push(issue);
      }
    }
  }

  return {
    valid: violations.length === 0,
    hasWarnings: warnings.length > 0,
    violations,
    warnings,
    checks,
  };
}
