import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { TARGET_SPECS } from '../../shared/spec.js';

export default function Forecast({ onNavigateToImport }) {
  const { model, demo, setDemo, basis, setBasis, scenario, setScenario, updateAssumptions, issueNewForecast } = useMarket();

  const [activeTab, setActiveTab] = useState('forecast'); // 'forecast' | 'bridge' | 'scenarios' | 'validation'
  const [editingBridge, setEditingBridge] = useState(false);
  const [bridgeDraft, setBridgeDraft] = useState(() => ({ ...model.bridge }));
  const [issuing, setIssuing] = useState(false);

  const fc = model.forecasts[basis] || model.forecasts.warehouse;
  const targetSpec = TARGET_SPECS[basis];

  // Save updated cost bridge
  async function handleSaveBridge() {
    await updateAssumptions({ bridge: bridgeDraft });
    setEditingBridge(false);
  }

  // Handle re-issuing forecast
  async function handleIssue() {
    setIssuing(true);
    try {
      await issueNewForecast(basis);
    } finally {
      setIssuing(false);
    }
  }

  const activeScenarioResult = model.scenarios.results.find(s => s.id === scenario) || model.scenarios.results[0];
  const scenarioRows = model.scenarios.rows?.[basis]?.[scenario] || fc?.horizons || [];

  return (
    <div className="panel">
      {/* ── Header & Basis Switcher ── */}
      <div className="basis-switcher-wrap">
        <div className="basis-switcher">
          <button
            type="button"
            className={`basis-btn ${basis === 'warehouse' ? 'active' : ''}`}
            onClick={() => setBasis('warehouse')}
          >
            🏬 Склад продавца (Волгоград, EXW без НДС)
          </button>
          <button
            type="button"
            className={`basis-btn ${basis === 'moscow' ? 'active' : ''}`}
            onClick={() => setBasis('moscow')}
          >
            🏢 Опт Москва (с доставкой, с НДС 10%)
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {demo ? (
            <span className="badge warn" style={{ fontSize: 11, fontWeight: 600 }}>
              ДЕМО-ПРОГНОЗ (иллюстративный ряд)
            </span>
          ) : fc?.status === 'validated' ? (
            <span className="badge up" style={{ fontSize: 11 }}>
              Валидирован бэктестом ({fc.modelVersion})
            </span>
          ) : fc?.status === 'baseline_unvalidated' ? (
            <span className="badge info" style={{ fontSize: 11 }}>
              Базовый прогноз ({fc.modelVersion})
            </span>
          ) : (
            <span className="badge dn" style={{ fontSize: 11 }}>
              Недостаточно данных
            </span>
          )}

          <div className="basis-switcher" style={{ margin: 0 }}>
            <button
              type="button"
              className={`basis-btn ${activeTab === 'forecast' ? 'active' : ''}`}
              onClick={() => setActiveTab('forecast')}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              Прогноз
            </button>
            <button
              type="button"
              className={`basis-btn ${activeTab === 'bridge' ? 'active' : ''}`}
              onClick={() => setActiveTab('bridge')}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              Мост издержек
            </button>
            <button
              type="button"
              className={`basis-btn ${activeTab === 'scenarios' ? 'active' : ''}`}
              onClick={() => setActiveTab('scenarios')}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              Сценарии
            </button>
            <button
              type="button"
              className={`basis-btn ${activeTab === 'validation' ? 'active' : ''}`}
              onClick={() => setActiveTab('validation')}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              Валидация
            </button>
          </div>
        </div>
      </div>

      {/* ── Metadata and Provenance Bar ── */}
      <div style={{ padding: '8px 14px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, fontSize: 11 }}>
        <div>
          <strong>Базис поставки:</strong> {targetSpec.label} ({targetSpec.deliveryBasis.join('/')}, {basis === 'moscow' ? 'с НДС 10%' : 'без НДС'})
          <span style={{ color: 'var(--txt3)', marginLeft: 8 }}>
            · Спецификация: {targetSpec.fields.grade.value || 'сорт не зафиксирован'} · {targetSpec.fields.packaging.value || 'навалом/сетка'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {fc && (
            <span>
              Дата выпуска: <strong className="mono">{fc.issueDate}</strong>
              {fc.inputCutoff && <> · Срез данных: <strong className="mono">{fc.inputCutoff}</strong></>}
              {fc.ageDays !== null && fc.ageDays !== undefined && <> ({fc.ageDays} дн. назад)</>}
            </span>
          )}
          {!demo && (
            <button
              type="button"
              onClick={handleIssue}
              disabled={issuing}
              className="cash-reset-btn"
              style={{ fontSize: 10, padding: '2px 7px' }}
            >
              {issuing ? 'Перерасчет...' : '↻ Перевыпустить прогноз'}
            </button>
          )}
        </div>
      </div>

      {/* ── Subtab: Forecast Table View ── */}
      {activeTab === 'forecast' && (
        <div style={{ padding: '14px' }}>
          {/* If No Forecast Available */}
          {!fc || fc.status === 'insufficient_data' || scenarioRows.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📉</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                Недостаточно наблюдений для построения прогноза цен
              </div>
              <div style={{ fontSize: 12, color: 'var(--txt2)', maxWidth: 560, margin: '0 auto 16px', lineHeight: 1.5 }}>
                {fc?.reasons?.[0] || 'В базе данных нет достаточного количества фактических сделок по данному базису. Система не строит вымышленные прогнозы без проверенных исторических данных.'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                {onNavigateToImport && (
                  <button
                    type="button"
                    onClick={onNavigateToImport}
                    className="basis-btn active"
                    style={{ fontSize: 12, padding: '6px 14px' }}
                  >
                    📥 Импортировать сделки (CSV)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDemo(true)}
                  className="basis-btn"
                  style={{ fontSize: 12, padding: '6px 14px', border: '1px solid var(--amber-border)', color: 'var(--amber)' }}
                >
                  Включить ДЕМО-режим
                </button>
              </div>
            </div>
          ) : (
            <div>
              {/* Scenario selector bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {model.scenarios.results.map(sc => (
                    <button
                      key={sc.id}
                      type="button"
                      className={`basis-btn ${scenario === sc.id ? 'active' : ''}`}
                      onClick={() => setScenario(sc.id)}
                      style={{ fontSize: 11, padding: '4px 10px' }}
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt2)' }}>
                  Эффект сценария: <strong>{activeScenarioResult.complete ? `${activeScenarioResult.totalPct > 0 ? '+' : ''}${activeScenarioResult.totalPct.toFixed(1)}%` : 'не оценён количественно'}</strong>
                  {demo && <span className="badge warn" style={{ marginLeft: 6, fontSize: 9 }}>ДЕМО</span>}
                </div>
              </div>

              {/* Table */}
              <div className="fc-table-head">
                <span style={{ minWidth: 80 }}>Горизонт</span>
                <span style={{ minWidth: 100 }}>Целевая дата</span>
                <span style={{ flex: 1 }}>{basis === 'moscow' ? 'Опт Москва (с НДС)' : 'Склад продавца (без НДС)'}</span>
                <span style={{ minWidth: 130, textAlign: 'center' }}>Интервал 80%</span>
                <span style={{ minWidth: 130, textAlign: 'center' }}>Интервал 95%</span>
                <span style={{ minWidth: 100, textAlign: 'center' }}>Модель</span>
                <span style={{ minWidth: 90, textAlign: 'right' }}>Валидация</span>
              </div>

              <div className="fc-body">
                {scenarioRows.map((r) => {
                  const pt = r.scenarioPoint ?? r.point;
                  const int = r.interval;
                  return (
                    <div className="fc-row" key={r.h}>
                      <span className="wk" style={{ minWidth: 80, fontWeight: 600 }}>
                        W+{r.h}
                      </span>
                      <span style={{ minWidth: 100, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt2)' }}>
                        {r.targetDate}
                      </span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13, color: 'var(--blue)' }}>
                          {pt !== null ? `${pt.toFixed(1)} ₽/кг` : '—'}
                        </span>
                        {r.scenarioShiftPct !== undefined && r.scenarioShiftPct !== 0 && (
                          <span className={`fc-delta-pill ${r.scenarioShiftPct > 0 ? 'up' : 'dn'}`} style={{ fontSize: 10 }}>
                            {r.scenarioShiftPct > 0 ? `+${r.scenarioShiftPct.toFixed(1)}%` : `${r.scenarioShiftPct.toFixed(1)}%`}
                          </span>
                        )}
                      </div>
                      <span style={{ minWidth: 130, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt2)' }}>
                        {int?.lo80 !== null && int?.hi80 !== null && int?.lo80 !== undefined
                          ? `${int.lo80.toFixed(1)} – ${int.hi80.toFixed(1)} ₽`
                          : '—'}
                      </span>
                      <span style={{ minWidth: 130, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt3)' }}>
                        {int?.lo95 !== null && int?.hi95 !== null && int?.lo95 !== undefined
                          ? `${int.lo95.toFixed(1)} – ${int.hi95.toFixed(1)} ₽`
                          : '—'}
                      </span>
                      <span style={{ minWidth: 100, textAlign: 'center', fontSize: 11 }}>
                        <span className="badge neu">{r.modelId}</span>
                      </span>
                      <span style={{ minWidth: 90, textAlign: 'right' }}>
                        {demo ? (
                          <span className="badge warn" style={{ fontSize: 10 }}>демо</span>
                        ) : r.validated ? (
                          <span className="badge up" style={{ fontSize: 10 }}>проверен</span>
                        ) : (
                          <span className="badge neu" style={{ fontSize: 10 }}>базовый</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Seasonal Factors Note */}
              <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>🌿 Сезонное давление предложения:</span>
                  {demo && <span className="badge amber" style={{ fontSize: 9 }}>ДЕМО-ФАЗЫ</span>}
                </div>
                {model.seasonal.pressures.length > 0 ? (
                  model.seasonal.pressures.map((p, idx) => (
                    <div key={idx} style={{ marginTop: 4 }}>
                      • <strong>{p.label}:</strong> {p.reason}
                      {p.priceImpactNote && <span style={{ color: 'var(--txt3)', marginLeft: 6 }}>({p.priceImpactNote})</span>}
                    </div>
                  ))
                ) : (
                  <div style={{ color: 'var(--txt2)' }}>
                    Наблюдений сезонных индикаторов на дату среза нет. Сезонные факторы не привязаны к жестким номерам строк прогноза.
                  </div>
                )}

                <div style={{ borderTop: '1px dashed var(--border)', marginTop: 8, paddingTop: 6, fontSize: 10, color: 'var(--txt3)', lineHeight: 1.5 }}>
                  <strong>Справочные региональные агрономические окна (ориентиры):</strong><br />
                  • <strong>Волгоградская обл.:</strong> уборка на капельном поливе — август–сентябрь; окончание закладки в хранилища — октябрь.<br />
                  • <strong>Казахстан (Жамбылская обл.):</strong> сезон массового экспорта — август–октябрь.<br />
                  • <strong>Узбекистан:</strong> ранний лук нового урожая — апрель–май.<br />
                  <em>* Фактическая сила сезонного давления в модели определяется только по датированным сводкам (ход уборки, запасы, качество), загружаемым через CSV.</em>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Subtab: Cost Bridge ── */}
      {activeTab === 'bridge' && (
        <div style={{ padding: '14px' }}>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>
              Мост издержек: Склад (Волгоград) ↔ Опт Москва
            </h3>
            <div style={{ fontSize: 11, color: 'var(--txt2)' }}>
              Вместо фиксированного множителя 2.08 разница между складом в Волгоградской области и Москвой рассчитывается из прозрачных издержек доставки, потерь, фасовки и маржи посредника.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
            {/* Left: Component inputs */}
            <div style={{ background: 'var(--surface2)', padding: '12px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Параметры моста издержек</span>
                {!editingBridge ? (
                  <button type="button" onClick={() => { setBridgeDraft({ ...model.bridge }); setEditingBridge(true); }} className="cash-reset-btn" style={{ fontSize: 10 }}>
                    ✏️ Редактировать
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={handleSaveBridge} className="basis-btn active" style={{ fontSize: 10, padding: '2px 8px' }}>
                      Сохранить
                    </button>
                    <button type="button" onClick={() => setEditingBridge(false)} className="cash-reset-btn" style={{ fontSize: 10 }}>
                      Отмена
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Фура Волгоград–Москва (₽ за рейс):</span>
                  {editingBridge ? (
                    <input type="number" value={bridgeDraft.truckCostRub ?? ''} onChange={e => setBridgeDraft({ ...bridgeDraft, truckCostRub: Number(e.target.value) })} style={{ width: 90, padding: 3 }} />
                  ) : (
                    <strong className="mono">{model.bridge.truckCostRub ?? '—'} ₽</strong>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Загрузка фуры (кг):</span>
                  {editingBridge ? (
                    <input type="number" value={bridgeDraft.truckPayloadKg ?? ''} onChange={e => setBridgeDraft({ ...bridgeDraft, truckPayloadKg: Number(e.target.value) })} style={{ width: 90, padding: 3 }} />
                  ) : (
                    <strong className="mono">{model.bridge.truckPayloadKg ?? '—'} кг</strong>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Фасовка / упаковка (₽/кг):</span>
                  {editingBridge ? (
                    <input type="number" step="0.1" value={bridgeDraft.packagingRubKg ?? ''} onChange={e => setBridgeDraft({ ...bridgeDraft, packagingRubKg: Number(e.target.value) })} style={{ width: 90, padding: 3 }} />
                  ) : (
                    <strong className="mono">{model.bridge.packagingRubKg ?? '—'} ₽/кг</strong>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Погрузка / сортировка (₽/кг):</span>
                  {editingBridge ? (
                    <input type="number" step="0.1" value={bridgeDraft.handlingRubKg ?? ''} onChange={e => setBridgeDraft({ ...bridgeDraft, handlingRubKg: Number(e.target.value) })} style={{ width: 90, padding: 3 }} />
                  ) : (
                    <strong className="mono">{model.bridge.handlingRubKg ?? '—'} ₽/кг</strong>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Потери / отбраковка в пути (%):</span>
                  {editingBridge ? (
                    <input type="number" step="0.5" value={bridgeDraft.lossPct ?? ''} onChange={e => setBridgeDraft({ ...bridgeDraft, lossPct: Number(e.target.value) })} style={{ width: 90, padding: 3 }} />
                  ) : (
                    <strong className="mono">{model.bridge.lossPct ?? '—'} %</strong>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Маржа посредника (₽/кг):</span>
                  {editingBridge ? (
                    <input type="number" step="0.5" value={bridgeDraft.marginRubKg ?? ''} onChange={e => setBridgeDraft({ ...bridgeDraft, marginRubKg: Number(e.target.value) })} style={{ width: 90, padding: 3 }} />
                  ) : (
                    <strong className="mono">{model.bridge.marginRubKg ?? '—'} ₽/кг</strong>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Ставка НДС (доля, овощи 10% = 0.10):</span>
                  {editingBridge ? (
                    <input type="number" step="0.01" value={bridgeDraft.vatRate ?? ''} onChange={e => setBridgeDraft({ ...bridgeDraft, vatRate: Number(e.target.value) })} style={{ width: 90, padding: 3 }} />
                  ) : (
                    <strong className="mono">{model.bridge.vatRate ?? '—'}</strong>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Bridge Calculation Results */}
            <div style={{ background: 'var(--surface2)', padding: '12px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 600, fontSize: 12, display: 'block', marginBottom: 10 }}>
                Результаты расчета (при цене склада {model.prices.warehouse.exVat ? `${model.prices.warehouse.exVat.toFixed(1)} ₽` : '15.0 ₽'})
              </span>

              {model.bridgeResult.status === 'ok' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--txt2)' }}>Цена склада EXW (без НДС):</span>
                    <span className="mono">{model.bridgeResult.components.warehousePrice.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--txt2)' }}>Учет потерь (на 1 кг проданного):</span>
                    <span className="mono">+{model.bridgeResult.components.lossAllowance.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--txt2)' }}>Фрахт фуры ({model.bridgeResult.components.freight.toFixed(2)} ₽/кг):</span>
                    <span className="mono">+{model.bridgeResult.components.freight.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--txt2)' }}>Фасовка + погрузка:</span>
                    <span className="mono">+{(model.bridgeResult.components.packaging + model.bridgeResult.components.handling).toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--txt2)' }}>Маржа посредника:</span>
                    <span className="mono">+{model.bridgeResult.components.margin.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                    <span>Москва опт без НДС:</span>
                    <span className="mono">{model.bridgeResult.moscowExVat.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: 'var(--blue)' }}>
                    <span>Москва опт с НДС 10%:</span>
                    <span className="mono">{model.bridgeResult.moscowInclVat.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 6, fontSize: 10, color: 'var(--txt3)' }}>
                    Валовая географическая разница без НДС: <strong>+{model.bridgeResult.grossDifferenceExVat.toFixed(2)} ₽/кг</strong>
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--amber)', fontSize: 11 }}>
                  Смета не полна. Отсутствуют: {model.bridgeResult.missing?.join(', ')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Subtab: Validation Metrics ── */}
      {activeTab === 'validation' && (
        <div style={{ padding: '14px' }}>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>
              Результаты валидации модели (Rolling-Origin Backtest)
            </h3>
            <div style={{ fontSize: 11, color: 'var(--txt2)' }}>
              Оценка точности на исторических срезах без заглядывания в будущее (out-of-sample). Модель выбирается на обучающем срезе и подтверждается на независимом финальном периоде.
            </div>
          </div>

          {demo ? (
            <div style={{ padding: '20px', background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11 }}>
              <div className="badge warn" style={{ marginBottom: 8 }}>ДЕМО-РЕЖИМ</div>
              <div>В демо-режиме отображаются иллюстративные данные. Валидация бэктестом доступна при наличии реальных исторических рядов наблюдений.</div>
            </div>
          ) : fc?.validation?.byHorizon ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Горизонт</th>
                  <th>Статус</th>
                  <th>Выборка n</th>
                  <th>Период оценки</th>
                  <th>MAE (₽/кг)</th>
                  <th>Смещение (bias)</th>
                  <th>MAE базовой модели</th>
                  <th>Покрытие 80%</th>
                  <th>Покрытие 95%</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fc.validation.byHorizon).map(([h, v]) => (
                  <tr key={h}>
                    <td className="fw">W+{h}</td>
                    <td>
                      <span className={`pill ${v?.status === 'ok' ? 'up' : 'warn'}`}>
                        {v?.status === 'ok' ? 'валидирован' : 'недостаточно n'}
                      </span>
                    </td>
                    <td className="mono">{v?.n ?? '—'}</td>
                    <td className="mono" style={{ fontSize: 10 }}>
                      {v?.period ? `${v.period.firstTarget} .. ${v.period.lastTarget}` : '—'}
                    </td>
                    <td className="mono fw" style={{ color: 'var(--blue)' }}>
                      {v?.maeRubKg !== null && v?.maeRubKg !== undefined ? `${v.maeRubKg.toFixed(2)} ₽` : '—'}
                    </td>
                    <td className="mono">
                      {v?.biasRubKg !== null && v?.biasRubKg !== undefined ? `${v.biasRubKg.toFixed(2)} ₽` : '—'}
                    </td>
                    <td className="mono">
                      {v?.naiveMaeRubKg !== null && v?.naiveMaeRubKg !== undefined ? `${v.naiveMaeRubKg.toFixed(2)} ₽` : '—'}
                    </td>
                    <td className="mono">
                      {v?.coverage80?.rate !== null && v?.coverage80?.rate !== undefined ? `${(v.coverage80.rate * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="mono">
                      {v?.coverage95?.rate !== null && v?.coverage95?.rate !== undefined ? `${(v.coverage95.rate * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: '20px', background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, color: 'var(--txt2)' }}>
              Для валидации необходимо накопить историю еженедельных цен (минимум 20+ недель в финальном срезе).
            </div>
          )}
        </div>
      )}

      {/* ── Subtab: Scenarios ── */}
      {activeTab === 'scenarios' && (
        <div style={{ padding: '14px' }}>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>
              Сценарный анализ предложения и курса
            </h3>
            <div style={{ fontSize: 11, color: 'var(--txt2)' }}>
              Сценарии определяются явными входными параметрами (отклонение импорта, урожая и валюты). Эффекты не выдумываются: если эмпирическая эластичность не оценена, эффект честно маркируется как "не оценён".
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {model.scenarios.results.map(sc => (
              <div
                key={sc.id}
                style={{
                  background: 'var(--surface2)',
                  borderRadius: 6,
                  padding: 12,
                  border: scenario === sc.id ? '2px solid var(--blue)' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
                onClick={() => setScenario(sc.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong style={{ fontSize: 12 }}>{sc.label}</strong>
                  {scenario === sc.id && <span className="badge info" style={{ fontSize: 9 }}>АКТИВЕН</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div>• Импорт ({sc.inputs.importScope === 'kz_only' ? 'только КЗ' : 'весь'}): <strong>{sc.inputs.importDeltaPct > 0 ? `+${sc.inputs.importDeltaPct}%` : `${sc.inputs.importDeltaPct}%`}</strong></div>
                  <div>• Внутреннее предложение: <strong>{sc.inputs.domesticSupplyDeltaPct > 0 ? `+${sc.inputs.domesticSupplyDeltaPct}%` : `${sc.inputs.domesticSupplyDeltaPct}%`}</strong></div>
                  <div>• Курс валют: <strong>{sc.inputs.fxDeltaPct > 0 ? `+${sc.inputs.fxDeltaPct}%` : `${sc.inputs.fxDeltaPct}%`}</strong></div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4, fontWeight: 600, color: sc.complete ? 'var(--blue)' : 'var(--amber)' }}>
                    Сдвиг цены: {sc.complete ? `${sc.totalPct > 0 ? '+' : ''}${sc.totalPct.toFixed(1)}%` : 'не оценён'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
