/** Monthly producer benchmark only. Latest-vintage hindcast is NOT point-in-time validation.
 * Selection, calibration and final evaluation use disjoint TARGET month blocks.
 * Candidates: naive/seasonal/ratio baselines and ridge models trained on the public history
 * (month-of-year only, and month-of-year + USD/RUB + key rate). Fitted coefficients are
 * predictive, never claimed as causal. A trained model is only selected if it beats the naive
 * baseline by >=5% on the tuning block; the untouched final block then reports it either way.
 */
import {ridgePredict,driverMaps} from './driverModel.js';
export const OFFICIAL_MODEL_VERSION='rosstat-monthly-2.0.0';
export const MONTHLY_MODELS={naive:'Последняя цена',seasonal:'Цена того же месяца прошлого года',ratio:'Среднее сезонное отношение (до 3 лет)',season_ridge:'Обученная сезонность (ridge, месяц года)',drivers:'Обученная модель: сезонность + курс USD/RUB + ключевая ставка (ridge)'};
export function monthNumber(s){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))throw new Error('Invalid month');return Number(s.slice(0,4))*12+Number(s.slice(5,7))-1;}
export function monthLabel(n){return `${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;}
export function monthlyPredict(points,origin,lead,id,ctx=null){
  const map=new Map(points.filter(r=>monthNumber(r.period)<=origin).map(r=>[monthNumber(r.period),r.value]));
  const base=map.get(origin);if(!Number.isFinite(base)||lead<1)return null;
  if(id==='naive')return base;
  if(id==='seasonal'){let target=origin+lead;while(target>origin)target-=12;return map.get(target)??null;}
  if(id==='ratio'){
   const ratios=[];
   for(let k=1;k<=3;k++){const a=map.get(origin-12*k),b=map.get(origin+lead-12*k);if(origin+lead-12*k<=origin&&a>0&&b>0)ratios.push(Math.log(b/a));}
   return ratios.length>=2?base*Math.exp(ratios.reduce((a,b)=>a+b,0)/ratios.length):null;
  }
  if(id==='season_ridge')return ridgePredict('season',map,null,origin,lead);
  if(id==='drivers')return ctx?.maps?ridgePredict('drivers',map,ctx.maps,origin,lead):null;
  throw new Error('Unknown monthly model');
}
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
export function errorQuantile(errors,coverage){const a=[...errors].sort((x,y)=>x-y),i=Math.ceil((a.length+1)*coverage)-1;return i>=0&&i<a.length?a[i]:null;}
function summary(rows){return {n:rows.length,mae:mean(rows.map(r=>r.abs)),directionAccuracy:mean(rows.map(r=>Number(Math.sign(r.point-r.base)===Math.sign(r.actual-r.base))))};}
/** @param drivers optional {usdRub:[{period,value}], keyRate:[{period,value}]} (already availability-filtered) */
export function evaluateMonthly(points,lead,drivers=null){
  const ctx=drivers?{maps:driverMaps(drivers)}:null;
  const ids=Object.keys(MONTHLY_MODELS).filter(id=>id!=='drivers'||ctx);
  const n=points.length,first=monthNumber(points[0].period);
  const finalStart=n-12;
  // Purge lead months so selection ends before the first calibration origin,
  // and calibration targets mature before the first final-test origin.
  const calibrationEnd=finalStart-lead-1,calibrationStart=calibrationEnd-11,tuningEnd=calibrationStart-lead-1;
  const records=Object.fromEntries(ids.map(id=>[id,[]]));
  for(let originIndex=23;originIndex+lead<n;originIndex++){
   const origin=first+originIndex,targetIndex=originIndex+lead;
   for(const id of ids){
    const point=monthlyPredict(points,origin,lead,id,ctx);
    if(point===null)continue;
    const actual=points[targetIndex].value;
    records[id].push({origin:monthLabel(origin),target:points[targetIndex].period,targetIndex,point,actual,base:points[originIndex].value,abs:Math.abs(point-actual)});
   }
  }
  // Compare candidates on exactly the same tuning targets; retain naive unless >=5% better.
  let selected='naive';const comparisons=[];
  for(const id of ids.filter(x=>x!=='naive')){
   const rows=records[id].filter(r=>r.targetIndex<=tuningEnd),targets=new Set(rows.map(r=>r.target));
   const base=records.naive.filter(r=>targets.has(r.target));
   const ratio=rows.length>=6?summary(rows).mae/summary(base).mae:null;
   comparisons.push({id,n:rows.length,mae:summary(rows).mae,naiveMAE:summary(base).mae,ratio});
  }
  const eligible=comparisons.filter(r=>r.ratio!==null&&r.ratio<0.95).sort((a,b)=>a.ratio-b.ratio);
  if(eligible.length)selected=eligible[0].id;
  const cal=records[selected].filter(r=>r.targetIndex>=calibrationStart&&r.targetIndex<=calibrationEnd);
  const final=records[selected].filter(r=>r.targetIndex>=finalStart);
  const finalTargets=new Set(final.map(r=>r.target));
  const naiveFinal=records.naive.filter(r=>finalTargets.has(r.target));
  // Informational only: the untouched final block for every candidate (never used to select).
  const finalAll=ids.map(id=>{const rows=records[id].filter(r=>r.targetIndex>=finalStart),t=new Set(rows.map(r=>r.target));return {id,n:rows.length,mae:rows.length?summary(rows).mae:null,naiveMAE:rows.length?summary(records.naive.filter(r=>t.has(r.target))).mae:null};});
  const q80=errorQuantile(cal.map(r=>r.abs),.8),q95=errorQuantile(cal.map(r=>r.abs),.95);
  const finalScore=summary(final),naiveScore=summary(naiveFinal);
  return {selected,lead,comparisons,finalAll,usesDrivers:!!ctx,calibrationN:cal.length,q80,q95,final:finalScore,naiveFinal:naiveScore,
    finalCoverage80:q80===null?null:mean(final.map(r=>Number(r.abs<=q80))),
    finalCoverage95:q95===null?null:mean(final.map(r=>Number(r.abs<=q95))),
    beatsNaive:finalScore.n>=6&&finalScore.mae<naiveScore.mae,
    split:{tuningEnds:points[tuningEnd]?.period,calibrationStarts:points[calibrationStart]?.period,calibrationEnds:points[calibrationEnd]?.period,finalStarts:points[finalStart]?.period,finalEnds:points.at(-1).period},
    finalPredictions:final};
}
export function issueOfficialForecast(history,{issueDate,drivers=null}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(issueDate||'')||Number.isNaN(Date.parse(issueDate)))throw new Error('Invalid issue date');
  // Do not make historical forecasts using a snapshot that had not been published.
  const sources=new Map(history.sources.map(s=>[s.id,s]));
  const points=history.producer.monthly.filter(r=>r.period<=issueDate.slice(0,7)&&r.availableDate<=issueDate&&sources.has(r.sourceId)).sort((a,b)=>a.period.localeCompare(b.period));
  const last=points.at(-1),issueMonth=monthNumber(issueDate.slice(0,7));
  // Drivers: only months already available at the issue date.
  const usableDrivers=drivers?{usdRub:drivers.usdRub.filter(r=>r.availableDate<=issueDate),keyRate:drivers.keyRate.filter(r=>r.availableDate<=issueDate)}:null;
  const output={schema:1,modelVersion:OFFICIAL_MODEL_VERSION,issueDate,target:'РФ · лук · цена производителей сельхозорганизаций',unit:'RUB/kg',vat:'excluded',
    frequency:'monthly',inputCutoff:last?.period??null,n:points.length,sourceHashes:[...history.sources.map(s=>s.sha256),...(drivers?[drivers.sources.usdRub.sha256,drivers.sources.keyRate.sha256]:[])],
    drivers:usableDrivers?{usdRubLast:usableDrivers.usdRub.at(-1)??null,keyRateLast:usableDrivers.keyRate.at(-1)??null,sourceNote:drivers.note}:null,
    evaluationType:'latest_vintage_hindcast',status:'research_benchmark',rows:[],limitations:history.limitations};
  if(points.length<48){return {...output,status:'insufficient_data'};}
  for(let i=0;i<points.length;i++){
   if(!Number.isFinite(points[i].value)||points[i].value<=0)throw new Error('Invalid producer value');
   if(i&&monthNumber(points[i].period)!==monthNumber(points[i-1].period)+1)throw new Error('Monthly history must be continuous, unique and not interpolated');
  }
  const lastMonth=monthNumber(last.period);
  if(issueMonth-lastMonth>2)return {...output,status:'stale_data'};
  const ctx=usableDrivers?{maps:driverMaps(usableDrivers)}:null;
  // Monthly target dates start in the month AFTER issuance, not after the last observation.
  for(let h=1;h<=14;h++){
   const target=issueMonth+h,lead=target-lastMonth,validation=evaluateMonthly(points,lead,usableDrivers);
   const point=monthlyPredict(points,lastMonth,lead,validation.selected,ctx);
   const range=q=>point!==null&&q!==null?{lo:Math.max(0,point-q),hi:point+q}:null;
   output.rows.push({h,lead,targetMonth:monthLabel(target),point,changePct:point===null?null:100*(point/last.value-1),
    interval80:range(validation.q80),interval95:range(validation.q95),validation});
  }
  return output;
}
