import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { deficitIndex } from '../../shared/balance.js';
export default function Deficit(){
 const {model,updateAssumptions}=useMarket();const [values,setValues]=useState(()=>model.assumptions.balance?.onion||{}),[saved,setSaved]=useState('');
 const fields={D:'Использование (потребление + экспорт + потери), млн т',P:'Товарное производство, млн т',I:'Импорт, млн т',S:'Запасы на начало периода, млн т'};
 const numeric=Object.fromEntries(Object.keys(fields).map(k=>[k,values[k]===''||values[k]==null?NaN:Number(values[k])]));
 const result=deficitIndex(numeric);
 return <div className="panel"><div className="panel-hd"><span className="panel-title">Баланс лука · пользовательский сценарий</span></div><div className="panel-body"><p>Один рынок и маркетинговый год. Начальные запасы прибавляются к производству и импорту. Не смешивайте запасы и поток продаж, не учитывайте потери дважды. Индекс баланса не является прогнозом цены.</p><div className="audit-inputs">{Object.entries(fields).map(([k,label])=><label key={k}>{label}<input type="number" min="0" step="any" value={values[k]??''} onChange={e=>setValues(p=>({...p,[k]:e.target.value}))}/></label>)}<label>Регион и период<input value={values.scope||''} onChange={e=>setValues(p=>({...p,scope:e.target.value}))}/></label><label>Источник / допущение<input value={values.source||''} onChange={e=>setValues(p=>({...p,source:e.target.value}))}/></label></div><p>{result.status==='ok'?`Индекс использования / предложения: ${result.index.toFixed(2)}. Остаток: ${(result.supply-numeric.D).toFixed(2)} млн т.`:result.reason}</p><button disabled={result.status!=='ok'||!values.scope||!values.source} onClick={async()=>setSaved(await updateAssumptions({balance:{onion:{...values,...numeric,asOf:model.today}}})?'Сохранено':'Ошибка')}>Сохранить сценарий</button><p role="status">{saved}</p></div></div>;
}
