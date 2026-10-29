import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { warehouseToMoscow } from '../../shared/bridge.js';
const fmt=v=>Number.isFinite(v)?v.toFixed(2):'—';
export default function Forecast({onNavigateToImport}) {
  const {model,demo,basis,setBasis,scenario,setScenario,issueNewForecast,updateAssumptions}=useMarket();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[manual,setManual]=useState('');
  const fc=model.forecasts[basis],rows=fc?.horizons||[];
  const sc=model.scenarios.results.find(s=>s.id===scenario);
  const scenarioRows=model.scenarios.rows?.[basis]?.[scenario]||[];
  async function issue() {setBusy(true);setError('');try{await issueNewForecast(basis);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function saveManual() {
    if(!(Number(manual)>0)) {setError('Введите положительную цену');return;}
    if(await updateAssumptions({manualPrices:{[basis]:{value:Number(manual),vat:'excl',asOf:model.today,note:'Пользовательское допущение'}}})) setManual('');
  }
  return <div className="panel"><div className="panel-hd"><span className="panel-title">Лук · прогноз цены без НДС, ₽/кг</span><span className="badge warn">{demo?'ДЕМО':fc?.status||'Не выпущен'}</span></div><div className="panel-body">
    <div className="audit-controls"><label>Рынок <select value={basis} onChange={e=>setBasis(e.target.value)}><option value="warehouse">Склад Волгоград</option><option value="moscow">Москва с доставкой</option></select></label>
    <button disabled={busy||demo} onClick={issue}>{busy?'Расчёт…':'Выпустить новый прогноз'}</button><button onClick={onNavigateToImport}>Импорт и источники</button></div>
    {error&&<p role="alert">{error}</p>}
    <p>Выпуск: {fc?.issueDate||'—'} · Отсечка: {fc?.inputCutoff||'—'} · Модель: {fc?.modelVersion||'—'}. Даты и цены ниже берутся из сохранённого выпуска без пересчёта масштаба.</p>
    {!!fc?.ageDays&&fc.ageDays>7&&<p className="audit-warning">Выпуск старше недели. Обновите данные и выпустите новый прогноз.</p>}
    {!rows.length&&<p className="audit-warning">Нет подходящего прогноза. Нужны подтверждённые данные; старые выпуски предыдущей методологии исключены. Сезонная кривая не подставляется.</p>}
    {fc?.reasons?.map((r,i)=><p key={i}>{r}</p>)}
    <div className="audit-scroll"><table className="tbl"><thead><tr><th>Горизонт / неделя с</th><th>Прогноз</th><th>80% диапазон</th><th>95% диапазон</th><th>Оценка</th><th>MAE / n</th></tr></thead><tbody>{rows.map(r=>{
      const v=fc.validation?.byHorizon?.[r.h];return <tr key={r.h}><td>W+{r.h} · {r.targetDate}</td><td>{fmt(r.point)}</td><td>{r.interval?`${fmt(r.interval.lo80)}–${fmt(r.interval.hi80)}`:'—'}</td><td>{r.interval?`${fmt(r.interval.lo95)}–${fmt(r.interval.hi95)}`:'—'}</td><td>{r.validated?'Ретроспективная проверка':'Не валидирован'} · {r.modelId}</td><td>{fmt(v?.final?.mae)} / {v?.final?.n??'—'}</td></tr>;})}</tbody></table></div>
    <p>Интервалы основаны на прошлых ошибках и не гарантируют покрытие при смене режима. Вероятности роста/падения пока не откалиброваны.</p>
    <details><summary>Сценарии отдельно от прогноза</summary><select value={scenario} onChange={e=>setScenario(e.target.value)}>{model.scenarios.results.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select><p>{sc?.complete?'Сценарный сдвиг: '+fmt(sc.totalPct)+'%. Не вероятность.':'Нет подтверждённой чувствительности: эффект не оценён.'} Лаг эффекта не оценён.</p><table className="tbl"><tbody>{scenarioRows.filter(r=>[1,4,13,26].includes(r.h)).map(r=><tr key={r.h}><td>{r.targetDate}</td><td>База {fmt(r.point)}</td><td>Сценарий {fmt(r.scenarioPoint)}</td></tr>)}</tbody></table></details>
    <details><summary>Ручная текущая цена (допущение, не сделка)</summary><input aria-label="Ручная цена без НДС" type="number" min="0.01" step="0.1" value={manual} onChange={e=>setManual(e.target.value)}/><button onClick={saveManual}>Сохранить допущение</button><p>Не меняет историю, прогноз или метрики. При наличии наблюдений текущая цена рассчитывается по сделкам.</p></details>
    <details><summary>Мост издержек: склад → Москва</summary><p>Это расчёт доставленной цены, а не второй независимый прогноз.</p><table className="tbl"><tbody>{Object.entries(model.bridge).map(([k,v])=><tr key={k}><td>{k}</td><td><input aria-label={k} type="number" step="0.01" defaultValue={v} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)>=0) updateAssumptions({bridge:{[k]:Number(e.target.value)}});}}/></td></tr>)}</tbody></table><p>Расчётная цена Москвы с НДС: {fmt(warehouseToMoscow(model.prices.warehouse.exVat,model.bridge).moscowInclVat)} ₽/кг.</p></details>
  </div></div>;
}
