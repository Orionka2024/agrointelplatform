import { useState } from 'react';
import { CROPS, FORECAST_CONFIDENCE, FEATURE_IMPORTANCE, CASH_DEFAULTS } from '../data/marketData';

const FC_CROPS = Object.keys(CROPS);

function getWeekDateLabel(weeksAhead) {
  const d = new Date();
  d.setDate(d.getDate() + weeksAhead * 7);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }).replace('.', '');
}

export default function Forecast({ initialBasis = 'wholesale', onSwitchBasis }) {
  const [activeCrop, setActiveCrop] = useState('onion');
  const [priceBasis, setPriceBasis] = useState(initialBasis);
  const [cashPrices, setCashPrices] = useState(CASH_DEFAULTS);

  function handleBasisChange(basis) {
    setPriceBasis(basis);
    if (onSwitchBasis) onSwitchBasis(basis);
  }

  function handleCashPriceChange(val) {
    const num = isNaN(val) ? 0 : val;
    setCashPrices(prev => ({ ...prev, [activeCrop]: num }));
  }

  const crop = CROPS[activeCrop];
  const isCash = priceBasis === 'cash';
  const currentCashStart = cashPrices[activeCrop] ?? CASH_DEFAULTS[activeCrop] ?? 15.0;
  const baseWholesale = crop.price;

  // If cash mode, compute 26 weeks as: currentCashStart * (wholesale_week / baseWholesale)
  const fc = isCash
    ? crop.forecast.map(wp => +(currentCashStart * (wp / baseWholesale)).toFixed(1))
    : crop.forecast;

  const max = Math.max(...fc), min = Math.min(...fc);
  const features = crop.features || FEATURE_IMPORTANCE;
  const trendCls = crop.trendSignal || 'hold';

  // Spread metrics for cash mode
  const spreadRub = +(baseWholesale - currentCashStart).toFixed(1);
  const spreadPct = currentCashStart > 0 ? Math.round((spreadRub / currentCashStart) * 100) : 0;
  const peakCashPrice = isCash ? Math.max(...fc) : Math.max(...crop.forecast);
  const totalGrowthPct = currentCashStart > 0
    ? Math.round(((peakCashPrice - currentCashStart) / currentCashStart) * 100)
    : 0;

  return (
    <div className="panel">
      {/* Basis switcher header */}
      <div className="basis-switcher-wrap">
        <div className="basis-switcher">
          <button
            type="button"
            className={`basis-btn ${priceBasis === 'wholesale' ? 'active' : ''}`}
            onClick={() => handleBasisChange('wholesale')}
          >
            🏢 Опт Москва · с НДС (Безнал)
          </button>
          <button
            type="button"
            className={`basis-btn ${priceBasis === 'cash' ? 'active' : ''}`}
            onClick={() => handleBasisChange('cash')}
          >
            🚜 С поля / Волгоград · Нал без НДС ({currentCashStart.toFixed(1)} ₽)
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge neu" style={{ fontSize: 11 }}>
            {isCash ? 'Базис: С поля (ex-farm, нал)' : 'Базис: Опт Москва (с НДС, безнал)'}
          </span>
          <span className="badge info">CatBoost v2.6</span>
        </div>
      </div>

      {/* Cash interactive control bar */}
      {isCash && (
        <div className="cash-control-card">
          <div className="cash-control-left">
            <span className="cash-control-label">
              Стартовая цена с поля ({crop.label}, нал без НДС):
            </span>
            <div className="cash-input-row">
              <div className="cash-inp-wrap">
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="1000"
                  value={currentCashStart}
                  onChange={e => handleCashPriceChange(parseFloat(e.target.value))}
                  className="cash-inp"
                />
                <span className="cash-inp-unit">₽/кг</span>
              </div>
              {currentCashStart !== CASH_DEFAULTS[activeCrop] && (
                <button
                  type="button"
                  className="cash-reset-btn"
                  onClick={() => handleCashPriceChange(CASH_DEFAULTS[activeCrop])}
                >
                  ↺ Сбросить ({CASH_DEFAULTS[activeCrop]} ₽)
                </button>
              )}
            </div>
          </div>

          <div className="cash-spread-metrics">
            <div className="spread-item">
              <span className="spread-label">С поля (Нал)</span>
              <span className="spread-val up">{currentCashStart.toFixed(1)} ₽</span>
            </div>
            <div className="spread-divider">→</div>
            <div className="spread-item">
              <span className="spread-label">Опт Москва</span>
              <span className="spread-val">{baseWholesale.toFixed(1)} ₽</span>
            </div>
            <div className="spread-divider">=</div>
            <div className="spread-item">
              <span className="spread-label">Оптовый спред (логистика/НДС/маржа)</span>
              <span className="spread-val warn">+{spreadRub} ₽ ({spreadPct > 0 ? `+${spreadPct}%` : `${spreadPct}%`})</span>
            </div>
            <div className="spread-divider">|</div>
            <div className="spread-item">
              <span className="spread-label">Пик с поля к весне</span>
              <span className="spread-val up">{peakCashPrice.toFixed(1)} ₽ (+{totalGrowthPct}%)</span>
            </div>
          </div>
        </div>
      )}

      {/* Crop tabs */}
      <div className="crop-tabs">
        {FC_CROPS.map(id => (
          <div
            key={id}
            className={`ctab${activeCrop === id ? ' active' : ''}`}
            onClick={() => setActiveCrop(id)}
          >
            {CROPS[id].emoji} {CROPS[id].label}
          </div>
        ))}
      </div>

      <div className="fc-split">
        {/* Left: forecast list */}
        <div className="fc-left">
          <div className="fc-section-hd">
            <span className="panel-title">
              26-недельный прогноз {isCash ? 'с поля (нал)' : 'опт Москва'} · (Окт 2026 – Апр 2027)
            </span>
            <span className="badge info">R² = {(crop.r2 ?? 0.85).toFixed(2)}</span>
          </div>
          <div className="fc-body">
            {fc.map((p, i) => {
              const prev = i === 0 ? (isCash ? currentCashStart : crop.price) : fc[i - 1];
              const up = p >= prev;
              const span = max - min || 1;
              const pct = Math.max(6, Math.round(((p - min) / span) * 100));
              const mskPrice = crop.forecast[i];
              return (
                <div className="fc-row" key={i}>
                  <span className="wk" style={{ minWidth: 74 }}>
                    W+{i + 1} <span style={{ color: 'var(--txt2)', opacity: 0.75 }}>({getWeekDateLabel(i + 1)})</span>
                  </span>
                  <div className="bar-wrap">
                    <div className="bar-fill" style={{ width: `${pct}%`, background: up ? 'var(--green)' : 'var(--red)' }} />
                  </div>
                  <span className="fc-price" style={{ color: up ? 'var(--green)' : 'var(--red)' }}>
                    {up ? '▲' : '▼'} {p.toFixed(1)} ₽
                  </span>
                  {isCash && (
                    <span className="fc-compare-tag" title="Котировка опт Москва (с НДС)">
                      (Опт: {mskPrice.toFixed(1)} ₽)
                    </span>
                  )}
                  <span className="fc-conf">{FORECAST_CONFIDENCE[i]}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: feature importance + signals */}
        <div>
          <div className="fc-section-hd">
            <span className="panel-title">Важность факторов · SHAP ({crop.label})</span>
            <span className={`pill ${crop.signal === 'BUY' ? 'up' : crop.signal === 'SELL' ? 'dn' : 'warn'}`}>
              {crop.signal}
            </span>
          </div>
          <div style={{ padding: '12px 14px' }}>
            {features.map(f => (
              <div key={f.label} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: 'var(--txt2)' }}>{f.label}</span>
                  <span style={{ fontFamily: 'var(--mono)' }}>{f.pct}%</span>
                </div>
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${f.pct}%`, background: f.color }} />
                </div>
              </div>
            ))}

            <div className="divider" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div className="signal-box buy">
                <div className="signal-label buy">Вероятность дефицита</div>
                <div className="signal-text buy" style={{ fontFamily: 'var(--mono)', fontSize: 20 }}>
                  {crop.deficitProb ?? 68}%
                </div>
              </div>
              <div className="signal-box sell">
                <div className="signal-label sell">Вероятность обвала</div>
                <div className="signal-text sell" style={{ fontFamily: 'var(--mono)', fontSize: 20 }}>
                  {crop.crashProb ?? 12}%
                </div>
              </div>
            </div>

            <div className={`signal-box ${trendCls}`}>
              <div className={`signal-label ${trendCls}`}>
                Тренд модели · {crop.label} {isCash ? '(С поля, нал)' : ''}
              </div>
              <div className={`signal-text ${trendCls}`} style={{ marginTop: 4 }}>
                {isCash ? (
                  <>
                    При стартовой цене <strong>{currentCashStart.toFixed(1)} ₽/кг</strong> нал с поля в Волгоградской обл. ожидается рост до <strong>{peakCashPrice.toFixed(1)} ₽/кг (+{totalGrowthPct}%)</strong> к концу февраля–марта. {crop.trendText}
                  </>
                ) : (
                  crop.trendText
                )}
              </div>
            </div>

            <div className="divider" />

            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Модель · CatBoost v2.6 ({isCash ? 'С поля / Нал' : 'Опт Москва'})
              </div>
              <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6 }}>
                {isCash
                  ? 'Прогноз с поля рассчитывается на основе тех же 6 макро- и рыночных факторов (остатки в хранилищах, импорт ЕАЭС, валюта, логистический спред). Модель масштабирует премию сезонного хранения к фактической стартовой цене без НДС.'
                  : 'Обучена на данных 2018–2026 (включая итоги уборки осени 2026). Признаки: price_lag_1w/2w/4w, storage_stocks, temperature, rainfall, imports, diesel_price, usd_rub, ndvi. Переобучение каждые 4 недели.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


