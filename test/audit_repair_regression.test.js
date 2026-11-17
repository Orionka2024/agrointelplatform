import test from 'node:test';
import assert from 'node:assert/strict';

import { computeMarketModel } from '../shared/marketModel.js';
import { computeReconciledStorageBreakEven } from '../shared/storageEconomics.js';
import {
  computeCentralAsianParity,
  calculateCriticalFxTrigger,
  evaluateSpringArrivalWindow,
} from '../shared/centralAsiaCorridor.js';
import {
  computeCurrentMarketIndex,
  computeSupplyPressureIndex,
  computeQualityAdjustedDeficit,
} from '../shared/marketIndex.js';
import {
  evaluateThreeFarmerQuestions,
  optimizeQualityAllocation,
} from '../shared/qualityTierSalesStrategy.js';
import {
  calculateProfitPerHectare,
  evaluatePrePlantingScenarios,
  calculateCropDiversification,
} from '../shared/prePlantingEconomics.js';
import { runConsistencyAudit } from '../shared/consistencyAudit.js';

test('Phase 3A: Kazakhstan import parity reconciles 55 KZT * 0.1888 + 6.20 + 0.67 (~17.25 pure landed vs 18.25 with 1.00 margin)', () => {
  const res = computeCentralAsianParity({
    purchasePriceForeignCurrency: 55,
    currency: 'KZT',
    fxRateToRub: 0.1888,
    freightRubKg: 6.20,
    customsPhytoRubKg: 0.35,
    transitLossPct: 3.0,
    importerMarginRubKg: 1.0,
    localVolgogradExwRubKg: 21.0,
  });

  assert.equal(res.basePurchaseRubKg, 10.38);
  assert.ok(Math.abs(res.pureLandedCostRubKg - 17.25) <= 0.05);
  assert.ok(Math.abs(res.deliveredPriceRubKg - 18.25) <= 0.05);
  assert.equal(res.deliveredPriceRubKg, +(res.pureLandedCostRubKg + res.importerMarginRubKg).toFixed(2));
  assert.ok(Math.abs(res.importAdvantageRubKg - (21.0 - res.pureLandedCostRubKg)) <= 0.02);
});

test('Phase 3B: Regional EXW netbacks equal DAP minus freight minus transit loss minus other deductions', () => {
  const idx = computeCurrentMarketIndex({ referenceOfficialPrice: 18.0, today: '2026-11-17' });
  for (const d of Object.values(idx.destinations)) {
    const expected = +(d.dapPriceRubKg - d.totalDeductionsRubKg).toFixed(2);
    assert.equal(d.exwNetbackRubKg, expected);
    assert.equal(d.totalDeductionsRubKg, +(d.freightRubKg + d.transitLossRubKg + d.otherDeductionsRubKg).toFixed(2));
  }
});

test('Phase 3C & 3I: Sales tranche gross/saleable/sold revenues reconcile and shares sum to 100%', () => {
  const alloc = optimizeQualityAllocation({
    totalTonnage: 1500,
    shares: { riskyPct: 20, standardPct: 40, premiumPct: 40 },
    currentPriceRubKg: 21.0,
    midSeasonPriceRubKg: 23.48,
    springForecastPriceRubKg: 26.5,
  });

  assert.equal(alloc.allocationSumPct, 100);
  assert.equal(alloc.allocationValid, true);
  assert.equal(alloc.totalAllocatedTons, 1500);
  assert.equal(alloc.totalGrossRevenueIfNoLossRub, 36288000); // 6.30M + 14.088M + 15.90M

  for (const t of alloc.tranches) {
    assert.equal(t.expectedRevenueRub, Math.round(t.soldTons * 1000 * t.expectedPriceRubKg));
    assert.equal(t.netProceedsRub, t.expectedRevenueRub - t.storageCostRub);
    assert.ok(t.saleableTons <= t.grossTons);
  }
});

test('Phase 3D & 3E: Hectare profitability separates marketable (32.69 t/ha) vs gross (38.46 t/ha) break-even yield and scenarios compute full farm P&L', () => {
  const hec = calculateProfitPerHectare({
    grossYieldTHa: 55,
    marketableSharePct: 85,
    categoryShares: { earlyHarvestPct: 15, standardPct: 45, premiumKeepingPct: 40 },
    categoryPricesRubKg: { earlyHarvestPrice: 15.0, standardPrice: 19.0, premiumKeepingPrice: 25.0 },
  });
  assert.equal(hec.marketableYieldTHa, 46.75);
  assert.equal(hec.weightedPriceRubKg, 20.8);
  assert.equal(hec.expectedRevenueRubHa, 972400);
  assert.equal(hec.expectedProfitRubHa, 292400);
  assert.equal(hec.breakEvenMarketableYieldTHa, 32.69);
  assert.equal(hec.breakEvenGrossYieldTHa, 38.46);
  assert.ok(Number.isFinite(hec.returnOnSalesPct) && Number.isFinite(hec.returnOnCostsPct));

  const scenarios = evaluatePrePlantingScenarios({
    farmProfile: { totalArableLandHa: 78, storageCapacityTons: 1500 },
  });
  assert.equal(scenarios.length, 3);
  for (const s of scenarios) {
    assert.ok(s.plantedAreaHa <= 78);
    assert.equal(s.totalCostRubHa, s.productionCostRubHa + s.storageCostRubHa + s.financingCostRubHa);
    assert.equal(s.totalFarmProfitRub, Math.round(s.expectedProfitPerHa * s.plantedAreaHa));
  }
});

