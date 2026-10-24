import { useState } from 'react';
import { IMPORTERS, CROPS } from '../data/marketData';
import { useLiveData } from '../hooks/useLiveData';
import DataStatusBadge from './DataStatusBadge';

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
  const { liveData, isLoading, isStale, isOffline, lastUpdated, refresh } = useLiveData();

  const [selectedCrop, setSelectedCrop] = useState('onion');
  const cropData = CROPS[selectedCrop];
  const BASE = cropData.balance;

  // Mode: federal (sliders) vs local (manual numbers)
  const [isManual, setIsManual] = useState(false);

  // Market balance sliders/inputs (manual correction on top of base values)
  const [D, setD] = useState(BASE.D);
  const [P, setP] = useState(BASE.P);
  const [I, setI] = useState(BASE.I);
  const [S, setS] = useState(BASE.S);

  // User farm planning inputs
  const [myHarvest, setMyHarvest] = useState(''); // in tons

  // Import pressure sliders — fx initializes from live CBR data or fallback
  const [vol, setVol] = useState(BASE.vol);
  const [userFx, setUserFx] = useState(null);
  const fx = userFx !== null ? userFx : (liveData.usdRub ?? 94.6);

  // Track if user has manually overridden the live value
  const fxIsLive = userFx === null || Math.abs(fx - (liveData.usdRub ?? fx)) < 0.1;

  function handleCropChange(cropId) {
    setSelectedCrop(cropId);
    const base = CROPS[cropId]?.balance || CROPS.onion.balance;
    setD(base.D);
    setP(base.P);
    setI(base.I);
    setS(base.S);
    setVol(base.vol);
    setMyHarvest('');
  }

  // New factors
  const [weatherRisk, setWeatherRisk] = useState('optimal');
  const [hasSanctions, setHasSanctions] = useState(false);

  const weatherFactor = weatherRisk === 'drought' ? 0.8 : 1.0;
  const restrictionFactor = hasSanctions ? 0.85 : 1.0;

  const idx = D / ((P * weatherFactor) + (I * restrictionFactor) - S);
  const defStatus = getDeficitStatus(idx);

  const pressure = vol * fx;
  const impStatus = getImportStatus(pressure);

  function resetToLive() {
    setUserFx(null);
    setVol(BASE.vol);
    setD(BASE.D);
    setP(BASE.P);
    setI(BASE.I);
    setS(BASE.S);
    setWeatherRisk('optimal');
    setHasSanctions(false);
    setMyHarvest('');
  }


  // Calculate my farm's share of production (P is in million tons, myHarvest is in tons)
  const totalProductionTons = P * 1000000 * weatherFactor;
  const marketSharePct = totalProductionTons > 0 && myHarvest > 0 
    ? (parseFloat(myHarvest) / totalProductionTons) * 100 
    : 0;

  return (
    <div>
      {/* Data status banner */}
      <div style={{ marginBottom: 12 }}>
        <DataStatusBadge
          isLoading={isLoading}
          isOffline={isOffline}
          isStale={isStale}
          lastUpdated={lastUpdated}
          onRefresh={refresh}
        />
      </div>

      <div className="row-2">
        {/* Deficit Index */}
        <div className="panel">
          <div className="panel-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="panel-title">Индекс дефицита</span>
              <code className="inline" style={{ marginLeft: 8 }}>D / (P + I − S)</code>
            </div>
            <select 
              value={selectedCrop} 
              onChange={e => handleCropChange(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--txt)', fontSize: 13 }}
            >
              {Object.values(CROPS).map(c => (
                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </div>
          <div className="panel-body">
            
            {/* Mode switch */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              <button
                onClick={() => setIsManual(false)}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: !isManual ? '1px solid var(--blue-border)' : '1px solid var(--border)',
                  background: !isManual ? 'var(--blue-bg)' : 'transparent',
                  color: !isManual ? 'var(--blue)' : 'var(--txt2)',
                  fontWeight: !isManual ? 600 : 400,
                  cursor: 'pointer',
                  fontSize: 11,
                  transition: 'all 0.15s'
                }}
              >
                📋 Демо (Росстат РФ)
              </button>
              <button
                onClick={() => setIsManual(true)}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: isManual ? '1px solid var(--blue-border)' : '1px solid var(--border)',
                  background: isManual ? 'var(--blue-bg)' : 'transparent',
                  color: isManual ? 'var(--blue)' : 'var(--txt2)',
                  fontWeight: isManual ? 600 : 400,
                  cursor: 'pointer',
                  fontSize: 11,
                  transition: 'all 0.15s'
                }}
              >
                🚜 Локальный / Свой баланс
              </button>
            </div>

            {isManual ? (
              // Manual Mode Inputs
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center', gap: 10 }}>
                  <span className="inp-label" style={{ margin: 0 }}>Спрос D (млн т):</span>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0"
                    value={D} 
                    onChange={e => setD(parseFloat(e.target.value) || 0)} 
                    style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--txt)' }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center', gap: 10 }}>
                  <span className="inp-label" style={{ margin: 0 }}>Производство P (млн т):</span>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0"
                    value={P} 
                    onChange={e => setP(parseFloat(e.target.value) || 0)} 
                    style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--txt)' }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center', gap: 10 }}>
                  <span className="inp-label" style={{ margin: 0 }}>Импорт I (млн т):</span>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0"
                    value={I} 
                    onChange={e => setI(parseFloat(e.target.value) || 0)} 
                    style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--txt)' }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center', gap: 10 }}>
                  <span className="inp-label" style={{ margin: 0 }}>Остатки S (млн т):</span>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0"
                    value={S} 
                    onChange={e => setS(parseFloat(e.target.value) || 0)} 
                    style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--txt)' }}
                  />
                </div>
              </div>
            ) : (
              // Sliders (Demo Mode)
              <>
                <div className="inp-row">
                  <span className="inp-label">Спрос D (млн т)</span>
                  <input type="range" min="0" max="10" step="0.1" value={D} onChange={e => setD(parseFloat(e.target.value))} />
                  <span className="inp-val">{D.toFixed(1)}</span>
                </div>
                <div className="inp-row">
                  <span className="inp-label">Производство P (млн т)</span>
                  <input type="range" min="0" max="10" step="0.1" value={P} onChange={e => setP(parseFloat(e.target.value))} />
                  <span className="inp-val">{P.toFixed(1)}</span>
                </div>
                <div className="inp-row">
                  <span className="inp-label">Импорт I (млн т)</span>
                  <input type="range" min="0" max="2" step="0.05" value={I} onChange={e => setI(parseFloat(e.target.value))} />
                  <span className="inp-val">{I.toFixed(2)}</span>
                </div>
                <div className="inp-row">
                  <span className="inp-label">Остатки S (млн т)</span>
                  <input type="range" min="0" max="2" step="0.1" value={S} onChange={e => setS(parseFloat(e.target.value))} />
                  <span className="inp-val">{S.toFixed(1)}</span>
                </div>
              </>
            )}

            <div className="divider" />
            
            <div className="inp-row">
              <span className="inp-label">Погода (фаза налива)</span>
              <select value={weatherRisk} onChange={e => setWeatherRisk(e.target.value)} style={{ flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--txt)' }}>
                <option value="optimal">Оптимально (100% урожая)</option>
                <option value="drought">Засуха (-20% урожая)</option>
              </select>
            </div>
            <div className="inp-row">
              <span className="inp-label">Ограничения импорта</span>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={hasSanctions} onChange={e => setHasSanctions(e.target.checked)} />
                Россельхознадзор (-15% импорта)
              </label>
            </div>

            <div style={{ marginTop: 6, marginBottom: 12, fontSize: 10, color: 'var(--txt3)', fontStyle: 'italic' }}>
              {isManual 
                ? "* Ручной ввод локальных объемов (можно вводить показатели конкретно вашего региона)" 
                : "* Базовые значения — Росстат / Минсельхоз · обновляются ежемесячно"}
            </div>

            {/* Farm share planning feature */}
            <div className="divider" />
            <div style={{ background: 'var(--surface2)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--txt2)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                🚜 Планирование для вашего хозяйства
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--txt2)' }}>Ваш план сбора (тонн):</span>
                <input 
                  type="number" 
                  placeholder="напр. 500" 
                  value={myHarvest} 
                  onChange={e => setMyHarvest(e.target.value)}
                  style={{ padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 11, background: 'var(--surface)', color: 'var(--txt)' }}
                />
              </div>
              {myHarvest > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, borderTop: '1px dashed var(--border)', paddingTop: 6, marginTop: 4 }}>
                  <span>Ваша доля рынка:</span>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--blue)' }}>
                    {marketSharePct < 0.01 ? '<0.01%' : `${marketSharePct.toFixed(3)}%`}
                  </span>
                </div>
              )}
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

            {/* Live USD/RUB indicator */}
            <div className="live-fx-row">
              <div className="live-fx-label">
                <span className="live-dot" style={{ background: isLoading ? '#8C97A8' : isOffline ? '#C0303A' : '#0D7C4A' }} />
                <span>USD/RUB · ЦБ РФ</span>
              </div>
              {isLoading ? (
                <span className="live-fx-val skeleton">—</span>
              ) : (
                <span className="live-fx-val">{liveData.usdRub?.toFixed(2) ?? '—'}</span>
              )}
            </div>

            <div className="inp-row" style={{ marginTop: 10 }}>
              <span className="inp-label">
                Объём импорта (тыс. т)
              </span>
              <input type="range" min="50" max="900" step="10" value={vol} onChange={e => setVol(parseFloat(e.target.value))} />
              <span className="inp-val">{Math.round(vol)}</span>
            </div>
            <div className="inp-row">
              <span className="inp-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                USD/RUB
                {!fxIsLive && liveData.usdRub && (
                  <span className="override-badge">изменено</span>
                )}
              </span>
              <input
                type="range"
                min="60"
                max="130"
                step="0.5"
                value={fx}
                onChange={e => setUserFx(parseFloat(e.target.value))}
              />
              <span className="inp-val">{fx.toFixed(1)}</span>
            </div>

            {/* Reset to live button — shown only when user has modified sliders */}
            {(!fxIsLive || vol !== BASE.vol) && liveData.usdRub && (
              <button className="reset-live-btn" onClick={resetToLive}>
                ↺ Сбросить к актуальным
              </button>
            )}

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

            <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 4, border: '1px solid var(--border)', fontSize: 11, color: 'var(--txt2)' }}>
              💡 <strong>Связь с прогнозом:</strong> Вклад импорта (КЗ/УЗ) в модель прогноза CatBoost составляет <strong>23% (SHAP)</strong>. В разделе <em>«Прогноз»</em> доступно интерактивное моделирование влияния сценариев импорта на 26 недель вперед.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
