import { useEffect, useState } from 'react';
import { useMarket } from '../context/useMarket';
import { USER_PRICE_MARKETS, buildUserPriceCsv } from '../../shared/localBasis.js';
import { loadStoredUserPrices, upsertStoredUserPrice } from '../utils/userPriceStore.js';
import { enqueuePendingTransaction, validateAttestedTransaction } from '../../shared/offlineQueue.js';

let browserSynced = false;

/**
 * The user attests to the price they enter. It is stored as a verified own transaction and used to
 * calibrate the national benchmark immediately and, over time, train the weekly own-price series.
 */
export default function AddActualPrice({ defaultOpen = true }) {
  const { model, demo, importData, issueNewForecast } = useMarket();
  const [basis, setBasis] = useState('warehouse');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(model.today);
  const [vat, setVat] = useState('excl');

  // Attestation & physical deal parameters (P1-8, F-06, F-11)
  const [lotSizeT, setLotSizeT] = useState('25');
  const [grade, setGrade] = useState('1 сорт (ГОСТ 34306-2017)');
  const [caliber, setCaliber] = useState('5+ см');
  const [packaging, setPackaging] = useState('Сетка 25-30 кг на паллетах');
  const [paymentTerms, setPaymentTerms] = useState('100% предоплата');
  const [buyerType, setBuyerType] = useState('Оптовик (EXW склад)');
  const [attested, setAttested] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (browserSynced || demo) return;
    browserSynced = true;
    const local = loadStoredUserPrices();
    if (!local.length) return;
    importData('prices', buildUserPriceCsv(local, model.today)).catch(() => {});
  }, [demo, importData, model.today]);

  const durable = model.storeDurable !== false;
  const whWeeks = model.series?.warehouse?.nUsed ?? 0;
  const mskWeeks = model.series?.moscow?.nUsed ?? 0;

  async function submit(e) {
    e.preventDefault();
    setMsg(null);

    const numPrice = Number(String(price).replace(',', '.'));
    const numLotSize = Number(String(lotSizeT).replace(',', '.'));

    const txEntry = {
      basis,
      date,
      price: numPrice,
      priceRubKg: numPrice,
      vat,
      lotSizeT: numLotSize,
      grade,
      caliber,
      packaging,
      paymentTerms,
      buyerType,
      attested,
    };

    const val = validateAttestedTransaction(txEntry);
    if (!val.valid) {
      setMsg({ bad: true, text: val.errors.join('; ') });
      return;
    }

    if (date > model.today) {
      setMsg({ bad: true, text: 'Дата сделки не может быть в будущем.' });
      return;
    }

    setBusy(true);

    // If offline, save directly to offline queue
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      try {
        enqueuePendingTransaction(txEntry);
        setMsg({ text: 'Вы работаете офлайн. Сделка сохранена в локальную очередь и синхронизируется при подключении к сети.' });
        setPrice('');
        setAttested(false);
      } catch (err) {
        setMsg({ bad: true, text: err.message });
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      const prevWeeks = basis === 'warehouse' ? whWeeks : mskWeeks;
      upsertStoredUserPrice(txEntry);
      const r = await importData('prices', buildUserPriceCsv([txEntry], model.today));
      const rep = r.report || {};
      if (rep.rejected?.length) {
        setMsg({ bad: true, text: 'Не принято: ' + rep.rejected[0].errors.join('; ') });
      } else {
        if (rep.accepted?.length && !demo && prevWeeks >= 1) {
          try {
            await issueNewForecast(basis);
          } catch {
            /* optional weekly issue */
          }
        }
        setMsg({
          text: rep.accepted?.length
            ? 'Подтверждённая сделка сохранена в историю и откалибровала прогноз.'
            : 'Запись обновлена / уже учтена в расчёте.',
        });
        setPrice('');
        setAttested(false);
      }
    } catch (err) {
      // If network failure occurs during online attempt, fallback to queue
      try {
        enqueuePendingTransaction(txEntry);
        setMsg({ text: `Сбой сети (${err.message}). Сделка сохранена в офлайн-очередь.` });
        setPrice('');
        setAttested(false);
      } catch {
        setMsg({ bad: true, text: err.message });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="add-price" open={defaultOpen}>
      <summary>Внести подтверждённую сделку (аттестация, калибровка базиса под ваш склад)</summary>
      <form onSubmit={submit} className="audit-controls" style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
          <label>
            Базис поставки
            <select
              value={basis}
              onChange={(ev) => {
                setBasis(ev.target.value);
                setVat(USER_PRICE_MARKETS[ev.target.value].vat);
              }}
            >
              {Object.entries(USER_PRICE_MARKETS).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Дата отгрузки (ТТН)
            <input type="date" value={date} max={model.today} onChange={(ev) => setDate(ev.target.value)} />
          </label>
          <label>
            Цена реализации, ₽/кг
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={price}
              onChange={(ev) => setPrice(ev.target.value)}
              placeholder="например 16.50"
            />
          </label>
          <label>
            НДС
            <select value={vat} onChange={(ev) => setVat(ev.target.value)}>
              <option value="excl">без НДС</option>
              <option value="incl">с НДС (10%)</option>
            </select>
          </label>
        </div>

        {/* Extended physical & contract specs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
          <label>
            Объём партии, тонн
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="2000"
              value={lotSizeT}
              onChange={(e) => setLotSizeT(e.target.value)}
              placeholder="25"
            />
          </label>
          <label>
            Сорт / Качество
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="1 сорт (ГОСТ 34306-2017)">1 сорт (ГОСТ 34306-2017)</option>
              <option value="2 сорт">2 сорт (допустимы пятна)</option>
              <option value="Нестандарт / переработка">Нестандарт / на переработку</option>
            </select>
          </label>
          <label>
            Калибр
            <select value={caliber} onChange={(e) => setCaliber(e.target.value)}>
              <option value="5+ см">5+ см (товарный стандарт)</option>
              <option value="4-5 см">4–5 см (мелкий/средний)</option>
              <option value="6+ см">6+ см (крупный премиум)</option>
            </select>
          </label>
          <label>
            Тара / Упаковка
            <select value={packaging} onChange={(e) => setPackaging(e.target.value)}>
              <option value="Сетка 25-30 кг на паллетах">Сетка 25–30 кг на паллетах</option>
              <option value="Биг-бэг (1 т)">Биг-бэг (1 т)</option>
              <option value="Навал в кузов">Навал в кузов</option>
            </select>
          </label>
          <label>
            Условия оплаты
            <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}>
              <option value="100% предоплата">100% предоплата</option>
              <option value="Отсрочка 7-14 дней">Отсрочка 7–14 дней</option>
              <option value="По факту приемки">По факту приемки на РЦ</option>
            </select>
          </label>
          <label>
            Канал сбыта / Покупатель
            <select value={buyerType} onChange={(e) => setBuyerType(e.target.value)}>
              <option value="Оптовик (EXW склад)">Оптовый трейдер (EXW)</option>
              <option value="Федеральная сеть">Федеральная розничная сеть</option>
              <option value="Локальная розница">Местная розница</option>
              <option value="Переработчик">Перерабатывающий завод</option>
            </select>
          </label>
        </div>

        {/* Attestation Checkbox */}
        <div style={{ marginTop: '0.25rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600, color: '#0f172a' }}>
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <span>Подтверждаю фактическое совершение сделки по товарно-транспортным накладным (ТТН / УПД)</span>
          </label>
        </div>

        <button type="submit" disabled={busy || demo || !attested} className="btn-primary" style={{ padding: '8px 16px', fontWeight: 600 }}>
          {busy ? 'Сохранение…' : 'Подтвердить и внести сделку'}
        </button>
      </form>

      {demo && (
        <p className="audit-warning">
          Переключите кнопку «ДЕМО-РЕЖИМ» вверху экрана в режим «НАБЛЮДЕНИЯ / ДОПУЩЕНИЯ», чтобы вводить реальные цены.
        </p>
      )}
      {msg && (
        <p role={msg.bad ? 'alert' : 'status'} className={msg.bad ? 'audit-warning' : 'basis-banner'}>
          {msg.text}
        </p>
      )}
      <p style={{ fontSize: '0.825rem', color: '#64748b' }}>
        Запись сохраняется как подтверждённая сделка: она сразу калибрует уровень месячного прогноза РФ под ваш склад/опт
        и накапливает ваш собственный недельный ряд (сохранено недель: склад — <strong>{whWeeks}</strong>, Москва — <strong>{mskWeeks}</strong>).
      </p>
      {!durable && (
        <p className="audit-warning">
          Сервер запущен без постоянного тома (Vercel): резервная копия введённых цен сохраняется в этом браузере и
          автоматически синхронизируется при открытии.
        </p>
      )}
    </details>
  );
}
