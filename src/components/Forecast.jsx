import { useState } from 'react';
import { CROPS, FORECAST_CONFIDENCE, FEATURE_IMPORTANCE } from '../data/marketData';

const FC_CROPS = Object.keys(CROPS);

function getWeekDateLabel(weeksAhead) {
  const d = new Date();
  d.setDate(d.getDate() + weeksAhead * 7);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }).replace('.', '');
}

export default function Forecast() {
  const [activeCrop, setActiveCrop] = useState('onion');
  const crop = CROPS[activeCrop];
  const fc = crop.forecast;
  const max = Math.max(...fc), min = Math.min(...fc);
  const features = crop.features || FEATURE_IMPORTANCE;
  const trendCls = crop.trendSignal || 'hold';

  return (
    <div className="panel">
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
            <span className="panel-title">26-недельный прогноз · CatBoost (Окт 2026 – Апр 2027)</span>
            <span className="badge info">R² = {(crop.r2 ?? 0.85).toFixed(2)}</span>
          </div>
          <div className="fc-body">
            {fc.map((p, i) => {
              const prev = i === 0 ? crop.price : fc[i - 1];
              const up = p >= prev;
              const span = max - min || 1;
              const pct = Math.max(6, Math.round(((p - min) / span) * 100));
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
              <div className={`signal-label ${trendCls}`}>Тренд модели · {crop.label}</div>
              <div className={`signal-text ${trendCls}`} style={{ marginTop: 4 }}>
                {crop.trendText}
              </div>
            </div>

            <div className="divider" />

            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Модель · CatBoost v2.6 (Октябрь 2026)
              </div>
              <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6 }}>
                Обучена на данных 2018–2026 (включая итоги уборки осени 2026). Признаки: price_lag_1w/2w/4w, storage_stocks, temperature, rainfall, imports, diesel_price, usd_rub, ndvi. Переобучение каждые 4 недели.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

