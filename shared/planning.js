import { parseCSV, parseNumber } from './csv.js';
import { isISODate } from './dates.js';
import { isVerified, verificationOf, hash32 } from './observations.js';

export const ANNUAL_TEMPLATE='year,crop,region,area_ha,yield_t_ha,marketable_share_pct,price_rub_kg,cost_rub_ha,cpi,source,source_ref,published_date,verification_status,verified_by,verified_at\n';
export function importAnnualCSV(text, existing=[], {today}={}) {
  const p=parseCSV(text), report={accepted:[],rejected:[],duplicates:[],fileErrors:p.errors,totalRows:p.rows.length};
  const ids=new Set(existing.map(x=>x.id));
  for(const r of p.rows) {
    const year=Number(r.year), errors=[];
    if(!Number.isInteger(year)||year<1980||year>Number(today?.slice(0,4))) errors.push('year: завершённый/текущий исторический год');
    if(!r.crop||!r.region||!r.source||!r.source_ref||!isISODate(r.published_date)||r.published_date>today) errors.push('Нужны crop, region, source, source_ref и доступная published_date');
    const row={year,crop:r.crop,region:r.region,source:r.source,sourceRef:r.source_ref,publishedDate:r.published_date,verification:verificationOf(r)};
    for(const field of ['area_ha','yield_t_ha','marketable_share_pct','price_rub_kg','cost_rub_ha','cpi']) {
      row[field]=parseNumber(r[field]);
      if(row[field]===null||row[field]<=0||(field==='marketable_share_pct'&&row[field]>100)) errors.push(field+': неверное значение');
    }
    row.id=hash32(JSON.stringify(row));
    if(errors.length) report.rejected.push({line:r.__line,errors});
    else if(ids.has(row.id)) report.duplicates.push({line:r.__line});
    else {report.accepted.push(row);ids.add(row.id);}
  } return report;
}
/** Historical pairs are descriptive only; never assign a deterministic high/low cycle. */
export function annualEvidence(rows,{crop='onion',region,today}) {
  const visible=rows.filter(r=>isVerified(r)&&r.crop===crop&&(!region||r.region===region)&&r.publishedDate<=today);
  const regions=[...new Set(visible.map(r=>r.region))];
  if(regions.length>1) return {status:'select_region',n:0,pairs:[],regions};
  const years=new Map();
  for(const r of visible.sort((a,b)=>a.publishedDate.localeCompare(b.publishedDate))) years.set(r.year,r);
  const sorted=[...years.values()].sort((a,b)=>a.year-b.year);
  const pairs=[];
  for(const r of sorted) {
    const next=years.get(r.year+1); if(!next) continue;
    const revenue=r.yield_t_ha*r.marketable_share_pct/100*r.price_rub_kg*1000;
    pairs.push({year:r.year,realMarginPerHa:(revenue-r.cost_rub_ha)/r.cpi*100,nextAreaChangePct:100*(next.area_ha/r.area_ha-1),nextRealPriceChangePct:100*((next.price_rub_kg/next.cpi)/(r.price_rub_kg/r.cpi)-1)});
  }
  return {status:sorted.length>=8?'descriptive_only':'insufficient_history',n:sorted.length,regions,pairs,firstYear:sorted[0]?.year,lastYear:sorted.at(-1)?.year,
    note:'Исторические пары не доказывают причинность. Вероятности цикла и ценовой прогноз не оценены.'};
}
export const PLANNING_FIELDS={
  areaHa:'Площадь хозяйства, га',yieldTHa:'Урожайность хозяйства, т/га',saleablePct:'Товарный выход, %',
  costRubHa:'Выращивание, ₽/га',salePrice:'Цена продажи без НДС, ₽/кг (допущение)',
  sellingRubKg:'Реализация, ₽/кг',fixedCostRub:'Дополнительные постоянные затраты, ₽',
  landLimitHa:'Доступная земля / севооборот, га',waterM3Ha:'Вода, м³/га',waterLimitM3:'Доступная вода, м³',
  labourDaysHa:'Труд, чел.-дней/га',labourLimitDays:'Доступный труд, чел.-дни',workingCapitalRub:'Доступное финансирование, ₽',
  nationalAreaHa:'Площадь рынка, га',nationalYieldTHa:'Урожайность рынка, т/га',nationalSaleablePct:'Товарный выход рынка, %',
  openingT:'Начальные запасы, т',importsT:'Импорт, т',exportsT:'Экспорт, т',demandT:'Внутреннее потребление, т',lossesT:'Потери после товарной приёмки, т'
};
export function evaluatePlan(input) {
  const missing=Object.keys(PLANNING_FIELDS).filter(k=>input[k]===null||input[k]===undefined||input[k]===''||!Number.isFinite(Number(input[k])));
  if(missing.length) return {status:'incomplete',missing};
  const p=Object.fromEntries(Object.keys(PLANNING_FIELDS).map(k=>[k,Number(input[k])]));
  if(Object.values(p).some(v=>v<0)||p.saleablePct>100||p.nationalSaleablePct>100||p.areaHa<=0||p.yieldTHa<=0||p.salePrice<=0||p.demandT<=0) return {status:'invalid',missing:[]};
  const tonnes=p.areaHa*p.yieldTHa*p.saleablePct/100;
  if(!tonnes) return {status:'invalid',missing:[]};
  const productionCost=p.areaHa*p.costRubHa+p.fixedCostRub;
  const revenue=tonnes*1000*p.salePrice;
  const profit=revenue-productionCost-tonnes*1000*p.sellingRubKg;
  const marketProduction=p.nationalAreaHa*p.nationalYieldTHa*p.nationalSaleablePct/100;
  const endingT=p.openingT+marketProduction+p.importsT-p.exportsT-p.demandT-p.lossesT;
  const constraints=[['земля',p.areaHa,p.landLimitHa],['вода',p.areaHa*p.waterM3Ha,p.waterLimitM3],['труд',p.areaHa*p.labourDaysHa,p.labourLimitDays],['финансирование выращивания',productionCost,p.workingCapitalRub]].map(([label,needed,available])=>({label,needed,available,ok:needed<=available}));
  return {status:'scenario',tonnes,revenue,profit,profitPerHa:profit/p.areaHa,breakEvenPrice:productionCost/(tonnes*1000)+p.sellingRubKg,
    marketProduction,endingT,stocksToUse:endingT>=0?endingT/p.demandT:null,constraints,
    note:'Цена и урожайность заданы совместным сценарием, не моделью. Отрицательный остаток означает несовместимый баланс. Вероятность не присваивается.'};
}