test('Phase 3F & 3G: Centralized storage break-even reconciles components cleanly and 90-day calculator uses live mass balance', () => {
  const be = computeReconciledStorageBreakEven({
    currentPriceRubKg: 21.0,
    months: 1,
    shrinkPct: 2.5,
    rotPct: 1.0,
    electricityRubKgMonth: 0.26,
    laborRubKgMonth: 0.12,
    financingRateAnnualPct: 18.86,
  });
  assert.equal(be.reconciliationDiffRubKg, 0);
  assert.ok(be.breakEvenPriceRubKg > 21.0);

  const qRisky = evaluateThreeFarmerQuestions({
    lotTierId: 'risky',
    priceNowRubKg: 21.0,
    financingRateAnnualPct: 18.0,
    futurePriceRubKg: 21.0,
    holdingDays: 90,
  });
  assert.equal(qRisky.verdict, 'SELL_NOW_AVOID_ROT');
  assert.ok(qRisky.costBreakdown.financingCost > 0);
  assert.ok(qRisky.costBreakdown.physicalMassLossPct > 0);
});

test('Phase 3H: Quality-specific loss curves differentiate risky vs premium and maintain physical = marketable + discard', () => {
  const riskyCurve = computeQualityAdjustedDeficit({ totalHarvestTons: 1500, initialQualityGradeShare: 0.85 }, { qualityCategory: 'risky' });
  const premCurve = computeQualityAdjustedDeficit({ totalHarvestTons: 1500, initialQualityGradeShare: 0.85 }, { qualityCategory: 'premium_keeping' });

  assert.ok(riskyCurve[2].physicalLossPct > premCurve[2].physicalLossPct);
  for (const row of [...riskyCurve, ...premCurve]) {
    assert.ok(Math.abs((row.marketableTons + row.substandardDiscardTons) - row.physicalRemainingTons) <= 0.1);
  }
});

test('Phase 4: Dynamic spring cutoff resolves 2027-03-20 from 2026-11-17 and blocks past dates from ACTIVE status', () => {
  const win = evaluateSpringArrivalWindow({ today: '2026-11-17' });
  assert.equal(win.recommendedMaxHoldingDate, '2027-03-20');
  assert.equal(win.daysUntilSpringWave, 123);
  assert.equal(win.isPastDate, false);
  assert.equal(win.status, 'ACTIVE');

  const pastWin = evaluateSpringArrivalWindow({ today: '2026-11-17', explicitCutoffDate: '2026-03-20' });
  assert.equal(pastWin.isPastDate, true);
  assert.equal(pastWin.safeStorageWindowActive, false);
  assert.equal(pastWin.status, 'EXPIRED_PAST_DATE');
});

test('Phase 5 & Phase 7: Land reconciles to 78 ha, I_sp does not assert critical on 0 offers, and active FX trigger is detected', () => {
  const ispZero = computeSupplyPressureIndex({ activeOffersCount: 0, availableTonnage: 1500, salesVelocityTonsPerWeek: 125 });
  assert.equal(ispZero.pressureLevel, 'unverified');
  assert.equal(ispZero.earlyWarningSignal, false);
  assert.equal(ispZero.confidence, 'low');

  const fx = calculateCriticalFxTrigger({
    purchaseKztKg: 55,
    targetLocalExwRubKg: 21.0,
    currentKztRubRate: 0.1888,
  });
  assert.equal(fx.triggerAlreadyActive, true);
  assert.equal(fx.status, 'TRIGGER_ACTIVE');

  const div = calculateCropDiversification({
    totalArableLandHa: 78,
    crops: { onion: { targetAreaHa: 24, expectedProfitPerHa: 292000, riskIndex: 0.65 }, fallow: { targetAreaHa: 54, expectedProfitPerHa: 0, riskIndex: 0.05 } },
  });
  assert.equal(div.landOverallocated, false);
  assert.equal(div.totalAllocatedHa, 78);
});

test('Phase 10: Model Consistency Audit passes on default model and blocks CRITICAL inconsistencies', () => {
  const model = computeMarketModel({ observations: [], today: '2026-11-17' });
  assert.equal(model.consistencyAudit.totalChecks, 18);
  assert.equal(model.consistencyAudit.criticalCount, 0);
  assert.equal(model.consistencyAudit.recommendationsBlocked, false);
  assert.ok(model.qualityTierSalesStrategy.threeFarmerQuestions.liveCbrKeyRatePct > 0);

  // Inject a critical error (over-allocated land)
  const broken = structuredClone(model);
  broken.prePlantingEconomics.cropDiversification.totalAllocatedHa = 120;
  const brokenAudit = runConsistencyAudit(broken);
  assert.ok(brokenAudit.criticalCount > 0);
  assert.equal(brokenAudit.recommendationsBlocked, true);
});
