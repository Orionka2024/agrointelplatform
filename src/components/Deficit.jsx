import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { deficitIndex, classifyDeficit } from '../../shared/balance.js';
import { CROP_PROFILES } from '../../shared/cropProfiles.js';

export default function Deficit() {
  const { model, updateAssumptions } = useMarket();
  const [selectedCrop, setSelectedCrop] = useState('onion');

  const initOnion = model.assumptions.balance?.onion || {};
  const def = CROP_PROFILES.onion.balance;
  const [D, setD] = useState(Number(initOnion.D) > 0 ? Number(initOnion.D) : def.D);
  const [P, setP] = useState(Number(initOnion.P) > 0 ? Number(initOnion.P) : def.P);
  const [I, setI] = useState(Number(initOnion.I) >= 0 && initOnion.I !== '' && initOnion.I != null ? Number(initOnion.I) : def.I);
  const [S, setS] = useState(Number(initOnion.S) >= 0 && initOnion.S !== '' && initOnion.S != null ? Number(initOnion.S) : def.S);
  const [scope, setScope] = useState(initOnion.scope || 'РФ · маркетинговый год 2026/27');
  const [source, setSource] = useState(initOnion.source || 'Росстат / отраслевой баланс товарного сектора');
  const [saved, setSaved] = useState('');

  function handleCropSelect(id) {
    setSelectedCrop(id);
    const b = CROP_PROFILES[id]?.balance || def;
    setD(b.D);
    setP(b.P);
    setI(b.I);
    setS(b.S);
    setSaved('');
  }

  const result = deficitIndex({ D, P, I, S });
  const clsInfo = result.status === 'ok' ? classifyDeficit(result.index) : null;
  const needlePct = result.status === 'ok' ? Math.min(98, Math.max(2, ((result.index - 0.7) / 0.6) * 100)) : 50;

  async function handleSave() {
    const ok = await updateAssumptions({
      balance: {
        onion: { D, P, I, S, scope, source, asOf: model.today },
      },
    });
    setSaved(ok ? 'Сценарий баланса сохранён' : 'Ошибка сохранения');
  }

  return (
    <div className="row-2">
      <div className="panel">
        <div className="panel-hd">
          <span className="panel-title">Национальный баланс спроса и предложения</span>
          <select
            aria-label="Культура для расчёта баланса"
            value={selectedCrop}
            onChange={(e) => handleCropSelect(e.target.value)}
            style={{ width: 'auto', padding: '4px 10px', fontSize: 11, fontWeight: 600 }}
          >
            {Object.values(CROP_PROFILES).map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="panel-body">
          <div className="inp-row">
            <span className="inp-label">Потребление + потери (D)</span>
            <input type="range" min="0.2" max="10" step="0.05" value={D} onChange={(e) => setD(Number(e.target.value))} />
            <span className="inp-val">{D.toFixed(2)} млн т</span>
          </div>
          <div className="inp-row">
            <span className="inp-label">Товарный сбор РФ (P)</span>
            <input type="range" min="0.1" max="10" step="0.05" value={P} onChange={(e) => setP(Number(e.target.value))} />
            <span className="inp-val">{P.toFixed(2)} млн т</span>
          </div>
          <div className="inp-row">
            <span className="inp-label">Импорт за сезон (I)</span>
            <input type="range" min="0" max="2.5" step="0.02" value={I} onChange={(e) => setI(Number(e.target.value))} />
            <span className="inp-val">{I.toFixed(2)} млн т</span>
          </div>
          <div className="inp-row">
            <span className="inp-label">Переходящие запасы (S)</span>
            <input type="range" min="0" max="2.5" step="0.02" value={S} onChange={(e) => setS(Number(e.target.value))} />
            <span className="inp-val">{S.toFixed(2)} млн т</span>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              type="button"
              className="cash-reset-btn"
              onClick={() => setI(+(I * 0.65).toFixed(2))}
            >
              ⚡ Шок: Квота на импорт КЗ (−35%)
            </button>
            <button
              type="button"
              className="cash-reset-btn"
              onClick={() => setP(+(P * 0.88).toFixed(2))}
            >
              ☀️ Недобор урожая в поле (−12%)
            </button>
            <button
              type="button"
              className="cash-reset-btn"
              onClick={() => handleCropSelect(selectedCrop)}
            >
              ↺ Сброс к норме
            </button>
          </div>

          {selectedCrop === 'onion' && (
            <>
              <div className="divider" />
              <div className="col-pair" style={{ fontSize: 11 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  Период и охват
                  <input value={scope} onChange={(e) => setScope(e.target.value)} style={{ padding: 6 }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  Источник / обоснование
                  <input value={source} onChange={(e) => setSource(e.target.value)} style={{ padding: 6 }} />
                </label>
              </div>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="basis-btn active"
                  disabled={result.status !== 'ok' || !scope || !source}
                  onClick={handleSave}
                >
                  💾 Сохранить баланс лука
                </button>
                {saved && <span role="status" style={{ fontSize: 11, color: 'var(--green)' }}>{saved}</span>}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="col-stack">
        <div className="panel">
          <div className="panel-hd">
            <span className="panel-title">Индекс напряжённости баланса: D / (P + I + S)</span>
            {clsInfo && <span className={`badge ${clsInfo.cls}`}>{clsInfo.badge}</span>}
          </div>
          <div className="panel-body">
            {result.status === 'ok' ? (
              <>
                <div className="big-num" style={{ color: result.index > 1.03 ? 'var(--red)' : result.index < 0.95 ? 'var(--amber)' : 'var(--green)' }}>
                  {result.index.toFixed(2)}
                </div>
                <div
                  className="idx-track"
                  style={{
                    background: 'linear-gradient(90deg, #0D7C4A 0%, #EF9F27 55%, #C0303A 100%)',
                    marginTop: 14,
                  }}
                >
                  <div className="idx-needle" style={{ left: `${needlePct}%` }} />
                </div>
                <div className="idx-labels">
                  <span>0.70 Профицит</span>
                  <span>1.00 Равновесие</span>
                  <span>1.30 Острый дефицит</span>
                </div>

                <div className="result-panel" style={{ marginTop: 14 }}>
                  <div className="result-grid">
                    <div>
                      <div className="result-lbl">Суммарный ресурс</div>
                      <div className="result-num">{result.supply.toFixed(2)} млн т</div>
                    </div>
                    <div>
                      <div className="result-lbl">Потребность</div>
                      <div className="result-num">{D.toFixed(2)} млн т</div>
                    </div>
                    <div>
                      <div className="result-lbl">Сальдо сезона</div>
                      <div className={`result-num ${result.supply - D >= 0 ? 'profit' : 'cost'}`}>
                        {result.supply - D >= 0 ? '+' : ''}
                        {(result.supply - D).toFixed(2)} млн т
                      </div>
                    </div>
                  </div>
                </div>
                <p style={{ marginTop: 10, fontSize: 11, color: 'var(--txt2)' }}>
                  {clsInfo?.label}. Индекс баланса характеризует физическую обеспеченность рынка за маркетинговый год и дополняет помесячный прогноз CatBoost.
                </p>
              </>
            ) : (
              <p>{result.reason}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
