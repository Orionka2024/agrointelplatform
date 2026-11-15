import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { CROP_PROFILES } from '../../shared/cropProfiles.js';
import { warehouseToMoscow } from '../../shared/bridge.js';

export default function Topbar() {
  const {
    model,
    user,
    requestMagicLink,
    verifyMagicLink,
    logout,
    signals,
    signalsBusy,
    demo,
    setDemo,
    refresh,
    loading,
    today,
  } = useMarket();
  const [authOpen, setAuthOpen] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [issuedToken, setIssuedToken] = useState('');
  const [authStatus, setAuthStatus] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const whPrice = model.prices.warehouse;
  const mskPrice = model.prices.moscow;
  const usd = signals?.fx?.usdRub?.value ?? model.macro.usdRub?.value;
  const usdLive = signals?.fx?.status === 'live' || model.macro.usdRub?.provenance?.status === 'live';
  const kzt = signals?.fx?.kztRub?.value ?? model.macro.kztRub?.value;
  const uzs10k = signals?.fx?.uzsPer10k?.value;
  const keyRate = model.macro.keyRate?.value ?? signals?.fx?.keyRate?.value;
  const spotDeal = signals?.analytics?.impliedDealSpotExVat;
  const kzParity = signals?.analytics?.parity?.kzLandedVolgogradExVat;

  const hasWhActual = whPrice.exVat !== null && whPrice.exVat !== undefined;
  const effWh = hasWhActual ? whPrice.exVat : CROP_PROFILES.onion.benchmarkWarehousePrice;
  const hasMskActual = mskPrice.inclVat !== null && mskPrice.inclVat !== undefined;
  const effMsk = hasMskActual
    ? mskPrice.inclVat
    : warehouseToMoscow(effWh, model.bridge)?.moscowInclVat ?? CROP_PROFILES.onion.benchmarkMoscowPrice;

  const dateStr = model.today || today;
  const formattedDate = (() => {
    if (!dateStr) return '';
    const parts = String(dateStr).split('-');
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
    return dateStr;
  })();

  const isBusy = loading || signalsBusy;

  async function handleRequestMagicLink(e) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthStatus('');
    try {
      const res = await requestMagicLink(emailInput);
      if (res.magicLinkToken) {
        setIssuedToken(res.magicLinkToken);
        await verifyMagicLink(res.magicLinkToken);
        setAuthOpen(false);
        setEmailInput('');
        setIssuedToken('');
      } else {
        setAuthStatus(res.message || 'Ссылка отправлена на почту');
      }
    } catch (err) {
      setAuthStatus(err.message);
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <div className="topbar" style={{ position: 'relative' }}>
      <div className="logo-mark">AGROINTEL</div>

      <div className="ticker-strip">
        <div
          className="ticker-item"
          title={
            hasWhActual
              ? `Подтверждённая цена склада (Волгоград EXW без НДС): ${whPrice.provenance.status}`
              : 'Региональный ориентир ЮФО/Волгоград (EXW без НДС, калиброван к Росстату)'
          }
        >
          <span className="ticker-name">ЛУК (СКЛАД EXW):</span>
          <span className="ticker-price" style={{ color: 'var(--blue)', fontWeight: 600 }}>
            {effWh.toFixed(1)} ₽
          </span>
          <span className={`badge ${hasWhActual ? 'up' : 'info'}`} style={{ fontSize: 9, padding: '1px 4px' }}>
            {hasWhActual ? whPrice.provenance.status : 'ориентир ЮФО'}
          </span>
        </div>

        {spotDeal && (
          <div
            className="ticker-item"
            title="Расчётный спот Волгограда по живым офертам AgroRU / AgroServer / Авито (5+ см, без НДС, за вычетом торга 0.25 ₽)"
          >
            <span className="ticker-name">СПОТ ДОСКИ:</span>
            <span className="ticker-price">{spotDeal.toFixed(1)} ₽</span>
            <span
              className={`ticker-chg ${signals?.mode === 'live_hybrid' ? 'up' : 'neu'}`}
            >
              {signals?.mode === 'live_hybrid' ? `LIVE (${signals.liveFeedsConnected})` : 'сверка'}
            </span>
          </div>
        )}

        <div
          className="ticker-item"
          title={
            hasMskActual
              ? `Опт Москва с НДС: ${mskPrice.provenance.status}`
              : 'Расчётная оптовая цена Москвы по мосту издержек (с НДС 10%)'
          }
        >
          <span className="ticker-name">МОСКВА (ОПТ):</span>
          <span className="ticker-price">{effMsk.toFixed(1)} ₽</span>
        </div>

        {kzParity && (
          <div
            className="ticker-item"
            title="Импортный паритет лука из Жамбылской обл. Казахстана с доставкой до ЮФО (без НДС)"
          >
            <span className="ticker-name">ПАРИТЕТ КЗ:</span>
            <span className={`ticker-price ${kzParity <= effWh ? 'dn' : 'up'}`}>
              {kzParity.toFixed(1)} ₽
            </span>
          </div>
        )}

        <div className="ticker-item" title="Курс доллара ЦБ РФ">
          <span className="ticker-name">USD:</span>
          <span className="ticker-price">{usd ? usd.toFixed(2) : '—'}</span>
          <span className={`ticker-chg ${usdLive ? 'up' : 'neu'}`}>
            {usdLive ? 'live' : 'арх.'}
          </span>
        </div>

        <div className="ticker-item" title="Курс тенге (1 KZT) и узбекского сума (10 000 UZS) ЦБ РФ">
          <span className="ticker-name">KZT / 10K UZS:</span>
          <span className="ticker-price">
            {kzt ? kzt.toFixed(3) : '—'}{uzs10k ? ` / ${uzs10k.toFixed(1)}` : ''}
          </span>
        </div>

        <div className="ticker-item" title="Ключевая ставка Банка России">
          <span className="ticker-name">СТАВКА ЦБ:</span>
          <span className="ticker-price">{keyRate ? `${keyRate.toFixed(1)}%` : '—'}</span>
        </div>
      </div>

      <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {formattedDate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 2 }}>
            <div className="live-dot" />
            <span className="live-label">LIVE · {formattedDate}</span>
          </div>
        )}

        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="badge up" style={{ fontSize: 10 }} title={`Изолированный профиль КФХ: ${user.email}`}>
              👤 {user.email}
            </span>
            <button
              type="button"
              onClick={logout}
              className="cash-reset-btn"
              style={{ fontSize: 10, padding: '2px 6px' }}
            >
              Выйти
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAuthOpen(!authOpen)}
            className="cash-reset-btn"
            style={{ fontSize: 11, padding: '3px 8px' }}
            title="Персональный вход по одноразовой ссылке (изоляция ваших сделок и настроек КФХ)"
          >
            🔑 Войти (КФХ)
          </button>
        )}

        <button
          type="button"
          onClick={() => setDemo(!demo)}
          className={`basis-btn ${demo ? 'active warn' : 'active'}`}
          style={{
            fontSize: 11,
            padding: '3px 9px',
            border: demo ? '1px solid var(--amber-border)' : '1px solid var(--blue-border)',
            background: demo ? 'var(--amber-bg)' : 'var(--blue-bg)',
            color: demo ? 'var(--amber)' : 'var(--blue)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
          title={
            demo
              ? 'Активен демонстрационный режим. Нажмите для перехода к реальным данным Росстата / ЦБ РФ и вашим сделкам.'
              : 'Режим реальных данных (Росстат + ЦБ РФ + скан спот-рынка + ваши сделки).'
          }
        >
          {demo ? '🟡 ДЕМО-РЕЖИМ' : '🟢 РЕАЛЬНЫЕ ДАННЫЕ'}
        </button>

        <button
          type="button"
          onClick={refresh}
          disabled={isBusy}
          className="cash-reset-btn"
          style={{ fontSize: 11, padding: '3px 8px' }}
          title="Сканировать площадки (AgroRU, Food Star, ЦБ РФ, погода 4 хабов) и обновить модель"
        >
          {isBusy ? 'Скан…' : '📡 Скан'}
        </button>
      </div>

      {authOpen && !user && (
        <form
          onSubmit={handleRequestMagicLink}
          style={{
            position: 'absolute',
            top: '100%',
            right: 12,
            zIndex: 100,
            background: 'var(--bg1, #fff)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 280,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600 }}>Вход по одноразовой ссылке (Magic Link)</div>
          <div style={{ fontSize: 11, color: 'var(--txt2)' }}>
            Ваши сделки, параметры хранения и профиль хозяйства хранятся изолированно под вашим аккаунтом.
          </div>
          <input
            type="email"
            required
            placeholder="farmer@kfh-volgograd.ru"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            style={{ padding: '6px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4 }}
          />
          {issuedToken && (
            <input
              type="text"
              value={issuedToken}
              onChange={(e) => setIssuedToken(e.target.value)}
              placeholder="Одноразовый код"
              style={{ padding: '6px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4 }}
            />
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setAuthOpen(false)} className="cash-reset-btn" style={{ fontSize: 11 }}>
              Отмена
            </button>
            <button type="submit" disabled={authBusy} className="basis-btn active" style={{ fontSize: 11 }}>
              {authBusy ? 'Вход…' : 'Получить ссылку и войти'}
            </button>
          </div>
          {authStatus && <div style={{ fontSize: 11, color: 'var(--amber)' }}>{authStatus}</div>}
        </form>
      )}
    </div>
  );
}

