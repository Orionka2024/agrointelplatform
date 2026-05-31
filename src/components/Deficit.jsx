import { useState } from 'react';
import { IMPORTERS } from '../data/marketData';

function getDeficitStatus(idx) {
  if (idx < 1)   return { cls: 'up',   badge: 'ИЗБЫТОК',   boxCls: 'buy',  text: 'Избыток предложения — давление на цену вниз.' };
  if (idx < 1.1) return { cls: 'warn', badge: 'БАЛАНС',    boxCls: 'hold', text: 'Рынок сбалансирован — цены стабильны.' };
  if (idx < 1.2) return { cls: 'warn', badge: 'РОСТ ЦЕН',  boxCls: 'hold', text: 'Дефицит формируется — вероятен рост цены.' };
  return           { cls: 'dn',   badge: 'ДЕФИЦИТ',   boxCls: 'sell', text: 'Острый дефицит — ожидайте значительный рост цены.' };
}

function getImportStatus(pressure) {
  if (pressure < 20000) return { badge: 'НИЗКОЕ',      badgeCls: 'up',   boxCls: 'buy',  text: 'Низкое давление — внутренние цены растут.' };
  if (pressure < 40000) return { badge: 'СРЕДНЕЕ',     badgeCls: 'warn', boxCls: 'hold', text: 'Умеренное давление — цены стабильны. Рубль выше 100 усилит давление.' };
  if (pressure < 70000) return { badge: 'ВЫСОКОЕ',     badgeCls: 'dn',   boxCls: 'sell', text: 'Высокое давление — внутренние цены снижаются.' };
  return                  { badge: 'КРИТИЧЕСКОЕ', badgeCls: 'dn',   boxCls: 'sell', text: 'Критическое давление — риск обвала внутренних цен.' };
}

function needleLeft(idx) {
  return Math.min(Math.max(((idx - 0.8) / 0.6) * 100, 0), 100) + '%';
}

export default function Deficit() {
  const [D, setD] = useState(2.4);
  const [P, setP] = useState(1.8);
  const [I, setI] = useState(0.6);
  const [S, setS] = useState(0.7);

  const [vol, setVol] = useState(420);
  const [fx,  setFx]  = useState(88.3);

  const idx = D / (P + I - S);
  const defStatus = getDeficitStatus(idx);

  const pressure = vol * fx;
  const impStatus = getImportStatus(pressure);

  return (
    <div className="row-2">
      {/* Deficit Index */}
      <div className="panel">
        <div className="panel-hd">
          <span className="panel-title">Индекс дефицита</span>
          <code className="inline">D / (P + I − S)</code>
        </div>
        <div className="panel-body">
          <div className="inp-row">
            <span className="inp-label">Спрос D (млн т)</span>
            <input type="range" min="1" max="4" step="0.1" value={D} onChange={e => setD(parseFloat(e.target.value))} />
            <span className="inp-val">{D.toFixed(1)}</span>
          </div>
          <div className="inp-row">
            <span className="inp-label">Производство P (млн т)</span>
            <input type="range" min="0.5" max="4" step="0.1" value={P} onChange={e => setP(parseFloat(e.target.value))} />
            <span className="inp-val">{P.toFixed(1)}</span>
          </div>
          <div className="inp-row">
            <span className="inp-label">Импорт I (млн т)</span>
            <input type="range" min="0" max="1.5" step="0.05" value={I} onChange={e => setI(parseFloat(e.target.value))} />
            <span className="inp-val">{I.toFixed(2)}</span>
          </div>
          <div className="inp-row">
            <span className="inp-label">Остатки S (млн т)</span>
            <input type="range" min="0" max="2" step="0.1" value={S} onChange={e => setS(parseFloat(e.target.value))} />
            <span className="inp-val">{S.toFixed(1)}</span>
          </div>

          <div className="divider" />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
            <div>
              <div className="stat-label" style={{ marginBottom: 4 }}>Deficit Index</div>
              <div className="big-num" style={{ color: `var(--${defStatus.cls === 'dn' ? 'red' : defStatus.cls === 'warn' ? 'amber' : 'green'})` }}>
                {idx.toFixed(2)}
              </div>
            </div>
            <span className={`badge ${defStatus.cls}`} style={{ fontSize: 12 }}>{defStatus.badge}</span>
          </div>

          <div style={{ position: 'relative', paddingBottom: 16 }}>
            <div className="idx-track" style={{ background: 'linear-gradient(to right, #0D7C4A, #B8860B, #C0303A)' }}>
              <div className="idx-needle" style={{ left: needleLeft(idx) }} />
            </div>
            <div className="idx-labels">
              <span>0.8 Избыток</span><span>1.0 Баланс</span><span>1.1 Рост</span><span>1.2+ Дефицит</span>
            </div>
          </div>

          <div className={`signal-box ${defStatus.boxCls}`}>
            <div className={`signal-label ${defStatus.boxCls}`}>Интерпретация</div>
            <div className={`signal-text ${defStatus.boxCls}`} style={{ marginTop: 4 }}>{defStatus.text}</div>
          </div>
        </div>
      </div>

      {/* Import Pressure */}
      <div className="panel">
        <div className="panel-hd">
          <span className="panel-title">Индекс давления импорта</span>
          <code className="inline">Vol × FX</code>
        </div>
        <div className="panel-body">
          <div className="inp-row">
            <span className="inp-label">Объём импорта (тыс. т)</span>
            <input type="range" min="50" max="900" step="10" value={vol} onChange={e => setVol(parseFloat(e.target.value))} />
            <span className="inp-val">{Math.round(vol)}</span>
          </div>
          <div className="inp-row">
            <span className="inp-label">USD/RUB</span>
            <input type="range" min="60" max="130" step="0.5" value={fx} onChange={e => setFx(parseFloat(e.target.value))} />
            <span className="inp-val">{fx.toFixed(1)}</span>
          </div>

          <div className="divider" />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
            <div>
              <div className="stat-label" style={{ marginBottom: 4 }}>Import Pressure Index</div>
              <div className="big-num">{(pressure / 1000).toFixed(1)}B</div>
            </div>
            <span className={`badge ${impStatus.badgeCls}`} style={{ fontSize: 12 }}>{impStatus.badge}</span>
          </div>

          <div className={`signal-box ${impStatus.boxCls}`} style={{ marginBottom: 12 }}>
            <div className={`signal-label ${impStatus.boxCls}`}>Интерпретация</div>
            <div className={`signal-text ${impStatus.boxCls}`} style={{ marginTop: 4 }}>{impStatus.text}</div>
          </div>

          <div className="divider" />

          <table className="tbl">
            <thead>
              <tr>
                <th>Страна</th>
                <th>Доля</th>
                <th>Риск поставок</th>
              </tr>
            </thead>
            <tbody>
              {IMPORTERS.map(imp => (
                <tr key={imp.country}>
                  <td className="fw">{imp.country}</td>
                  <td className="mono">{imp.share}%</td>
                  <td>
                    <span className={`pill ${imp.risk}`}>
                      {imp.risk === 'up' ? 'Низкий' : imp.risk === 'dn' ? 'Высокий' : 'Средний'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
