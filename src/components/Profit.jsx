import { useState } from 'react';
import { CROPS, CROP_DEFAULTS } from '../data/marketData';

function fmt(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M ₽';
  if (a >= 1e3) return s + Math.round(a / 1e3) + 'K ₽';
  return s + a + ' ₽';
}

const NORMS = [
  { id: 'garlic',     yRange: '8–12',  pRange: '135–220', cost: '540', pill: 'up',   profitRange: '1.5–1.9M' },
  { id: 'onion',      yRange: '50–60', pRange: '28–45',   cost: '780', pill: 'up',   profitRange: '650K–1.1M' },
  { id: 'carrot',     yRange: '40–55', pRange: '22–36',   cost: '630', pill: 'up',   profitRange: '450–950K' },
  { id: 'melon',      yRange: '15–25', pRange: '35–65',   cost: '420', pill: 'info', profitRange: '350K–650K' },
  { id: 'watermalon', yRange: '30–50', pRange: '14–28',   cost: '320', pill: 'up',   profitRange: '250K–450K' },
  { id: 'beet',       yRange: '35–50', pRange: '17–28',   cost: '430', pill: 'info', profitRange: '320–640K' },
  { id: 'potato',     yRange: '25–35', pRange: '19–29',   cost: '580', pill: 'info', profitRange: '280–580K' },
  { id: 'cabbage',    yRange: '30–45', pRange: '12–20',   cost: '380', pill: 'warn', profitRange: '80–280K' },
];

