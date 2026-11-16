import test from 'node:test';
import assert from 'node:assert/strict';

test('Module 2: Flow Redistribution Engine requires chain corroboration and prevents false price spikes from uncorroborated foreign headlines', async () => {
  const corridorMod = await import('../shared/centralAsiaCorridor.js');

  assert.equal(typeof corridorMod.evaluateFlowRedistributionChain, 'function');

  // Case 1: Uncorroborated media headline in Iraq -> must not leak into Volgograd price
  const uncorroboratedHeadline = {
    triggerEvent: 'iraq_import_tender',
    evidence: {
      stage1_iraqTenderAnnounced: true,
      stage2_uzbekExportConfirmed: false, // No contracts signed in Uzbekistan
      stage3_kazakhTransitDiverted: false, // Trains still heading to Russia
      stage4_russianInflowReduced: false,  // Border customs show steady volume
    },
    localVolgogradPriceRubKg: 16.5,
  };

  const res1 = corridorMod.evaluateFlowRedistributionChain(uncorroboratedHeadline);
  assert.equal(res1.status, 'transmission_blocked');
  assert.equal(res1.effectivePriceImpulseRubKg, 0.0, 'Uncorroborated foreign news must have 0.0 price impact');
  assert.ok(res1.warningRu.includes('не подтверждён отгрузками'));
  assert.equal(res1.confirmedStagesCount, 1);

  // Case 2: Corroborated multi-stage flow diversion
  const fullyCorroboratedChain = {
    triggerEvent: 'iraq_import_tender',
    evidence: {
      stage1_iraqTenderAnnounced: true,
      stage2_uzbekExportConfirmed: true,  // Confirmed purchases at 120 USD/t EXW Tashkent
      stage3_kazakhTransitDiverted: true,  // 45 wagons redirected south
      stage4_russianInflowReduced: true,   // Weekly border arrivals down -35%
    },
    localVolgogradPriceRubKg: 16.5,
  };

  const res2 = corridorMod.evaluateFlowRedistributionChain(fullyCorroboratedChain);
  assert.equal(res2.status, 'corroborated_diversion');
  assert.ok(res2.effectivePriceImpulseRubKg > 0.5, 'Corroborated diversion reduces competition, providing positive support');
  assert.equal(res2.confirmedStagesCount, 4);
  assert.ok(res2.recommendationRu.includes('Снижение импортного давления'));
});

test('Module 2: Central Asian Import Parity calculates delivered netbacks and classifies competitiveness regimes', async () => {
  const { computeCentralAsianParity } = await import('../shared/centralAsiaCorridor.js');

  // Scenario A: Kazakhstan import parity with typical seasonal parameters
  const kzParity = computeCentralAsianParity({
    origin: 'KAZAKHSTAN_TARAZ',
    purchasePriceForeignCurrency: 55, // 55 KZT/kg
    currency: 'KZT',
    fxRateToRub: 0.1865, // ~0.1865 RUB per KZT -> ~10.26 RUB base
    freightRubKg: 6.20,  // Taraz to Volgograd ~2200 km
    customsPhytoRubKg: 0.35,
    transitLossPct: 3.0,
    importerMarginRubKg: 1.0,
    localVolgogradExwRubKg: 16.5,
  });

  assert.ok(kzParity.deliveredPriceRubKg > 17.5 && kzParity.deliveredPriceRubKg < 19.5, `Delivered price: ${kzParity.deliveredPriceRubKg}`);
  assert.ok(kzParity.competitivenessGapRubKg > 0, 'Delivered price exceeds local EXW -> domestic advantage');
  assert.equal(kzParity.regime, 'domestic_advantage');
  assert.ok(kzParity.summaryRu.includes('Отечественный лук имеет ценовое преимущество'));

  // Scenario B: Aggressive dump / cheap import from Kazakhstan (field clearance 30 KZT, low freight)
  const kzDumping = computeCentralAsianParity({
    origin: 'KAZAKHSTAN_TARAZ',
    purchasePriceForeignCurrency: 30, // 30 KZT/kg
    currency: 'KZT',
    fxRateToRub: 0.175, // cheap tenge
    freightRubKg: 5.0,
    customsPhytoRubKg: 0.30,
    transitLossPct: 2.0,
    importerMarginRubKg: 0.8,
    localVolgogradExwRubKg: 16.5,
  });

  assert.ok(kzDumping.deliveredPriceRubKg < 13.0, `Dumping delivered price: ${kzDumping.deliveredPriceRubKg}`);
  assert.ok(kzDumping.competitivenessGapRubKg < -2.0);
  assert.equal(kzDumping.regime, 'import_pressure_glut');
  assert.ok(kzDumping.summaryRu.includes('Ценовое давление импорта'));

  // Scenario C: Uzbekistan spring crop delivered to Volgograd
  const uzParity = computeCentralAsianParity({
    origin: 'UZBEKISTAN_TASHKENT',
    purchasePriceForeignCurrency: 110, // 110 USD/t = 0.11 USD/kg
    currency: 'USD',
    fxRateToRub: 98.0, // 98 RUB per USD -> ~10.78 RUB/kg
    freightRubKg: 8.50, // Longer rail/truck corridor
    customsPhytoRubKg: 0.60,
    transitLossPct: 4.5,
    importerMarginRubKg: 1.20,
    localVolgogradExwRubKg: 22.0,
  });

  assert.ok(uzParity.deliveredPriceRubKg >= 21.0 && uzParity.deliveredPriceRubKg <= 24.0);
  assert.ok(uzParity.regime === 'parity_zone' || uzParity.regime === 'domestic_advantage');
});

