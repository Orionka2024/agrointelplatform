import { useState } from 'react';
import {
  CROPS,
  FORECAST_CONFIDENCE,
  FEATURE_IMPORTANCE,
  CASH_DEFAULTS,
  IMPORT_SCENARIOS,
  MACRO,
} from '../data/marketData';
import { useLiveData } from '../hooks/useLiveData';
import { useStoragePrices } from '../hooks/useStoragePrices';

const FC_CROPS = Object.keys(CROPS);

function getWeekDateLabel(weeksAhead) {
  const d = new Date();
  d.setDate(d.getDate() + weeksAhead * 7);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }).replace('.', '');
}

function getSeasonPhase(weekIdx) {
  if (weekIdx <= 3) {
    return { tag: 'Ноябрь · Сброс с полей', desc: 'Давление свежего урожая и сброс с необорудованных складов' };
  }
  if (weekIdx <= 6) {
    return { tag: 'Декабрь · Склады', desc: 'Переход на отапливаемые хранилища, начало зимнего спроса' };
  }
  if (weekIdx <= 8) {
    return { tag: 'Предновогодний пик', desc: 'Ажиотажный выкуп сетями к новогоднему столу' };
  }
  if (weekIdx <= 12) {
    return { tag: 'Январское затишье', desc: 'Постновогодний спад розничного потребления и коррекция' };
  }
  if (weekIdx <= 16) {
    return { tag: 'Февраль · Морозы', desc: 'Холода (-20°C..-30°C), срыв погрузок, дефицит рефрижераторов' };
  }
  if (weekIdx <= 21) {
    return { tag: 'Весенний дефицит', desc: 'Истощение запасов РФ и ЕАЭС, годовой пик котировок' };
  }
  return { tag: 'Апрель · Ранний юг', desc: 'Обвал цен старого урожая с приходом свежих овощей из ЦА/Египта' };
}

