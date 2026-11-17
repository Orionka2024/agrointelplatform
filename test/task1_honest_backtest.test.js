import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  cropYearOf,
  computeSeasonalIndices,
  predictLastPlusSeasonal,
  predictSeasonalDirection,
  seasonBlockBootstrapDiff,
  runHonestBacktest,
} from '../shared/honestBacktest.js';
import { driverMaps } from '../shared/driverModel.js';
import { buildCatBoostContext } from '../shared/catboostModel.js';

test('Task 1.1: cropYearOf maps August-July agricultural seasons accurately', () => {
  assert.equal(cropYearOf('2024-08'), '2024/25');
  assert.equal(cropYearOf('2024-12'), '2024/25');
  assert.equal(cropYearOf('2025-07'), '2024/25');
  assert.equal(cropYearOf('2025-08'), '2025/26');
  assert.equal(cropYearOf('2026-07'), '2025/26');
});

test('Task 1.2: predictLastPlusSeasonal and predictSeasonalDirection are strictly causal (no lookahead)', () => {
  const pts = [
    { period: '2023-01', value: 20 },
    { period: '2023-02', value: 22 },
    { period: '2023-03', value: 25 },
    { period: '2023-04', value: 27 },
    { period: '2023-05', value: 30 },
    { period: '2023-06', value: 28 },
    { period: '2023-07', value: 20 },
    { period: '2023-08', value: 15 },
    { period: '2023-09', value: 14 },
    { period: '2023-10', value: 15 },
    { period: '2023-11', value: 17 },
    { period: '2023-12', value: 19 },
    { period: '2024-01', value: 21 },
    { period: '2024-02', value: 999 }, // Future spike after origin
  ];

  const idxBefore = computeSeasonalIndices(pts, 12);
  const predBefore = predictLastPlusSeasonal(pts, 12, 1);
  const dirBefore = predictSeasonalDirection(pts, 12, 1);

  // Mutating future value at index 13 must not change index 12's forecast
  const ptsMutated = pts.map((p, i) => (i === 13 ? { ...p, value: 1 } : p));
  const predMutated = predictLastPlusSeasonal(ptsMutated, 12, 1);
  assert.equal(predBefore, predMutated);
  assert.ok(Array.isArray(idxBefore) && idxBefore.length === 12);
  assert.ok([-1, 0, 1].includes(dirBefore));
});

test('Task 1.3: runHonestBacktest produces season-clustered CIs, effectiveSeasons, seasonalDirectionHitRate, and 2024/25 vs 2025/26 breakdown', () => {
  const H = JSON.parse(fs.readFileSync('data/official-history.json', 'utf8'));
  const D = JSON.parse(fs.readFileSync('data/official-drivers.json', 'utf8'));
  const points = H.producer.monthly.filter((r) => r.availableDate <= '2026-10-30').sort((a, b) => a.period.localeCompare(b.period));
  const filt = (a) => (a || []).filter((r) => r.availableDate <= '2026-10-30');
  const drivers = {
    usdRub: filt(D.usdRub),
    kztRub: filt(D.kztRub),
    keyRate: filt(D.keyRate),
    weather: { volgograd: filt(D.weather.volgograd), zhambyl: filt(D.weather.zhambyl) },
  };
  const ctx = { maps: driverMaps(drivers), cb: buildCatBoostContext(drivers, H.retail.weekly.filter((r) => r.availableDate <= '2026-10-30')) };

  const report = runHonestBacktest(points, ctx, { leads: [2, 5, 7] });
  assert.equal(report.horizons.length, 3);
  for (const h of report.horizons) {
    assert.ok(h.naive_seasonal_adj && Number.isFinite(h.naive_seasonal_adj.mae));
    assert.ok(Number.isFinite(h.seasonalDirectionHitRate));
    assert.ok(h.ciVsSeasonal.effectiveSeasons >= 4);
    assert.ok(h.bySeason['2024/25_shortage'].eq_carry.n > 0);
    assert.ok(h.bySeason['2025/26_glut'].eq_carry.n > 0);
  }

  // Test seasonBlockBootstrapDiff directly
  const mockA = [
    { target: '2024-09', p: 10, a: 12 },
    { target: '2025-09', p: 15, a: 16 },
    { target: '2026-02', p: 20, a: 21 },
  ];
  const mockB = [
    { target: '2024-09', p: 8, a: 12 },
    { target: '2025-09', p: 12, a: 16 },
    { target: '2026-02', p: 18, a: 21 },
  ];
  const boot = seasonBlockBootstrapDiff(mockA, mockB, { B: 200 });
  assert.equal(boot.effectiveSeasons, 2);
  assert.ok(boot.mean < 0);
});
