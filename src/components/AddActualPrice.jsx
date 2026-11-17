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
  const { model, demo, setDemo, importData, issueNewForecast, refresh, applySpotPreview } = useMarket();
  const [basis, setBasis] = useState('warehouse');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(model.today);
  const [vat, setVat] = useState('excl');
  const [region, setRegion] = useState('Волгоградская обл.');
  const [deliveryBasis, setDeliveryBasis] = useState('EXW');
  const [sourceType, setSourceType] = useState('transaction');

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
  const verifiedCount = model.evidence?.pricesVerified ?? 0;

  async function submit(e) {
    e.preventDefault();
    setMsg(null);

    const numPrice = Number(String(price).replace(',', '.'));
    const numLotSize = Number(String(lotSizeT).replace(',', '.'));

    if (sourceType === 'listing') {
      if (!Number.isFinite(numPrice) || numPrice < 3 || numPrice > 120) {
        setMsg({ bad: true, text: 'Укажите цену оферты в диапазоне 3–120 ₽/кг.' });
        return;
      }
      applySpotPreview(numPrice, { basis });
      setMsg({
        text: `Предпросмотр объявления (${numPrice.toFixed(2)} ₽/кг · listing, только сессия). В базу подтверждённых сделок не записано.`,
      });
      return;
    }

    const txEntry = {
      basis,
      date,
      price: numPrice,
      priceRubKg: numPrice,
      vat,
      region,
      deliveryBasis,
      sourceType,
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
      if (demo) setDemo(false);
      const prevWeeks = basis === 'warehouse' ? whWeeks : mskWeeks;
      upsertStoredUserPrice(txEntry);
      const r = await importData('prices', buildUserPriceCsv([txEntry], model.today));
      const rep = r.report || {};
      if (rep.rejected?.length) {
        setMsg({ bad: true, text: 'Не принято: ' + rep.rejected[0].errors.join('; ') });
      } else {
        if (rep.accepted?.length && prevWeeks >= 1) {
          try {
            await issueNewForecast(basis);
          } catch {
            /* optional weekly issue */
          }
        }
        await refresh();
        setMsg({
          text: rep.accepted?.length
            ? `Сохранено: подтверждённая сделка ${numPrice.toFixed(2)} ₽/кг (${deliveryBasis}, ${region}) добавлена для обучения и калибровки прогноза.`
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
      <summary>
        Внести фактическую цену сделки (подтверждено в базе: {verifiedCount})
      </summary>
      <form onSubmit={submit} className="audit-controls" style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem' }}>
          <label>
            Рынок / Категория
            <select
              value={basis}
              onChange={(ev) => {
                const nextBasis = ev.target.value;
                setBasis(nextBasis);
                setVat(USER_PRICE_MARKETS[nextBasis].vat);
                setRegion(USER_PRICE_MARKETS[nextBasis].geo);
                setDeliveryBasis(USER_PRICE_MARKETS[nextBasis].delivery);
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
            Тип источника
            <select value={sourceType} onChange={(ev) => setSourceType(ev.target.value)}>
              <option value="transaction">Подтверждённая сделка (ТТН/УПД)</option>
              <option value="listing">Объявление с доски (listing — только предпросмотр)</option>
            </select>
          </label>
          <label>
            Дата сделки
            <input type="date" value={date} max={model.today} onChange={(ev) => setDate(ev.target.value)} />
          </label>
          <label>
            Фактическая цена, ₽/кг (3–120)
            <input
              type="number"
              min="3"
              max="120"
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
          <label>
            Условия поставки
            <select value={deliveryBasis} onChange={(ev) => setDeliveryBasis(ev.target.value)}>
              <option value="EXW">EXW (у хозяйства / склад)</option>
              <option value="DAP">DAP (с доставкой покупателю)</option>
            </select>
          </label>
          <label>
            Регион
            <input type="text" value={region} onChange={(ev) => setRegion(ev.target.value)} placeholder="Волгоградская обл." />
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

        {/* Attestation Checkbox (only for confirmed transactions) */}
        {sourceType === 'transaction' ? (
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
        ) : (
          <p className="audit-warning" style={{ margin: 0 }}>
            Запись с типом «Объявление (listing)» никогда не попадает в подтверждённые сделки и используется только как временный предпросмотр.
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="btn-primary"
          data-testid="save-actual-price-btn"
          style={{ padding: '8px 16px', fontWeight: 600 }}
        >
          {busy
            ? 'Сохранение…'
            : sourceType === 'listing'
              ? '👁 Предпросмотр оферты (не сохраняется в сделки)'
              : '💾 Сохранить фактическую цену'}
        </button>
      </form>

      {demo && (
        <p className="audit-warning">
          Вы в «ДЕМО-РЕЖИМЕ» — при сохранении сделки приложение автоматически переключится в режим реальных наблюдений.
        </p>
      )}
      {msg && (
        <p role={msg.bad ? 'alert' : 'status'} className={msg.bad ? 'audit-warning' : 'basis-banner'}>
          {msg.text}
        </p>
      )}
      <p style={{ fontSize: '0.825rem', color: '#64748b' }}>
        Введённая фактическая цена — это реальная цена сделки на дату, а не прогноз. Она сохраняется для дальнейшего обучения модели
        и сразу калибрует прогноз (сохранено недель: склад — <strong>{whWeeks}</strong>, Москва — <strong>{mskWeeks}</strong>).
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
