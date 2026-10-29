import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { evaluatePlan, PLANNING_FIELDS, annualEvidence } from '../../shared/planning.js';
const fmt=v=>Number.isFinite(v)?v.toLocaleString('ru-RU',{maximumFractionDigits:2}):'—';
export default function Cycle() {
  const {model,updateAssumptions}=useMarket();
  const [plan,setPlan]=useState(()=>model.assumptions.planning||{});
  const [scenario,setScenario]=useState('base'),[message,setMessage]=useState('');
  const year=Number(model.today.slice(0,4))+1;
  const names={surplus:'Избыток',base:'Центральный',tight:'Дефицит'};
  const values=plan[scenario]||{};
  const evidence=annualEvidence(model.annualHistory||[],{today:model.today,region:plan.region});
  function update(k,v){setPlan(p=>({...p,[scenario]:{...(p[scenario]||{}),[k]:v}}));}
  const results=Object.keys(names).map(id=>({id,result:evaluatePlan(plan[id]||{})}));
  async function save(){setMessage(await updateAssumptions({planning:plan})?'Сценарии сохранены':'Не удалось сохранить');}
  return <div className="panel"><div className="panel-hd"><span className="panel-title">Планирование урожая {year} и продаж {year}–{year+1}</span><span className="badge warn">СЦЕНАРИИ · НЕ ПРОГНОЗ</span></div><div className="panel-body">
    <p>Высокая цена не означает автоматически низкую цену следующего года. Сначала оцениваются площади, товарный урожай и баланс. Цена и урожайность задаются совместно; вероятности этим сценариям не присваиваются.</p>
    <label>Регион исторического ряда <input value={plan.region||''} onChange={e=>setPlan(p=>({...p,region:e.target.value}))}/></label>
    <p>Подтверждённых лет: {evidence.n}; статус: {evidence.status}. Нужны сопоставимые годовые данные, желательно 8–15 лет. Сводки разных регионов не смешиваются.</p>
    <table className="tbl"><thead><tr><th>Год</th><th>Реальная маржа, ₽/га (CPI=100)</th><th>Площадь следующего года</th><th>Реальная цена следующего года</th></tr></thead><tbody>{evidence.pairs.map(r=><tr key={r.year}><td>{r.year}</td><td>{fmt(r.realMarginPerHa)}</td><td>{fmt(r.nextAreaChangePct)}%</td><td>{fmt(r.nextRealPriceChangePct)}%</td></tr>)}</tbody></table>
    <p>Это описательное сравнение, не причинная модель и не доказанный цикл. Импорт годовой истории доступен на вкладке данных.</p>
    <div className="audit-controls"><label>Редактировать сценарий <select value={scenario} onChange={e=>setScenario(e.target.value)}>{Object.entries(names).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><button onClick={save}>Сохранить</button><span role="status">{message}</span></div>
    <div className="audit-inputs">{Object.entries(PLANNING_FIELDS).map(([k,label])=><label key={k}>{label}<input type="number" min="0" step="any" value={values[k]??''} onChange={e=>update(k,e.target.value)}/></label>)}</div>
    <p>Все рыночные объёмы относятся к одному региону/рынку и маркетинговому году. Потери после приёмки не должны повторно включать уже исключённую нетоварную часть урожая. Стоимость воды и труда включите в затраты выращивания.</p>
    <div className="audit-scroll"><table className="tbl"><thead><tr><th>Сценарий</th><th>Товарный урожай, т</th><th>Прибыль / га</th><th>Безубыточная цена</th><th>Остаток рынка, т</th><th>Ограничения</th></tr></thead><tbody>{results.map(({id,result:r})=><tr key={id}><td>{names[id]}</td><td>{fmt(r.tonnes)}</td><td>{fmt(r.profit)} / {fmt(r.profitPerHa)}</td><td>{fmt(r.breakEvenPrice)}</td><td>{fmt(r.endingT)}{r.endingT<0?' — баланс несовместим':''}</td><td>{r.status==='scenario'?r.constraints.map(c=>`${c.label}: ${c.ok?'OK':'превышено'}`).join('; '):'Заполните все поля корректно'}</td></tr>)}</tbody></table></div>
    <h3>Контрольные точки</h3><p>До посева: намерения и бюджет → после посева: фактическая площадь → летом: урожайность и качество → при уборке: товарные тонны → хранение до весны {year+1}: ежемесячные продажи, потери и стоимость денег.</p>
    <p>Для продажи после хранения используйте «Экономика хранения» с ценой и длительностью выбранного сценария. В этом расчёте прибыль относится к продаже урожая без последующего хранения.</p>
  </div></div>;
}
