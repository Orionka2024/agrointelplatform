import { buildWeeklySeries } from './series.js';
import { isVerified, availableDate, INDICATORS } from './observations.js';
import { daysBetween } from './dates.js';
export function monitorMarket(observations, indicators, today) {
  const prices = [];
  for (const basis of ['warehouse','moscow']) for (const kind of ['transaction','bid','ask']) {
    const series=buildWeeklySeries(observations,{basis,kind,asOf:today});
    const last=series.points.at(-1),prev=series.points.at(-2);
    prices.push({basis,kind,n:series.used,weeks:series.points.length,latest:last||null,
      previousWeek:prev?.week||null,ageDays:last?daysBetween(last.week,today):null,
      change: last&&prev?last.value-prev.value:null,
      changePct:last&&prev?100*(last.value/prev.value-1):null});
  }
  const groups=new Map();
  for(const o of indicators.filter(o=>isVerified(o)&&o.observationDate<=today&&availableDate(o)<=today)) {
    const key=[o.indicator,o.region,o.cropYear,o.storageType].join('|');
    if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(o);
  }
  const drivers=[...groups.entries()].map(([id,rows])=>{
    rows.sort((a,b)=>a.observationDate.localeCompare(b.observationDate));
    const last=rows.at(-1),prev=rows.at(-2);
    return {id,...last,label:INDICATORS[last.indicator]?.label||last.indicator,ageDays:daysBetween(last.observationDate,today),change:prev?last.value-prev.value:null,previousDate:prev?.observationDate||null,
      interpretation:'Наблюдение; знак и величина влияния на цену не оценены.'};
  });
  return {prices,drivers,probabilities:null, note:'Изменение между последними доступными неделями, не обязательно соседними. Тонны разных регионов и периодов не суммируются.'};
}
