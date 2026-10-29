import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { deficitIndex, shareOfMarket } from '../../shared/balance.js';
import { CROPS } from '../data/marketData';

export default function Deficit() {
  const { model, updateAssumptions } = useMarket();

  const [selectedCrop, setSelectedCrop] = useState('onion');
  const cropData = CROPS[selectedCrop] || CROPS.onion;

  // Read current balance from model assumptions or demo
  const currentAssumptionsBalance = model.assumptions.balance?.[selectedCrop] || model.balance.inputs || cropData.balance;

  const [D, setD] = useState(() => Number(currentAssumptionsBalance.D ?? 2.2));
  const [P, setP] = useState(() => Number(currentAssumptionsBalance.P ?? 1.65));
  const [I, setI] = useState(() => Number(currentAssumptionsBalance.I ?? 0.35));
  const [S, setS] = useState(() => Number(currentAssumptionsBalance.S ?? 0.25));

  const [drought, setDrought] = useState(false);
  const [importRestriction, setImportRestriction] = useState(false);
  const [myHarvestTons, setMyHarvestTons] = useState('');

  const weatherFactor = drought ? 0.8 : 1.0;
  const importFactor = importRestriction ? 0.85 : 1.0;

  // Unified calculation from shared/balance.js
  const calc = deficitIndex({
    D,
    P,
    I,
    S,
    weatherFactor,
    importFactor,
  });

  const myShare = shareOfMarket(Number(myHarvestTons), P, weatherFactor);

  async function handleSaveLocal() {
    await updateAssumptions({
      balance: {
        ...model.assumptions.balance,
        [selectedCrop]: { D, P, I, S, asOf: model.today, source: 'введено пользователем' },
      },
    });
  }

  return (
    <div>
      <div className="row-2">
        {/* Panel 1: Balance & Deficit Index */}
        <div className="panel">
          <div className="panel-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="panel-title">Баланс рынка и индекс дефицита</span>
              <code className="inline" style={{ marginLeft: 8 }}>D / (P·w + I·r + S)</code>
            </div>
            <select
              value={selectedCrop}
              onChange={e => {
                const id = e.target.value;
                setSelectedCrop(id);
                const b = model.assumptions.balance?.[id] || CROPS[id]?.balance || CROPS.onion.balance;
                setD(b.D);
                setP(b.P);
                setI(b.I);
                setS(b.S);
              }}
              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--txt)', fontSize: 13 }}
            >
              {Object.values(CROPS).map(c => (
                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </div>

          <div className="panel-body">
            {/* Formula Explanation Alert */}
            <div style={{ background: 'var(--surface2)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 14, fontSize: 11, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600, color: 'var(--txt)' }}>📐 Формула баланса спроса и доступного предложения:</div>
              <div style={{ color: 'var(--txt2)', marginTop: 2 }}>
                Доступное предложение = <code>P × погода + I × квоты + S (переходящие запасы)</code>.<br />
                <strong>S (запасы на начало периода)</strong> увеличивают доступное предложение на рынке (прибавляются, а не вычитаются).
              </div>
            </div>

            {/* Inputs */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              <div className="inp-row">
                <span className="inp-label">Спрос D (млн т):</span>
                <input type="range" min="0.1" max="10" step="0.05" value={D} onChange={e => setD(parseFloat(e.target.value))} />
                <span className="inp-val">{D.toFixed(2)}</span>
              </div>

              <div className="inp-row">
                <span className="inp-label">Производство P (млн т):</span>
                <input type="range" min="0.1" max="10" step="0.05" value={P} onChange={e => setP(parseFloat(e.target.value))} />
                <span className="inp-val">{P.toFixed(2)}</span>
              </div>

              <div className="inp-row">
                <span className="inp-label">Импорт I (млн т):</span>
                <input type="range" min="0" max="3" step="0.02" value={I} onChange={e => setI(parseFloat(e.target.value))} />
                <span className="inp-val">{I.toFixed(2)}</span>
              </div>

              <div className="inp-row">
                <span className="inp-label">Начальные запасы S (млн т):</span>
                <input type="range" min="0" max="3" step="0.02" value={S} onChange={e => setS(parseFloat(e.target.value))} />
                <span className="inp-val">{S.toFixed(2)}</span>
              </div>
            </div>

            <div className="divider" />

            {/* Shock Toggles */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: 11 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={drought} onChange={e => setDrought(e.target.checked)} />
                Засуха в регионе (-20% сбора P)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={importRestriction} onChange={e => setImportRestriction(e.target.checked)} />
                Ограничения импорта (-15% I)
              </label>
            </div>

            <button
              type="button"
              onClick={handleSaveLocal}
              className="basis-btn active"
              style={{ fontSize: 11, padding: '4px 10px', marginBottom: 14 }}
            >
              💾 Зафиксировать баланс в модели
            </button>

            <div className="divider" />

            {/* Result */}
            {calc.status === 'ok' ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
                  <div>
                    <div className="stat-label">Индекс баланса рынка</div>
                    <div className="big-num" style={{ color: `var(--${calc.cls === 'dn' ? 'red' : calc.cls === 'warn' ? 'amber' : 'green'})` }}>
                      {calc.index.toFixed(2)}
                    </div>
                  </div>
                  <span className={`badge ${calc.cls}`} style={{ fontSize: 12 }}>{calc.badge}</span>
                </div>

                <div className={`signal-box ${calc.cls === 'dn' ? 'sell' : calc.cls === 'up' ? 'buy' : 'hold'}`}>
                  <div className="signal-label">{calc.badge}</div>
                  <div className="signal-text" style={{ marginTop: 4 }}>
                    {calc.text} (Доступное предложение: {calc.supply.toFixed(2)} млн т, спрос: {D.toFixed(2)} млн т).
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--red)', fontSize: 12, padding: 10, background: 'var(--surface2)', borderRadius: 4 }}>
                Ошибка расчета: {calc.reason}
              </div>
            )}
          </div>
        </div>

        {/* Panel 2: Farm Planning & Interpretation */}
        <div className="panel">
          <div className="panel-hd">
            <span className="panel-title">Планирование для отдельного хозяйства</span>
          </div>
          <div className="panel-body">
            <div style={{ background: 'var(--surface2)', padding: '12px', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 14 }}>
              <span style={{ fontWeight: 600, fontSize: 12, display: 'block', marginBottom: 8 }}>
                Доля объема сбора на рынке РФ
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--txt2)' }}>Ваш объем сбора (тонн):</span>
                <input
                  type="number"
                  placeholder="напр. 1500"
                  value={myHarvestTons}
                  onChange={e => setMyHarvestTons(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--txt)', fontSize: 11 }}
                />
              </div>

              {myShare !== null && (
                <div style={{ marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span>Расчетная доля в урожае РФ:</span>
                  <strong className="mono" style={{ color: 'var(--blue)' }}>
                    {myShare < 0.001 ? '<0.001%' : `${myShare.toFixed(3)}%`}
                  </strong>
                </div>
              )}
            </div>

            <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6 }}>
              <strong>Экономический смысл индекса дефицита:</strong><br />
              • <code>Индекс &lt; 1.0</code>: Объем суммарного предложения превышает годовое потребление. Вероятность высоких складских запасов к весне.<br />
              • <code>Индекс 1.0 – 1.1</code>: Рынок близок к балансу.<br />
              • <code>Индекс &gt; 1.1</code>: Спрос превышает доступные фонды. Напряженность предложения стимулирует импорт и рост цен в межсезонье.
            </div>

            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 4, border: '1px solid var(--border)', fontSize: 10, color: 'var(--txt3)' }}>
              * Индекс дефицита является агрегированным балансовым индикатором, а не детерминированным прогнозом цены.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
