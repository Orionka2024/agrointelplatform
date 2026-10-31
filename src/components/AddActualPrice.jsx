import {useEffect,useState} from 'react';
import {useMarket} from '../context/useMarket';
import {USER_PRICE_MARKETS,buildUserPriceCsv} from '../../shared/localBasis.js';
import {isValidUserPriceEntry,loadStoredUserPrices,upsertStoredUserPrice} from '../utils/userPriceStore.js';
let browserSynced=false;
/** The user attests to the price they enter. It is stored as a verified own transaction and used to
 * calibrate the national benchmark immediately and, over time, train the weekly own-price series. */
export default function AddActualPrice({defaultOpen=true}){
  const {model,demo,importData,issueNewForecast}=useMarket();
  const [basis,setBasis]=useState('warehouse'),[price,setPrice]=useState(''),[date,setDate]=useState(model.today),[vat,setVat]=useState('excl');
  const [busy,setBusy]=useState(false),[msg,setMsg]=useState(null);
  useEffect(()=>{
    if(browserSynced||demo)return;
    browserSynced=true;
    const local=loadStoredUserPrices();if(!local.length)return;
    importData('prices',buildUserPriceCsv(local,model.today)).catch(()=>{});
  },[demo,importData,model.today]);
  const durable=model.storeDurable!==false;
  const whWeeks=model.series?.warehouse?.nUsed??0,mskWeeks=model.series?.moscow?.nUsed??0;
  async function submit(e){
    e.preventDefault();setMsg(null);
    const entry={basis,date,price:Number(String(price).replace(',','.')),vat};
    if(!isValidUserPriceEntry(entry)){setMsg({bad:true,text:'Проверьте дату (ГГГГ-ММ-ДД) и положительную цену.'});return;}
    if(date>model.today){setMsg({bad:true,text:'Дата сделки не может быть в будущем.'});return;}
    setBusy(true);
    try{
      const prevWeeks=entry.basis==='warehouse'?whWeeks:mskWeeks;
      upsertStoredUserPrice(entry);
      const r=await importData('prices',buildUserPriceCsv([entry],model.today));
      const rep=r.report||{};
      if(rep.rejected?.length){setMsg({bad:true,text:'Не принято: '+rep.rejected[0].errors.join('; ')});}
      else{
        if(rep.accepted?.length&&!demo&&prevWeeks>=1){try{await issueNewForecast(entry.basis);}catch{/* optional weekly issue */}}
        setMsg({text:rep.accepted?.length?'Фактическая цена сохранена в историю и сразу отображена на панели «Обзор».':'Запись обновлена / уже учтена в расчёте.'});
        setPrice('');
      }
    }catch(err){setMsg({bad:true,text:err.message});}
    finally{setBusy(false);}
  }
  return <details className="add-price" open={defaultOpen}>
   <summary>Добавить фактическую цену на сегодня или за прошлую дату (обучение и калибровка под ваш рынок)</summary>
   <form onSubmit={submit} className="audit-controls">
    <label>Рынок <select value={basis} onChange={ev=>{setBasis(ev.target.value);setVat(USER_PRICE_MARKETS[ev.target.value].vat);}}>{Object.entries(USER_PRICE_MARKETS).map(([k,m])=><option key={k} value={k}>{m.label}</option>)}</select></label>
    <label>Дата сделки <input type="date" value={date} max={model.today} onChange={ev=>setDate(ev.target.value)}/></label>
    <label>Цена, ₽/кг <input type="number" min="0.01" step="0.01" value={price} onChange={ev=>setPrice(ev.target.value)} placeholder="например 16.50"/></label>
    <label>НДС <select value={vat} onChange={ev=>setVat(ev.target.value)}><option value="excl">без НДС</option><option value="incl">с НДС (10%)</option></select></label>
    <button type="submit" disabled={busy||demo}>{busy?'Сохранение…':'Сохранить фактическую цену'}</button>
   </form>
   {demo&&<p className="audit-warning">Переключите кнопку «ДЕМО-РЕЖИМ» вверху экрана в режим «НАБЛЮДЕНИЯ / ДОПУЩЕНИЯ», чтобы вводить реальные цены.</p>}
   {msg&&<p role={msg.bad?'alert':'status'} className={msg.bad?'audit-warning':'basis-banner'}>{msg.text}</p>}
   <p>Запись сохраняется как подтверждённая сделка: она сразу калибрует уровень месячного прогноза РФ под ваш склад/опт и накапливает ваш собственный недельный ряд (сохранено недель: склад — <strong>{whWeeks}</strong>, Москва — <strong>{mskWeeks}</strong>).</p>
   {!durable&&<p className="audit-warning">Сервер запущен без постоянного тома (Vercel): резервная копия введённых цен сохраняется в этом браузере и автоматически синхронизируется при открытии.</p>}
  </details>;
}
