import { useState } from 'react';
import { CROPS, CROP_DEFAULTS } from '../data/marketData';

function fmt(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M ₽';
  if (a >= 1e3) return s + Math.round(a / 1e3) + 'K ₽';
  return s + a + ' ₽';
}

const NORMS = [
  { id: 'garlic', yRange: '8–12',  pRange: '120–180', cost: '500',  pill: 'up',   profitRange: '1.5–1.8M' },
  { id: 'onion',  yRange: '50–60', pRange: '25–35',   cost: '700',  pill: 'up',   profitRange: '600K–1M' },
  { id: 'watermalon', yRange: '30–50', pRange: '10–20', cost: '300', pill: 'up', profitRange: '200K–400K' },
  { id: 'melon',  yRange: '15–25', pRange: '30–60',   cost: '400',  pill: 'info', profitRange: '300K–600K' },
  { id: 'carrot', yRange: '40–55', pRange: '20–30',   cost: '600',  pill: 'warn', profitRange: '400–900K' },
  { id: 'potato', yRange: '25–35', pRange: '18–28',   cost: '550',  pill: 'info', profitRange: '250–550K' },
  { id: 'beet',   yRange: '35–50', pRange: '15–22',   cost: '400',  pill: 'info', profitRange: '300–600K' },
];

export default function Profit() {
  const [cropId, setCropId] = useState('onion');
  const [area,   setArea]   = useState(10);
  const [yld,    setYld]    = useState(55);
  const [price,  setPrice]  = useState(28);
  const [cost,   setCost]   = useState(750);

  function handleCropChange(id) {
    setCropId(id);
    const d = CROP_DEFAULTS[id];
    if (d) { setYld(d.yield); setPrice(d.price); setCost(d.cost); }
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
          <div style={{ marginBottom: 12 }}>
            <select value={cropId} onChange={e => handleCropChange(e.target.value)}>
              {Object.values(CROPS).filter(c => CROP_DEFAULTS[c.id]).map(c => (
                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
              ))}
            </select>
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
          <div className="inp-row">
            <span className="inp-label">Затраты (тыс. ₽/га)</span>
            <input type="range" min="100" max="2000" step="50" value={cost} onChange={e => setCost(+e.target.value)} />
            <span className="inp-val">{cost}</span>
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
