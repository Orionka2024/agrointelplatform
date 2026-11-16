/**
 * Reconciled Plan Export Engine (P1-9, F-12).
 * Strictly gates exports behind P1-6 plan reconciliation validation.
 * If any arithmetic, mass balance, period overlap or rotation violation exists,
 * exports are blocked with HTTP 422 and actionable discrepancies.
 */

import { validateFarmStrategyPlan } from './planValidators.js';
import officialHashes from '../data/official-hashes.json' with { type: 'json' };

const REPORT_DISCLAIMER =
  'Настоящий аналитический отчёт сформирован на основе верифицированных рыночных наблюдений платформы Agro Intelligence и математической модели сезонного баланса Weibull. ' +
  'Документ прошёл автоматический аудит сходимости: суммарная доля траншей составляет строго 100.0%, физический баланс массы сходится с учётом технологической усушки/отхода, ' +
  'выручка отчёта о прибылях и убытках (P&L) полностью совпадает с притоками движения денежных средств (Cashflow), а доля лука в севообороте не превышает агрономический порог 25% ' +
  '(интервал возврата на поле ≥ 3–4 года). Отчёт предназначен для обоснования кредитных лимитов и внутреннего производственного планирования.';

/**
 * Builds a validated, reconciled export document (PDF/XLSX structure).
 */
export function buildReconciledPlanExport(plan = {}, { format = 'json' } = {}) {
  const validation = validateFarmStrategyPlan(plan);

  if (!validation.valid) {
    return {
      valid: false,
      statusCode: 422,
      error: 'PLAN_RECONCILIATION_FAILED',
      message: 'Экспорт отклонён: обнаружены арифметические, финансовые или агрономические несоответствия в плане.',
      violations: validation.violations,
      checks: validation.checks,
    };
  }

  const generatedAt = new Date().toISOString();
  const onionCrop = (plan.crops || []).filter((c) => c.isAllium || /лук/i.test(c.name || ''));
  const onionHa = onionCrop.reduce((sum, c) => sum + (c.ha || 0), 0);
  const onionSharePct = plan.totalAreaHa > 0 ? +((onionHa / plan.totalAreaHa) * 100).toFixed(1) : 0;

  // Build structured document payload
  const document = {
    title: 'Стратегический план реализации и севооборота овощных культур',
    geography: 'Волгоградская область',
    generatedAt,
    reconciled: true,
    sourceHashes: officialHashes.files || {},
    farmSummary: {
      totalAreaHa: plan.totalAreaHa || 0,
      onionHa,
      onionSharePct,
      rotationIntervalYears: +(100 / Math.max(1, onionSharePct)).toFixed(1),
      rotationSafe: onionSharePct <= 25,
    },
    crops: (plan.crops || []).map((c) => ({
      name: c.name,
      ha: c.ha,
      sharePct: plan.totalAreaHa > 0 ? +((c.ha / plan.totalAreaHa) * 100).toFixed(1) : 0,
      isAllium: !!(c.isAllium || /лук/i.test(c.name || '')),
    })),
    salesTranches: (plan.tranches || []).map((t) => ({
      name: t.name,
      sharePct: t.sharePct,
      targetMonth: t.targetMonth || null,
      priceRubKg: t.priceRubKg || null,
    })),
    massBalance: {
      harvestedTons: plan.massBalance?.harvestedTons || 0,
      soldTons: plan.massBalance?.soldTons || 0,
      lossTons: plan.massBalance?.lossTons || 0,
      unsoldTons: plan.massBalance?.unsoldTons || 0,
      discrepancyTons: 0,
    },
    revenue: {
      pnlRevenueRub: plan.revenue?.pnlRevenueRub || 0,
      cashflowSalesRub: plan.revenue?.cashflowSalesRub || 0,
      revenueGapRub: 0,
    },
    cashFlowPeriods: plan.cashFlowPeriods || [],
    disclaimer: REPORT_DISCLAIMER,
  };

  // Build CSV/Excel-ready table format
  const csvLines = [
    `"СТРАТЕГИЧЕСКИЙ ПЛАН РЕАЛИЗАЦИИ И СЕВООБОРОТА"`,
    `"Дата формирования:","${generatedAt}"`,
    `"Статус верификации:","ПЛАН ПОЛНОСТЬЮ СХОДИТСЯ (RECONCILED)"`,
    ``,
    `"РАЗДЕЛ 1. СТРУКТУРА СЕВООБОРОТА"`,
    `"Культура","Площадь, га","Доля площади, %","Тип"`,
  ];

  for (const c of document.crops) {
    csvLines.push(`"${c.name}",${c.ha},${c.sharePct}%,"${c.isAllium ? 'Луковые (Allium)' : 'Предшественник'}"`);
  }
  csvLines.push(`"ИТОГО ПЛОЩАДЬ",${document.farmSummary.totalAreaHa},100.0%,"—"`);
  csvLines.push(``);

  csvLines.push(`"РАЗДЕЛ 2. ГРАФИК ПРОДАЖ ПО ТРАНШАМ"`);
  csvLines.push(`"Транш","Доля объёма, %","Период"`);
  for (const t of document.salesTranches) {
    csvLines.push(`"${t.name}",${t.sharePct}%,"${t.targetMonth || '—'}"`);
  }
  csvLines.push(`"ИТОГО ТРАНШИ",100.0%,"—"`);
  csvLines.push(``);

  csvLines.push(`"РАЗДЕЛ 3. ФИЗИЧЕСКИЙ БАЛАНС МАССЫ"`);
  csvLines.push(`"Валовой сбор, т",${document.massBalance.harvestedTons}`);
  csvLines.push(`"Реализация, т",${document.massBalance.soldTons}`);
  csvLines.push(`"Технологическая усушка и отход, т",${document.massBalance.lossTons}`);
  csvLines.push(`"Невязка баланса, т",0`);
  csvLines.push(``);

  csvLines.push(`"РАЗДЕЛ 4. ФИНАНСОВАЯ СХОДИМОСТЬ (P&L vs CASHFLOW)"`);
  csvLines.push(`"Выручка от реализации (P&L), ₽",${document.revenue.pnlRevenueRub}`);
  csvLines.push(`"Приток от продаж (Cashflow), ₽",${document.revenue.cashflowSalesRub}`);
  csvLines.push(`"Расхождение, ₽",0`);
  csvLines.push(``);

  csvLines.push(`"ДИСКЛЕЙМЕР:","${REPORT_DISCLAIMER.replace(/"/g, '""')}"`);

  const csv = csvLines.join('\n');

  return {
    valid: true,
    statusCode: 200,
    format,
    document,
    csv,
  };
}
