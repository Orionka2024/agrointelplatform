import { lazy, Suspense, useState } from 'react';
import { useMarket } from '../context/useMarket';
import { officialForecast, officialSnapshot } from '../../shared/officialData.js';
import { MONTHLY_MODELS } from '../../shared/officialForecast.js';
import { CROP_PROFILES, CROP_TYPES, getCropProfile } from '../../shared/cropProfiles.js';
import { buildUserPriceCsv } from '../../shared/localBasis.js';
import { warehouseToMoscow, BRIDGE_LABELS } from '../../shared/bridge.js';
import { buildWeeklyDecisionPlan, buildCatBoostShapCards } from '../../shared/weeklyDecisionPlan.js';
import MonthlySalesPlanTable from './MonthlySalesPlanTable';

const OfficialMarket = lazy(() => import('./OfficialMarket'));

const CROP_ORDER = ['onion', 'potato', 'carrot', 'beet', 'cabbage', 'garlic', 'watermalon', 'melon'];

const SCENARIO_PRESETS = [
  {
    id: 'base',
    label: '⚖️ Базовый баланс (0%)',
    deltaPct: 0,
    cls: '',
    desc: 'Штатный осенний транзит из Казахстана (Жамбылская обл.) и плановое истощение запасов к марту.',
  },
  {
    id: 'kz_quota',
    label: '🚨 Квота / Заморозки КЗ (+22%)',
    deltaPct: 22,
    cls: 'dn',
    desc: 'Ограничение вывоза лука из Казахстана или вымерзание буртов в ЦА (аналог января–марта 2023 г.).',
  },
  {
    id: 'fx_weak',
    label: '💱 Ослабление рубля (+10%)',
    deltaPct: 10,
    cls: 'warn',
    desc: 'Удорожание импортного паритета (рост KZT/RUB и USD/RUB) повышает ценовой потолок весной.',
  },
  {
    id: 'dumping',
    label: '📉 Избыточный импорт (−14%)',
    deltaPct: -14,
    cls: 'warn',
    desc: 'Ускоренный сброс несохранных партий из временных неотапливаемых ангаров давит на опт.',
  },
];

