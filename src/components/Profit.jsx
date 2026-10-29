import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { evaluateStorage, lossSensitivity, priceSensitivity } from '../../shared/storageEconomics.js';
import { CROPS, CROP_DEFAULTS } from '../data/marketData';
import { CROP_TYPES, getCropProfile } from '../../shared/cropProfiles.js';

function fmt(n) {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M ₽';
  if (a >= 1e3) return s + Math.round(a / 1e3) + 'K ₽';
  return s + Math.round(a) + ' ₽';
}

export default function Profit() {
  const { model, demo, updateAssumptions } = useMarket();

  const [activeTab, setActiveTab] = useState('storage'); // 'storage' | 'field'
  const [storageCrop, setStorageCrop] = useState('onion');

  // Storage Economics state
  const whPrice = model.prices.warehouse.exVat ?? 15.0;
  const storageParams = model.storage.params;

  const [pNow, setPNow] = useState(whPrice);
  const [pFuture, setPFuture] = useState(24.0);
  const [months, setMonths] = useState(storageParams.months ?? 4);
  const [shrinkPct, setShrinkPct] = useState(storageParams.shrinkPct ?? 6);
  const [rotPct, setRotPct] = useState(storageParams.rotPct ?? 4);
  const [downgradeSharePct, setDowngradeSharePct] = useState(storageParams.downgradeSharePct ?? 10);
  const [downgradeDiscountPct, setDowngradeDiscountPct] = useState(storageParams.downgradeDiscountPct ?? 15);
  const [energyRubKgMonth, setEnergyRubKgMonth] = useState(storageParams.energyRubKgMonth ?? 0.35);
  const [handlingRubKg, setHandlingRubKg] = useState(storageParams.handlingRubKg ?? 0.5);
  const [sortingRubKgSold, setSortingRubKgSold] = useState(storageParams.sortingRubKgSold ?? 0.6);
  const [financingRatePctYear, setFinancingRatePctYear] = useState(storageParams.financingRatePctYear ?? 20);
  const [sellNowCostRubKg, setSellNowCostRubKg] = useState(storageParams.sellNowCostRubKg ?? 0.2);
  const [acquisitionCostRubKg, setAcquisitionCostRubKg] = useState(storageParams.acquisitionCostRubKg ?? 12.0);

  function handleSelectStorageCrop(id) {
    setStorageCrop(id);
    const p = getCropProfile(id);
    if (p.type === CROP_TYPES.STORAGE) {
      const sp = p.storageParams;
      const nowP = id === 'onion' ? (model.prices.warehouse.exVat ?? p.benchmarkWarehousePrice) : p.benchmarkWarehousePrice;
      const futP = Math.round(nowP * (p.seasonalMultipliers[19] ?? 1.5) * 10) / 10;
      setPNow(nowP);
      setPFuture(futP);
      setMonths(sp.months);
      setShrinkPct(sp.shrinkPct);
      setRotPct(sp.rotPct);
      setDowngradeSharePct(sp.downgradeSharePct);
      setDowngradeDiscountPct(sp.downgradeDiscountPct);
      setEnergyRubKgMonth(sp.energyRubKgMonth);
      setHandlingRubKg(sp.handlingRubKg);
      setSortingRubKgSold(sp.sortingRubKgSold);
      setFinancingRatePctYear(sp.financingRatePctYear);
      setSellNowCostRubKg(sp.sellNowCostRubKg);
      setAcquisitionCostRubKg(sp.acquisitionCostRubKg);
    }
  }

  const currentParams = {
    months,
    shrinkPct,
    rotPct,
    downgradeSharePct,
    downgradeDiscountPct,
    energyRubKgMonth,
    handlingRubKg,
    sortingRubKgSold,
    financingRatePctYear,
    sellNowCostRubKg,
    acquisitionCostRubKg,
  };

  const storageResult = evaluateStorage(pNow, pFuture, currentParams);
  const lossSens = lossSensitivity(pNow, pFuture, currentParams);
  const priceSens = priceSensitivity(pNow, pFuture, currentParams);

  // Field economics state
  const [fieldCrop, setFieldCrop] = useState('onion');
  const [area, setArea] = useState(10);
  const [yld, setYld] = useState(55);
  const [price, setPrice] = useState(whPrice);
  const [costPerHa, setCostPerHa] = useState(780);

  const revenue = area * yld * price * 1000;
  const costs = area * costPerHa * 1000;
  const fieldProfit = revenue - costs;
  const roi = costs > 0 ? Math.round((fieldProfit / costs) * 100) : 0;
  const perHa = area > 0 ? Math.round(fieldProfit / area) : 0;

  async function handleSaveStorageParams() {
    await updateAssumptions({
      storage: currentParams,
    });
  }

  return (
    <div>
      {/* Subnavigation */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className={`basis-btn ${activeTab === 'storage' ? 'active' : ''}`}
          onClick={() => setActiveTab('storage')}
          style={{ fontSize: 12, padding: '5px 12px' }}
        >
          🏬 Экономика хранения: Продать сейчас vs Хранить до весны
        </button>
        <button
          type="button"
          className={`basis-btn ${activeTab === 'field' ? 'active' : ''}`}
          onClick={() => setActiveTab('field')}
          style={{ fontSize: 12, padding: '5px 12px' }}
        >
          🚜 Калькулятор поля: Себестоимость и рентабельность гектара
        </button>
      </div>

      {activeTab === 'storage' && (
        <div className="row-2">
          {/* Storage Inputs */}
          <div className="panel">
            <div className="panel-hd" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="panel-title">Параметры хранения и издержек</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  value={storageCrop}
                  onChange={e => handleSelectStorageCrop(e.target.value)}
                  style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--txt)', fontWeight: 600 }}
                >
                  {Object.values(CROPS).map(c => (
                    <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
                  ))}
                </select>
                {demo && <span className="badge amber" style={{ fontSize: 10 }}>ДЕМО-ПАРАМЕТРЫ</span>}
              </div>
            </div>
            <div className="panel-body">
              {getCropProfile(storageCrop).type === CROP_TYPES.FIELD_SEASONAL ? (
                <div style={{ background: 'var(--surface2)', padding: '24px 16px', borderRadius: 6, border: '1px solid var(--border)', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>{storageCrop === 'watermalon' ? '🍉' : '🍈'}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--txt)', marginBottom: 6 }}>
                    {CROPS[storageCrop]?.label}: Длительное зимнее хранение не осуществляется
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--txt2)', maxWidth: 440, margin: '0 auto 16px', lineHeight: 1.55 }}>
                    Бахчевые культуры (арбуз, дыня) — скоропортящаяся продукция открытого грунта. Хранение до весны в овощехранилищах РФ технологически невозможно из-за полной потери товарного вида. Для расчета экономики гектара на сезон 2027 г. используйте калькулятор поля.
                  </div>
                  <button
                    type="button"
                    className="basis-btn active"
                    onClick={() => { setActiveTab('field'); setFieldCrop(storageCrop); }}
                    style={{ fontSize: 11, padding: '5px 12px' }}
                  >
                    🚜 Перейти в калькулятор поля для {CROPS[storageCrop]?.label}
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 11 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Цена «продать сейчас» (₽/кг EXW):</span>
                      <input type="number" step="0.5" value={pNow} onChange={e => setPNow(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Издержки сбыта сейчас (₽/кг EXW):</span>
                      <input type="number" step="0.05" value={sellNowCostRubKg} onChange={e => setSellNowCostRubKg(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Ожидаемая будущая цена (₽/кг EXW):</span>
                      <input type="number" step="0.5" value={pFuture} onChange={e => setPFuture(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Срок хранения (месяцев):</span>
                      <input type="number" step="0.5" min="0.5" max="10" value={months} onChange={e => setMonths(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Усушка / естественная убыль (%):</span>
                      <input type="number" step="0.5" value={shrinkPct} onChange={e => setShrinkPct(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Гниль / отход при хранении (%):</span>
                      <input type="number" step="0.5" value={rotPct} onChange={e => setRotPct(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Доля нестандарта / 2 сорт (%):</span>
                      <input type="number" step="1" min="0" max="100" value={downgradeSharePct} onChange={e => setDowngradeSharePct(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Скидка на нестандарт (% к цене):</span>
                      <input type="number" step="1" min="0" max="100" value={downgradeDiscountPct} onChange={e => setDowngradeDiscountPct(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Энергия и охлаждение (₽/кг заложенного/мес):</span>
                      <input type="number" step="0.05" value={energyRubKgMonth} onChange={e => setEnergyRubKgMonth(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Закладка и выгрузка (₽/кг заложенного):</span>
                      <input type="number" step="0.1" value={handlingRubKg} onChange={e => setHandlingRubKg(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Сортировка перед продажей (₽/кг проданного):</span>
                      <input type="number" step="0.1" value={sortingRubKgSold} onChange={e => setSortingRubKgSold(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Стоимость денег (альтернативная доходность, % год):</span>
                      <input type="number" step="1" value={financingRatePctYear} onChange={e => setFinancingRatePctYear(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', alignItems: 'center' }}>
                      <span>Себестоимость выращенного (₽/кг, sunk cost):</span>
                      <input type="number" step="0.5" value={acquisitionCostRubKg} onChange={e => setAcquisitionCostRubKg(parseFloat(e.target.value) || 0)} style={{ padding: 4 }} />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveStorageParams}
                    className="basis-btn active"
                    style={{ fontSize: 11, padding: '4px 10px', marginTop: 14 }}
                  >
                    💾 Сохранить параметры хранения в модели
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Storage Decision Card & Loss Sensitivity */}
          <div className="col-stack">
            <div className="panel">
              <div className="panel-hd">
                <span className="panel-title">Экономический результат решения</span>
              </div>
              <div className="panel-body">
                {storageResult.status === 'ok' ? (
                  <div>
                    {/* Gain Metric */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
                      <div>
                        <div className="stat-label">Эффект от хранения (на 1 кг заложенного)</div>
                        <div className={`big-num ${storageResult.gain >= 0 ? 'up' : 'dn'}`}>
                          {storageResult.gain >= 0 ? `+${storageResult.gain.toFixed(2)}` : storageResult.gain.toFixed(2)} ₽/кг
                        </div>
                      </div>
                      <span className={`badge ${storageResult.gain >= 0 ? 'up' : 'dn'}`} style={{ fontSize: 12 }}>
                        {storageResult.gain >= 0 ? 'ХРАНЕНИЕ ВЫГОДНО' : 'ПРОДАТЬ СЕЙЧАС'}
                      </span>
                    </div>

                    <div className="result-grid" style={{ marginBottom: 12 }}>
                      <div>
                        <div className="result-lbl">Выход кондиции ({CROPS[storageCrop]?.label})</div>
                        <div className="result-num">{(storageResult.saleableYield * 100).toFixed(1)}%</div>
                      </div>
                      <div>
                        <div className="result-lbl">Издержки хранения</div>
                        <div className="result-num cost">{storageResult.costsLater.toFixed(2)} ₽/кг</div>
                      </div>
                      <div>
                        <div className="result-lbl">Точка безубыточности</div>
                        <div className="result-num" style={{ color: 'var(--amber)' }}>
                          {storageResult.breakEvenFuturePrice.toFixed(1)} ₽/кг
                        </div>
                      </div>
                    </div>

                    <div style={{ background: 'var(--surface2)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, lineHeight: 1.55 }}>
                      <div>• Чистая выручка сейчас (за вычетом сбыта): <strong>{storageResult.netNowPerKgStored.toFixed(2)} ₽/кг</strong></div>
                      <div>• Чистая выручка позже на 1 кг заложенного: <strong>{storageResult.netLaterPerKgStored.toFixed(2)} ₽/кг</strong></div>
                      <div>• Чистая выручка позже на 1 кг фактически проданного: <strong>{storageResult.netLaterPerKgSold?.toFixed(2)} ₽/кг</strong></div>
                      <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 6, marginTop: 4, color: 'var(--txt2)' }}>
                        Для окупаемости хранения будущая цена должна быть не ниже <strong>{storageResult.breakEvenFuturePrice.toFixed(1)} ₽/кг</strong> (рост от текущей на +{storageResult.breakEvenMarkupPct.toFixed(0)}%).
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: 'var(--red)', fontSize: 12 }}>{storageResult.reason}</div>
                )}
              </div>
            </div>

            {/* Sensitivity Grid */}
            <div className="panel">
              <div className="panel-hd">
                <span className="panel-title">Чувствительность к потерям (усушка + гниль)</span>
              </div>
              <div className="panel-body" style={{ padding: 0 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Суммарные потери</th>
                      <th>Эффект на 1 кг заложенного</th>
                      <th>Безубыточная цена продажи</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lossSens.map((ls, idx) => (
                      <tr key={idx}>
                        <td className="fw">{ls.totalLossPct}% потерь</td>
                        <td className={`mono ${ls.gain >= 0 ? 'up' : 'dn'}`}>
                          {ls.gain >= 0 ? `+${ls.gain.toFixed(2)}` : ls.gain.toFixed(2)} ₽/кг
                        </td>
                        <td className="mono">
                          {ls.breakEvenFuturePrice ? `${ls.breakEvenFuturePrice.toFixed(1)} ₽/кг` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Price Uncertainty Sensitivity */}
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="panel-hd">
                <span className="panel-title">Чувствительность к будущей цене продажи</span>
              </div>
              <div className="panel-body" style={{ padding: 0 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Сценарий цены</th>
                      <th>Цена продажи</th>
                      <th>Эффект на 1 кг заложенного</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceSens.map((ps, idx) => (
                      <tr key={idx}>
                        <td className="fw">{ps.label}</td>
                        <td className="mono">{ps.price.toFixed(1)} ₽/кг</td>
                        <td className={`mono ${ps.gain != null && ps.gain >= 0 ? 'up' : 'dn'}`}>
                          {ps.gain != null ? (ps.gain >= 0 ? `+${ps.gain.toFixed(2)}` : ps.gain.toFixed(2)) : '—'} ₽/кг
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'field' && (
        <div className="row-2">
          {/* Field Calculator */}
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Калькулятор гектара и валового сбора</span>
            </div>
            <div className="panel-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="inp-row">
                  <span className="inp-label">Культура:</span>
                  <select
                    value={fieldCrop}
                    onChange={e => {
                      const id = e.target.value;
                      setFieldCrop(id);
                      const d = CROP_DEFAULTS[id] || { yield: 55, price: 15, cost: 780 };
                      setYld(d.yield);
                      setCostPerHa(d.cost);
                      setPrice(id === 'onion' ? whPrice : d.price);
                    }}
                    style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--txt)' }}
                  >
                    {Object.values(CROPS).map(c => (
                      <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
                    ))}
                  </select>
                </div>

                <div className="inp-row">
                  <span className="inp-label">Площадь посева (га):</span>
                  <input type="range" min="1" max="500" step="1" value={area} onChange={e => setArea(Number(e.target.value))} />
                  <span className="inp-val">{area} га</span>
                </div>

                <div className="inp-row">
                  <span className="inp-label">Урожайность (т/га):</span>
                  <input type="range" min="5" max="80" step="1" value={yld} onChange={e => setYld(Number(e.target.value))} />
                  <span className="inp-val">{yld} т/га</span>
                </div>

                <div className="inp-row">
                  <span className="inp-label">Цена реализации (₽/кг):</span>
                  <input type="range" min="5" max="150" step="0.5" value={price} onChange={e => setPrice(Number(e.target.value))} />
                  <span className="inp-val">{price.toFixed(1)} ₽</span>
                </div>

                <div className="inp-row">
                  <span className="inp-label">Затраты на гектар (тыс. ₽/га):</span>
                  <input type="range" min="100" max="1500" step="20" value={costPerHa} onChange={e => setCostPerHa(Number(e.target.value))} />
                  <span className="inp-val">{costPerHa} тыс. ₽</span>
                </div>
              </div>

              <div className="result-panel" style={{ marginTop: 16 }}>
                <div className="result-grid">
                  <div>
                    <div className="result-lbl">Выручка</div>
                    <div className="result-num">{fmt(revenue)}</div>
                  </div>
                  <div>
                    <div className="result-lbl">Затраты поля</div>
                    <div className="result-num cost">{fmt(costs)}</div>
                  </div>
                  <div>
                    <div className="result-lbl">Прибыль поля</div>
                    <div className={`result-num ${fieldProfit >= 0 ? 'up' : 'dn'}`}>{fmt(fieldProfit)}</div>
                  </div>
                </div>

                <div className="divider" />

                <div className="col-pair">
                  <div>
                    <div className="result-lbl">Рентабельность (ROI)</div>
                    <div className={`result-num ${roi >= 0 ? 'up' : 'dn'}`}>{roi}%</div>
                  </div>
                  <div>
                    <div className="result-lbl">Прибыль на 1 гектар</div>
                    <div className={`result-num ${perHa >= 0 ? 'up' : 'dn'}`}>{fmt(perHa)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd"><span className="panel-title">Справочные нормативы</span></div>
            <div className="panel-body" style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6 }}>
              <div>Показатели урожайности и полевых затрат являются базовыми региональными нормативами и могут быть скорректированы под агротехнологию конкретного хозяйства.</div>
              <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 4, border: '1px solid var(--border)' }}>
                💡 <strong>Важное различие:</strong> Полевые затраты (себестоимость) являются невозвратными издержками (sunk cost) при принятии решения об отгрузке. Решение продать сейчас или заложить в хранилище принимается сравнением чистой выручки сегодня с чистой будущей выручкой с учетом усушки, порчи и стоимости денег.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
