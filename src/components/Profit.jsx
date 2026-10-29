import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { evaluateStorage, storageAtHorizon, STORAGE_LABELS } from '../../shared/storageEconomics.js';
const fmt=v=>Number.isFinite(v)?v.toFixed(2):'—';
export default function Profit(){
  const {model,updateAssumptions}=useMarket();
  const [params,setParams]=useState(()=>({...model.storage.params}));
  const [pNow,setPNow]=useState(()=>model.prices.warehouse.exVat??'');
  const [pFuture,setPFuture]=useState(''),[message,setMessage]=useState('');
  const [share,setShare]=useState(50);
  const r=evaluateStorage(Number(pNow),Number(pFuture),params);
  const future=model.forecasts.warehouse?.horizons||[];
  return <div className="panel"><div className="panel-hd"><span className="panel-title">Продать сейчас / хранить / продать частями</span><span className="badge warn">Допущения затрат</span></div><div className="panel-body">
    <p>Лук, склад Волгоград, без НДС. Расчёт на 1 кг исходного остатка. Потери задаются за выбранный срок; для других сроков применяется постоянная месячная интенсивность потерь — допущение, проверяйте по своим партиям.</p>
    <div className="audit-inputs"><label>Продажа сейчас, ₽/кг<input type="number" min="0" value={pNow} onChange={e=>setPNow(e.target.value)}/></label><label>Будущая цена, ₽/кг (сценарий)<input type="number" min="0" value={pFuture} onChange={e=>setPFuture(e.target.value)}/></label>{Object.entries(STORAGE_LABELS).map(([k,label])=><label key={k}>{label}<input type="number" min="0" step="any" value={params[k]??''} onChange={e=>setParams(p=>({...p,[k]:e.target.value}))}/></label>)}</div>
    <button onClick={async()=>setMessage(await updateAssumptions({storage:params})?'Допущения сохранены':'Ошибка сохранения')}>Сохранить затраты</button><span role="status"> {message}</span>
    <p>Статус: {r.status}. Продать сейчас: {fmt(r.netNowPerKgStored)}; продать позже: {fmt(r.netLaterPerKgStored)}; разница: {fmt(r.gain)} ₽/кг. Безубыточная будущая цена: {fmt(r.breakEvenFuturePrice)} ₽/кг.</p>
    <label>Доля продажи сейчас, % <input type="number" min="0" max="100" value={share} onChange={e=>setShare(Math.min(100,Math.max(0,Number(e.target.value))))}/></label>
    <p>Чистые поступления смешанного плана: {r.status==='ok'?fmt(share/100*r.netNowPerKgStored+(1-share/100)*r.netLaterPerKgStored):'—'} ₽ на кг исходного остатка. Общие постоянные затраты здесь не моделируются; линейное распределение подходит только для переменных затрат.</p>
    <h3>Сохранённый прогноз и чувствительность</h3><p>Расчёт ниже использует будущие целевые даты и сегодняшний остаток. Прошедшие недели не включаются. Будущая цена выше — не обязательно более выгодная продажа.</p>
    <table className="tbl"><thead><tr><th>Продать</th><th>Цена</th><th>Безубыточность</th><th>Выигрыш</th><th>При нижней / верхней 80% цене</th></tr></thead><tbody>{future.filter(x=>x.targetDate>model.today&&[1,4,8,13,26].includes(x.h)).map(x=>{
      const p=storageAtHorizon(params,(Date.parse(x.targetDate)-Date.parse(model.today))/86400000/30.4375);
      const a=evaluateStorage(Number(pNow),x.point,p),lo=evaluateStorage(Number(pNow),x.interval?.lo80,p),hi=evaluateStorage(Number(pNow),x.interval?.hi80,p);
      return <tr key={x.h}><td>{x.targetDate}</td><td>{fmt(x.point)}</td><td>{fmt(a.breakEvenFuturePrice)}</td><td>{fmt(a.gain)}</td><td>{fmt(lo.gain)} / {fmt(hi.gain)}</td></tr>;
    })}</tbody></table>
    <p>Это чувствительность к цене при фиксированных затратах и потерях, не интервал общей прибыли. Вероятность убытка не оценена.</p>
  </div></div>;
}
