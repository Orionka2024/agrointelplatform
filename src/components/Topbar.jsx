import { CROPS, MACRO } from '../data/marketData';
import { useStoragePrices } from '../hooks/useStoragePrices';

const NOW = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const TIME = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export default function Topbar() {
  const { storagePrices, isCustom, hasAnyCustom, resetAll } = useStoragePrices();

  const tickers = [
    ...Object.values(CROPS).map(c => {
      const stor = storagePrices[c.id];
      const custom = isCustom(c.id);
      return {
        name: c.ticker,
        price: `${c.price.toFixed(c.price >= 100 ? 0 : 1)} / ${stor.toFixed(stor >= 100 ? 0 : 1)}скл`,
        change: c.change,
        isCustom: custom,
      };
    }),
    { name: 'USD/RUB', price: MACRO.usdRub.toFixed(2), change: MACRO.usdRubChange },
    { name: 'СТАВКА ЦБ', price: `${MACRO.keyRate.toFixed(2)}%`, change: 0 },
  ];

  return (
    <div className="topbar">
      <div className="logo-mark">AGROINTEL</div>
      <div className="ticker-strip">
        {tickers.map(t => (
          <div className="ticker-item" key={t.name}>
            <span className="ticker-name">{t.name}</span>
            <span className="ticker-price" style={{ color: t.isCustom ? 'var(--blue)' : 'inherit' }}>
              {t.price}
            </span>
            <span className={`ticker-chg ${t.change > 0 ? 'up' : t.change < 0 ? 'dn' : 'neu'}`}>
              {t.change > 0 ? '+' : ''}{t.change !== 0 ? `${t.change}%` : '→'}
            </span>
          </div>
        ))}
      </div>
      <div className="topbar-right">
        {hasAnyCustom && (
          <button
            type="button"
            onClick={resetAll}
            className="cash-reset-btn"
            style={{ fontSize: 10, padding: '2px 7px', background: 'transparent' }}
            title="Сбросить все изменённые вручную цены склада к нормативам"
          >
            ↺ Сбросить склад
          </button>
        )}
        <div className="live-dot" />
        <span className="live-label">LIVE · {NOW} · {TIME}</span>
      </div>
    </div>
  );
}

