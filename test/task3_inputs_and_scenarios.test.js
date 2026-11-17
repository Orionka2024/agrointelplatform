import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  getImportPhaseWeight,
  evaluateImportScenarioSwitches,
  analyzeEarlyImportArrivalsByYear,
  evaluateSpringArrivalWindow,
} from '../shared/centralAsiaCorridor.js';
import { computeMarketModel } from '../shared/marketModel.js';

test('Task 3.1: Live CBR key rate from macro input drives storage financing instead of hardcoded 19%', () => {
  const m14 = computeMarketModel({
    observations: [],
    macro: { keyRate: { value: 14.0, provenance: { status: 'live', asOf: '2026-11-15' } } },
    today: '2026-11-15',
  });
  const m21 = computeMarketModel({
    observations: [],
    macro: { keyRate: { value: 21.0, provenance: { status: 'live', asOf: '2026-11-15' } } },
    today: '2026-11-15',
  });

  assert.equal(m14.qualityTierSalesStrategy.threeFarmerQuestions.liveCbrKeyRatePct, 14.0);
  assert.equal(m21.qualityTierSalesStrategy.threeFarmerQuestions.liveCbrKeyRatePct, 21.0);
  assert.ok(
    m21.qualityTierSalesStrategy.threeFarmerQuestions.premium.costBreakdown.financingCost >
      m14.qualityTierSalesStrategy.threeFarmerQuestions.premium.costBreakdown.financingCost
  );
});

test('Task 3.2: Import parity and geopolitical flags are scenario switches weighted by phase (Nov-Feb ~0, rising from March)', () => {
  assert.equal(getImportPhaseWeight(11), 0.05);
  assert.equal(getImportPhaseWeight(12), 0.05);
  assert.equal(getImportPhaseWeight(1), 0.05);
  assert.equal(getImportPhaseWeight(2), 0.05);
  assert.equal(getImportPhaseWeight(3), 0.45);
  assert.equal(getImportPhaseWeight(4), 1.0);

  const novGlut = evaluateImportScenarioSwitches({ month: 11, parityDiffRubKg: -3.0 });
  const marGlut = evaluateImportScenarioSwitches({ month: 3, parityDiffRubKg: -3.0 });
  const aprGlut = evaluateImportScenarioSwitches({ month: 4, parityDiffRubKg: -3.0 });

  assert.equal(novGlut.isScenarioSwitchOnly, true);
  assert.ok(Math.abs(novGlut.scenarioDeltaRubKg) < 0.2);
  assert.ok(Math.abs(marGlut.scenarioDeltaRubKg) > Math.abs(novGlut.scenarioDeltaRubKg));
  assert.ok(Math.abs(aprGlut.scenarioDeltaRubKg) > Math.abs(marGlut.scenarioDeltaRubKg));

  const banSwitch = evaluateImportScenarioSwitches({ month: 3, caExportBan: true, iranBanStatus: 'restricted', phytoRestrictions: true });
  assert.ok(banSwitch.scenarioDeltaRubKg > 0);
});

test('Task 3.3: 20 March cutoff is configurable and early import arrivals are verified by year in HS 070310', () => {
  const defaultWin = evaluateSpringArrivalWindow({ today: '2026-03-10', plannedSaleDate: '2026-03-25' });
  assert.equal(defaultWin.springArrivalCutoff, '03-20');
  assert.equal(defaultWin.recommendedMaxHoldingDate, '2026-03-20');
  assert.equal(defaultWin.safeStorageWindowActive, false);

  const customWin = evaluateSpringArrivalWindow({
    today: '2026-03-10',
    plannedSaleDate: '2026-03-25',
    springArrivalCutoff: '04-05',
  });
  assert.equal(customWin.springArrivalCutoff, '04-05');
  assert.equal(customWin.recommendedMaxHoldingDate, '2026-04-05');
  assert.equal(customWin.safeStorageWindowActive, true);

  const imp = JSON.parse(fs.readFileSync('data/imports-hs070310.json', 'utf8'));
  const arrivals = analyzeEarlyImportArrivalsByYear(imp.monthly);
  assert.ok(arrivals.length >= 6);
  const eg2025 = arrivals.find((r) => r.year === '2025' && r.partner === 'Египет');
  const uz2025 = arrivals.find((r) => r.year === '2025' && r.partner === 'Узбекистан');
  assert.equal(eg2025.surgeMonth, '2025-03');
  assert.equal(uz2025.surgeMonth, '2025-04');
});
