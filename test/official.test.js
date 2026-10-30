import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {officialHistory as history,officialForecast as forecast,officialSnapshot} from '../shared/officialData.js';
import {issueOfficialForecast,monthlyPredict,monthNumber,evaluateMonthly,errorQuantile} from '../shared/officialForecast.js';
import {driverMaps as driverMapsFor} from '../shared/driverModel.js';
import {localBasis,applyBasis,buildUserPriceCsv} from '../shared/localBasis.js';
import {buildWeeklySeries} from '../shared/series.js';
import importHandler from '../api/import.js';
import marketHandler from '../api/market.js';

test('Official sources retain original files, hashes, source cells and distinct price bases',()=>{
 for(const s of history.sources){const data=fs.readFileSync(new URL('../'+s.file,import.meta.url));assert.equal(createHash('sha256').update(data).digest('hex'),s.sha256);}
 assert.equal(history.producer.monthly.length,69);assert.equal(history.producer.annual.length,16);assert.equal(history.retail.weekly.length,246);
 assert.equal(history.producer.monthly[0].period,'2021-01');assert.equal(history.producer.monthly.at(-1).period,'2026-09');
 assert.equal(history.producer.monthly.at(-1).value,18.11816);assert.equal(history.producer.monthly.at(-1).cell,'K1658');
 assert.equal(history.retail.weekly.at(-1).value,49.19);assert.equal(history.retail.weekly.at(-1).cell,'AQ41');
 assert.equal(history.producer.vat,'excluded');assert.equal(history.retail.vat,'as_published_consumer_price');
 for(const r of history.producer.monthly){assert.equal(r.value,Math.round(r.rawValue/1000*1e5)/1e5);assert.equal(r.availableDate,'2026-10-23');}
 assert.equal(history.acreage.rows.find(r=>r.year===2024).areaHa,55000);
 assert.ok(!history.acreage.rows.some(r=>r.year===2022&&r.yieldTHa));
});
test('National aggregates do not silently enter warehouse transaction series',()=>{
 assert.equal(buildWeeklySeries(history.producer.monthly,{basis:'warehouse'}).used,0);
 assert.equal(buildWeeklySeries(history.retail.weekly,{basis:'warehouse'}).used,0);
});
test('Saved official forecast is reproducible and refuses future source vintages',()=>{
 const drivers=JSON.parse(fs.readFileSync(new URL('../data/official-drivers.json',import.meta.url),'utf8'));const result=issueOfficialForecast(history,{issueDate:forecast.issueDate,drivers});const {id,...stored}=forecast;
 assert.ok(id.startsWith('official-'));assert.deepEqual(result,stored);
 assert.equal(issueOfficialForecast(history,{issueDate:'2026-10-22'}).status,'insufficient_data');
 assert.equal(officialSnapshot('2026-10-22').producer,null);
 assert.equal(issueOfficialForecast(history,{issueDate:'2027-03-01'}).status,'stale_data');
 assert.equal(forecast.rows[0].targetMonth,'2026-11');assert.equal(forecast.rows[0].lead,2);
 assert.equal(forecast.rows.at(-1).targetMonth,'2027-12');
});
test('Monthly predictions ignore future values and require contiguous observations',()=>{
 const points=history.producer.monthly,origin=monthNumber('2024-09');
 const changed=points.map(r=>r.period>'2024-09'?{...r,value:r.value*100}:r);
 for(const id of ['naive','seasonal','ratio'])assert.equal(monthlyPredict(points,origin,3,id),monthlyPredict(changed,origin,3,id));
 const broken=structuredClone(history);broken.producer.monthly.splice(8,1);
 assert.throws(()=>issueOfficialForecast(broken,{issueDate:'2026-10-29'}),/continuous/);
});
test('Calibration and tuning are purged for lead time; final data never selects model or intervals',()=>{
 const points=history.producer.monthly;
 for(const lead of [1,2,6,13,15]){
  const v=evaluateMonthly(points,lead),split=v.split;
  assert.ok(monthNumber(split.tuningEnds)<monthNumber(split.calibrationStarts)-lead);
  assert.ok(monthNumber(split.calibrationEnds)<monthNumber(split.finalStarts)-lead);
  const changed=points.map(r=>r.period>=split.finalStarts?{...r,value:r.value*10}:r);
  const other=evaluateMonthly(changed,lead);
  assert.equal(other.selected,v.selected);assert.equal(other.q80,v.q80);assert.equal(other.q95,v.q95);
  assert.deepEqual(other.comparisons,v.comparisons);
 }
});
test('Insufficient interval samples remain unknown; failed benchmarks are not called validated',()=>{
 assert.equal(errorQuantile([1,2,3,4,5,6,7,8,9,10,11,12],.95),null);
 assert.equal(errorQuantile([], .8),null);
 assert.equal(forecast.status,'research_benchmark');assert.equal(forecast.evaluationType,'latest_vintage_hindcast');
 assert.equal(forecast.rows[0].validation.beatsNaive,false);
 for(const r of forecast.rows){assert.ok(Number.isFinite(r.point)&&r.point>0);assert.ok(!r.interval95);}
});

