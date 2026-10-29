import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {buildWeeklySeries,pointsToMap} from '../shared/series.js';
import {rollingOriginBacktest} from '../shared/backtest.js';
import {issueForecast} from '../shared/forecast.js';
import {generateAutonomousAnalysis} from '../shared/autonomousAdvisor.js';
import {computeMarketModel,DEFAULT_ASSUMPTIONS} from '../shared/marketModel.js';
import {addWeeks} from '../shared/dates.js';
import {storageAtHorizon,evaluateStorage} from '../shared/storageEconomics.js';
import {evaluateScenario,applyScenarioToRows,DEFAULT_SCENARIOS} from '../shared/scenarios.js';
import {evaluatePlan,annualEvidence,importAnnualCSV,ANNUAL_TEMPLATE} from '../shared/planning.js';
import {store} from '../server/store.js';
import assumptions from '../api/assumptions.js';
import advisor from '../api/advisor.js';
const verified={status:'verified',by:'test',at:'2026-10-29',evidence:'synthetic fixture'};
const observation=(i,extra={})=>({id:'test'+i,market:'warehouse_volgograd',kind:'transaction',observationDate:addWeeks('2026-01-05',i),publishedDate:addWeeks('2026-01-05',i),priceExVatRubKg:10+i,deliveryBasis:'EXW',source:'fixture',spec:{},verification:verified,...extra});
function response(){return {code:200,setHeader(){},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
test('Unverified seed records and legacy forecasts never become real outputs',()=>{
 const obs=observation(0,{verification:undefined});
 assert.equal(buildWeeklySeries([obs],{basis:'warehouse',asOf:'2026-10-29'}).points.length,0);
 const m=computeMarketModel({observations:[obs],forecasts:[{basis:'warehouse',status:'validated',horizons:[{point:99}]}],today:'2026-10-29'});
 assert.equal(m.forecasts.warehouse,null);assert.equal(m.prices.warehouse.exVat,null);assert.equal(m.evidence.pricesVerified,0);
});
test('Historical origins cannot see prices published months later',()=>{
 const obs=Array.from({length:12},(_,i)=>observation(i,{publishedDate:'2026-05-01'}));
 const points=buildWeeklySeries(obs,{basis:'warehouse',asOf:'2026-05-02'}).points;
 const bt=rollingOriginBacktest(points,{horizons:[1],visibleAt:origin=>pointsToMap(buildWeeklySeries(obs,{basis:'warehouse',asOf:origin}).points)});
 assert.equal(bt.errors.naive[1].length,0);
});
test('Target date advances from issue week, not stale observation week',()=>{
 const fc=issueForecast({observations:[observation(0)],basis:'warehouse',issueDate:'2026-01-15',horizons:[1]});
 assert.equal(fc.horizons[0].targetDate,'2026-01-19');
});
test('Manual prices never rewrite observed transactions or issue a historical forecast',async()=>{
 const before=JSON.stringify(store.getObservations()),forecasts=JSON.stringify(store.getForecasts());
 const res=response();await assumptions({method:'POST',body:{manualPrices:{warehouse:{value:50,vat:'excl',asOf:'2026-10-29'}}}},res);
 assert.equal(res.code,200);assert.equal(JSON.stringify(store.getObservations()),before);assert.equal(JSON.stringify(store.getForecasts()),forecasts);
});
test('Empty adviser does not invent performance, prices or seasonal peaks',()=>{
 const s=generateAutonomousAnalysis('точность',{});
 assert.ok(!s.includes('0.90'));assert.ok(!s.includes('313'));assert.ok(!s.includes('39.3'));assert.match(s,/нет данных/);
});
test('Adviser ignores client supplied authoritative snapshot',async()=>{
 const res=response();await advisor({method:'POST',body:{message:'точность',snapshot:{prices:{warehouse:{priceExVat:999999}}}}},res);
 assert.equal(res.code,200);assert.ok(!res.data.answer.includes('999999'));
});
test('Unknown scenario response remains unknown',()=>{
 const sc=evaluateScenario(DEFAULT_SCENARIOS.tight);
 assert.equal(sc.complete,false);assert.equal(applyScenarioToRows([{h:1,point:20}],sc)[0].scenarioPoint,null);
});
test('Losses grow with duration and break-even price solves the sell-now equality',()=>{
 const p=DEFAULT_ASSUMPTIONS.storage;
 const a=storageAtHorizon(p,1),b=storageAtHorizon(p,6);
 assert.ok(b.shrinkPct>a.shrinkPct);
 const r=evaluateStorage(20,25,b);assert.ok(Math.abs(evaluateStorage(20,r.breakEvenFuturePrice,b).gain)<1e-9);
});
test('Planning rejects missing data and exposes infeasible land and supply balance',()=>{
 assert.equal(evaluatePlan({}).status,'incomplete');
 const p={areaHa:10,yieldTHa:40,saleablePct:80,costRubHa:400000,salePrice:20,sellingRubKg:1,fixedCostRub:0,landLimitHa:8,waterM3Ha:100,waterLimitM3:2000,labourDaysHa:5,labourLimitDays:100,workingCapitalRub:5000000,nationalAreaHa:100,nationalYieldTHa:40,nationalSaleablePct:80,openingT:0,importsT:0,exportsT:0,demandT:4000,lossesT:0};
 const r=evaluatePlan(p);assert.equal(r.tonnes,320);assert.equal(r.profit,2080000);assert.equal(r.endingT,-800);assert.equal(r.constraints[0].ok,false);
});
test('Cycle evidence does not mix regions or claim deterministic cycles',()=>{
 const rows=[2023,2024].map(year=>({year,crop:'onion',region:'A',publishedDate:'2025-01-01',verification:verified,area_ha:100,yield_t_ha:40,marketable_share_pct:80,price_rub_kg:20,cost_rub_ha:400000,cpi:100}));
 const e=annualEvidence(rows,{today:'2026-10-29'});assert.equal(e.status,'insufficient_history');assert.equal(e.pairs.length,1);
 assert.equal(annualEvidence([...rows,{...rows[0],region:'B'}],{today:'2026-10-29'}).status,'select_region');
});
test('Annual CSV accepts verified original references and rejects future publication',()=>{
 const text=ANNUAL_TEMPLATE+'2024,onion,A,100,40,80,20,400000,100,own,invoice,2025-01-01,verified,test,2026-10-29\n';
 assert.equal(importAnnualCSV(text,[],{today:'2026-10-29'}).accepted.length,1);
 assert.equal(importAnnualCSV(text.replace('2025-01-01','2027-01-01'),[],{today:'2026-10-29'}).rejected.length,1);
});
test('SQLite data survives a separate Node process',()=>{
 const child=spawnSync(process.execPath,['--input-type=module','-e',"import {store} from './server/store.js'; console.log(store.getAssumptions().version)"],{encoding:'utf8',env:process.env});
 assert.equal(child.status,0);assert.equal(child.stdout.trim(),'2');
});

test('Re-import can attest an existing price without changing historical values', async()=>{
 const {importPriceCSV}=await import('../shared/observations.js');
 const header='observation_date,kind,market,geography,price,unit,vat,delivery_basis,source,source_ref,verification_status,verified_by,verified_at';
 const row='2026-01-01,transaction,warehouse_volgograd,Volgograd,20,RUB/kg,excl,EXW,fixture,invoice-1';
 const first=importPriceCSV(header+'\n'+row+',unverified,,',[],{today:'2026-10-29',importDate:'2026-10-29'});
 assert.equal(first.accepted.length,1);
 store.appendObservations(first.accepted);
 const upgrade=importPriceCSV(header+'\n'+row+',verified,test,2026-10-29',first.accepted,{today:'2026-10-29',importDate:'2026-10-29'});
 assert.equal(upgrade.accepted.length,1);
 store.appendObservations(upgrade.accepted);
 const saved=store.getObservations().filter(o=>o.id===first.accepted[0].id);
 assert.equal(saved.length,1);assert.equal(saved[0].verification.status,'verified');
 assert.equal(saved[0].priceRubKg,first.accepted[0].priceRubKg);
 assert.equal(importPriceCSV(header+'\n'+row+',verified,test,2026-10-29',saved,{today:'2026-10-29',importDate:'2026-10-29'}).duplicates.length,1);
});
