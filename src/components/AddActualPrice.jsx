import {useEffect,useState} from 'react';
import {useMarket} from '../context/useMarket';
import {USER_PRICE_MARKETS,buildUserPriceCsv} from '../../shared/localBasis.js';
const KEY='agro_user_prices';
const isIso=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'');
const valid=e=>e&&USER_PRICE_MARKETS[e.basis]&&isIso(e.date)&&Number(e.price)>0&&['excl','incl'].includes(e.vat);
let browserSynced=false;
function loadLocal(){try{const a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a.filter(valid):[];}catch{return [];}}
function saveLocal(list){try{localStorage.setItem(KEY,JSON.stringify(list));}catch{/* storage unavailable */}}
/** The user attests to the price they enter. It is stored as a verified own transaction and used to
 * calibrate the national benchmark immediately and, over time, train the weekly own-price series. */
export default function AddActualPrice({defaultOpen=true}){
  const {model,demo,importData,issueNewForecast}=useMarket();
  const [basis,setBasis]=useState('warehouse'),[price,setPrice]=useState(''),[date,setDate]=useState(model.today),[vat,setVat]=useState('excl');
  const [busy,setBusy]=useState(false),[msg,setMsg]=useState(null);
  useEffect(()=>{
    if(browserSynced||demo)return;
    browserSynced=true;
    const local=loadLocal();if(!local.length)return;
    importData('prices',buildUserPriceCsv(local,model.today)).catch(()=>{});
  },[demo,importData,model.today]);
  const durable=model.storeDurable!==false;
  const whWeeks=model.series?.warehouse?.nUsed??0,mskWeeks=model.series?.moscow?.nUsed??0;
  async function submit(e){
    e.preventDefault();setMsg(null);
    const entry={basis,date,price:Number(String(price).replace(',','.')),vat};
    if(!valid(entry)){setMsg({bad:true,text:'Проверьте дату (ГГГГ-ММ-ДД) и положительную цену.'});return;}
    if(date>model.today){setMsg({bad:true,text:'Дата сделки не может быть в будущем.'});return;}
    setBusy(true);
    try{
      const prevWeeks=entry.basis==='warehouse'?whWeeks:mskWeeks;
      const r=await importData('prices',buildUserPriceCsv([entry],model.today));
      const rep=r.report||{};
      if(rep.rejected?.length){setMsg({bad:true,text:'Не принято: '+rep.rejected[0].errors.join('; ')});}
      else{
        const list=loadLocal();
        if(!list.some(x=>x.basis===entry.basis&&x.date===entry.date&&x.price===entry.price&&x.vat===entry.vat)){list.push(entry);saveLocal(list);}
        if(rep.accepted?.length&&!demo&&prevWeeks>=1){try{await issueNewForecast(entry.basis);}catch{/* optional weekly issue */}}
        setMsg({text:rep.accepted?.length?'Фактическая цена сохранена в историю и учтена для калибровки прогноза.':'Такая запись уже сохранена — дубликат не добавлен.'});
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
