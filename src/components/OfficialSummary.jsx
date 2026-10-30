import {officialHistory,officialSnapshot} from '../../shared/officialData.js';
import {useMarket} from '../context/useMarket';
const fmt=n=>Number.isFinite(n)?n.toFixed(2):'—';
export default function OfficialSummary(){
 const {model}=useMarket();const s=officialSnapshot(model.today);
 const drv=s.drivers;
 return <section className="official-summary" aria-label="Официальные данные Росстата и Банка России">
  <div><span className="badge up">РОССТАТ + ЦБ РФ · ЗАГРУЖЕНО</span><h3>Публичная история цен и макрофакторов уже подключена</h3><p>{s.producerCount} мес. цен производителей · {s.annualCount} годовых средних · {s.retailCount} нед. розницы · {drv?.count??0} мес. макрофакторов ЦБ РФ. Сбор: {s.collectedAt}.</p></div>
  <div className="official-cards">
   <div><small>РФ · производители · без НДС и доставки</small><strong>{fmt(s.producer?.value)} ₽/кг</strong><span>{s.producer?.period??'Нет доступных данных'} · опубликовано {s.producer?.availableDate??'—'}</span></div>
   <div><small>РФ · розница · цена для потребителя</small><strong>{fmt(s.retail?.value)} ₽/кг</strong><span>{s.retail?.date??'Нет доступных данных'} · опубликовано {s.retail?.availableDate??'—'}</span></div>
   <div><small>ЦБ РФ · факторы модели ({drv?.usdRub?.period??'—'})</small><strong>{fmt(drv?.usdRub?.value)} ₽/$ · {fmt(drv?.keyRate?.value)}%</strong><span>USD/RUB (средн.) и ключевая ставка на конец месяца</span></div>
  </div>
  <p>Национальная цена производителей не заменяет цену конкретной партии на складе: добавьте вашу текущую цену сделки ниже, чтобы откалибровать прогноз под ваш уровень.</p>
  <p><a href={officialHistory.sources[0].url} target="_blank" rel="noreferrer">Оригинал цен производителей (Росстат)</a> · <a href={officialHistory.sources[1].url} target="_blank" rel="noreferrer">Оригинал розничных цен (Росстат)</a> · <a href="https://www.cbr.ru/development/SXML/" target="_blank" rel="noreferrer">Ряды Банка России</a></p>
 </section>;
}