export default function Forecast({ basis = 'wholesale', initialBasis, onSwitchBasis }) {
  const { liveData } = useLiveData();
  const { storagePrices, setStoragePrice, resetStoragePrice, isCustom } = useStoragePrices();
  const [activeCrop, setActiveCrop] = useState('onion');
  
  const resolvedBasis = basis || initialBasis || 'wholesale';
  const [prevBasis, setPrevBasis] = useState(resolvedBasis);
  const [priceBasis, setPriceBasis] = useState(resolvedBasis);
  const [importScenario, setImportScenario] = useState('base');
  const [customImportDelta, setCustomImportDelta] = useState(0);

  if (basis && basis !== prevBasis) {
    setPrevBasis(basis);
    setPriceBasis(basis);
  }

  function handleBasisChange(newBasis) {
    setPriceBasis(newBasis);
    if (onSwitchBasis) onSwitchBasis(newBasis);
  }

  function handleCashPriceChange(val) {
    const num = isNaN(val) ? 0 : val;
    setStoragePrice(activeCrop, num);
  }

  const crop = CROPS[activeCrop];
  const isStorage = priceBasis === 'storage';
  const isField = priceBasis === 'field';
  const isWholesale = priceBasis === 'wholesale';

  const currentCashStart = storagePrices[activeCrop] ?? CASH_DEFAULTS[activeCrop] ?? 15.0;
  const baseWholesale = crop.price;
  const currentActualPrice = isWholesale ? baseWholesale : currentCashStart;

  // Import Scenario Simulation Parameters
  const activeScenario = IMPORT_SCENARIOS[importScenario] || IMPORT_SCENARIOS.base;
  const deltaPct = importScenario === 'custom' ? customImportDelta : activeScenario.deltaPct;
  const liveUsd = liveData.usdRub ?? MACRO.usdRub;
  const liveKzt = liveData.kztRub ?? MACRO.kztRub;
  const shapWeight = (crop.importDetail?.shapWeight ?? 23) / 100;

  // Helper: calculate total impact % for any week
  function getWeekImpactPct(i) {
    let elasticity = 0.35;
    if (i >= 4 && i <= 8) elasticity = 0.70;        // Предновогодний разгон
    else if (i >= 9 && i <= 12) elasticity = 0.50;  // Январское затишье
    else if (i >= 13 && i <= 16) elasticity = 1.10; // Февральские морозы и логистика
    else if (i >= 17 && i <= 21) elasticity = 1.45; // Весенний пик дефицита
    else if (i >= 22) elasticity = 0.85;            // Апрельский слом рынка

    const volumeImpactPct = (-deltaPct * shapWeight * elasticity);
    const fxImpactPct = ((liveUsd - 94.6) / 94.6) * 12 * elasticity;
    return volumeImpactPct + fxImpactPct;
  }

  // 1. Base Forecast Curve (CatBoost baseline for the ACTIVE basis)
  const fcBase = (isStorage || isField)
    ? crop.forecast.map(wp => +(currentCashStart * (wp / baseWholesale)).toFixed(1))
    : crop.forecast;

  // 2. Active Forecast with Import Curve
  const fcImport = fcBase.map((basePrice, i) => {
    const totalImpactPct = getWeekImpactPct(i);
    return +(basePrice * (1 + totalImpactPct / 100)).toFixed(1);
  });

  // 3. Moscow Wholesale Forecast Curve (for side-by-side comparison)
  const mskImport = crop.forecast.map((baseMsk, i) => {
    const totalImpactPct = getWeekImpactPct(i);
    return +(baseMsk * (1 + totalImpactPct / 100)).toFixed(1);
  });

  // 4. Storage Cash Forecast Curve (for side-by-side comparison)
  const storageImport = crop.forecast.map((baseMsk, i) => {
    const totalImpactPct = getWeekImpactPct(i);
    return +(currentCashStart * (baseMsk / baseWholesale) * (1 + totalImpactPct / 100)).toFixed(1);
  });

  // Storage cost and shrinkage loss models per week
  const storageMetrics = storageImport.map((p, i) => {
    const months = (i + 1) / 4.33;
    const lossPct = +(Math.min(13.5, 1.5 + months * 1.6)).toFixed(1); // shrinkage + rot
    const opex = +(0.5 + months * 0.35).toFixed(2); // cooling electricity, ventilation, sorting
    const netPerKg = +(p * (1 - lossPct / 100) - opex).toFixed(1);
    const netProfitPerKg = +(netPerKg - currentCashStart).toFixed(1);
    return { lossPct, opex, netPerKg, netProfitPerKg };
  });

  const max = Math.max(...fcImport);
  const min = Math.min(...fcImport);
  const features = crop.features || FEATURE_IMPORTANCE;
  const trendCls = crop.trendSignal || 'hold';

  // Peak Statistics
  const peakBasePrice = Math.max(...fcBase);
  const peakImportPrice = Math.max(...fcImport);
  const peakWeekIdx = fcImport.indexOf(peakImportPrice);
  const importDeltaAtPeak = +(peakImportPrice - peakBasePrice).toFixed(1);

  const startPrice = isWholesale ? baseWholesale : currentCashStart;
  const totalGrowthPct = startPrice > 0 ? Math.round(((peakImportPrice - startPrice) / startPrice) * 100) : 0;
  const baseGrowthPct = startPrice > 0 ? Math.round(((peakBasePrice - startPrice) / startPrice) * 100) : 0;

  return (
    <div className="panel">
      {/* ── Basis Switcher Header ── */}
      <div className="basis-switcher-wrap">
        <div className="basis-switcher">
          <button
            type="button"
            className={`basis-btn ${priceBasis === 'wholesale' ? 'active' : ''}`}
            onClick={() => handleBasisChange('wholesale')}
          >
            🏢 Опт Москва · с НДС ({baseWholesale.toFixed(1)} ₽)
          </button>
          <button
            type="button"
            className={`basis-btn ${priceBasis === 'storage' ? 'active' : ''}`}
            onClick={() => handleBasisChange('storage')}
          >
            🏬 Из хранилища · Нал ({currentCashStart.toFixed(1)} ₽){isCustom(activeCrop) ? ' ✏️' : ''}
          </button>
          <button
            type="button"
            className={`basis-btn ${priceBasis === 'field' ? 'active' : ''}`}
            onClick={() => handleBasisChange('field')}
          >
            🚜 С поля · Нал ({currentCashStart.toFixed(1)} ₽){isCustom(activeCrop) ? ' ✏️' : ''}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge neu" style={{ fontSize: 11 }}>
            {isWholesale
              ? 'Базис: Опт Москва (РЦ сетей / Овощебазы, с НДС 10%)'
              : isStorage
              ? 'Базис: Со склада / Овощехранилище (Волгоград, нал без НДС)'
              : 'Базис: С поля / ex-farm (сырец, нал без НДС)'}
          </span>
          {isCustom(activeCrop) && (
            <span className="badge info" style={{ fontSize: 10 }}>Своя цена</span>
          )}
          <span className="badge info">CatBoost v2.6</span>
        </div>
      </div>

      {/* ── Actual vs Forecast Comparison Grid (KPI Cards) ── */}
      <div className="actual-vs-fc-grid">
        <div className="compare-card">
          <span className="compare-lbl">
            {isWholesale ? 'Оптовая цена в Москве сейчас (W+1)' : 'Фактическая цена со склада (W+1)'}
          </span>
          <div className="compare-val">
            {currentActualPrice.toFixed(1)} ₽/кг
            {(!isWholesale && isCustom(activeCrop)) && (
              <span className="badge info" style={{ fontSize: 10, marginLeft: 6 }}>вручную</span>
            )}
          </div>
          <span className="compare-sub">
            {isWholesale ? 'Опт Москва с НДС 10% (РЦ / Базы)' : 'Отгрузка со склада (нал без НДС)'}
          </span>
        </div>

        <div className="compare-card">
          <span className="compare-lbl">
            {isWholesale ? `Базовый опт (пик W+${fcBase.indexOf(peakBasePrice) + 1})` : `Базовый склад (пик W+${fcBase.indexOf(peakBasePrice) + 1})`}
          </span>
          <div className="compare-val up">
            {peakBasePrice.toFixed(1)} ₽/кг
            <span style={{ fontSize: 11, fontWeight: 500 }}>(+{baseGrowthPct}%)</span>
          </div>
          <span className="compare-sub">
            {isWholesale ? 'Оптовый пик без шоков импорта' : 'Складской пик без шоков импорта'}
          </span>
        </div>

        <div className={`compare-card ${importDeltaAtPeak > 0 ? 'danger' : importDeltaAtPeak < 0 ? 'highlight' : ''}`}>
          <span className="compare-lbl">
            {isWholesale ? `Опт со сценарием (пик W+${peakWeekIdx + 1})` : `Склад со сценарием (пик W+${peakWeekIdx + 1})`}
          </span>
          <div className={`compare-val ${importDeltaAtPeak > 0 ? 'up' : importDeltaAtPeak < 0 ? 'dn' : ''}`}>
            {peakImportPrice.toFixed(1)} ₽/кг
            <span style={{ fontSize: 11, fontWeight: 500 }}>(+{totalGrowthPct}%)</span>
          </div>
          <span className="compare-sub">
            {importDeltaAtPeak !== 0 ? (
              <span>Влияние импорта: <strong>{importDeltaAtPeak > 0 ? `+${importDeltaAtPeak}` : importDeltaAtPeak} ₽/кг</strong></span>
            ) : (
              'Совпадает с базовым прогнозом'
            )}
          </span>
        </div>

        <div className="compare-card">
          <span className="compare-lbl">Спред цен Москва vs Склад</span>
          <div className="compare-val warn">
            +{(baseWholesale - currentCashStart).toFixed(1)} ₽/кг
          </div>
          <span className="compare-sub">
            Доставка фурой (~6.75 ₽) + НДС 10% + фасовка
          </span>
        </div>
      </div>

      {/* ── Storage Cash Control Input ── */}
      {(isStorage || isField) && (
        <div className="cash-control-card">
          <div className="cash-control-left">
            <span className="cash-control-label">
              Текущая фактическая цена отгрузки со склада ({crop.label}, нал без НДС):
            </span>
            <div className="cash-input-row">
              <div className="cash-inp-wrap">
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="1000"
                  value={currentCashStart}
                  onChange={e => handleCashPriceChange(parseFloat(e.target.value))}
                  className="cash-inp"
                />
                <span className="cash-inp-unit">₽/кг</span>
              </div>
              {isCustom(activeCrop) && (
                <button
                  type="button"
                  className="cash-reset-btn"
                  onClick={() => resetStoragePrice(activeCrop)}
                >
                  ↺ Сбросить к норме ({CASH_DEFAULTS[activeCrop]} ₽)
                </button>
              )}
            </div>
          </div>

          <div className="cash-spread-metrics">
            <div className="spread-item">
              <span className="spread-label">Спред к опту Москва</span>
              <span className="spread-val warn">+{(baseWholesale - currentCashStart).toFixed(1)} ₽</span>
            </div>
            <div className="spread-divider">|</div>
            <div className="spread-item">
              <span className="spread-label">Пик со склада (W+{peakWeekIdx + 1} · {getWeekDateLabel(peakWeekIdx + 1)})</span>
              <span className="spread-val up">{peakImportPrice.toFixed(1)} ₽/кг</span>
            </div>
            <div className="spread-divider">|</div>
            <div className="spread-item">
              <span className="spread-label">Окно максимальной цены</span>
              <span className="spread-val up">W+{Math.max(1, peakWeekIdx)} – W+{Math.min(26, peakWeekIdx + 2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Interactive Import Scenario Simulator Bar ── */}
      <div className="import-sim-panel">
        <div className="import-sim-header">
          <div className="import-sim-title">
            <span>🚢 Влияние импорта (Казахстан 39% · Узбекистан 28%):</span>
            <span className="badge info" style={{ fontSize: 10 }}>Симуляция 26 недель</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--txt2)' }}>
            <span>ЦБ РФ:</span>
            <span className="mono" style={{ fontWeight: 600, color: 'var(--txt)' }}>USD {liveUsd.toFixed(2)} ₽</span>
            <span>·</span>
            <span className="mono" style={{ fontWeight: 600, color: 'var(--txt)' }}>KZT {liveKzt.toFixed(3)} ₽</span>
          </div>
        </div>

        <div className="import-scenarios-row">
          {Object.values(IMPORT_SCENARIOS).map(sc => (
            <button
              key={sc.id}
              type="button"
              className={`scenario-btn ${importScenario === sc.id ? `active ${sc.badgeCls}` : ''}`}
              onClick={() => setImportScenario(sc.id)}
            >
              {sc.label}
            </button>
          ))}
        </div>

        {importScenario === 'custom' && (
          <div style={{ background: 'var(--surface)', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt)' }}>
                Ручное отклонение объема импорта из Казахстана и ЕАЭС:
              </span>
              <span className="mono" style={{ fontWeight: 600, color: customImportDelta > 0 ? 'var(--amber)' : customImportDelta < 0 ? 'var(--red)' : 'var(--txt)' }}>
                {customImportDelta > 0 ? `+${customImportDelta}% (избыток)` : customImportDelta < 0 ? `${customImportDelta}% (дефицит)` : '0% (базовый)'}
              </span>
            </div>
            <input
              type="range"
              min="-50"
              max="50"
              step="5"
              value={customImportDelta}
              onChange={e => setCustomImportDelta(parseInt(e.target.value, 10))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--txt3)', marginTop: 4 }}>
              <span>-50% (Жёсткое эмбарго)</span>
              <span>0% (Норма Росстат/ФТС)</span>
              <span>+50% (Массивный демпинг)</span>
            </div>
          </div>
        )}

        <div className="import-desc-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>ℹ️</span>
            <span>{activeScenario.desc}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 10, color: 'var(--txt3)' }}>Статус границы РК:</span>
            <span className="badge warn" style={{ fontSize: 10 }}>{activeScenario.kzStatus}</span>
          </div>
        </div>
      </div>

      {/* ── Crop Tabs ── */}
      <div className="crop-tabs">
        {FC_CROPS.map(id => (
          <div
            key={id}
            className={`ctab${activeCrop === id ? ' active' : ''}`}
            onClick={() => setActiveCrop(id)}
          >
            {CROPS[id].emoji} {CROPS[id].label}
          </div>
        ))}
      </div>

      {/* ── Main Split View ── */}
      <div className="fc-split">
        {/* Left: 26-Week Detailed Comparison Table */}
        <div className="fc-left">
          <div className="fc-section-hd">
            <span className="panel-title">
              26-недельный прогноз · {isWholesale ? 'Опт Москва (с НДС)' : isStorage ? 'Отгрузка из хранилища (нал)' : 'С поля (нал)'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge info">R² = {(crop.r2 ?? 0.85).toFixed(2)}</span>
              <span className={`pill ${activeScenario.badgeCls}`}>{activeScenario.shortLabel}</span>
            </div>
          </div>

          <div style={{ padding: '0 14px' }}>
            {/* Table Header showing BOTH prices */}
            <div className="fc-table-head">
              <span style={{ minWidth: 78 }}>Неделя · Дата</span>
              <span style={{ flex: 1 }}>Тренд</span>
              <span style={{ minWidth: 72, textAlign: 'right' }}>
                {isWholesale ? 'Опт Москва' : 'Цена склада'}
              </span>
              {importScenario !== 'base' && (
                <span style={{ minWidth: 55, textAlign: 'right' }}>Эффект КЗ</span>
              )}
              {isStorage && (
                <span style={{ minWidth: 85, textAlign: 'right' }}>Чистыми</span>
              )}
              <span style={{ minWidth: 78, textAlign: 'right' }}>
                {isWholesale ? 'Склад (нал)' : 'Опт Москва'}
              </span>
              <span style={{ minWidth: 55, textAlign: 'right' }}>Спред</span>
              <span style={{ minWidth: 100, textAlign: 'center' }}>Фаза сезона</span>
              <span style={{ minWidth: 32, textAlign: 'right' }}>Conf.</span>
            </div>

            {/* Table Body */}
            <div className="fc-body">
              {fcImport.map((p, i) => {
                const prev = i === 0 ? p : fcImport[i - 1];
                const up = p >= prev;
                const span = max - min || 1;
                const pct = Math.max(6, Math.round(((p - min) / span) * 100));
                const baseP = fcBase[i];
                const deltaP = +(p - baseP).toFixed(1);
                const metrics = storageMetrics[i];
                const phase = getSeasonPhase(i);

                // Both prices for side-by-side comparison
                const mskP = mskImport[i];
                const storageP = storageImport[i];
                const spread = +(mskP - storageP).toFixed(1);

                return (
                  <div className="fc-row" key={i}>
                    <span className="wk" style={{ minWidth: 78 }}>
                      W+{i + 1} <span style={{ color: 'var(--txt2)', opacity: 0.75 }}>({getWeekDateLabel(i + 1)})</span>
                    </span>

                    <div className="bar-wrap">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${pct}%`,
                          background: up ? 'var(--green)' : 'var(--red)',
                        }}
                      />
                    </div>

                    {/* Primary Price for this tab */}
                    <span className="fc-price" style={{ minWidth: 72, color: up ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                      {up ? '▲' : '▼'} {p.toFixed(1)} ₽
                    </span>

                    {/* Import Delta Badge */}
                    {importScenario !== 'base' && (
                      <span
                        className={`fc-delta-pill ${deltaP > 0 ? 'up' : deltaP < 0 ? 'dn' : 'neu'}`}
                        style={{ minWidth: 55, textAlign: 'center' }}
                        title={`Отклонение от базового прогноза (${baseP.toFixed(1)} ₽) из-за фактора импорта`}
                      >
                        {deltaP > 0 ? `+${deltaP}` : deltaP < 0 ? `${deltaP}` : '0'} ₽
                      </span>
                    )}

                    {/* Net Realization (in storage mode) */}
                    {isStorage && (
                      <span
                        className="storage-net-tag"
                        style={{ minWidth: 85 }}
                        title={`Чистая выручка со склада за вычетом потерь (${metrics.lossPct}%) и OPEX (${metrics.opex} ₽/кг)`}
                      >
                        {metrics.netPerKg} ₽
                      </span>
                    )}

                    {/* Secondary Comparative Price */}
                    <span
                      style={{
                        minWidth: 78,
                        textAlign: 'right',
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        color: 'var(--txt2)',
                      }}
                      title={isWholesale ? 'Справочно: отгрузка со склада в Волгограде (нал)' : 'Справочно: оптовая цена в Москве (с НДС)'}
                    >
                      {isWholesale ? `${storageP.toFixed(1)} ₽` : `${mskP.toFixed(1)} ₽`}
                    </span>

                    {/* Price Spread */}
                    <span
                      style={{
                        minWidth: 55,
                        textAlign: 'right',
                        fontFamily: 'var(--mono)',
                        fontSize: 10,
                        color: 'var(--amber)',
                      }}
                      title="Спред Москва — Склад (логистика + фасовка + НДС)"
                    >
                      +{spread.toFixed(1)}
                    </span>

                    <span className="fc-phase-tag" style={{ minWidth: 100, textAlign: 'center' }} title={phase.desc}>
                      {phase.tag}
                    </span>

                    <span className="fc-conf" style={{ minWidth: 32 }}>{FORECAST_CONFIDENCE[i]}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Feature Importance + Import Breakdown */}
        <div>
          <div className="fc-section-hd">
            <span className="panel-title">Важность факторов · SHAP ({crop.label})</span>
            <span className={`pill ${crop.signal === 'BUY' ? 'up' : crop.signal === 'SELL' ? 'dn' : 'warn'}`}>
              {crop.signal}
            </span>
          </div>

          <div style={{ padding: '12px 14px' }}>
            {features.map(f => {
              const isImport = f.label.includes('Импорт');
              return (
                <div key={f.label} className={`shap-item ${isImport ? 'highlight' : ''}`}>
                  <div className="shap-item-head">
                    <span style={{ fontWeight: 600, color: 'var(--txt)' }}>
                      {f.label} {isImport ? '⭐ (КЗ/УЗ)' : ''}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: isImport ? 'var(--blue)' : 'var(--txt)' }}>
                      {f.pct}%
                    </span>
                  </div>

                  <div className="progress" style={{ height: 4, marginBottom: f.currentVal ? 6 : 0 }}>
                    <div
                      className="progress-fill"
                      style={{
                        width: `${f.pct}%`,
                        background: isImport ? 'var(--blue)' : f.color,
                      }}
                    />
                  </div>

                  {f.currentVal && (
                    <div className="shap-meta-row">
                      <div>
                        <span style={{ color: 'var(--txt3)' }}>Факт: </span>
                        <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}>{f.currentVal}</strong>
                      </div>
                      <span className="shap-source-badge" title={`Источник: ${f.source}`}>
                        {f.asOf}
                      </span>
                    </div>
                  )}

                  {f.trend && (
                    <div className="shap-trend-desc" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <span style={{ color: 'var(--txt3)' }}>Динамика:</span>
                      <span style={{ color: 'var(--txt2)' }}>{f.trend}</span>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="divider" />

            {/* Import Seasonal Mechanics Card */}
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Механизм влияния импорта из Казахстана (39%)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                  <span style={{ color: 'var(--txt2)' }}>🍂 Ноябрь (W+1..W+4):</span>
                  <span style={{ fontWeight: 500, color: 'var(--amber)' }}>Сдерживание цен (-1.8 ₽)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                  <span style={{ color: 'var(--txt2)' }}>🎄 Декабрь (W+5..W+9):</span>
                  <span style={{ fontWeight: 500, color: 'var(--green)' }}>Новогодний всплеск (+4.2 ₽)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                  <span style={{ color: 'var(--txt2)' }}>❄️ Янв–Фев (W+10..W+17):</span>
                  <span style={{ fontWeight: 500, color: 'var(--red)' }}>Морозы и риски квот (+5.8 ₽)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                  <span style={{ color: 'var(--txt2)' }}>🌱 Март (W+18..W+22):</span>
                  <span style={{ fontWeight: 600, color: 'var(--green)' }}>Пик дефицита (+7.4 ₽)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--txt2)' }}>☀️ Апрель (W+23..W+26):</span>
                  <span style={{ fontWeight: 500, color: 'var(--blue)' }}>Ранний юг / обвал (-11.2 ₽)</span>
                </div>
              </div>
            </div>

            {/* Deficit / Crash Probabilities */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div className="signal-box buy">
                <div className="signal-label buy">Вероятность дефицита</div>
                <div className="signal-text buy" style={{ fontFamily: 'var(--mono)', fontSize: 20 }}>
                  {crop.deficitProb ?? 74}%
                </div>
              </div>
              <div className="signal-box sell">
                <div className="signal-label sell">Вероятность обвала</div>
                <div className="signal-text sell" style={{ fontFamily: 'var(--mono)', fontSize: 20 }}>
                  {crop.crashProb ?? 9}%
                </div>
              </div>
            </div>

            {/* Trend interpretation */}
            <div className={`signal-box ${trendCls}`}>
              <div className={`signal-label ${trendCls}`}>
                Оценка динамики · {crop.label} {isWholesale ? '(Опт Москва)' : isStorage ? '(Хранилище / Нал)' : '(С поля)'}
              </div>
              <div className={`signal-text ${trendCls}`} style={{ marginTop: 4 }}>
                {isWholesale ? (
                  <>
                    Оптовая цена в Москве стартует с <strong>{baseWholesale.toFixed(1)} ₽/кг</strong>. При сценарии <em>«{activeScenario.shortLabel}»</em> прогнозируется сезонная волна с предновогодним подъёмом, январской паузой и выходом на годовой пик <strong>{peakImportPrice.toFixed(1)} ₽/кг (+{totalGrowthPct}%)</strong> на W+{peakWeekIdx + 1} ({getWeekDateLabel(peakWeekIdx + 1)}), с последующим апрельским снижением под давлением нового урожая.
                  </>
                ) : isStorage ? (
                  <>
                    При стартовой цене отгрузки со склада <strong>{currentCashStart.toFixed(1)} ₽/кг</strong> модель прогнозирует сезонный пик <strong>{peakImportPrice.toFixed(1)} ₽/кг (+{totalGrowthPct}%)</strong> на W+{peakWeekIdx + 1} ({getWeekDateLabel(peakWeekIdx + 1)}).
                    {importDeltaAtPeak > 0 && ` Ограничение экспорта из Казахстана добавляет +${importDeltaAtPeak} ₽/кг к пиковой выручке на хранении.`}
                    {importDeltaAtPeak < 0 && ` Избыточный импорт снижает потенциал пика на ${Math.abs(importDeltaAtPeak)} ₽/кг.`}
                  </>
                ) : (
                  crop.trendText
                )}
              </div>
            </div>

            <div className="divider" />

            {/* Live Data & Frequency Explainer */}
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Источники данных и частота обновления факторов
              </div>
              <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6 }}>
                <strong>• Валюта (USD, KZT) и ставка ЦБ:</strong> обновляются ежедневно в автоматическом режиме с серверов Банка России.<br />
                <strong>• Импорт (ФТС РФ, ЕЭК, Казахстан):</strong> обновляется ежемесячно по таможенным декларациям и фитосанитарным сводкам.<br />
                <strong>• Запасы хранилищ и валовой сбор:</strong> обновляются ежемесячно по отчётам Минсельхоза РФ и Росстата.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
