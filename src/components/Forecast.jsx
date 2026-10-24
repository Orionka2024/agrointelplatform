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
  const isStorage = priceBasis === 'storage';
  const isField = priceBasis === 'field';
  const isWholesale = priceBasis === 'wholesale';

  const currentCashStart = cashPrices[activeCrop] ?? CASH_DEFAULTS[activeCrop] ?? 15.0;
  const baseWholesale = crop.price;

  // Compute 26 weeks selling price forecast from storage:
  // W+1 selling price starts strictly at currentCashStart (15.0 ₽ for onion)
  // Weeks W+1..W+26 scale according to the CatBoost wholesale price growth ratio: wp / baseWholesale
  const fc = (isStorage || isField)
    ? crop.forecast.map(wp => +(currentCashStart * (wp / baseWholesale)).toFixed(1))
    : crop.forecast;

  // Storage cost and shrinkage loss models per week
  const storageMetrics = fc.map((p, i) => {
    const months = (i + 1) / 4.33;
    const lossPct = +(Math.min(13.5, 1.5 + months * 1.6)).toFixed(1); // shrinkage + rot
    const opex = +(0.5 + months * 0.35).toFixed(2); // cooling electricity, ventilation, sorting
    const netPerKg = +(p * (1 - lossPct / 100) - opex).toFixed(1);
    const netProfitPerKg = +(netPerKg - currentCashStart).toFixed(1);
    return { lossPct, opex, netPerKg, netProfitPerKg };
  });

  const max = Math.max(...fc), min = Math.min(...fc);
  const features = crop.features || FEATURE_IMPORTANCE;
  const trendCls = crop.trendSignal || 'hold';

  const peakPrice = Math.max(...fc);
  const peakWeekIdx = fc.indexOf(peakPrice);
  const totalGrowthPct = currentCashStart > 0 ? Math.round(((peakPrice - currentCashStart) / currentCashStart) * 100) : 0;

  return (
    <div className="panel">
      {/* Basis switcher header */}
      <div className="basis-switcher-wrap">
        <div className="basis-switcher">
          <button
            type="button"
            className={`basis-btn ${priceBasis === 'storage' ? 'active' : ''}`}
            onClick={() => handleBasisChange('storage')}
          >
            🏬 Из хранилища · Нал ({fc[0]?.toFixed(1)} ₽)
          </button>
          <button
            type="button"
            className={`basis-btn ${priceBasis === 'field' ? 'active' : ''}`}
            onClick={() => handleBasisChange('field')}
          >
            🚜 С поля · Нал ({currentCashStart.toFixed(1)} ₽)
          </button>
          <button
            type="button"
            className={`basis-btn ${priceBasis === 'wholesale' ? 'active' : ''}`}
            onClick={() => handleBasisChange('wholesale')}
          >
            🏢 Опт Москва · с НДС ({baseWholesale.toFixed(1)} ₽)
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge neu" style={{ fontSize: 11 }}>
            {isStorage
              ? 'Базис: Со склада / Овощехранилище (Волгоград, нал без НДС)'
              : isField
              ? 'Базис: С поля / ex-farm (сырец, нал без НДС)'
              : 'Базис: Опт Москва (РЦ / Овощебазы, с НДС)'}
          </span>
          <span className="badge info">CatBoost v2.6</span>
        </div>
      </div>

      {/* Storage and Cash Control Card */}
      {(isStorage || isField) && (
        <div className="cash-control-card">
          <div className="cash-control-left">
            <span className="cash-control-label">
              Текущая цена продажи со склада ({crop.label}, нал без НДС):
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
              <span className="spread-label">Текущая отгрузка со склада W+1</span>
              <span className="spread-val up">{fc[0]?.toFixed(1)} ₽/кг</span>
            </div>
            <div className="spread-divider">→</div>
            <div className="spread-item">
              <span className="spread-label">Пик цены со склада (W+{peakWeekIdx + 1})</span>
              <span className="spread-val up">{peakPrice.toFixed(1)} ₽/кг (+{totalGrowthPct}%)</span>
            </div>
            <div className="spread-divider">|</div>
            <div className="spread-item">
              <span className="spread-label">Оптовый спред к Москве W+1</span>
              <span className="spread-val warn">+{(baseWholesale - currentCashStart).toFixed(1)} ₽</span>
            </div>
            <div className="spread-divider">|</div>
            <div className="spread-item">
              <span className="spread-label">Окно пиковых цен</span>
              <span className="spread-val up">W+19 – W+22 (Март)</span>
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
              26-недельный прогноз · {isStorage ? 'Отгрузка из хранилища (нал)' : isField ? 'С поля (нал)' : 'Опт Москва (с НДС)'}
            </span>
            <span className="badge info">R² = {(crop.r2 ?? 0.85).toFixed(2)}</span>
          </div>
          <div className="fc-body">
            {fc.map((p, i) => {
              const prev = i === 0 ? p : fc[i - 1];
              const up = p >= prev;
              const span = max - min || 1;
              const pct = Math.max(6, Math.round(((p - min) / span) * 100));
              const mskPrice = crop.forecast[i];
              const metrics = storageMetrics[i];
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
                  {isStorage && (
                    <span className="storage-net-tag" title={`Чистая выручка за вычетом потерь (${metrics.lossPct}%) и OPEX (${metrics.opex} ₽/кг)`}>
                      Чистыми: {metrics.netPerKg} ₽
                    </span>
                  )}
                  {!isWholesale && (
                    <span className="fc-compare-tag" title="Справочно: оптовая цена в Москве (с НДС)">
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
                Тренд модели · {crop.label} {isStorage ? '(Отгрузка из хранилища)' : isField ? '(С поля)' : ''}
              </div>
              <div className={`signal-text ${trendCls}`} style={{ marginTop: 4 }}>
                {isStorage ? (
                  <>
                    При текущей цене продажи со склада <strong>{currentCashStart.toFixed(1)} ₽/кг</strong> (нал без НДС в октябре) модель CatBoost прогнозирует сезонный рост отгрузок до <strong>{peakPrice.toFixed(1)} ₽/кг (+{totalGrowthPct}%)</strong> к концу марта (W+22). {crop.trendText}
                  </>
                ) : isField ? (
                  <>
                    При текущей цене продажи <strong>{currentCashStart.toFixed(1)} ₽/кг</strong> нал с поля в Волгоградской обл. ожидается рост до <strong>{peakPrice.toFixed(1)} ₽/кг</strong> к весне. {crop.trendText}
                  </>
                ) : (
                  crop.trendText
                )}
              </div>
            </div>

            <div className="divider" />

            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Модель · CatBoost v2.6 ({isStorage ? 'Хранилище / Нал' : isField ? 'С поля / Нал' : 'Опт Москва'})
              </div>
              <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6 }}>
                {isStorage
                  ? 'Модель прогноза из хранилища учитывает кондиционную товарную премию (+1.5 ₽/кг на сушку и калибровку), динамику цен отгрузки со склада на юге РФ (без НДС), накопленную усушку (3–4%), естественную гниль/отход (6–8%) и затраты на электроэнергию холодильников.'
                  : isField
                  ? 'Прогноз сырца с поля масштабирует премию сезонного хранения к фактической стартовой цене без учета складской предпродажной подготовки.'
                  : 'Обучена на данных 2018–2026 (включая итоги уборки осени 2026). Признаки: price_lag_1w/2w/4w, storage_stocks, temperature, rainfall, imports, diesel_price, usd_rub, ndvi. Переобучение каждые 4 недели.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



