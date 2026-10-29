import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { PRICE_CSV_TEMPLATE } from '../../shared/observations.js';
import { ANNUAL_TEMPLATE } from '../../shared/planning.js';
import { SOURCES } from '../../shared/sources.js';
const INDICATOR_TEMPLATE='observation_date,retrieved_date,published_date,indicator,value,unit,region,storage_type,crop_year,cause,source,source_ref,notes,verification_status,verified_by,verified_at\n';
export default function DataImport(){
  const {importData,model}=useMarket();const [type,setType]=useState('prices'),[text,setText]=useState(''),[busy,setBusy]=useState(false),[report,setReport]=useState(null),[error,setError]=useState('');
  const template=type==='annual'?ANNUAL_TEMPLATE:type==='indicators'?INDICATOR_TEMPLATE:PRICE_CSV_TEMPLATE.split('\n')[0]+'\n';
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{const r=await importData(type,text);setReport(r.report);}catch(e){setError(e.message);}finally{setBusy(false);}}
  function download(){const u=URL.createObjectURL(new Blob([template],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=type+'-template.csv';a.click();URL.revokeObjectURL(u);}
  return <div className="panel"><div className="panel-hd"><span className="panel-title">Источники и импорт подтверждённых данных</span></div><div className="panel-body">
    <p className="audit-warning">Встроенная история не подтверждена первичными документами и исключена из реальных прогнозов. Ручная цена — допущение, а не сделка. Подтверждено {model.evidence?.pricesVerified||0} ценовых записей.</p>
    <p>Для использования записи в реальном ряду нужны verification_status=verified, verified_by, verified_at (YYYY-MM-DD) и source_ref (URL или идентификатор исходного документа). Подтверждайте только проверенные записи. Храните исходные документы отдельно под указанными идентификаторами. Дата публикации обязательна для корректного исторического воспроизведения; без неё используется дата получения.</p>
    <form onSubmit={submit}><div className="audit-controls"><select aria-label="Тип импорта" value={type} onChange={e=>{setType(e.target.value);setReport(null);}}><option value="prices">Цены: сделки / bids / asks / индексы</option><option value="indicators">Рыночные индикаторы</option><option value="annual">Годовые данные для цикла</option></select><button type="button" onClick={download}>Скачать шаблон</button><input aria-label="CSV файл" type="file" accept=".csv,text/csv" onChange={async e=>{const f=e.target.files[0];if(f){if(f.size>2_000_000){setError('Лимит 2 MB');return;}setText(await f.text());}}}/></div>
    <textarea aria-label="CSV данные" rows="12" style={{width:'100%',fontFamily:'monospace'}} value={text} onChange={e=>setText(e.target.value)} placeholder={template}/><button disabled={busy||!text.trim()}>{busy?'Проверка…':'Проверить и импортировать'}</button></form>
    {error&&<p role="alert">{error}</p>}{report&&<div role="status"><p>Принято: {report.accepted.length}; отклонено: {report.rejected.length}; дубликаты: {report.duplicates.length}. Подтверждение записи не означает автоматическую валидацию прогноза.</p><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify({errors:report.fileErrors,rejected:report.rejected,conflicts:report.conflicts},null,2)}</pre></div>}
    <p>Годовой импорт: crop=onion; CPI должен иметь одну базу для всех лет. area_ha — га, yield_t_ha — т/га; cost_rub_ha — ₽/га; price_rub_kg — цена одного сопоставимого рынка/сезона без НДС. Не смешивайте розницу, опт и склад.</p>
    <h3>Реестр источников</h3><div className="audit-scroll"><table className="tbl"><thead><tr><th>Источник</th><th>Данные</th><th>Доступ / частота</th><th>Ограничение</th></tr></thead><tbody>{SOURCES.map(s=><tr key={s.name}><td>{s.url?<a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>:s.name}</td><td>{s.data}</td><td>{s.access}<br/>{s.cadence}</td><td>{s.limit}</td></tr>)}</tbody></table></div>
  </div></div>;
}
