import fs from 'node:fs';
import { runHonestBacktest } from '../shared/honestBacktest.js';
import { driverMaps } from '../shared/driverModel.js';
import { buildCatBoostContext } from '../shared/catboostModel.js';

const ISSUE = '2026-10-30';
const root = new URL('../', import.meta.url);
const H = JSON.parse(fs.readFileSync(new URL('data/official-history.json', root), 'utf8'));
const D = JSON.parse(fs.readFileSync(new URL('data/official-drivers.json', root), 'utf8'));

const points = H.producer.monthly
  .filter((r) => r.availableDate <= ISSUE)
  .sort((a, b) => a.period.localeCompare(b.period));

const filt = (a) => (a || []).filter((r) => r.availableDate <= ISSUE);
const drivers = {
  usdRub: filt(D.usdRub),
  kztRub: filt(D.kztRub),
  keyRate: filt(D.keyRate),
  weather: { volgograd: filt(D.weather.volgograd), zhambyl: filt(D.weather.zhambyl) },
};
const retail = H.retail.weekly.filter((r) => r.availableDate <= ISSUE);
const ctx = { maps: driverMaps(drivers), cb: buildCatBoostContext(drivers, retail) };

const report = runHonestBacktest(points, ctx);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n=== HONEST WALK-FORWARD BACKTEST (${report.firstPeriod} .. ${report.lastPeriod}, N=${report.nMonths} months) ===\n`);
  console.log('h  | N  | eq_carry MAE | naive MAE | y(t-12) MAE | last+seas MAE | eq-seas CI90 (effSeasons) | eq Dir% | seas Dir%');
  console.log('-'.repeat(110));
  for (const r of report.horizons) {
    const ci = r.ciVsSeasonal;
    const ciStr = `${ci.mean >= 0 ? '+' : ''}${ci.mean} [${ci.lo90}, ${ci.hi90}] (S=${ci.effectiveSeasons})`;
    console.log(
      `${String(r.horizonMonths).padStart(2)} | ${String(r.n).padStart(2)} | ${r.eq_carry.mae.toFixed(2).padStart(12)} | ${r.naive.mae.toFixed(2).padStart(9)} | ${r.seasonal.mae.toFixed(2).padStart(11)} | ${r.naive_seasonal_adj.mae.toFixed(2).padStart(13)} | ${ciStr.padEnd(27)} | ${Math.round(r.eq_carry.directionHitRate * 100).toString().padStart(6)}% | ${Math.round(r.seasonalDirectionHitRate * 100).toString().padStart(8)}%`
    );
  }

  console.log('\n=== DISAGGREGATED BY CROP-YEAR SEASON (Aug-Jul): 2024/25 Shortage vs 2025/26 Glut ===\n');
  console.log('h  | 2024/25 Shortage (eq MAE / last+seas MAE / naive MAE) | 2025/26 Glut (eq MAE / last+seas MAE / naive MAE)');
  console.log('-'.repeat(110));
  for (const r of report.horizons) {
    const s24 = r.bySeason['2024/25_shortage'];
    const s25 = r.bySeason['2025/26_glut'];
    const fmt = (s) => (s.eq_carry ? `${s.eq_carry.mae.toFixed(2)} / ${s.naive_seasonal_adj.mae.toFixed(2)} / ${s.naive.mae.toFixed(2)} (N=${s.eq_carry.n})` : 'N/A');
    console.log(`${String(r.horizonMonths).padStart(2)} | ${fmt(s24).padEnd(53)} | ${fmt(s25)}`);
  }
}
