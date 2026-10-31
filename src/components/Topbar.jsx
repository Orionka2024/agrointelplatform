import { useMarket } from '../context/useMarket';
import { CROP_PROFILES } from '../../shared/cropProfiles.js';
import { warehouseToMoscow } from '../../shared/bridge.js';

export default function Topbar() {
  const { model, demo, setDemo, refresh, loading, today } = useMarket();

  const whPrice = model.prices.warehouse;
  const mskPrice = model.prices.moscow;
  const usd = model.macro.usdRub;
  const kzt = model.macro.kztRub;
  const keyRate = model.macro.keyRate;

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

  return (
    <div className="topbar">
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

        <div
          className="ticker-item"
          title={
            hasMskActual
              ? `Опт Москва с НДС: ${mskPrice.provenance.status}`
              : 'Расчётная оптовая цена Москвы по мосту издержек (с НДС 10%)'
          }
        >
          <span className="ticker-name">МОСКВА (ОПТ С НДС):</span>
          <span className="ticker-price">{effMsk.toFixed(1)} ₽</span>
          <span className="badge neu" style={{ fontSize: 9, padding: '1px 4px' }}>
            {hasMskActual ? mskPrice.provenance.status : 'мост издержек'}
          </span>
        </div>

        <div className="ticker-item" title={`Курс доллара ЦБ РФ (${usd.provenance.status})`}>
          <span className="ticker-name">USD/RUB:</span>
          <span className="ticker-price">{usd.value ? usd.value.toFixed(2) : '—'}</span>
          <span className={`ticker-chg ${usd.provenance.status === 'live' ? 'up' : 'neu'}`}>
            {usd.provenance.status}
          </span>
        </div>

        <div className="ticker-item" title={`Курс тенге ЦБ РФ (${kzt?.provenance?.status || 'cached'})`}>
          <span className="ticker-name">KZT/RUB:</span>
          <span className="ticker-price">{kzt?.value ? kzt.value.toFixed(3) : '—'}</span>
        </div>

        <div className="ticker-item" title={`Ключевая ставка Банка России (${keyRate.provenance.status})`}>
          <span className="ticker-name">СТАВКА ЦБ:</span>
          <span className="ticker-price">{keyRate.value ? `${keyRate.value.toFixed(1)}%` : '—'}</span>
        </div>
      </div>

      <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {formattedDate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 2 }}>
            <div className="live-dot" />
            <span className="live-label">LIVE · {formattedDate}</span>
          </div>
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
              : 'Режим реальных данных (Росстат + ЦБ РФ + ваши сделки).'
          }
        >
          {demo ? '🟡 ДЕМО-РЕЖИМ' : '🟢 РЕАЛЬНЫЕ ДАННЫЕ'}
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
