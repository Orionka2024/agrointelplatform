import {officialHistory as history} from '../../shared/officialData.js';
const fmt=v=>Number.isFinite(v)?v.toLocaleString('ru-RU',{maximumFractionDigits:2}):'—';
export default function OfficialAnnualEvidence(){
 const prices=history.producer.annual,area=new Map(history.acreage.rows.map(r=>[r.year,r.areaHa]));
 return <section className="official-summary"><h3>История для планирования: официальные данные РФ</h3><p>{prices.length} годовых средних цен производителей, {prices[0].year}–{prices.at(-1).year}. Посевные площади: {history.acreage.rows.length} опубликованных лет, все категории хозяйств.</p>
  <div className="official-history"><table className="tbl"><thead><tr><th>Год</th><th>Средняя цена производителей, ₽/кг без НДС</th><th>К прошлому году, номинально</th><th>Посевная площадь, га</th></tr></thead><tbody>{[...prices].reverse().map(r=>{const prev=prices.find(p=>p.year===r.year-1);return <tr key={r.year}><td>{r.year}</td><td>{fmt(r.value)}</td><td>{prev?fmt(100*(r.value/prev.value-1))+'%':'—'}</td><td>{fmt(area.get(r.year))}</td></tr>;})}</tbody></table></div>
  <p>Цены номинальные, без поправки на инфляцию; это не реальная прибыль. Площадь округлена источником до тысяч гектаров. Категории хозяйств у цен и площадей различаются, поэтому причинный эффект площади на цену не оценён. Пропуски не заполнены.</p>
  <p>Высокие и низкие годы видны в истории, но фиксированный цикл не доказан. Месячные ориентиры до декабря 2027 доступны в прогнозе РФ; точность будущей годовой цены не подтверждена. Затраты вашего хозяйства, товарный выход и запасы не выдумываются.</p>
  <p><a href={history.sources[0].url} target="_blank" rel="noreferrer">Цены: лист 1.1, строка «лук репчатый»</a> · <a href="https://rosstat.gov.ru/storage/mediabank/S_x_2025.pdf" target="_blank" rel="noreferrer">Площади: сборник 2025, таблица 3.3</a></p>
 </section>;
}
