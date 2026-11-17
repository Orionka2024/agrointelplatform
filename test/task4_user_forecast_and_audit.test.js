import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildScenarioCorridor } from '../shared/weeklyDecisionPlan.js';
import { optimizeQualityAllocation } from '../shared/qualityTierSalesStrategy.js';

test('Task 4.1: buildScenarioCorridor computes low/base/high scenario prices and corridor width', () => {
  const sampleWeeks = [
    { h: 4, weekStart: '2026-12-14', shortDate: '14 дек', whPrice: 20.0, lo80: 15.0, hi80: 25.0 },
    { h: 13, weekStart: '2027-02-15', shortDate: '15 фев', whPrice: 24.0, lo80: null, hi80: null },
  ];
  const corridor = buildScenarioCorridor(sampleWeeks);
  assert.equal(corridor.length, 2);

  assert.equal(corridor[0].lowPrice, 15.0);
  assert.equal(corridor[0].basePrice, 20.0);
  assert.equal(corridor[0].highPrice, 25.0);
  assert.equal(corridor[0].corridorWidthRubKg, 10.0);

  assert.ok(corridor[1].lowPrice < corridor[1].basePrice);
  assert.ok(corridor[1].highPrice > corridor[1].basePrice);
  assert.ok(corridor[1].corridorWidthRubKg > 0);
});

test('Task 4.2: optimizeQualityAllocation labels economic effect as a model simulation until verified deals & backtest exist', () => {
  const res = optimizeQualityAllocation({
    totalTonnage: 1500,
    shares: { riskyPct: 20, standardPct: 40, premiumPct: 40 },
    currentPriceRubKg: 15.5,
    springForecastPriceRubKg: 26.5,
  });

  assert.equal(res.isSimulation, true);
  assert.equal(res.financialAdvantageVsNaiveHoldAll.isSimulation, true);
  assert.ok(res.simulationDisclaimerRu.includes('Симуляция'));
  assert.ok(res.financialAdvantageVsNaiveHoldAll.summaryRu.includes('Симуляция'));
});

test('Task 4.3: Forecast.jsx renders scenario corridor and QualityTierStrategyModule3.jsx labels economic effect as simulation', () => {
  const forecastSrc = fs.readFileSync('src/components/Forecast.jsx', 'utf8');
  const mod3Src = fs.readFileSync('src/components/QualityTierStrategyModule3.jsx', 'utf8');

  assert.ok(forecastSrc.includes('data-testid="scenario-corridor"'));
  assert.ok(forecastSrc.includes('Сценарный коридор цен (Низкий / Базовый / Высокий)'));
  assert.ok(mod3Src.includes('Симуляция (расчётный эффект):'));
});
