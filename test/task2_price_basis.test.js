import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isTargetGrade5PlusLot20Plus,
  buildCalibrationSeries,
  buildTargetWholesaleSeries,
  computeWholesaleRetailRatioRange,
  buildSeparatedPriceBasis,
} from '../shared/priceBasis.js';
import { buildUserPriceCsv } from '../shared/localBasis.js';
import { importPriceCSV } from '../shared/observations.js';
import { computeMarketModel } from '../shared/marketModel.js';

test('Task 2.1: Target series strictly isolates grade 5+ and lot >= 20t from smaller/substandard lots and Rosstat calibration series', () => {
  const csv = buildUserPriceCsv([
    {
      basis: 'warehouse',
      date: '2026-10-10',
      price: 16.5,
      vat: 'excl',
      region: 'Волгоградская обл.',
      deliveryBasis: 'EXW',
      lotSizeT: 25,
      grade: '1 сорт (ГОСТ 34306-2017)',
      caliber: '5+ см',
    },
    {
      basis: 'warehouse',
      date: '2026-10-12',
      price: 11.0,
      vat: 'excl',
      region: 'Волгоградская обл.',
      deliveryBasis: 'EXW',
      lotSizeT: 10, // < 20t, must NOT enter target series
      grade: '1 сорт (ГОСТ 34306-2017)',
      caliber: '5+ см',
    },
    {
      basis: 'warehouse',
      date: '2026-10-14',
      price: 12.0,
      vat: 'excl',
      region: 'Волгоградская обл.',
      deliveryBasis: 'EXW',
      lotSizeT: 30,
      grade: '2 сорт',
      caliber: '4-5 см', // not 5+, must NOT enter target series
    },
  ], '2026-10-15');

  const rep = importPriceCSV(csv, [], { today: '2026-10-15', importDate: '2026-10-15' });
  assert.equal(rep.accepted.length, 3);
  assert.equal(isTargetGrade5PlusLot20Plus(rep.accepted[0]), true);
  assert.equal(isTargetGrade5PlusLot20Plus(rep.accepted[1]), false);
  assert.equal(isTargetGrade5PlusLot20Plus(rep.accepted[2]), false);

  const cal = buildCalibrationSeries([{ period: '2026-09', value: 18.12 }]);
  const target = buildTargetWholesaleSeries(rep.accepted);
  assert.equal(cal.length, 1);
  assert.equal(cal[0].seriesRole, 'calibration');
  assert.equal(cal[0].vat, 'excl');
  assert.equal(cal[0].deliveryTerms, 'EXW');

  assert.equal(target.length, 1);
  assert.equal(target[0].seriesRole, 'target');
  assert.equal(target[0].lotSizeT, 25);
  assert.equal(target[0].deliveryTerms, 'EXW');
  assert.equal(target[0].region, 'Волгоградская обл.');
  assert.ok(target[0].source);
});

test('Task 2.2: computeWholesaleRetailRatioRange computes paired range from matching dates', () => {
  const wholesale = [
    { date: '2026-10-05', priceExVat: 15.0 },
    { date: '2026-10-12', priceExVat: 18.0 },
    { date: '2026-10-19', priceExVat: 21.0 },
  ];
  const retail = [
    { date: '2026-10-06', value: 40.0 }, // 15/40 = 0.375
    { date: '2026-10-13', value: 40.0 }, // 18/40 = 0.450
    { date: '2026-10-20', value: 42.0 }, // 21/42 = 0.500
  ];

  const ratio = computeWholesaleRetailRatioRange(wholesale, retail);
  assert.equal(ratio.available, true);
  assert.equal(ratio.n, 3);
  assert.equal(ratio.min, 0.375);
  assert.equal(ratio.median, 0.45);
  assert.equal(ratio.max, 0.5);
  assert.ok(ratio.rangeText.includes('37.5%'));
});

test('Task 2.3: computeMarketModel exposes separated priceBasis and officialProducerRetailRatio', () => {
  const basisRes = buildSeparatedPriceBasis({
    officialMonthly: [{ period: '2026-09', value: 18.12 }],
    retailWeekly: [{ date: '2026-09-14', value: 36.24 }],
    observations: [],
  });
  assert.equal(basisRes.officialProducerRetailRatio.median, 0.5);

  const model = computeMarketModel({ observations: [], today: '2026-11-15' });
  assert.ok(model.priceBasis);
  assert.ok(model.priceBasis.calibrationSeries.length > 0);
  assert.equal(model.priceBasis.officialProducerRetailRatio.available, true);
});
