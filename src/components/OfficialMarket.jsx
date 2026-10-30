import {useState} from 'react';
import {Line} from 'react-chartjs-2';
import {Chart as ChartJS,CategoryScale,LinearScale,PointElement,LineElement,Tooltip,Legend} from 'chart.js';
import {officialHistory as history,officialForecast as fc,officialDrivers as drivers} from '../../shared/officialData.js';
import {MONTHLY_MODELS,monthNumber} from '../../shared/officialForecast.js';
import {localBasis,applyBasis} from '../../shared/localBasis.js';
import {useMarket} from '../context/useMarket';
import OfficialSummary from './OfficialSummary';
import AddActualPrice from './AddActualPrice';
ChartJS.register(CategoryScale,LinearScale,PointElement,LineElement,Tooltip,Legend);
const fmt=v=>Number.isFinite(v)?v.toLocaleString('ru-RU',{maximumFractionDigits:2}):'—';
const band=v=>v?`${fmt(v.lo)}–${fmt(v.hi)}`:'Недостаточно ошибок';
const STRENGTH={calibrated:'Калибровка по ≥6 мес.',weak:'Предварительная привязка (3–5 мес.)',anchor:'Первичная привязка по текущим сделкам (1–2 мес.)'};
export default function OfficialMarket(){
 const {model}=useMarket();
 const hasWh=(model.series?.warehouse?.points?.length??0)>0,hasMsk=(model.series?.moscow?.points?.length??0)>0;
 const [view,setView]=useState('producer'),[selected,setSelected]=useState(1),[calBasis,setCalBasis]=useState(!hasWh&&hasMsk?'moscow':'warehouse');
 const activeBasis=calBasis==='moscow'&&!hasMsk&&hasWh?'warehouse':calBasis==='warehouse'&&!hasWh&&hasMsk?'moscow':calBasis;
 const available=history.producer.monthly.filter(r=>r.availableDate<=model.today&&r.period<=model.today.slice(0,7));
 const cal=localBasis(model.series?.[activeBasis]?.points,available);
 const rows=fc.issueDate<=model.today?fc.rows:[];
 const r=rows.find(x=>x.h===selected),v=r?.validation;
 const stale=monthNumber(model.today.slice(0,7))-monthNumber(fc.inputCutoff)>2;
 const monthly=available.slice(-36),future=rows.map(x=>x.targetMonth);
 // Keep the unpublished intervening month as a gap, never invent an observation.
 const labels=[...new Set([...monthly.map(x=>x.period),...(cal?cal.months.map(x=>x.month):[]),fc.issueDate.slice(0,7),...future])].sort();
 const monthlyMap=new Map(monthly.map(x=>[x.period,x.value])),forecastMap=new Map(rows.map(x=>[x.targetMonth,x.point]));
 const userObsMap=new Map((cal?.months||[]).map(x=>[x.month,x.user]));
 const localFcMap=new Map(cal?rows.map(x=>[x.targetMonth,applyBasis(x,cal)?.point]):[]);
 const datasets=[
  {label:'Росстат: наблюдения РФ',data:labels.map(m=>monthlyMap.get(m)??null),borderColor:'#2563a6',backgroundColor:'#2563a6',pointRadius:2},
  {label:'Ориентир модели РФ',data:labels.map(m=>forecastMap.get(m)??null),borderColor:'#ad7024',borderDash:[6,5],pointRadius:3},
 ];
 if(cal){
  datasets.push({label:`Ваши сделки (${activeBasis==='warehouse'?'склад без НДС':'Москва без НДС'})`,data:labels.map(m=>userObsMap.get(m)??null),borderColor:'#0D7C4A',backgroundColor:'#0D7C4A',pointRadius:4});
  datasets.push({label:'Калиброванный ориентир для вашей цены',data:labels.map(m=>localFcMap.get(m)??null),borderColor:'#0D7C4A',borderDash:[4,4],pointRadius:3});
 }
 const retail=history.retail.weekly.filter(x=>x.availableDate<=model.today&&x.date<=model.today);
 const tuningById=new Map((v?.comparisons||[]).map(c=>[c.id,c]));
 return <div className="panel"><div className="panel-hd"><span className="panel-title">Лук · официальная история, макрофакторы и месячный прогноз</span><span className="badge warn">ИССЛЕДОВАТЕЛЬСКИЙ ОРИЕНТИР</span></div><div className="panel-body">
  <OfficialSummary/>
  <AddActualPrice defaultOpen={true}/>
  <div className="audit-controls">
   <label>Ряд <select value={view} onChange={e=>setView(e.target.value)}><option value="producer">Производители РФ · месяцы · без НДС + факторы ЦБ</option><option value="retail">Розница РФ · недели · наблюдения</option></select></label>
   {(hasWh||hasMsk)&&view==='producer'&&<label>Базис калибровки <select value={activeBasis} onChange={e=>setCalBasis(e.target.value)}><option value="warehouse">Склад Волгоград (без НДС)</option><option value="moscow">Опт Москва (без НДС)</option></select></label>}
  </div>
  {view==='retail'?<><p>Розничные цены приведены как независимый индикатор. Они не пересчитываются в складскую цену постоянным коэффициентом.</p><div className="official-chart"><Line data={{labels:retail.map(x=>x.date),datasets:[{label:'Розница РФ, ₽/кг',data:retail.map(x=>x.value),borderColor:'#2563a6',pointRadius:0}]}} options={{responsive:true,maintainAspectRatio:false}}/></div><details><summary>История и ссылки на ячейки ({retail.length})</summary><HistoryTable rows={retail} dateKey="date"/></details></>:<>
   <p>Сохранённый выпуск: <strong>{fc.issueDate}</strong> · Последнее наблюдение Росстата: <strong>{fc.inputCutoff}</strong> · Модель: <code>{fc.modelVersion}</code>. Обученные кандидаты используют сезонность месяца цели, 3-месячное изменение курса <strong>USD/RUB</strong> ({fc.drivers?.usdRubLast?`${fmt(fc.drivers.usdRubLast.value)} ₽ за ${fc.drivers.usdRubLast.period}`:'—'}) и уровень/изменение <strong>ключевой ставки ЦБ РФ</strong> ({fc.drivers?.keyRateLast?`${fmt(fc.drivers.keyRateLast.value)}% за ${fc.drivers.keyRateLast.period}`:'—'}).</p>
   {cal&&<div className="basis-banner"><strong>Калибровка под ваши сделки активна ({activeBasis==='warehouse'?'склад EXW без НДС':'Москва без НДС'}):</strong> коэффициент уровня <strong>×{fmt(cal.factor)}</strong> · учтено месяцев: <strong>{cal.n}</strong> ({STRENGTH[cal.strength]}){cal.approx>0?` · из них ${cal.approx} мес. сопоставлен с последним опубликованным месяцем Росстата (${fc.inputCutoff}), так как официальный индекс за текущий месяц ещё не вышел`:''}.</div>}
   {stale&&<p className="audit-warning">Данные устарели. Нужна новая загрузка Росстата и новый выпуск; старые прогнозы не продлеваются.</p>}
   <p className="audit-warning">Базовый ряд — месячная средняя цена реализации сельхозорганизаций по РФ без НДС (последняя ревизия Росстата; архивные первые версии публикаций за прошлые годы недоступны). На каждом горизонте модель выбирается строго по раннему участку (порог улучшения ≥5% к «последней цене»), а на независимом финальном участке 12 мес. публикуются ошибки всех 5 моделей, включая ridge-модель с факторами ЦБ РФ.</p>
   <div className="official-chart"><Line data={{labels,datasets}} options={{responsive:true,maintainAspectRatio:false,scales:{y:{title:{display:true,text:'₽/кг без НДС'}}}}}/></div>
   <div className="audit-scroll"><table className="tbl"><thead><tr><th>Месяц</th><th>Ориентир РФ</th>{cal&&<th>Ваш ориентир</th>}<th>Изменение к {fc.inputCutoff}</th><th>80% диапазон РФ</th>{cal&&<th>Ваш 80% диапазон</th>}<th>95% диапазон</th><th>MAE выбр. / драйверы / naive</th><th>Статус проверки</th></tr></thead><tbody>{rows.map(row=>{
    const loc=applyBasis(row,cal),drvFinal=row.validation.finalAll?.find(x=>x.id==='drivers');
    return <tr key={row.h}><td>{row.targetMonth}</td><td>{fmt(row.point)} ₽</td>{cal&&<td className="fw">{fmt(loc?.point)} ₽</td>}<td>{fmt(row.changePct)}%</td><td>{band(row.interval80)}</td>{cal&&<td>{band(loc?.interval80)}</td>}<td>{band(row.interval95)}</td><td>{fmt(row.validation.final.mae)} / {fmt(drvFinal?.mae)} / {fmt(row.validation.naiveFinal.mae)} ₽</td><td>{MONTHLY_MODELS[row.validation.selected]} · {row.validation.selected==='naive'?'базовый ориентир':row.validation.beatsNaive?'лучше naive на holdout (hindcast)':'не превзошёл naive на holdout'}</td></tr>;
   })}</tbody></table></div>
   <p>Изменение — расчёт относительно последнего наблюдения, а не вероятность роста или падения. Столбец MAE показывает ошибку на 12 независимых финальных месяцах: выбранная модель / обученная ridge-модель с факторами ЦБ / простая последняя цена.</p>
   <details><summary>Как проверена модель и сравнение с макрофакторами</summary><label>Целевой месяц <select value={selected} onChange={e=>setSelected(Number(e.target.value))}>{rows.map(x=><option key={x.h} value={x.h}>{x.targetMonth} (лаг +{x.lead} мес.)</option>)}</select></label>{v&&<>
    <p>Выбрана на участке настройки: <strong>{MONTHLY_MODELS[v.selected]}</strong>. Настройка до {v.split.tuningEnds||'—'}; калибровка интервалов {v.split.calibrationStarts}–{v.split.calibrationEnds} ({v.calibrationN} ошибок); независимый финальный тест {v.split.finalStarts}–{v.split.finalEnds} ({v.final.n} прогнозов). Фактическое покрытие 80% диапазона на финальном тесте: {v.finalCoverage80===null?'—':fmt(v.finalCoverage80*100)+'%'}.</p>
    <div className="audit-scroll"><table className="tbl"><thead><tr><th>Кандидат</th><th>MAE на настройке (выбор)</th><th>Отношение к naive (настройка)</th><th>MAE на финальных 12 мес. (holdout)</th></tr></thead><tbody>{(v.finalAll||[]).map(f=>{
     const t=tuningById.get(f.id);
     return <tr key={f.id}><td>{MONTHLY_MODELS[f.id]||f.id}{f.id===v.selected?' ✓':''}</td><td>{f.id==='naive'?fmt(v.comparisons?.[0]?.naiveMAE):fmt(t?.mae)} ({f.id==='naive'?v.comparisons?.[0]?.n??'—':t?.n??0})</td><td>{f.id==='naive'?'1,00':fmt(t?.ratio)}</td><td>{fmt(f.mae)} ₽ (n={f.n})</td></tr>;
    })}</tbody></table></div>
    <table className="tbl"><thead><tr><th>Целевой месяц</th><th>Исторический прогноз ({v.selected})</th><th>Факт Росстата</th><th>Абсолютная ошибка</th></tr></thead><tbody>{v.finalPredictions.map(x=><tr key={x.target}><td>{x.target}</td><td>{fmt(x.point)}</td><td>{fmt(x.actual)}</td><td>{fmt(x.abs)}</td></tr>)}</tbody></table>
   </>}</details>
   <details><summary>Проверенная месячная история Росстата ({available.length})</summary><HistoryTable rows={available} dateKey="period"/></details>
  </>}
  <details><summary>Источники, версии и ограничения</summary>
   {history.sources.map(s=><p key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.url.split('/').at(-1)}</a> · опубликовано {s.publishedDate} · SHA-256: <code style={{overflowWrap:'anywhere'}}>{s.sha256}</code></p>)}
   {Object.entries(drivers.sources).map(([k,s])=><p key={k}>ЦБ РФ ({k}): <code>{s.url}</code> · получено {s.retrievedDate} · SHA-256: <code style={{overflowWrap:'anywhere'}}>{s.sha256}</code></p>)}
   <ul>{history.limitations.map(s=><li key={s}>{s}</li>)}</ul>
   <p>Обновление публичных рядов выполняется командами <code>npm run data:collect</code>, <code>npm run data:drivers</code> и <code>npm run data:forecast</code>.</p>
  </details>
 </div></div>;
}
function HistoryTable({rows,dateKey}){return <div className="official-history"><table className="tbl"><thead><tr><th>Период</th><th>₽/кг</th><th>Лист / ячейка</th></tr></thead><tbody>{[...rows].reverse().map(r=><tr key={r[dateKey]}><td>{r[dateKey]}</td><td>{fmt(r.value)}</td><td>{r.sheet}!{r.cell}</td></tr>)}</tbody></table></div>;}
