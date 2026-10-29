import { useMarket } from '../context/useMarket';

export default function Topbar() {
  const { model, demo, setDemo, refresh, loading, today } = useMarket();

  const whPrice = model.prices.warehouse;
  const mskPrice = model.prices.moscow;
  const usd = model.macro.usdRub;
  const keyRate = model.macro.keyRate;

  const dateStr = model.today || today;
  const formattedDate = (() => {
    if (!dateStr) return '';
    const parts = String(dateStr).split('-');
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
    return dateStr;
  })();

  const fmtPrice = (p) => {
    if (p.exVat !== null && p.exVat !== undefined) {
      return `${p.exVat.toFixed(1)} ₽`;
    }
    return 'нет данных';
  };

  return (
    <div className="topbar">
      <div className="logo-mark">AGROINTEL</div>

      <div className="ticker-strip">
        <div className="ticker-item" title={`Базис: Склад продавца (Волгоградская обл., EXW без НДС). Статус: ${whPrice.provenance.status}`}>
          <span className="ticker-name">ЛУК (СКЛАД EXW):</span>
          <span className="ticker-price" style={{ color: whPrice.exVat ? 'var(--blue)' : 'var(--txt3)' }}>
            {fmtPrice(whPrice)}
          </span>
          <span className="badge info" style={{ fontSize: 9, padding: '1px 4px' }}>
            {whPrice.provenance.status}
          </span>
        </div>

        <div className="ticker-item" title={`Базис: Опт Москва (с доставкой, с НДС). Статус: ${mskPrice.provenance.status}`}>
          <span className="ticker-name">МОСКВА (ОПТ С НДС):</span>
          <span className="ticker-price">
            {mskPrice.inclVat ? `${mskPrice.inclVat.toFixed(1)} ₽` : 'нет данных'}
          </span>
          <span className="badge neu" style={{ fontSize: 9, padding: '1px 4px' }}>
            {mskPrice.provenance.status}
          </span>
        </div>

        <div className="ticker-item" title={`Курс доллара ЦБ РФ. Статус: ${usd.provenance.status}`}>
          <span className="ticker-name">USD/RUB:</span>
          <span className="ticker-price">{usd.value ? usd.value.toFixed(2) : '—'}</span>
          <span className={`ticker-chg ${usd.provenance.status === 'live' ? 'up' : 'neu'}`}>
            {usd.provenance.status}
          </span>
        </div>

        <div className="ticker-item" title={`Ключевая ставка Банка России. Статус: ${keyRate.provenance.status}`}>
          <span className="ticker-name">СТАВКА ЦБ:</span>
          <span className="ticker-price">{keyRate.value ? `${keyRate.value.toFixed(1)}%` : '—'}</span>
          <span className="ticker-chg neu">{keyRate.provenance.status}</span>
        </div>
      </div>

      <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {formattedDate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 2 }}>
            <div className="live-dot" />
            <span className="live-label">LIVE · {formattedDate}</span>
          </div>
        )}

        {/* Mode Toggle Button */}
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
          title={demo ? 'Сейчас активен демонстрационный режим с иллюстративными данными. Нажмите, чтобы переключить на режим реальных наблюдений.' : 'Сейчас активен режим реальных данных. Нажмите, чтобы переключить на демо-режим.'}
        >
          {demo ? '🟡 ДЕМО-РЕЖИМ' : 'НАБЛЮДЕНИЯ / ДОПУЩЕНИЯ'}
        </button>

        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="cash-reset-btn"
          style={{ fontSize: 11, padding: '3px 8px' }}
          title="Обновить рыночные данные"
        >
          {loading ? '...' : '↺'}
        </button>
      </div>
    </div>
  );
}