const drv=()=>JSON.parse(fs.readFileSync(new URL('../data/official-drivers.json',import.meta.url),'utf8'));
test('CBR driver history is hashed, complete-month, and only available after month end',()=>{
  const d=drv();
  for(const s of Object.values(d.sources)){const data=fs.readFileSync(new URL('../'+s.file,import.meta.url));assert.equal(createHash('sha256').update(data).digest('hex'),s.sha256);}
  for(const r of [...d.usdRub,...d.keyRate]){assert.ok(r.value>0);assert.ok(r.availableDate>r.period+'-28');}
  assert.equal(d.usdRub.at(-1).period,'2026-09');assert.equal(d.keyRate.at(-1).period,'2026-09');
  assert.equal(officialSnapshot('2026-10-30').drivers.count,81);
});
test('Trained driver model never sees future prices or future driver values',()=>{
  const d=drv(),points=history.producer.monthly,origin=monthNumber('2025-06');
  const maps=ds=>({maps:driverMapsFor(ds)});
  const base=monthlyPredict(points,origin,3,'drivers',maps(d));
  assert.ok(Number.isFinite(base));
  const futurePrices=points.map(r=>r.period>'2025-06'?{...r,value:r.value*50}:r);
  assert.equal(monthlyPredict(futurePrices,origin,3,'drivers',maps(d)),base);
  const futureDrivers={usdRub:d.usdRub.map(r=>r.period>'2025-06'?{...r,value:r.value*7}:r),keyRate:d.keyRate.map(r=>r.period>'2025-06'?{...r,value:r.value+30}:r)};
  assert.equal(monthlyPredict(points,origin,3,'drivers',maps(futureDrivers)),base);
});
test('Trained candidates are selected on tuning only; untouched final block never changes selection',()=>{
  const d=drv(),points=history.producer.monthly;
  for(const lead of [2,6,13]){
   const v=evaluateMonthly(points,lead,d),s=v.split;
   const changed=points.map(r=>r.period>=s.finalStarts?{...r,value:r.value*10}:r);
   const o=evaluateMonthly(changed,lead,d);
   assert.equal(o.selected,v.selected);assert.equal(o.q80,v.q80);assert.deepEqual(o.comparisons,v.comparisons);
   assert.ok(v.comparisons.some(c=>c.id==='drivers')&&v.comparisons.some(c=>c.id==='season_ridge'));
  }
});
test('Saved forecast reports every trained candidate on the final block, including failures',()=>{
  for(const r of forecast.rows){assert.ok(r.validation.usesDrivers);assert.ok(r.validation.finalAll.some(x=>x.id==='drivers'));}
});
test('Local basis calibrates level by monthly medians, flags unpublished-month anchor, and rejects large gaps',()=>{
  const nat=[{period:'2026-08',value:20},{period:'2026-09',value:18}];
  // Three entries in Aug (median 16 -> ratio 0.8) and one in Oct (compared to Sep 18 -> 14.4/18 = 0.8, approx=true)
  const pts=[{week:'2026-08-03',value:15},{week:'2026-08-10',value:16},{week:'2026-08-17',value:30},{week:'2026-10-19',value:14.4}];
  const cal=localBasis(pts,nat);
  assert.equal(cal.n,2);assert.equal(cal.approx,1);assert.equal(cal.strength,'anchor');
  assert.ok(Math.abs(cal.factor-0.8)<1e-9);
  const scaled=applyBasis({point:20,interval80:{lo:15,hi:25}},cal);
  assert.ok(Math.abs(scaled.point-16)<1e-9);assert.ok(Math.abs(scaled.interval80.lo-12)<1e-9);assert.ok(Math.abs(scaled.interval80.hi-20)<1e-9);
  // Gap > 2 months is rejected when national figure is missing
  assert.equal(localBasis([{week:'2027-01-05',value:15}],nat),null);
});
test('Adding a user-attested actual price stores verified observation and calibrates local basis immediately',async()=>{
  const csv=buildUserPriceCsv([{basis:'warehouse',date:'2026-10-28',price:15.40,vat:'excl'}],'2026-10-28');
  let impOut=null,mktOut=null;
  const resImp={setHeader(){},status(){return this;},end(){return this;},json(d){impOut=d;return this;}};
  await importHandler({method:'POST',url:'/api/import',body:{type:'prices',csv}},resImp);
  assert.equal(impOut.success,true);
  const resMkt={setHeader(){},status(){return this;},end(){return this;},json(d){mktOut=d;return this;}};
  await marketHandler({method:'GET',url:'/api/market?today=2026-10-28'},resMkt);
  assert.equal(mktOut.prices.warehouse.exVat,15.4);
  assert.equal(mktOut.storeDurable,true);
  assert.ok(mktOut.evidence.pricesVerified>=1);
  assert.ok(mktOut.macro.usdRub.value>0&&mktOut.macro.keyRate.value>0);
  const cal=localBasis(mktOut.series.warehouse.points,history.producer.monthly);
  assert.ok(cal&&cal.n>=1);
  assert.ok(Math.abs(cal.factor-15.4/18.11816)<1e-5);
});