function getCropParams(id) {
  try {
    const saved = localStorage.getItem(`farm_params_${id}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        area: parsed.area ?? 10,
        yld: parsed.yld ?? 55,
        price: parsed.price ?? 31,
        cost: parsed.cost ?? 780,
        isSaved: true,
      };
    }
  } catch (e) {
    console.error("Failed to parse saved farm params", e);
  }
  const d = CROP_DEFAULTS[id] || { yield: 55, price: 31, cost: 780 };
  return {
    area: 10,
    yld: d.yield,
    price: d.price,
    cost: d.cost,
    isSaved: false,
  };
}

export default function Profit() {
  const [cropId, setCropId] = useState('onion');
  const [area,   setArea]   = useState(() => getCropParams('onion').area);
  const [yld,    setYld]    = useState(() => getCropParams('onion').yld);
  const [price,  setPrice]  = useState(() => getCropParams('onion').price);
  const [cost,   setCost]   = useState(() => getCropParams('onion').cost);
  const [isSaved, setIsSaved] = useState(() => getCropParams('onion').isSaved);

  function handleCropChange(id) {
    setCropId(id);
    const p = getCropParams(id);
    setArea(p.area);
    setYld(p.yld);
    setPrice(p.price);
    setCost(p.cost);
    setIsSaved(p.isSaved);
  }

  function handleSave() {
    const data = { area, yld, price, cost };
    localStorage.setItem(`farm_params_${cropId}`, JSON.stringify(data));
    setIsSaved(true);
  }

  function handleReset() {
    localStorage.removeItem(`farm_params_${cropId}`);
    const d = CROP_DEFAULTS[cropId] || { yield: 55, price: 31, cost: 780 };
    setArea(10);
    setYld(d.yield);
    setPrice(d.price);
    setCost(d.cost);
    setIsSaved(false);
  }


  const revenue = area * yld * price * 1000;
  const costs   = area * cost * 1000;
  const profit  = revenue - costs;
  const roi     = costs > 0 ? Math.round((profit / costs) * 100) : 0;
  const perHa   = area > 0 ? Math.round(profit / area) : 0;

  return (
    <div className="row-2">
      {/* Calculator */}
      <div className="panel">
        <div className="panel-hd">
          <span className="panel-title">Калькулятор прибыли</span>
          <code className="inline">Profit = (Yield × Price) − Cost</code>
        </div>
        <div className="panel-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10 }}>
            <select 
              value={cropId} 
              onChange={e => handleCropChange(e.target.value)} 
              style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--txt)', fontSize: 13 }}
            >
              {Object.values(CROPS).filter(c => CROP_DEFAULTS[c.id]).map(c => (
                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
              ))}
            </select>
            <span className={`badge ${isSaved ? 'up' : 'warn'}`} style={{ fontSize: 11, padding: '5px 8px', whiteSpace: 'nowrap', textTransform: 'uppercase', fontWeight: 600 }}>
              {isSaved ? '💼 Моё хозяйство' : '📋 Демо-нормы'}
            </span>
          </div>

          <div className="inp-row">
            <span className="inp-label">Площадь (га)</span>
            <input type="range" min="1" max="500" step="1" value={area} onChange={e => setArea(+e.target.value)} />
            <span className="inp-val">{area}</span>
          </div>
          <div className="inp-row">
            <span className="inp-label">Урожайность (т/га)</span>
            <input type="range" min="5" max="80" step="1" value={yld} onChange={e => setYld(+e.target.value)} />
            <span className="inp-val">{yld}</span>
          </div>
          <div className="inp-row">
            <span className="inp-label">Цена продажи (₽/кг)</span>
            <input type="range" min="5" max="200" step="1" value={price} onChange={e => setPrice(+e.target.value)} />
            <span className="inp-val">{price}</span>
          </div>
          <div className="inp-row" style={{ marginBottom: 16 }}>
            <span className="inp-label">Затраты (тыс. ₽/га)</span>
            <input type="range" min="100" max="2000" step="50" value={cost} onChange={e => setCost(+e.target.value)} />
            <span className="inp-val">{cost}</span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <button 
              onClick={handleSave} 
              className="reset-live-btn" 
              style={{ margin: 0, background: 'var(--green-bg)', color: 'var(--green)', border: '1px solid var(--green-border)', borderRadius: 4, height: 32, cursor: 'pointer', fontWeight: 500 }}
            >
              💾 Сохранить параметры хозяйства
            </button>
            {isSaved && (
              <button 
                onClick={handleReset} 
                className="reset-live-btn" 
                style={{ margin: 0, flex: 0.5, border: '1px solid var(--border)', color: 'var(--txt2)', borderRadius: 4, height: 32, cursor: 'pointer' }}
              >
                ↺ Сбросить к демо
              </button>
            )}
          </div>

          <div className="result-panel">
            <div className="result-grid">
              <div>
                <div className="result-lbl">Выручка</div>
                <div className="result-num">{fmt(revenue)}</div>
              </div>
              <div>
                <div className="result-lbl">Затраты</div>
                <div className="result-num cost">{fmt(costs)}</div>
              </div>
              <div>
                <div className="result-lbl">Прибыль</div>
                <div className="result-num profit" style={{ color: profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(profit)}</div>
              </div>
            </div>
            <div className="divider" />
            <div className="col-pair">
              <div>
                <div className="result-lbl">Рентабельность</div>
                <div className="result-num profit" style={{ color: roi >= 0 ? 'var(--green)' : 'var(--red)' }}>{roi}%</div>
              </div>
              <div>
                <div className="result-lbl">Прибыль / га</div>
                <div className="result-num profit" style={{ color: perHa >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(perHa)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Norms table */}
      <div className="panel">
        <div className="panel-hd"><span className="panel-title">Нормативы по культурам</span></div>
        <div className="panel-body" style={{ padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th className="pl">Культура</th>
                <th>Урожай т/га</th>
                <th>Цена ₽/кг</th>
                <th>Затраты К₽</th>
                <th>Прибыль/га</th>
              </tr>
            </thead>
            <tbody>
              {NORMS.map(n => {
                const c = CROPS[n.id];
                return (
                  <tr key={n.id}>
                    <td className="pl fw">{c.emoji} {c.label}</td>
                    <td className="mono">{n.yRange}</td>
                    <td className="mono">{n.pRange}</td>
                    <td className="mono">{n.cost}</td>
                    <td><span className={`pill ${n.pill}`}>{n.profitRange}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
          <div className="signal-box info">
            <div className="signal-label info">Модель прогноза урожая</div>
            <div className="signal-text info" style={{ marginTop: 4 }}>
              Второй уровень системы. Вход: спутники (NDVI), погода, история региона. Выход: урожайность с точностью ±8%. Пример: лук 52 т/га ± 8%.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
