import { useState } from 'react';
import { useMarket } from '../context/useMarket';
const fmt=v=>Number.isFinite(v)?v.toFixed(2):'—';
export default function Dashboard() {
  const {model,refresh,error}=useMarket(); const [macroStatus,setMacroStatus]=useState('');
  async function loadMacro(){setMacroStatus('Загрузка…');try{const r=await fetch('/api/macro');const d=await r.json();if(!r.ok)throw new Error(d.message||'Ошибка');setMacroStatus(d.errors?.join('; ')||'Обновлено');await refresh();}catch(e){setMacroStatus(e.message);}}
  const ev=model.evidence||{};
  return <div className="panel"><div className="panel-hd"><span className="panel-title">Мониторинг рынка лука</span><button onClick={refresh}>Обновить данные</button></div><div className="panel-body">
    {error&&<p role="alert">{error}</p>}
    <p className="audit-warning">Подтверждено пользователем: {ev.pricesVerified??0} из {ev.pricesTotal??0} ценовых записей; {ev.indicatorsVerified??0} из {ev.indicatorsTotal??0} индикаторов. Подтверждение — аттестация источника, не независимая гарантия. Старые прогнозы: {ev.legacyForecasts??0}, исключены из текущей методологии.</p>
    <div className="audit-scroll"><table className="tbl"><thead><tr><th>Рынок / тип</th><th>Последняя неделя</th><th>₽/кг без НДС</th><th>Изменение / предыдущая неделя</th><th>Источники / давность</th></tr></thead><tbody>{model.monitoring?.prices.map(r=><tr key={r.basis+r.kind}><td>{r.basis==='warehouse'?'Склад':'Москва'} / {r.kind}</td><td>{r.latest?.week||'Нет данных'}</td><td>{fmt(r.latest?.value)}</td><td>{fmt(r.changePct)}% / {r.previousWeek||'—'}</td><td>{r.latest?.sources?.join(', ')||'—'} / {r.ageDays??'—'} дн.</td></tr>)}</tbody></table></div>
    <p>{model.monitoring?.note}</p><p>Сделки, заявки покупателей и предложения продавцов не объединяются. Изменение цены — наблюдение, а не вероятность будущего движения.</p>
    <h3>Факторы предложения и спроса</h3>
    {!model.monitoring?.drivers.length&&<p>Нет подтверждённых индикаторов. Импортируйте запасы, отгрузки, качество, поступления и спрос.</p>}
    <table className="tbl"><thead><tr><th>Индикатор / регион</th><th>Значение / изменение</th><th>Дата / источник</th><th>Статус</th></tr></thead><tbody>{model.monitoring?.drivers.map(r=><tr key={r.id}><td>{r.label} · {r.region}</td><td>{fmt(r.value)} {r.unit} / {fmt(r.change)}</td><td>{r.observationDate} · {r.source}</td><td>{r.ageDays>21?'Устарело':'Наблюдение'} · эффект на цену не оценён</td></tr>)}</tbody></table>
    <h3>Наблюдаемые сезонные процессы</h3>{model.seasonal.pressures.length?model.seasonal.pressures.map((r,i)=><p key={i}>{r.label}: {r.reason} · {r.active?'есть свидетельство':'не подтверждено'} · {r.priceImpactNote}</p>):<p>{model.seasonal.note}</p>}
    <h3>Макроэкономика</h3><button onClick={loadMacro}>Запросить данные ЦБ</button><p>{macroStatus}</p><table className="tbl"><tbody>{Object.entries(model.macro).map(([k,v])=><tr key={k}><td>{k}</td><td>{fmt(v.value)}</td><td>{v.provenance.status}</td><td>{v.provenance.asOf||'—'}</td></tr>)}</tbody></table>
    <p>Курсы и ставка отображаются отдельно: коэффициент их влияния на цену лука не задан автоматически.</p>
  </div></div>;
}
