import { officialHistory, officialSnapshot } from '../../shared/officialData.js';
import { useMarket } from '../context/useMarket';

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');

export default function OfficialSummary() {
  const { model } = useMarket();
  const s = officialSnapshot(model.today);
  const drv = s.drivers;

  return (
    <section className="official-summary" aria-label="Официальные данные Росстата, ЦБ РФ и ERA5">
      <div>
        <span className="badge up">РОССТАТ + ЦБ РФ + ERA5 · ЗАГРУЖЕНО</span>
        <h3>Публичная история цен, курсов валют, ставки ЦБ и агрометеорологии подключена</h3>
        <p>
          {s.producerCount} мес. цен производителей · {s.annualCount} годовых средних · {s.retailCount} нед. розницы ·{' '}
          {drv?.count ?? 0} мес. макрофакторов ЦБ РФ (USD/RUB, KZT/RUB, ставка) и погоды ERA5 (Волгоград, Жамбыл КЗ). Сбор: {s.collectedAt}.
        </p>
      </div>
      <div className="official-cards">
        <div>
          <small>РФ · производители · без НДС и доставки</small>
          <strong>{fmt(s.producer?.value)} ₽/кг</strong>
          <span>
            {s.producer?.period ?? 'Нет данных'} · опубликовано {s.producer?.availableDate ?? '—'}
          </span>
        </div>
        <div>
          <small>РФ · розница · цена для потребителя</small>
          <strong>{fmt(s.retail?.value)} ₽/кг</strong>
          <span>
            {s.retail?.date ?? 'Нет данных'} · опубликовано {s.retail?.availableDate ?? '—'}
          </span>
        </div>
        <div>
          <small>ЦБ РФ · курсы и ставка ({drv?.usdRub?.period ?? '—'})</small>
          <strong>
            {fmt(drv?.usdRub?.value, 1)} ₽/$ · {fmt(drv?.kztRub?.value, 3)} ₽/₸ · {fmt(drv?.keyRate?.value, 1)}%
          </strong>
          <span>USD/RUB, KZT/RUB (средн.) и ключевая ставка ЦБ РФ</span>
        </div>
      </div>
      <p>
        Национальная цена производителей не заменяет цену конкретной партии на складе: добавьте вашу текущую цену сделки ниже, чтобы откалибровать уровень прогноза.
      </p>
      <p>
        <a href={officialHistory.sources[0].url} target="_blank" rel="noreferrer">
          Оригинал цен производителей (Росстат)
        </a>{' '}
        ·{' '}
        <a href={officialHistory.sources[1].url} target="_blank" rel="noreferrer">
          Оригинал розничных цен (Росстат)
        </a>{' '}
        ·{' '}
        <a href="https://www.cbr.ru/development/SXML/" target="_blank" rel="noreferrer">
          Ряды Банка России
        </a>
      </p>
    </section>
  );
}