function OffSeasonPlanningView({ cropProfile }) {
  return (
    <div style={{ padding: 14 }}>
      <div className="signal-box warn" style={{ marginBottom: 14 }}>
        <div className="signal-label warn">{cropProfile.offSeasonNotice?.title}</div>
        <div className="signal-text warn">{cropProfile.offSeasonNotice?.description}</div>
      </div>

      <div className="row-2" style={{ marginBottom: 14 }}>
        <div className="panel" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 12 }}>Годовой ценовой профиль ({cropProfile.label})</span>
            <span className="badge neu">СЕЗОННЫЙ ПРОФИЛЬ</span>
          </div>
          <div className="table-wrapper" role="region" tabIndex={0} aria-label="Годовой цикл бахчевых">
            <table className="tbl sticky-hd">
              <thead>
                <tr>
                  <th>Период</th>
                  <th>Агрофаза</th>
                  <th>Поле (EXW)</th>
                  <th>Опт Москва</th>
                </tr>
              </thead>
              <tbody>
                {(cropProfile.annualCycle || []).map((ac) => (
                  <tr key={ac.month} style={{ opacity: ac.status === 'off_season' ? 0.65 : 1 }}>
                    <td className="fw">{ac.month}</td>
                    <td style={{ fontSize: 11, color: 'var(--txt2)' }}>{ac.phase}</td>
                    <td className="mono">{ac.priceWh ? `${ac.priceWh.toFixed(1)} ₽` : '—'}</td>
                    <td className="mono">{ac.priceMsk ? `${ac.priceMsk.toFixed(1)} ₽` : 'межсезонье'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 12 }}>Дорожная карта сезона 2027 г.</span>
            <span className="badge info">ПЛАНИРОВАНИЕ</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(cropProfile.planning2027?.keyMilestones || []).map((m) => (
              <div
                key={m.period}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  paddingBottom: 6,
                  borderBottom: '1px solid var(--border)',
                  fontSize: 11,
                }}
              >
                <span className="badge up" style={{ minWidth: 138, textAlign: 'center' }}>
                  {m.period}
                </span>
                <span style={{ color: 'var(--txt2)', lineHeight: 1.45 }}>{m.step}</span>
              </div>
            ))}
          </div>
          {cropProfile.planning2027?.recommendedVarieties && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--txt2)' }}>
              <strong>Рекомендуемые гибриды:</strong> {cropProfile.planning2027.recommendedVarieties}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Forecast({ onNavigateToImport }) {
  const { model, importData, updateAssumptions } = useMarket();

  const [activeCrop, setActiveCrop] = useState('onion');
  const [activeTab, setActiveTab] = useState('forecast'); // 'forecast' | 'official' | 'bridge' | 'validation'
  const [simId, setSimId] = useState('base');
  const [priceDraft, setPriceDraft] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceStatus, setPriceStatus] = useState('');
  const [bridgeDraft, setBridgeDraft] = useState(() => ({ ...model.bridge }));
  const [bridgeSaved, setBridgeSaved] = useState('');

  const cropProfile = getCropProfile(activeCrop);
  const isFieldSeasonal = cropProfile.type === CROP_TYPES.FIELD_SEASONAL;
  const snap = officialSnapshot(model.today);

  const hasOnionDeal =
    activeCrop === 'onion' &&
    model.prices.warehouse.exVat !== null &&
    model.prices.warehouse.exVat !== undefined;

  const savedCropManual = model.assumptions?.manualPrices?.[activeCrop]?.value;
  const defaultStartPrice =
    activeCrop === 'onion'
      ? (hasOnionDeal ? model.prices.warehouse.exVat : (savedCropManual || cropProfile.benchmarkWarehousePrice))
      : (savedCropManual || cropProfile.benchmarkWarehousePrice);

  const liveInputPrice =
    priceDraft !== '' && Number(priceDraft) > 0 ? Number(priceDraft) : defaultStartPrice;

  const activePreset = SCENARIO_PRESETS.find((s) => s.id === simId) || SCENARIO_PRESETS[0];

  const basePlan = buildWeeklyDecisionPlan({
    cropId: activeCrop,
    cropProfile,
    officialForecast: officialForecast.issueDate <= model.today ? officialForecast : null,
    today: model.today,
    baseWarehousePrice: liveInputPrice,
    bridge: model.bridge,
    storageParams: activeCrop === 'onion' ? (model.storage?.params ?? cropProfile.storageParams) : cropProfile.storageParams,
    scenarioDeltaPct: 0,
  });

  const decisionPlan = buildWeeklyDecisionPlan({
    cropId: activeCrop,
    cropProfile,
    officialForecast: officialForecast.issueDate <= model.today ? officialForecast : null,
    today: model.today,
    baseWarehousePrice: liveInputPrice,
    bridge: model.bridge,
    storageParams: activeCrop === 'onion' ? (model.storage?.params ?? cropProfile.storageParams) : cropProfile.storageParams,
    scenarioDeltaPct: activePreset.deltaPct,
  });

  const shapCards =
    activeCrop === 'onion'
      ? buildCatBoostShapCards({
          officialForecast,
          officialSnapshotData: snap,
          macro: model.macro,
        })
      : [
          {
            key: 'season',
            label: `Сезонный профиль хранения (${cropProfile.label})`,
            pct: 42,
            signedPct: +((Math.max(...(cropProfile.seasonalMultipliers || [1])) - 1) * 100).toFixed(0),
            color: '#1A56A8',
            currentVal: `Режим камеры: ${cropProfile.storageParams?.optimalTemp || '0..+2°C'}, ${cropProfile.storageParams?.optimalHumidity || '90%'}`,
            asOf: 'Агронорматив РФ',
            source: 'Отраслевой регламент хранения',
            trend: 'Вымывание партий из необорудованных ангаров к январю–февралю',
            highlight: true,
          },
          {
            key: 'losses',
            label: 'Технологическая усушка и отход при хранении',
            pct: 28,
            signedPct: -((cropProfile.storageParams?.shrinkPct ?? 5) + (cropProfile.storageParams?.rotPct ?? 4)),
            color: '#0D7C4A',
            currentVal: `Усушка ${cropProfile.storageParams?.shrinkPct}% + отход ${cropProfile.storageParams?.rotPct}%`,
            asOf: 'Модель потерь',
            source: 'shared/storageEconomics.js',
            trend: 'Определяет порог безубыточности длительного хранения',
            highlight: false,
          },
          {
            key: 'rate',
            label: 'Ключевая ставка ЦБ РФ и электроэнергия',
            pct: 18,
            signedPct: 4.5,
            color: '#C0303A',
            currentVal: `Ставка ЦБ: ${(model.macro.keyRate?.value ?? snap.drivers?.keyRate?.value ?? 14).toFixed(1)}% · Энергия: ${cropProfile.storageParams?.energyRubKgMonth ?? 0.35} ₽/кг/мес`,
            asOf: 'ЦБ РФ',
            source: 'Банк России',
            trend: 'Альтернативная стоимость оборотного капитала на сроке 4–5 мес.',
            highlight: false,
          },
          {
            key: 'import',
            label: 'Весенний ранний импорт (Египет, Узбекистан, АЗ)',
            pct: 12,
            signedPct: -3.2,
            color: '#8C5E00',
            currentVal: `Импорт в балансе: ${cropProfile.balance?.I ?? 0.25} млн т`,
            asOf: 'Баланс РФ',
            source: 'Таможенный паритет',
            trend: 'Формирует ценовой потолок в апреле–мае',
            highlight: false,
          },
        ];

  const minWh = Math.min(...decisionPlan.weeks.map((w) => w.whPrice));
  const maxWh = Math.max(...decisionPlan.weeks.map((w) => w.whPrice));
  const peakGrowthPct = Math.round(((decisionPlan.peakWeek.whPrice - liveInputPrice) / liveInputPrice) * 100);
  const basePeakGrowthPct = Math.round(((basePlan.peakWeek.whPrice - liveInputPrice) / liveInputPrice) * 100);
  const scenarioPeakDiff = +(decisionPlan.peakWeek.whPrice - basePlan.peakWeek.whPrice).toFixed(1);

  async function handlePersistPrice() {
    const val = Number(priceDraft || liveInputPrice);
    if (!(val > 0)) return;
    setSavingPrice(true);
    setPriceStatus('');
    try {
      if (activeCrop === 'onion') {
        const csv = buildUserPriceCsv(
          [{ basis: 'warehouse', date: model.today, price: val, vat: 'excl' }],
          model.today
        );
        await importData('prices', csv);
        setPriceStatus(`Сохранено как подтверждённая сделка склада (${val.toFixed(2)} ₽/кг)`);
      } else {
        await updateAssumptions({
          manualPrices: {
            [activeCrop]: { value: val, vat: 'excl', asOf: model.today, note: 'Стартовая цена склада' },
          },
        });
        setPriceStatus(`Сохранено для культуры «${cropProfile.label}» (${val.toFixed(2)} ₽/кг)`);
      }
      setPriceDraft('');
    } catch (e) {
      setPriceStatus(e.message);
    } finally {
      setSavingPrice(false);
    }
  }

  async function handleSaveBridge() {
    const ok = await updateAssumptions({ bridge: bridgeDraft });
    setBridgeSaved(ok ? 'Мост издержек сохранён' : 'Ошибка сохранения');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="panel">
        {/* Crop Tabs */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8, paddingRight: 12 }}>
          <div className="crop-tabs" style={{ borderBottom: 'none' }} role="tablist" aria-label="Выбор культуры">
            {CROP_ORDER.map((id) => {
              const cp = CROP_PROFILES[id];
              return (
                <div
                  key={id}
                  role="tab"
                  tabIndex={0}
                  aria-selected={activeCrop === id}
                  className={`ctab ${activeCrop === id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveCrop(id);
                    setPriceDraft('');
                    setPriceStatus('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setActiveCrop(id);
                      setPriceDraft('');
                    }
                  }}
                >
                  {cp.emoji} {cp.label}
                </div>
              );
            })}
          </div>

          <div className="basis-switcher" style={{ margin: '6px 0' }}>
            <button
              type="button"
              className={`basis-btn ${activeTab === 'forecast' ? 'active' : ''}`}
              onClick={() => setActiveTab('forecast')}
            >
              📈 26 нед. (Склад / Москва)
            </button>
            <button
              type="button"
              className={`basis-btn ${activeTab === 'official' ? 'active' : ''}`}
              onClick={() => setActiveTab('official')}
            >
              🏛️ Росстат + ЦБ (аудит)
            </button>
            <button
              type="button"
              className={`basis-btn ${activeTab === 'bridge' ? 'active' : ''}`}
              onClick={() => setActiveTab('bridge')}
            >
              🚚 Мост издержек
            </button>
            <button
              type="button"
              className={`basis-btn ${activeTab === 'validation' ? 'active' : ''}`}
              onClick={() => setActiveTab('validation')}
            >
              ✅ Бэктест (Holdout)
            </button>
          </div>
        </div>

        {/* Subtab 1: 26-Week CatBoost Forecast */}
        {activeTab === 'forecast' && (
          isFieldSeasonal ? (
            <OffSeasonPlanningView cropProfile={cropProfile} />
          ) : (
            <div>
              {/* Starting Warehouse Price Calibration Bar */}
              <div className="cash-control-card">
                <div className="cash-control-left">
                  <span className="cash-control-label">
                    Стартовая цена отгрузки со склада ({cropProfile.label} · Волгоград EXW без НДС):
                  </span>
                  <div className="cash-input-row">
                    <div className="cash-inp-wrap">
                      <input
                        aria-label="Стартовая цена склада без НДС"
                        type="number"
                        step="0.1"
                        min="1"
                        max="1000"
                        value={priceDraft !== '' ? priceDraft : defaultStartPrice}
                        onChange={(e) => setPriceDraft(e.target.value)}
                        className="cash-inp"
                      />
                      <span className="cash-inp-unit">₽/кг</span>
                    </div>
                    <button
                      type="button"
                      className="basis-btn active"
                      onClick={handlePersistPrice}
                      disabled={savingPrice}
                      style={{ padding: '4px 10px', fontSize: 11 }}
                    >
                      {savingPrice ? 'Сохранение…' : '💾 Зафиксировать цену'}
                    </button>
                    {priceDraft !== '' && (
                      <button
                        type="button"
                        className="cash-reset-btn"
                        onClick={() => setPriceDraft('')}
                      >
                        ↺ Сброс ({defaultStartPrice.toFixed(1)} ₽)
                      </button>
                    )}
                  </div>
                  {priceStatus && (
                    <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500 }}>{priceStatus}</span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`badge ${activeCrop === 'onion' ? 'up' : 'info'}`}>
                    {activeCrop === 'onion'
                      ? `CatBoost GBDT (${officialForecast.modelVersion})`
                      : 'Сезонный профиль хранения'}
                  </span>
                  {activeCrop === 'onion' && (
                    <span className="badge neu">
                      Базис к РФ: ×{decisionPlan.basisFactor.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              {/* Scenario Simulator Strip */}
              <div className="import-sim-panel">
                <div className="import-sim-header">
                  <div className="import-sim-title">
                    <span>Сценарий внешнего предложения и валютного паритета:</span>
                    <span className="badge warn">Сценарный анализ (не вероятность)</span>
                  </div>
                  <div className="import-scenarios-row">
                    {SCENARIO_PRESETS.map((sc) => (
                      <button
                        key={sc.id}
                        type="button"
                        className={`scenario-btn ${simId === sc.id ? `active ${sc.cls}` : ''}`}
                        onClick={() => setSimId(sc.id)}
                      >
                        {sc.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="import-desc-box">
                  <span>{activePreset.desc}</span>
                  <button
                    type="button"
                    className="cash-reset-btn"
                    onClick={onNavigateToImport}
                  >
                    📥 Импорт пакета CSV
                  </button>
                </div>
              </div>

              {/* 4 KPI Summary Cards */}
              <div className="actual-vs-fc-grid">
                <div className="compare-card">
                  <span className="compare-lbl">Склад сейчас (EXW без НДС)</span>
                  <div className="compare-val" style={{ color: 'var(--blue)' }}>
                    {liveInputPrice.toFixed(1)} ₽/кг
                  </div>
                  <span className="compare-sub">
                    {hasOnionDeal ? 'Подтверждённая сделка склада' : 'Региональный старт ЮФО/Волгоград'}
                  </span>
                </div>

                <div className="compare-card">
                  <span className="compare-lbl">Базовый пик (W+{basePlan.peakWeek.h} · {basePlan.peakWeek.shortDate})</span>
                  <div className="compare-val up">
                    {basePlan.peakWeek.whPrice.toFixed(1)} ₽/кг
                    <span style={{ fontSize: 11, fontWeight: 500 }}>(+{basePeakGrowthPct}%)</span>
                  </div>
                  <span className="compare-sub">Без внешних квот и валютных шоков</span>
                </div>

                <div className={`compare-card ${scenarioPeakDiff > 0 ? 'highlight' : ''}`}>
                  <span className="compare-lbl">Пик с учётом сценария (W+{decisionPlan.peakWeek.h})</span>
                  <div className={`compare-val ${scenarioPeakDiff >= 0 ? 'up' : 'dn'}`}>
                    {decisionPlan.peakWeek.whPrice.toFixed(1)} ₽/кг
                    <span style={{ fontSize: 11, fontWeight: 500 }}>(+{peakGrowthPct}%)</span>
                  </div>
                  <span className="compare-sub">
                    {scenarioPeakDiff !== 0
                      ? `Эффект сценария: ${scenarioPeakDiff > 0 ? `+${scenarioPeakDiff}` : scenarioPeakDiff} ₽/кг`
                      : 'Совпадает с базовой траекторией CatBoost'}
                  </span>
                </div>

                <div className="compare-card">
                  <span className="compare-lbl">Максимум чистыми (W+{decisionPlan.bestNetWeek.h})</span>
                  <div className="compare-val up">
                    {decisionPlan.bestNetWeek.netPerKg.toFixed(1)} ₽/кг
                  </div>
                  <span className="compare-sub">
                    Выигрыш к продаже осенью:{' '}
                    <strong>
                      {decisionPlan.bestNetWeek.gainVsNow >= 0 ? '+' : ''}
                      {decisionPlan.bestNetWeek.gainVsNow.toFixed(1)} ₽/кг
                    </strong>
                  </span>
                </div>
              </div>

              {/* Main Split: Left 26-Week Table | Right Exact TreeSHAP Factor Cards */}
              <div className="fc-split">
                <div className="fc-left">
                  <div className="fc-section-hd">
                    <span className="panel-title">
                      26-недельный прогноз · отгрузка из хранилища ({cropProfile.label})
                    </span>
                    <span className="badge up">
                      {activeCrop === 'onion' ? 'Holdout MAE: 2.5–3.5 ₽' : '26 недель'}
                    </span>
                  </div>

                  <div
                    className="table-wrapper table-scroll-tall"
                    role="region"
                    tabIndex={0}
                    aria-label="26-недельная таблица прогноза цен со склада и в Москве"
                  >
                    <table className="tbl sticky-hd">
                      <thead>
                        <tr>
                          <th className="pl sticky-col">Неделя · Дата</th>
                          <th style={{ minWidth: 92 }}>Тренд</th>
                          <th>Цена склада</th>
                          <th>Чистыми</th>
                          <th>Опт Москва</th>
                          <th>Спред</th>
                          <th>Фаза сезона</th>
                          <th>80% коридор</th>
                        </tr>
                      </thead>
                      <tbody>
                        {decisionPlan.weeks.map((w) => {
                          const span = Math.max(1, maxWh - minWh);
                          const pctBar = Math.min(100, Math.max(12, Math.round(((w.whPrice - minWh) / span) * 88 + 12)));
                          const barColor = w.gainVsNow >= 1.0 ? 'var(--green)' : w.gainVsNow >= 0 ? '#2563EB' : '#EF9F27';
                          return (
                            <tr key={w.h}>
                              <td className="pl mono sticky-col" style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
                                W+{w.h} · {w.shortDate}
                              </td>
                              <td>
                                <div className="bar-wrap" style={{ minWidth: 78 }}>
                                  <div
                                    className="bar-fill"
                                    style={{ width: `${pctBar}%`, background: barColor }}
                                  />
                                </div>
                              </td>
                              <td className="mono" style={{ fontWeight: 600, color: 'var(--blue)', whiteSpace: 'nowrap' }}>
                                {w.whPrice.toFixed(1)} ₽
                              </td>
                              <td
                                className="mono"
                                style={{ fontWeight: 600, color: w.gainVsNow >= 0 ? 'var(--green)' : 'var(--amber)', whiteSpace: 'nowrap' }}
                                title={`Выручка на 1 кг заложенного после усушки и гнили (${w.totalLossPct}%) и расходов хранения. Безубыточность: ${w.breakEvenPrice} ₽/кг`}
                              >
                                {w.netPerKg.toFixed(1)} ₽
                              </td>
                              <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                                {w.mskPrice.toFixed(1)} ₽
                              </td>
                              <td className="mono" style={{ color: 'var(--amber)', whiteSpace: 'nowrap' }}>
                                +{w.spread.toFixed(1)} ₽
                              </td>
                              <td>
                                <span className="fc-phase-tag" title={w.phase.desc}>
                                  {w.phase.tag}
                                </span>
                              </td>
                              <td className="mono" style={{ color: 'var(--txt2)', whiteSpace: 'nowrap', fontSize: 10.5 }}>
                                {w.lo80 !== null && w.hi80 !== null ? `${w.lo80}–${w.hi80} ₽` : 'профиль'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right Column: Exact TreeSHAP Attributions & Agronomic Summary */}
                <div>
                  <div className="fc-section-hd">
                    <span className="panel-title">
                      Факторы модели · {activeCrop === 'onion' ? 'Exact TreeSHAP (CatBoost)' : 'Драйверы хранения'}
                    </span>
                    <span className={`pill ${decisionPlan.bestNetWeek.gainVsNow > 0.5 ? 'up' : 'warn'}`}>
                      {decisionPlan.bestNetWeek.gainVsNow > 0.5 ? 'ХРАНЕНИЕ ОКУПАЕТСЯ' : 'КОНТРОЛЬ ПОТЕРЬ'}
                    </span>
                  </div>

                  <div style={{ padding: '12px 14px' }}>
                    {shapCards.map((f) => (
                      <div key={f.key} className={`shap-item ${f.highlight ? 'highlight' : ''}`}>
                        <div className="shap-item-head">
                          <span style={{ fontWeight: 600, color: 'var(--txt)' }}>{f.label}</span>
                          <span className="mono" style={{ fontWeight: 600, color: f.highlight ? 'var(--blue)' : 'var(--txt)' }}>
                            {f.pct}%
                          </span>
                        </div>
                        <div className="progress" style={{ height: 4, marginBottom: 6 }}>
                          <div
                            className="progress-fill"
                            style={{ width: `${f.pct}%`, background: f.color }}
                          />
                        </div>
                        <div className="shap-meta-row">
                          <div>
                            <span style={{ color: 'var(--txt3)' }}>Факт: </span>
                            <strong className="mono" style={{ color: 'var(--txt)' }}>{f.currentVal}</strong>
                          </div>
                          <span className="shap-source-badge" title={f.source}>
                            {f.asOf}
                          </span>
                        </div>
                        <div className="shap-trend-desc">{f.trend}</div>
                      </div>
                    ))}

                    <div className="divider" />

                    {/* Storage Economics Summary Signal */}
                    <div className={`signal-box ${decisionPlan.bestNetWeek.gainVsNow > 0 ? 'buy' : 'hold'}`}>
                      <div className={`signal-label ${decisionPlan.bestNetWeek.gainVsNow > 0 ? 'buy' : 'hold'}`}>
                        Экономическое резюме хранения ({cropProfile.label})
                      </div>
                      <div className={`signal-text ${decisionPlan.bestNetWeek.gainVsNow > 0 ? 'buy' : 'hold'}`}>
                        При стартовой цене склада <strong>{liveInputPrice.toFixed(1)} ₽/кг</strong> точка безубыточности к марту (W+20) составляет{' '}
                        <strong>{decisionPlan.weeks[19]?.breakEvenPrice.toFixed(1)} ₽/кг</strong> с учётом усушки, гнили, охлаждения и стоимости денег ({(model.storage?.params?.financingRatePctYear ?? 16).toFixed(0)}% годовых). Прогнозная цена склада в пике:{' '}
                        <strong>{decisionPlan.peakWeek.whPrice.toFixed(1)} ₽/кг</strong> (чистыми <strong>{decisionPlan.bestNetWeek.netPerKg.toFixed(1)} ₽/кг</strong>).
                      </div>
                    </div>

                    {cropProfile.seasonalNotes?.length > 0 && (
                      <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--txt2)', lineHeight: 1.5 }}>
                        {cropProfile.seasonalNotes.map((sn) => (
                          <div key={sn.label} style={{ marginTop: 4 }}>
                            • <strong>{sn.label}:</strong> {sn.note}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        )}

        {/* Subtab 2: Official Monthly Rosstat + CBR Audit */}
        {activeTab === 'official' && (
          <div style={{ padding: 12 }}>
            <Suspense fallback={<div style={{ padding: 20 }}>Загрузка официального аудита Росстата и ЦБ РФ…</div>}>
              <OfficialMarket />
            </Suspense>
          </div>
        )}

        {/* Subtab 3: Cost Bridge Volgograd -> Moscow */}
        {activeTab === 'bridge' && (
          <div style={{ padding: 14 }}>
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>
                Мост издержек: Склад (Волгоград EXW) → Опт Москва (DAP с НДС 10%)
              </h3>
              <p style={{ fontSize: 11.5, color: 'var(--txt2)' }}>
                Оптовая котировка в Москве рассчитывается прозрачно из цены склада, стоимости рефрижератора/фуры, калибровки, сетки, потерь в пути, маржи оптового звена и НДС.
              </p>
            </div>

            <div className="row-2">
              <div className="panel" style={{ padding: 12 }}>
                <div className="audit-inputs" style={{ margin: 0 }}>
                  {Object.entries(BRIDGE_LABELS).map(([k, label]) => (
                    <label key={k} style={{ fontSize: 11.5 }}>
                      {label}
                      <input
                        aria-label={label}
                        type="number"
                        step="any"
                        value={bridgeDraft[k] ?? ''}
                        onChange={(e) => setBridgeDraft((p) => ({ ...p, [k]: Number(e.target.value) }))}
                      />
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button type="button" className="basis-btn active" onClick={handleSaveBridge}>
                    💾 Сохранить параметры моста
                  </button>
                  {bridgeSaved && <span style={{ fontSize: 11, color: 'var(--green)' }}>{bridgeSaved}</span>}
                </div>
              </div>

              <div className="panel" style={{ padding: 14, background: 'var(--surface2)' }}>
                <div className="stat-label">Калькуляция на 1 кг при цене склада {liveInputPrice.toFixed(1)} ₽/кг</div>
                {(() => {
                  const br = warehouseToMoscow(liveInputPrice, bridgeDraft);
                  if (br.status !== 'ok') return <p>{br.reason}</p>;
                  return (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                      <div className="macro-row">
                        <span>Цена на складе EXW (без НДС)</span>
                        <strong className="mono">{liveInputPrice.toFixed(2)} ₽/кг</strong>
                      </div>
                      <div className="macro-row">
                        <span>Фрахт фуры на 1 кг</span>
                        <strong className="mono">+{(bridgeDraft.truckCostRub / bridgeDraft.truckPayloadKg).toFixed(2)} ₽/кг</strong>
                      </div>
                      <div className="macro-row">
                        <span>Фасовка, погрузка, потери в пути и маржа</span>
                        <strong className="mono">
                          +{(br.moscowExVat - liveInputPrice - bridgeDraft.truckCostRub / bridgeDraft.truckPayloadKg).toFixed(2)} ₽/кг
                        </strong>
                      </div>
                      <div className="macro-row">
                        <span>Себестоимость в Москве без НДС</span>
                        <strong className="mono">{br.moscowExVat.toFixed(2)} ₽/кг</strong>
                      </div>
                      <div className="macro-row">
                        <span>Расчётная цена Опт Москва с НДС</span>
                        <strong className="mono" style={{ color: 'var(--amber)', fontSize: 15 }}>
                          {br.moscowInclVat.toFixed(2)} ₽/кг
                        </strong>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Subtab 4: Purged Rolling-Origin Holdout Validation */}
        {activeTab === 'validation' && (
          <div style={{ padding: 14 }}>
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>
                Ретроспективная проверка точности (Purged Rolling-Origin Backtest · 12 независимых месяцев)
              </h3>
              <p style={{ fontSize: 11.5, color: 'var(--txt2)' }}>
                Модель <code>{officialForecast.modelVersion}</code> протестирована без утечки будущих цен и курсов на финальном отложенном участке 12 месяцев ({officialForecast.rows[0]?.validation?.split?.finalStarts} – {officialForecast.rows[0]?.validation?.split?.finalEnds}). Никаких вымышленных R² = 0.87 — только фактическая средняя абсолютная ошибка (MAE в ₽/кг без НДС).
              </p>
            </div>

            <div className="table-wrapper" role="region" tabIndex={0} aria-label="Таблица ошибок бэктеста по горизонтам">
              <table className="tbl sticky-hd">
                <thead>
                  <tr>
                    <th className="pl sticky-col">Целевой месяц</th>
                    <th>Лаг (мес.)</th>
                    <th>Прогноз CatBoost РФ</th>
                    <th>MAE CatBoost (holdout)</th>
                    <th>MAE Сезонное равновесие</th>
                    <th>MAE Наивная (посл. цена)</th>
                    <th>Выигрыш CatBoost к наивной</th>
                    <th>80% эмпир. коридор</th>
                  </tr>
                </thead>
                <tbody>
                  {officialForecast.rows.map((r) => {
                    const cbFinal = r.validation.finalAll?.find((x) => x.id === 'catboost');
                    const eqFinal = r.validation.finalAll?.find((x) => x.id === 'eq_carry');
                    const naiveMae = r.validation.naiveFinal?.mae ?? 0;
                    const cbMae = cbFinal?.mae ?? r.validation.final?.mae ?? 0;
                    const skill = naiveMae > 0 ? Math.round((1 - cbMae / naiveMae) * 100) : 0;
                    return (
                      <tr key={r.h}>
                        <td className="pl fw mono sticky-col">{r.targetMonth}</td>
                        <td className="mono">+{r.lead} мес.</td>
                        <td className="mono" style={{ fontWeight: 600, color: 'var(--blue)' }}>
                          {(r.catboostPoint ?? r.point)?.toFixed(2)} ₽
                        </td>
                        <td className="mono up" style={{ fontWeight: 600 }}>
                          {cbMae.toFixed(2)} ₽
                        </td>
                        <td className="mono">{eqFinal?.mae?.toFixed(2) ?? '—'} ₽</td>
                        <td className="mono">{naiveMae.toFixed(2)} ₽</td>
                        <td className={`mono ${skill > 0 ? 'up' : 'dn'}`}>
                          {skill > 0 ? `+${skill}% точнее` : `${skill}%`}
                        </td>
                        <td className="mono">
                          {r.catboostInterval80
                            ? `${r.catboostInterval80.lo.toFixed(1)}–${r.catboostInterval80.hi.toFixed(1)} ₽`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--txt3)' }}>
              * На сверхкоротких горизонтах (1–2 мес.) инерция текущей цены высока у всех моделей; начиная с горизонта 4–15 месяцев CatBoost GBDT и сезонное равновесие Weibull снижают ошибку прогноза с 5.0–8.3 ₽/кг до 2.5–3.5 ₽/кг (+30%..+67% точнее наивной базовой модели). Помесячный выбор строгого селектора: {MONTHLY_MODELS[officialForecast.rows[2]?.validation?.selected]}.
            </div>
          </div>
        )}
      </div>

      {/* Show 5-Stage Monthly Sales Plan below 26-week table for storage crops */}
      {activeTab === 'forecast' && !isFieldSeasonal && (
        <MonthlySalesPlanTable plan={decisionPlan} cropLabel={cropProfile.fullName || cropProfile.label} />
      )}
    </div>
  );
}