test('Module 2: FX Sensitivity Trigger identifies break-even exchange rate where imports undercut local warehouse', async () => {
  const { calculateCriticalFxTrigger } = await import('../shared/centralAsiaCorridor.js');

  const trigger = calculateCriticalFxTrigger({
    purchaseKztKg: 55,
    freightRubKg: 6.20,
    customsPhytoRubKg: 0.35,
    transitLossPct: 3.0,
    importerMarginRubKg: 1.0,
    targetLocalExwRubKg: 17.0,
  });

  // Target delivered = 17.0 -> net allowable for base purchase + loss:
  // 17.0 - (6.20 + 0.35 + 1.0) = 9.45 RUB.
  // 9.45 * (1 - 0.03) = 9.1665 RUB.
  // Critical FX = 9.1665 / 55 KZT = ~0.1666 RUB/KZT.
  assert.ok(trigger.criticalKztRubRate >= 0.16 && trigger.criticalKztRubRate <= 0.175);
  assert.ok(
    trigger.interpretationRu.includes('Если тенге укрепится выше') ||
      trigger.interpretationRu.includes('Если курс KZT/RUB опустится ниже') ||
      trigger.interpretationRu.includes('Критический курс')
  );
});

test('Module 2: Spring Arrival Window flags seasonal influx of early Uzbek/Tajik onion ending safe domestic storage', async () => {
  const { evaluateSpringArrivalWindow } = await import('../shared/centralAsiaCorridor.js');

  // Holding in February (safe window before spring arrivals)
  const febCheck = evaluateSpringArrivalWindow({
    today: '2027-02-10',
    plannedSaleDate: '2027-03-05',
    storageType: 'ventilated',
  });

  assert.equal(febCheck.safeStorageWindowActive, true);
  assert.equal(febCheck.importHazardLevel, 'low');
  assert.ok(febCheck.daysUntilSpringWave > 10);

  // Holding into late April (high hazard of early Central Asian arrivals)
  const aprilCheck = evaluateSpringArrivalWindow({
    today: '2027-02-10',
    plannedSaleDate: '2027-04-15',
    storageType: 'ventilated',
  });

  assert.equal(aprilCheck.safeStorageWindowActive, false);
  assert.equal(aprilCheck.importHazardLevel, 'critical');
  assert.ok(aprilCheck.hazardWarningRu.includes('раннего лука'));
  assert.ok(aprilCheck.recommendedMaxHoldingDate.endsWith('-03-20') || aprilCheck.recommendedMaxHoldingDate.endsWith('-03-25'));
});
