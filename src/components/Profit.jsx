import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { evaluateStorage, lossSensitivity, priceSensitivity } from '../../shared/storageEconomics.js';
import { officialForecast } from '../../shared/officialData.js';
import { CROP_PROFILES, CROP_TYPES, getCropProfile } from '../../shared/cropProfiles.js';
import { buildWeeklyDecisionPlan } from '../../shared/weeklyDecisionPlan.js';

function fmtMoney(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)} млн ₽`;
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)} тыс. ₽`;
  return `${s}${Math.round(a)} ₽`;
}

export default function Profit() {
  const { model, updateAssumptions } = useMarket();

  const [activeTab, setActiveTab] = useState('storage');
  const [storageCrop, setStorageCrop] = useState('onion');

  const onionWh = model.prices.warehouse.exVat ?? CROP_PROFILES.onion.benchmarkWarehousePrice;
  const defaultOnionPlan = buildWeeklyDecisionPlan({
    cropId: 'onion',
    cropProfile: CROP_PROFILES.onion,
    officialForecast: officialForecast.issueDate <= model.today ? officialForecast : null,
    today: model.today,
    baseWarehousePrice: onionWh,
    bridge: model.bridge,
    storageParams: model.storage?.params ?? CROP_PROFILES.onion.storageParams,
    scenarioDeltaPct: 0,
  });

  const spInit = model.storage?.params ?? CROP_PROFILES.onion.storageParams;
  const [pNow, setPNow] = useState(onionWh);
  const [pFuture, setPFuture] = useState(defaultOnionPlan.peakWeek.whPrice);
  const [months, setMonths] = useState(spInit.months ?? 4.5);
  const [shrinkPct, setShrinkPct] = useState(spInit.shrinkPct ?? 6);
  const [rotPct, setRotPct] = useState(spInit.rotPct ?? 4);
  const [downgradeSharePct, setDowngradeSharePct] = useState(spInit.downgradeSharePct ?? 10);
  const [downgradeDiscountPct, setDowngradeDiscountPct] = useState(spInit.downgradeDiscountPct ?? 15);
  const [energyRubKgMonth, setEnergyRubKgMonth] = useState(spInit.energyRubKgMonth ?? 0.35);
  const [handlingRubKg, setHandlingRubKg] = useState(spInit.handlingRubKg ?? 0.5);
  const [sortingRubKgSold, setSortingRubKgSold] = useState(spInit.sortingRubKgSold ?? 0.6);
  const [financingRatePctYear, setFinancingRatePctYear] = useState(spInit.financingRatePctYear ?? 16);
  const [sellNowCostRubKg, setSellNowCostRubKg] = useState(spInit.sellNowCostRubKg ?? 0.2);
  const [acquisitionCostRubKg, setAcquisitionCostRubKg] = useState(spInit.acquisitionCostRubKg ?? 12.0);
  const [shareNow, setShareNow] = useState(25);
  const [saveMsg, setSaveMsg] = useState('');

  // Field calculator state
  const [fieldCrop, setFieldCrop] = useState('onion');
  const [area, setArea] = useState(20);
  const [yld, setYld] = useState(55);
  const [salePrice, setSalePrice] = useState(onionWh);
  const [costPerHa, setCostPerHa] = useState(780);

  function handleSelectStorageCrop(id) {
    setStorageCrop(id);
    const p = getCropProfile(id);
    if (p.type === CROP_TYPES.STORAGE) {
      const sp = p.storageParams;
      const nowP = id === 'onion' ? onionWh : p.benchmarkWarehousePrice;
      const futP =
        id === 'onion'
          ? defaultOnionPlan.peakWeek.whPrice
          : +(nowP * (p.seasonalMultipliers?.[19] ?? 1.45)).toFixed(1);
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

  function handleSelectFieldCrop(id) {
    setFieldCrop(id);
    const p = getCropProfile(id);
    setYld(p.yield ?? 45);
    setCostPerHa(p.costPerHa ?? 600);
    setSalePrice(id === 'onion' ? onionWh : p.benchmarkWarehousePrice);
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

  const revenueRub = area * yld * salePrice * 1000;
  const costsRub = area * costPerHa * 1000;
  const fieldProfitRub = revenueRub - costsRub;
  const fieldRoi = costsRub > 0 ? Math.round((fieldProfitRub / costsRub) * 100) : 0;

  async function handleSaveStorage() {
    const ok = await updateAssumptions({ storage: currentParams });
    setSaveMsg(ok ? 'Параметры сохранены' : 'Ошибка сохранения');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="basis-switcher" style={{ alignSelf: 'flex-start' }}>
        <button
          type="button"
          className={`basis-btn ${activeTab === 'storage' ? 'active' : ''}`}
          onClick={() => setActiveTab('storage')}
        >
          🏬 Экономика хранения: Продать сейчас vs Хранить до весны
        </button>
        <button
          type="button"
          className={`basis-btn ${activeTab === 'field' ? 'active' : ''}`}
          onClick={() => setActiveTab('field')}
        >
          🚜 Калькулятор поля: Себестоимость и прибыль с гектара
        </button>
      </div>

      {activeTab === 'storage' ? (
        <div className="row-2">
          {/* Storage Sliders & Inputs */}
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Параметры закладки, потерь и издержек</span>
              <select
                aria-label="Культура для расчёта хранения"
                value={storageCrop}
                onChange={(e) => handleSelectStorageCrop(e.target.value)}
                style={{ width: 'auto', padding: '4px 10px', fontSize: 11, fontWeight: 600 }}
              >
                {Object.values(CROP_PROFILES)
                  .filter((c) => c.type === CROP_TYPES.STORAGE)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.label}
                    </option>
                  ))}
              </select>
            </div>
            <div className="panel-body">
              <div className="inp-row">
                <span className="inp-label">Цена со склада сейчас</span>
                <input type="range" min="5" max="150" step="0.5" value={pNow} onChange={(e) => setPNow(Number(e.target.value))} />
                <span className="inp-val">{pNow.toFixed(1)} ₽</span>
              </div>
              <div className="inp-row">
                <span className="inp-label">Целевая цена весной</span>
                <input type="range" min="5" max="220" step="0.5" value={pFuture} onChange={(e) => setPFuture(Number(e.target.value))} />
                <span className="inp-val">{pFuture.toFixed(1)} ₽</span>
              </div>
              <div className="inp-row">
                <span className="inp-label">Срок хранения (мес.)</span>
                <input type="range" min="1" max="7" step="0.5" value={months} onChange={(e) => setMonths(Number(e.target.value))} />
                <span className="inp-val">{months} мес.</span>
              </div>
              <div className="inp-row">
                <span className="inp-label">Естественная усушка (%)</span>
                <input type="range" min="1" max="18" step="0.5" value={shrinkPct} onChange={(e) => setShrinkPct(Number(e.target.value))} />
                <span className="inp-val">{shrinkPct}%</span>
              </div>
              <div className="inp-row">
                <span className="inp-label">Потери от гнили / брака (%)</span>
                <input type="range" min="0" max="20" step="0.5" value={rotPct} onChange={(e) => setRotPct(Number(e.target.value))} />
                <span className="inp-val">{rotPct}%</span>
              </div>
              <div className="inp-row">
                <span className="inp-label">Доля продажи сразу с осени</span>
                <input type="range" min="0" max="100" step="5" value={shareNow} onChange={(e) => setShareNow(Number(e.target.value))} />
                <span className="inp-val">{shareNow}%</span>
              </div>

              <div className="divider" />

              <div className="col-pair" style={{ fontSize: 11 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  Электроэнергия (₽/кг/мес)
                  <input type="number" step="0.05" value={energyRubKgMonth} onChange={(e) => setEnergyRubKgMonth(Number(e.target.value) || 0)} style={{ padding: 6 }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  Сортировка при выгрузке (₽/кг)
                  <input type="number" step="0.1" value={sortingRubKgSold} onChange={(e) => setSortingRubKgSold(Number(e.target.value) || 0)} style={{ padding: 6 }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  Ставка финансирования (% год.)
                  <input type="number" step="0.5" value={financingRatePctYear} onChange={(e) => setFinancingRatePctYear(Number(e.target.value) || 0)} style={{ padding: 6 }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  Закладка / погрузка (₽/кг)
                  <input type="number" step="0.1" value={handlingRubKg} onChange={(e) => setHandlingRubKg(Number(e.target.value) || 0)} style={{ padding: 6 }} />
                </label>
              </div>

              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button" className="basis-btn active" onClick={handleSaveStorage}>
                  💾 Сохранить нормативы в модели
                </button>
                {saveMsg && <span role="status" style={{ fontSize: 11, color: 'var(--green)' }}>{saveMsg}</span>}
              </div>
            </div>
          </div>

          {/* Decision Result & Sensitivity Tables */}
          <div className="col-stack">
            <div className="panel">
              <div className="panel-hd">
                <span className="panel-title">Экономический результат на 1 кг заложенного урожая</span>
                {storageResult.status === 'ok' && (
                  <span className={`badge ${storageResult.gain >= 0 ? 'up' : 'dn'}`}>
                    {storageResult.gain >= 0 ? 'ХРАНЕНИЕ ВЫГОДНО' : 'ВЫГОДНЕЕ ПРОДАТЬ СЕЙЧАС'}
                  </span>
                )}
              </div>
              <div className="panel-body">
                {storageResult.status === 'ok' ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                      <div>
                        <div className="stat-label">Чистый выигрыш хранения (с учётом ставки ЦБ)</div>
                        <div className={`big-num ${storageResult.gain >= 0 ? 'up' : 'dn'}`} style={{ color: storageResult.gain >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {storageResult.gain >= 0 ? `+${storageResult.gain.toFixed(2)}` : storageResult.gain.toFixed(2)} ₽/кг
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="stat-label">Смешанный план ({shareNow}% сейчас / {100 - shareNow}% весной)</div>
                        <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
                          {((shareNow / 100) * storageResult.netNowPerKgStored + ((100 - shareNow) / 100) * storageResult.netLaterPerKgStored).toFixed(2)} ₽/кг
                        </div>
                      </div>
                    </div>

                    <div className="result-panel">
                      <div className="result-grid">
                        <div>
                          <div className="result-lbl">Товарный выход</div>
                          <div className="result-num">{(storageResult.saleableYield * 100).toFixed(1)}%</div>
                        </div>
                        <div>
                          <div className="result-lbl">Чистыми весной</div>
                          <div className="result-num profit">{storageResult.netLaterPerKgStored.toFixed(2)} ₽</div>
                        </div>
                        <div>
                          <div className="result-lbl">Точка безубыточности</div>
                          <div className="result-num" style={{ color: 'var(--amber)' }}>
                            {storageResult.breakEvenFuturePrice.toFixed(1)} ₽/кг
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p>{storageResult.reason}</p>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-hd">
                <span className="panel-title">Чувствительность к потерям и цене продажи</span>
              </div>
              <div className="table-wrapper" role="region" tabIndex={0} aria-label="Таблица чувствительности экономики хранения">
                <table className="tbl sticky-hd">
                  <thead>
                    <tr>
                      <th className="pl">Суммарные потери</th>
                      <th>Выигрыш хранения</th>
                      <th>Безубыточная цена</th>
                      <th>Сценарий цены</th>
                      <th>Эффект при цене</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lossSens.map((ls, idx) => {
                      const ps = priceSens[idx];
                      return (
                        <tr key={ls.totalLossPct}>
                          <td className="pl fw">{ls.totalLossPct}% потерь</td>
                          <td className={`mono ${ls.gain >= 0 ? 'up' : 'dn'}`}>
                            {ls.gain >= 0 ? `+${ls.gain.toFixed(2)}` : ls.gain.toFixed(2)} ₽
                          </td>
                          <td className="mono">{ls.breakEvenFuturePrice?.toFixed(1) ?? '—'} ₽</td>
                          <td className="mono">{ps ? `${ps.futurePrice.toFixed(1)} ₽ (${ps.label})` : '—'}</td>
                          <td className={`mono ${ps && ps.gain >= 0 ? 'up' : 'dn'}`}>
                            {ps ? `${ps.gain >= 0 ? '+' : ''}${ps.gain.toFixed(2)} ₽` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="row-2">
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Параметры поля и агротехнологии</span>
              <select
                aria-label="Культура для расчёта поля"
                value={fieldCrop}
                onChange={(e) => handleSelectFieldCrop(e.target.value)}
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
                <span className="inp-label">Площадь посева (га)</span>
                <input type="range" min="1" max="300" step="1" value={area} onChange={(e) => setArea(Number(e.target.value))} />
                <span className="inp-val">{area} га</span>
              </div>
              <div className="inp-row">
                <span className="inp-label">Товарная урожайность (т/га)</span>
                <input type="range" min="5" max="90" step="1" value={yld} onChange={(e) => setYld(Number(e.target.value))} />
                <span className="inp-val">{yld} т/га</span>
              </div>
              <div className="inp-row">
                <span className="inp-label">Цена реализации EXW (₽/кг)</span>
                <input type="range" min="5" max="150" step="0.5" value={salePrice} onChange={(e) => setSalePrice(Number(e.target.value))} />
                <span className="inp-val">{salePrice.toFixed(1)} ₽</span>
              </div>
              <div className="inp-row">
                <span className="inp-label">Затраты на 1 га (тыс. ₽)</span>
                <input type="range" min="150" max="1200" step="10" value={costPerHa} onChange={(e) => setCostPerHa(Number(e.target.value))} />
                <span className="inp-val">{costPerHa} тыс.</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Финансовый результат уборочной кампании</span>
              <span className={`badge ${fieldProfitRub >= 0 ? 'up' : 'dn'}`}>ROI: {fieldRoi}%</span>
            </div>
            <div className="panel-body">
              <div className="stat-label">Чистая прибыль со всей площади ({area} га · валовой сбор {area * yld} т)</div>
              <div className="big-num" style={{ color: fieldProfitRub >= 0 ? 'var(--green)' : 'var(--red)', marginBottom: 12 }}>
                {fmtMoney(fieldProfitRub)}
              </div>
              <div className="result-panel">
                <div className="result-grid">
                  <div>
                    <div className="result-lbl">Выручка</div>
                    <div className="result-num">{fmtMoney(revenueRub)}</div>
                  </div>
                  <div>
                    <div className="result-lbl">Себестоимость 1 кг</div>
                    <div className="result-num cost">{(costPerHa / yld).toFixed(2)} ₽/кг</div>
                  </div>
                  <div>
                    <div className="result-lbl">Прибыль на 1 га</div>
                    <div className="result-num profit">{fmtMoney(fieldProfitRub / area)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
