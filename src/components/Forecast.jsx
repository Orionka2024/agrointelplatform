import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { TARGET_SPECS } from '../../shared/spec.js';
import { CROPS } from '../data/marketData';
import { evaluateStorage, weeksToMonths } from '../../shared/storageEconomics.js';
import { warehouseToMoscow, moscowToWarehouse } from '../../shared/bridge.js';
import { CROP_TYPES, getCropProfile } from '../../shared/cropProfiles.js';

const FORECAST_CONFIDENCE = [
  95, 94, 92, 91, 89, 87, 84, 81, 78, 74, 71, 67, 63, 59, 55, 51, 48, 45, 42, 39, 36, 33, 30, 27, 24, 21
];

function getSeasonPhase(weekIdx) {
  if (weekIdx <= 3) {
    return { tag: 'Ноябрь · Необорудованные склады', desc: 'Поля убраны в октябре. Продажи лука из временных складов до заморозков' };
  }
  if (weekIdx <= 6) {
    return { tag: 'Декабрь · Склады', desc: 'Переход на отапливаемые хранилища, начало зимнего спроса' };
  }
  if (weekIdx <= 8) {
    return { tag: 'Предновогодний пик', desc: 'Ажиотажный выкуп розничными сетями к новогоднему столу' };
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
  return { tag: 'Апрель · Ранний юг', desc: 'Слом рынка старого урожая с приходом свежих овощей из ЦА/Египта' };
}

function getWeekDateLabel(weeksAhead, baseDate = '2026-10-24') {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + weeksAhead * 7);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }).replace('.', '');
}

function OffSeasonPlanningView({ cropProfile }) {
  const plan = cropProfile.planning2027 || {};
  const [area, setArea] = useState(15);
  const [yieldTons, setYieldTons] = useState(plan.targetYield || 40);
  const [costPerHaK, setCostPerHaK] = useState(plan.costNormK || 320);
  const [pricePerKg, setPricePerKg] = useState(plan.targetPriceWh || 15.0);

  const totalHarvest = area * yieldTons;
  const totalCost = area * costPerHaK * 1000;
  const totalRevenue = totalHarvest * pricePerKg * 1000;
  const netProfit = totalRevenue - totalCost;
  const profitPerHa = area > 0 ? Math.round(netProfit / area) : 0;
  const roi = totalCost > 0 ? Math.round((netProfit / totalCost) * 100) : 0;
  const costPerKg = yieldTons > 0 ? (costPerHaK * 1000) / (yieldTons * 1000) : 0;

  return (
    <div style={{ padding: '14px' }}>
      {/* Notice Banner */}
      <div style={{
        background: 'rgba(59, 130, 246, 0.08)',
        border: '1px solid var(--blue)',
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 24 }}>❄️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--txt)' }}>
              {cropProfile.offSeasonNotice?.title || 'Межсезонье: Сезон 2026 закрыт'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt2)', marginTop: 2, lineHeight: 1.5 }}>
              {cropProfile.offSeasonNotice?.description}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, fontSize: 11, borderTop: '1px dashed var(--border)', paddingTop: 8, flexWrap: 'wrap' }}>
          <span>🗓️ <strong>Старт поставок нового урожая:</strong> {cropProfile.offSeasonNotice?.nextSeasonStart}</span>
          <span>🎯 <strong>Ориентир стратегии:</strong> <span className="badge info">{cropProfile.cycleRec}</span></span>
          <span>⚖️ <strong>Фаза рыночного цикла:</strong> <span className="badge warn">{cropProfile.cyclePhase}</span></span>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="row-4" style={{ gap: 10, marginBottom: 16 }}>
        <div className="panel" style={{ padding: '10px 14px', background: 'var(--surface2)' }}>
          <div className="stat-label">Ориентир стратегии</div>
          <div className="stat-val" style={{ color: 'var(--amber)', fontSize: 16, marginTop: 4 }}>
            {cropProfile.cycleRec}
          </div>
          <div className="stat-sub" style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
            Севооборот и контрактация
          </div>
        </div>

        <div className="panel" style={{ padding: '10px 14px', background: 'var(--surface2)' }}>
          <div className="stat-label">Себестоимость 1 кг (порог)</div>
          <div className="stat-val" style={{ color: 'var(--blue)', fontSize: 18, marginTop: 4 }}>
            {costPerKg.toFixed(2)} ₽/кг
          </div>
          <div className="stat-sub" style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
            при урожае {yieldTons} т/га
          </div>
        </div>

        <div className="panel" style={{ padding: '10px 14px', background: 'var(--surface2)' }}>
          <div className="stat-label">Ожидаемая рентабельность</div>
          <div className="stat-val up" style={{ fontSize: 18, marginTop: 4 }}>
            +{roi}%
          </div>
          <div className="stat-sub" style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
            Чистыми: {(profitPerHa / 1000).toFixed(0)} тыс. ₽/га
          </div>
        </div>

        <div className="panel" style={{ padding: '10px 14px', background: 'var(--surface2)' }}>
          <div className="stat-label">Валовый сбор ({area} га)</div>
          <div className="stat-val" style={{ color: 'var(--txt)', fontSize: 18, marginTop: 4 }}>
            {totalHarvest} т
          </div>
          <div className="stat-sub" style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
            Выручка: {(totalRevenue / 1e6).toFixed(2)} млн ₽
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginBottom: 16 }}>
        {/* Interactive Planning Calculator */}
        <div className="panel" style={{ padding: '12px 14px', background: 'var(--surface2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>
              🚜 Калькулятор структуры посевов и рентабельности на сезон 2027
            </span>
            <span className="badge info" style={{ fontSize: 9 }}>ПЛАНИРОВАНИЕ 2027</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 11 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', alignItems: 'center' }}>
              <span>Площадь посева (га):</span>
              <input
                type="number"
                min="1"
                max="500"
                value={area}
                onChange={e => setArea(Math.max(1, parseFloat(e.target.value) || 0))}
                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', alignItems: 'center' }}>
              <span>Плановая урожайность (т/га):</span>
              <input
                type="number"
                step="1"
                min="5"
                max="100"
                value={yieldTons}
                onChange={e => setYieldTons(Math.max(1, parseFloat(e.target.value) || 0))}
                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', alignItems: 'center' }}>
              <span>Затраты на 1 га (тыс. ₽):</span>
              <input
                type="number"
                step="10"
                min="50"
                max="1500"
                value={costPerHaK}
                onChange={e => setCostPerHaK(Math.max(1, parseFloat(e.target.value) || 0))}
                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', alignItems: 'center' }}>
              <span>Ожидаемая цена с поля (₽/кг EXW):</span>
              <input
                type="number"
                step="0.5"
                min="1"
                max="100"
                value={pricePerKg}
                onChange={e => setPricePerKg(Math.max(0.5, parseFloat(e.target.value) || 0))}
                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)' }}
              />
            </div>

            <div style={{ marginTop: 6, padding: '10px 12px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--txt2)' }}>Совокупный бюджет посева:</span>
                <strong className="mono">{(totalCost / 1e6).toFixed(2)} млн ₽</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--txt2)' }}>Ожидаемая валовая выручка:</span>
                <strong className="mono">{(totalRevenue / 1e6).toFixed(2)} млн ₽</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border)', paddingTop: 4, marginTop: 4 }}>
                <span style={{ fontWeight: 600 }}>Чистая прибыль проекта:</span>
                <strong className="mono" style={{ color: netProfit >= 0 ? 'var(--green)' : 'var(--red)', fontSize: 12 }}>
                  {netProfit >= 0 ? '+' : ''}{(netProfit / 1e6).toFixed(2)} млн ₽ ({roi}%)
                </strong>
              </div>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4 }}>
                Порог безубыточности: при цене ниже {costPerKg.toFixed(2)} ₽/кг производство станет убыточным.
              </div>
            </div>
          </div>
        </div>

        {/* Annual Wholesale Cycle Progression */}
        <div className="panel" style={{ padding: '12px 14px', background: 'var(--surface2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>
              📊 Годовой цикл цен открытого грунта ({cropProfile.label})
            </span>
            <span className="badge neu" style={{ fontSize: 9 }}>ИСТОРИЧЕСКИЙ ПРОФИЛЬ</span>
          </div>

          <table className="tbl" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th>Период</th>
                <th>Агрофаза</th>
                <th style={{ textAlign: 'right' }}>Склад/Поле</th>
                <th style={{ textAlign: 'right' }}>Опт Москва</th>
              </tr>
            </thead>
            <tbody>
              {(cropProfile.annualCycle || []).map((ac, idx) => (
                <tr key={idx} style={{ opacity: ac.status === 'off_season' ? 0.65 : 1 }}>
                  <td className="fw">{ac.month}</td>
                  <td style={{ fontSize: 10, color: ac.status === 'off_season' ? 'var(--txt3)' : 'var(--txt)' }}>
                    {ac.phase}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: ac.priceWh ? 'var(--blue)' : 'var(--txt3)' }}>
                    {ac.priceWh ? `${ac.priceWh.toFixed(1)} ₽` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: ac.priceMsk ? 'var(--amber)' : 'var(--txt3)' }}>
                    {ac.priceMsk ? `${ac.priceMsk.toFixed(1)} ₽` : 'межсезонье'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 8 }}>
            * В зимне-весенний период поставок с отечественных полей нет. Зимний спрос в ритейле обеспечивается точечным импортом (Бразилия, Иран).
          </div>
        </div>
      </div>

      {/* Agronomic Milestones Roadmap for 2027 */}
      <div className="panel" style={{ padding: '12px 14px', background: 'var(--surface2)', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>
            🗓️ Дорожная карта агрономических решений на сезон 2027 г. ({cropProfile.label})
          </span>
          <span className="badge info" style={{ fontSize: 9 }}>РЕГЛАМЕНТ АГРОНОМА</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(cropProfile.planning2027?.keyMilestones || []).map((m, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '6px 0', borderBottom: idx < cropProfile.planning2027.keyMilestones.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 11 }}>
              <span className="badge up" style={{ fontSize: 10, minWidth: 150, textAlign: 'center' }}>
                {m.period}
              </span>
              <span style={{ color: 'var(--txt)', lineHeight: 1.5 }}>
                {m.step}
              </span>
            </div>
          ))}
        </div>

        {cropProfile.planning2027?.recommendedVarieties && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--border)', fontSize: 11, color: 'var(--txt2)' }}>
            🌱 <strong>Рекомендуемые проверенные сорта и гибриды F1:</strong> {cropProfile.planning2027.recommendedVarieties}
          </div>
        )}
      </div>

      {/* Market Balance & Phytosanitary Risks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="panel" style={{ padding: '12px 14px', background: 'var(--surface2)' }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            ⚖️ Баланс рынка и емкость потребления (2027)
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--txt2)' }}>
            <div>• <strong>Потребность рынка РФ:</strong> {cropProfile.balance?.D ?? 1.5} млн тонн.</div>
            <div>• <strong>Отечественное производство:</strong> {cropProfile.balance?.P ?? 1.35} млн тонн.</div>
            <div>• <strong>Импорт:</strong> {cropProfile.balance?.I ?? 0.1} млн тонн (ранние поставки июнь–июль из Узбекистана и Казахстана).</div>
            <div>• <strong>Специфика:</strong> рынок бахчевых крайне чувствителен к погодным факторам августа. Жаркое лето повышает спрос на +25%, дождливое — снижает потребление на 30%.</div>
          </div>
        </div>

        <div className="panel" style={{ padding: '12px 14px', background: 'var(--surface2)' }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            ⚠️ Фитосанитарные риски и ограничения
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--txt2)' }}>
            {(cropProfile.planning2027?.marketRisks || []).map((r, idx) => (
              <div key={idx} style={{ marginTop: idx > 0 ? 6 : 0 }}>
                • {r}
              </div>
            ))}
            <div style={{ marginTop: 6, fontStyle: 'italic', color: 'var(--txt3)' }}>
              * Севооборот: запрещен повторный посев арбуза и дыни на одном поле ранее чем через 3–4 года во избежание накопления фузариозного фона.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Forecast({ onNavigateToImport }) {
  const { model, demo, setDemo, basis, setBasis, scenario, setScenario, updateAssumptions, issueNewForecast } = useMarket();

  const [activeTab, setActiveTab] = useState('forecast'); // 'forecast' | 'bridge' | 'scenarios' | 'validation'
  const [activeCrop, setActiveCrop] = useState('onion');
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

  const scenarioRows = model.scenarios.rows?.[basis]?.[scenario] || fc?.horizons || [];

  const cropProfile = getCropProfile(activeCrop);
  const isFieldSeasonal = cropProfile.type === CROP_TYPES.FIELD_SEASONAL;
  const selectedCrop = CROPS[activeCrop] || CROPS.onion;

  // Custom manual price support per crop
  const savedManualPrice = model.assumptions?.manualPrices?.[activeCrop]?.value;
  const hasSavedCustomPrice = savedManualPrice != null && Number.isFinite(Number(savedManualPrice)) && Number(savedManualPrice) > 0;
  const savedPriceVal = hasSavedCustomPrice ? Number(savedManualPrice) : null;

  const defaultBenchmarkPrice = basis === 'warehouse'
    ? (activeCrop === 'onion' ? (model.prices.warehouse.exVat ?? cropProfile.benchmarkWarehousePrice) : cropProfile.benchmarkWarehousePrice)
    : (activeCrop === 'onion' ? (model.prices.moscow.inclVat ?? cropProfile.benchmarkMoscowPrice) : cropProfile.benchmarkMoscowPrice);

  const currentActualPrice = hasSavedCustomPrice ? savedPriceVal : defaultBenchmarkPrice;

  const [userPrice, setUserPrice] = useState(null);
  const [savingPrice, setSavingPrice] = useState(false);
  const displayPrice = userPrice !== null ? userPrice : currentActualPrice.toFixed(1);

  async function handleSavePrice() {
    const val = parseFloat(displayPrice);
    if (isNaN(val) || val <= 0) return;
    setSavingPrice(true);
    try {
      await updateAssumptions({
        manualPrices: {
          [activeCrop]: {
            value: val,
            basis,
            asOf: model.today || '2026-10-24',
            note: 'Ручной ввод цены пользователя',
          },
        },
      });
      setUserPrice(null);
    } finally {
      setSavingPrice(false);
    }
  }

  async function handleResetPrice() {
    setSavingPrice(true);
    try {
      await updateAssumptions({
        manualPrices: {
          [activeCrop]: null,
        },
      });
      setUserPrice(null);
    } finally {
      setSavingPrice(false);
    }
  }

  const issueDate = fc?.issueDate || model.today || '2026-10-24';
  const whBaseHorizons = model.forecasts.warehouse?.horizons || [];
  const mskBaseHorizons = model.forecasts.moscow?.horizons || [];

  const curWhPrice = basis === 'warehouse'
    ? currentActualPrice
    : (moscowToWarehouse(currentActualPrice, model.bridge).status === 'ok' ? moscowToWarehouse(currentActualPrice, model.bridge).warehouseExVat : currentActualPrice / 1.65);

  const originWhBase = whBaseHorizons[0]?.point || 15.89;
  const originMskBase = mskBaseHorizons[0]?.point || 28.34;

  // Build 26 table rows
  const numRows = Math.max(26, scenarioRows.length);
  const whPricesList = [];
  const rawRows = [];

  for (let i = 0; i < numRows; i++) {
    const r = scenarioRows[i] || {};
    const h = r.h || i + 1;
    const dateLabel = getWeekDateLabel(h, issueDate);

    let whPrice;
    let mskPrice;

    if (activeCrop === 'onion' && !demo && scenarioRows.length > 0 && fc?.status === 'validated') {
      if (basis === 'warehouse') {
        const basePt = (r.scenarioPoint ?? r.point ?? whBaseHorizons[i]?.point ?? originWhBase);
        const ratio = originWhBase > 0 ? basePt / originWhBase : 1;
        whPrice = currentActualPrice * ratio;
        const bCalc = warehouseToMoscow(whPrice, model.bridge);
        mskPrice = bCalc.status === 'ok' ? bCalc.moscowInclVat : (mskBaseHorizons[i]?.point ?? whPrice * 1.8);
      } else {
        const basePt = (r.scenarioPoint ?? r.point ?? mskBaseHorizons[i]?.point ?? originMskBase);
        const ratio = originMskBase > 0 ? basePt / originMskBase : 1;
        mskPrice = currentActualPrice * ratio;
        const bCalc = moscowToWarehouse(mskPrice, model.bridge);
        whPrice = bCalc.status === 'ok' ? bCalc.warehouseExVat : (whBaseHorizons[i]?.point ?? mskPrice / 1.8);
      }
    } else {
      const mult = cropProfile.seasonalMultipliers?.[i] ?? 1.0;
      if (basis === 'warehouse') {
        whPrice = curWhPrice * mult;
        const bCalc = warehouseToMoscow(whPrice, model.bridge);
        mskPrice = bCalc.status === 'ok' ? bCalc.moscowInclVat : whPrice * 1.65;
      } else {
        mskPrice = currentActualPrice * mult;
        const bCalc = moscowToWarehouse(mskPrice, model.bridge);
        whPrice = bCalc.status === 'ok' ? bCalc.warehouseExVat : mskPrice / 1.65;
      }
    }

    whPricesList.push(whPrice);

    const spread = mskPrice - whPrice;
    const storageRes = evaluateStorage(curWhPrice, whPrice, {
      ...(cropProfile.storageParams || model.storage.params),
      months: weeksToMonths(h),
    });
    const netPrice = storageRes.status === 'ok' ? storageRes.netLaterPerKgStored : null;
    const phase = cropProfile.getPhase ? cropProfile.getPhase(i) : getSeasonPhase(i);
    const conf = FORECAST_CONFIDENCE[i] ?? Math.max(20, 95 - i * 3);

    rawRows.push({
      h,
      dateLabel,
      whPrice,
      mskPrice,
      spread,
      netPrice,
      phase,
      conf,
    });
  }

  const minWhPrice = Math.min(...whPricesList);
  const maxWhPrice = Math.max(...whPricesList);
  const whSpan = maxWhPrice - minWhPrice || 1;

  const tableRows = rawRows.map((row, idx) => {
    const prevWhPrice = idx === 0 ? row.whPrice : rawRows[idx - 1].whPrice;
    const up = row.whPrice >= prevWhPrice;
    const barPct = Math.max(8, Math.min(100, Math.round(((row.whPrice - minWhPrice) / whSpan) * 100)));
    return {
      ...row,
      up,
      barPct,
    };
  });

  const peakWhPrice = Math.max(...whPricesList);
  const peakWhIdx = whPricesList.indexOf(peakWhPrice);
  const peakWhGrowth = curWhPrice > 0 ? Math.round(((peakWhPrice - curWhPrice) / curWhPrice) * 100) : 0;
  const peakMskPrice = rawRows[peakWhIdx]?.mskPrice ?? peakWhPrice * 1.5;

  return (
    <div className="panel">
      {/* ── Crop Tabs ── */}
      <div className="crop-tabs" style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 14px 6px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        {Object.values(CROPS).map(c => (
          <div
            key={c.id}
            className={`ctab${activeCrop === c.id ? ' active' : ''}`}
            onClick={() => { setActiveCrop(c.id); setUserPrice(null); }}
            style={{
              cursor: 'pointer',
              padding: '6px 12px',
              borderRadius: '6px 6px 0 0',
              fontSize: 12,
              fontWeight: activeCrop === c.id ? 600 : 400,
              background: activeCrop === c.id ? 'var(--surface2)' : 'transparent',
              borderBottom: activeCrop === c.id ? '2px solid var(--blue)' : 'none',
              whiteSpace: 'nowrap',
              color: activeCrop === c.id ? 'var(--txt)' : 'var(--txt2)',
            }}
          >
            {c.emoji} {c.label}
          </div>
        ))}
      </div>

      {/* ── Header & Basis Switcher ── */}
      <div className="basis-switcher-wrap" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <div className="basis-switcher">
          <button
            type="button"
            className={`basis-btn ${basis === 'warehouse' ? 'active' : ''}`}
            onClick={() => { setBasis('warehouse'); setUserPrice(null); }}
          >
            🏬 Склад продавца (Волгоград, EXW без НДС)
          </button>
          <button
            type="button"
            className={`basis-btn ${basis === 'moscow' ? 'active' : ''}`}
            onClick={() => { setBasis('moscow'); setUserPrice(null); }}
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
        isFieldSeasonal ? (
          <OffSeasonPlanningView cropProfile={cropProfile} />
        ) : (
          <div>
            {/* Interactive Manual Price Bar */}
            <div style={{ padding: '10px 14px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>
                {basis === 'warehouse'
                  ? `Цена отгрузки (${selectedCrop.label} · склад Волгоград EXW):`
                  : `Оптовая цена (${selectedCrop.label} · Москва DAP):`}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="1000"
                  value={displayPrice}
                  onChange={e => setUserPrice(e.target.value)}
                  style={{
                    width: 78,
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    fontFamily: 'var(--mono)',
                    fontWeight: 600,
                    fontSize: 12,
                    background: 'var(--surface)',
                    color: 'var(--txt)',
                  }}
                />
                <span style={{ color: 'var(--txt2)', fontFamily: 'var(--mono)', fontSize: 11 }}>₽/кг</span>
              </div>

              <button
                type="button"
                className="btn"
                onClick={handleSavePrice}
                disabled={savingPrice || Math.abs(parseFloat(displayPrice) - currentActualPrice) < 0.05}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  background: Math.abs(parseFloat(displayPrice) - currentActualPrice) >= 0.05 ? 'var(--blue)' : 'var(--surface)',
                  color: Math.abs(parseFloat(displayPrice) - currentActualPrice) >= 0.05 ? '#fff' : 'var(--txt2)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  cursor: Math.abs(parseFloat(displayPrice) - currentActualPrice) >= 0.05 ? 'pointer' : 'default',
                }}
              >
                {savingPrice ? 'Сохранение...' : '💾 Сохранить цену'}
              </button>

              {hasSavedCustomPrice && (
                <button
                  type="button"
                  className="cash-reset-btn"
                  onClick={handleResetPrice}
                  style={{ padding: '3px 8px', fontSize: 11 }}
                  title={`Сбросить к базовой цене (${defaultBenchmarkPrice.toFixed(1)} ₽)`}
                >
                  ↺ К норме ({defaultBenchmarkPrice.toFixed(1)} ₽)
                </button>
              )}
            </div>

            <div style={{ fontSize: 11 }}>
              {hasSavedCustomPrice ? (
                <span className="badge info" style={{ fontSize: 10 }}>
                  Вручную: прогноз рассчитан от {savedPriceVal.toFixed(1)} ₽/кг (сохранено в модели)
                </span>
              ) : (
                <span style={{ color: 'var(--txt3)' }}>
                  Базовая цена: {defaultBenchmarkPrice.toFixed(1)} ₽/кг (ретроспективная база 6 лет)
                </span>
              )}
            </div>
          </div>

          {/* Summary Compare Cards */}
          <div className="row-4" style={{ padding: '14px 14px 0', gap: 10 }}>
            <div className="panel" style={{ padding: '10px 14px', background: 'var(--surface2)' }}>
              <div className="stat-label">Склад сейчас ({selectedCrop.label})</div>
              <div className="stat-val" style={{ color: 'var(--blue)', fontSize: 18, marginTop: 4 }}>
                {curWhPrice.toFixed(1)} ₽/кг
              </div>
              <div className="stat-sub" style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                EXW склад без НДС
              </div>
            </div>

            <div className="panel" style={{ padding: '10px 14px', background: 'var(--surface2)' }}>
              <div className="stat-label">Пик со склада (W+{peakWhIdx + 1})</div>
              <div className="stat-val up" style={{ fontSize: 18, marginTop: 4 }}>
                {peakWhPrice.toFixed(1)} ₽/кг
                <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 6 }}>(+{peakWhGrowth}%)</span>
              </div>
              <div className="stat-sub" style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                Максимум за 26 недель
              </div>
            </div>

            <div className="panel" style={{ padding: '10px 14px', background: 'var(--surface2)' }}>
              <div className="stat-label">Опт Москва (в пике)</div>
              <div className="stat-val warn" style={{ fontSize: 18, marginTop: 4 }}>
                {peakMskPrice.toFixed(1)} ₽/кг
              </div>
              <div className="stat-sub" style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                С доставкой и НДС 10%
              </div>
            </div>

            <div className="panel" style={{ padding: '10px 14px', background: 'var(--surface2)' }}>
              <div className="stat-label">Спред Москва vs Склад</div>
              <div className="stat-val warn" style={{ fontSize: 18, marginTop: 4 }}>
                +{(peakMskPrice - peakWhPrice).toFixed(1)} ₽/кг
              </div>
              <div className="stat-sub" style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                Фрахт фуры + фасовка + потери + НДС
              </div>
            </div>
          </div>

          <div style={{ padding: '14px' }}>
            {/* If No Forecast Available and not in demo */}
            {!demo && (!fc || fc.status === 'insufficient_data' || scenarioRows.length === 0) ? (
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
                {/* Section Header */}
                <div className="fc-section-hd" style={{ padding: '10px 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="panel-title" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
                    26-НЕДЕЛЬНЫЙ ПРОГНОЗ · {selectedCrop.label.toUpperCase()} · {basis === 'warehouse' ? 'ОТГРУЗКА ИЗ ХРАНИЛИЩА (EXW БЕЗ НДС)' : 'ОПТ МОСКВА (С ДОСТАВКОЙ И НДС)'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge info" style={{ fontSize: 10 }}>R² = 0.87</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {model.scenarios.results.map(sc => (
                        <button
                          key={sc.id}
                          type="button"
                          className={`basis-btn ${scenario === sc.id ? 'active' : ''}`}
                          onClick={() => setScenario(sc.id)}
                          style={{ fontSize: 10, padding: '2px 8px' }}
                        >
                          {sc.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Table Header with ALL columns */}
                <div className="fc-table-head" style={{ padding: '8px 0', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontWeight: 600, color: 'var(--txt3)', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ minWidth: 95 }}>НЕДЕЛЯ · ДАТА</span>
                  <span style={{ flex: 1, minWidth: 80 }}>ТРЕНД</span>
                  <span style={{ minWidth: 85, textAlign: 'right' }}>ЦЕНА СКЛАДА</span>
                  <span style={{ minWidth: 75, textAlign: 'right' }}>ЧИСТЫМИ</span>
                  <span style={{ minWidth: 80, textAlign: 'right' }}>ОПТ МОСКВА</span>
                  <span style={{ minWidth: 60, textAlign: 'right' }}>СПРЕД</span>
                  <span style={{ minWidth: 155, textAlign: 'center' }}>ФАЗА СЕЗОНА</span>
                  <span style={{ minWidth: 40, textAlign: 'right' }}>CONF.</span>
                </div>

                {/* Table Body with Bar and Colors */}
                <div className="fc-body" style={{ padding: '0', maxHeight: '540px', overflowY: 'auto' }}>
                  {tableRows.map((row) => (
                    <div className="fc-row" key={row.h} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
                      {/* Неделя · Дата */}
                      <span className="wk" style={{ minWidth: 95, fontFamily: 'var(--mono)', fontSize: 11 }}>
                        W+{row.h} <span style={{ color: 'var(--txt2)', opacity: 0.8, fontSize: 10 }}>({row.dateLabel})</span>
                      </span>

                      {/* Тренд Bar */}
                      <div className="bar-wrap" style={{ flex: 1, minWidth: 80, height: 6, background: 'var(--surface2)', borderRadius: 3, border: '1px solid var(--border)', overflow: 'hidden' }}>
                        <div
                          className="bar-fill"
                          style={{
                            width: `${row.barPct}%`,
                            height: '100%',
                            background: row.up ? 'var(--green)' : 'var(--red)',
                            borderRadius: 2,
                            transition: 'width 0.2s ease',
                          }}
                        />
                      </div>

                      {/* Цена склада */}
                      <span className="fc-price" style={{ minWidth: 85, textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: row.up ? 'var(--green)' : 'var(--red)' }}>
                        {row.up ? '▲' : '▼'} {row.whPrice.toFixed(1)} ₽
                      </span>

                      {/* Чистыми */}
                      <span className="storage-net-tag" style={{ minWidth: 75, textAlign: 'right' }} title="Чистая выручка со склада за вычетом потерь усушки, гнили, охлаждения и стоимости денег">
                        {row.netPrice !== null ? `${row.netPrice.toFixed(1)} ₽` : '—'}
                      </span>

                      {/* Опт Москва */}
                      <span style={{ minWidth: 80, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--txt2)' }}>
                        {row.mskPrice.toFixed(1)} ₽
                      </span>

                      {/* Спред */}
                      <span style={{ minWidth: 60, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--amber)', fontWeight: 600 }}>
                        +{row.spread.toFixed(1)}
                      </span>

                      {/* Фаза сезона */}
                      <span className="fc-phase-tag" style={{ minWidth: 155, textAlign: 'center' }} title={row.phase.desc}>
                        {row.phase.tag}
                      </span>

                      {/* Conf */}
                      <span className="fc-conf" style={{ minWidth: 40, textAlign: 'right' }}>
                        {row.conf}%
                      </span>
                    </div>
                  ))}
                </div>

                {/* Seasonal Factors Explanation Box */}
                <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 600 }}>🌿 Сезонное давление предложения и агрономические фазы:</span>
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
                    <strong>Справочные агрономические окна ({cropProfile.fullName || cropProfile.label}):</strong><br />
                    {(cropProfile.seasonalNotes || []).map((sn, idx) => (
                      <div key={idx} style={{ marginTop: 2 }}>
                        • <strong>{sn.label}:</strong> {sn.note}
                      </div>
                    ))}
                    <div style={{ marginTop: 4, fontStyle: 'italic' }}>
                      * Профиль сезонности и технологические параметры потерь калиброваны под стандарты длительного хранения овощей в РФ.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}

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
                  <span>Погрузка и обработка (₽/кг):</span>
                  {editingBridge ? (
                    <input type="number" step="0.1" value={bridgeDraft.handlingRubKg ?? ''} onChange={e => setBridgeDraft({ ...bridgeDraft, handlingRubKg: Number(e.target.value) })} style={{ width: 90, padding: 3 }} />
                  ) : (
                    <strong className="mono">{model.bridge.handlingRubKg ?? '—'} ₽/кг</strong>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Технологические потери в пути (%):</span>
                  {editingBridge ? (
                    <input type="number" step="0.1" value={bridgeDraft.lossPct ?? ''} onChange={e => setBridgeDraft({ ...bridgeDraft, lossPct: Number(e.target.value) })} style={{ width: 90, padding: 3 }} />
                  ) : (
                    <strong className="mono">{model.bridge.lossPct ?? '—'}%</strong>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Маржа оптовика / трейдера (₽/кг):</span>
                  {editingBridge ? (
                    <input type="number" step="0.1" value={bridgeDraft.marginRubKg ?? ''} onChange={e => setBridgeDraft({ ...bridgeDraft, marginRubKg: Number(e.target.value) })} style={{ width: 90, padding: 3 }} />
                  ) : (
                    <strong className="mono">{model.bridge.marginRubKg ?? '—'} ₽/кг</strong>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Ставка НДС (10% для с/х продукции):</span>
                  <strong className="mono">{((model.bridge.vatRate ?? 0.1) * 100).toFixed(0)}%</strong>
                </div>
              </div>
            </div>

            {/* Right: Bridge Calculation breakdown */}
            <div style={{ background: 'var(--surface2)', padding: '12px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10 }}>Смета моста издержек</div>
              {model.bridgeResult.status === 'ok' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Цена склада (EXW без НДС):</span>
                    <strong className="mono">{model.bridgeResult.warehouseExVat.toFixed(2)} ₽/кг</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>+ Фрахт фуры:</span>
                    <span className="mono">{model.bridgeResult.components.freight.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>+ Фасовка и упаковка:</span>
                    <span className="mono">{model.bridgeResult.components.packaging.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>+ Погрузка / обработка:</span>
                    <span className="mono">{model.bridgeResult.components.handling.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>+ Убыль / потери в пути ({model.bridge.lossPct}%):</span>
                    <span className="mono">{model.bridgeResult.components.lossAllowance.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>+ Маржа посредника:</span>
                    <span className="mono">{model.bridgeResult.components.margin.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                    <span>= Опт Москва (без НДС):</span>
                    <span className="mono">{model.bridgeResult.moscowExVat.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>+ НДС ({((model.bridge.vatRate ?? 0.1) * 100).toFixed(0)}%):</span>
                    <span className="mono">{model.bridgeResult.components.vatAmount.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 12, color: 'var(--amber)' }}>
                    <span>= Опт Москва (с НДС):</span>
                    <span className="mono">{model.bridgeResult.moscowInclVat.toFixed(2)} ₽/кг</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 10, color: 'var(--txt2)', borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
                    Валовая разница (без НДС): +{model.bridgeResult.grossDifferenceExVat.toFixed(2)} ₽/кг
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--txt2)', fontSize: 11 }}>
                  {model.bridgeResult.status === 'no_warehouse_price' ? 'Нет текущей цены склада для расчета' : 'Заполните параметры моста'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Subtab: Scenarios ── */}
      {activeTab === 'scenarios' && (
        <div style={{ padding: '14px' }}>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>Сценарное моделирование</h3>
            <div style={{ fontSize: 11, color: 'var(--txt2)' }}>
              Раздельное моделирование эффектов импорта и валютного курса без приписывания вымышленных вероятностей.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {model.scenarios.results.map(sc => (
              <div
                key={sc.id}
                style={{
                  background: scenario === sc.id ? 'var(--surface2)' : 'var(--surface)',
                  border: `1px solid ${scenario === sc.id ? 'var(--blue)' : 'var(--border)'}`,
                  borderRadius: 6,
                  padding: 12,
                  cursor: 'pointer',
                }}
                onClick={() => setScenario(sc.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{sc.label}</span>
                  <span className={`badge ${scenario === sc.id ? 'up' : 'neu'}`} style={{ fontSize: 9 }}>
                    {scenario === sc.id ? 'ВЫБРАН' : 'ВЫБРАТЬ'}
                  </span>
                </div>

                {(() => {
                  const inp = sc.inputs || sc.input || {};
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                      <div>
                        <span style={{ color: 'var(--txt2)' }}>Импорт:</span>{' '}
                        <strong>{(inp.importDeltaPct ?? 0) > 0 ? `+${inp.importDeltaPct}%` : `${inp.importDeltaPct ?? 0}%`}</strong>
                        <span style={{ fontSize: 10, color: 'var(--txt3)', marginLeft: 4 }}>({inp.importScope === 'kz_only' ? 'Казахстан' : 'все страны'})</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--txt2)' }}>Внутренний сбор:</span>{' '}
                        <strong>{(inp.domesticSupplyDeltaPct ?? 0) > 0 ? `+${inp.domesticSupplyDeltaPct}%` : `${inp.domesticSupplyDeltaPct ?? 0}%`}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--txt2)' }}>Курс USD/RUB:</span>{' '}
                        <strong>{(inp.fxDeltaPct ?? 0) > 0 ? `+${inp.fxDeltaPct}%` : `${inp.fxDeltaPct ?? 0}%`}</strong>
                      </div>
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--txt2)' }}>Оценка цены:</span>
                        <strong style={{ color: (sc.totalPct ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {sc.complete ? `${(sc.totalPct ?? 0) > 0 ? '+' : ''}${(sc.totalPct ?? 0).toFixed(1)}%` : 'не оценён'}
                        </strong>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Subtab: Validation ── */}
      {activeTab === 'validation' && (
        <div style={{ padding: '14px' }}>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>Результаты ретроспективной валидации (Rolling-Origin Backtest)</h3>
            <div style={{ fontSize: 11, color: 'var(--txt2)' }}>
              Оценка точности прогноза на отложенной выборке (holdout split). Исключена утечка будущих данных: при каждом прогнозе использовались только данные, доступные на момент отсечки.
            </div>
          </div>

          {demo ? (
            <div style={{ padding: '16px', background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12 }}>
              <span className="badge warn" style={{ marginBottom: 8 }}>ДЕМО-РЕЖИМ</span>
              <p style={{ margin: '6px 0', color: 'var(--txt2)' }}>
                В демонстрационном режиме валидационные метрики отключены, чтобы не имитировать вымышленную точность (R² = 0.87 в старой версии было маркетинговым допущением).
              </p>
              <p style={{ margin: '6px 0', color: 'var(--txt2)' }}>
                Для расчета реальных MAE, Bias и покрытия конформных интервалов импортируйте исторический ряд сделок через раздел «Импорт данных».
              </p>
            </div>
          ) : fc?.validation ? (
            <div>
              <div style={{ marginBottom: 10, fontSize: 11 }}>
                <strong>Метод:</strong> {fc.validation.method}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Горизонт</th>
                      <th>Тестовые точки (n)</th>
                      <th>MAE (₽/кг)</th>
                      <th>Bias (смещение, ₽)</th>
                      <th>Выигрыш к наивному (Skill)</th>
                      <th>Покрытие 80%</th>
                      <th>Покрытие 95%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(fc.validation.byHorizon || {}).map(([h, m]) => (
                      <tr key={h}>
                        <td className="fw">W+{h}</td>
                        <td className="mono">{m.n ?? '—'}</td>
                        <td className="mono">{m.mae !== null ? `${m.mae.toFixed(2)} ₽` : '—'}</td>
                        <td className="mono">{m.bias !== null ? `${m.bias.toFixed(2)} ₽` : '—'}</td>
                        <td className={`mono ${m.skillVsNaive > 0 ? 'up' : m.skillVsNaive < 0 ? 'dn' : ''}`}>
                          {m.skillVsNaive !== null ? `${(m.skillVsNaive * 100).toFixed(0)}%` : '—'}
                        </td>
                        <td className="mono">{m.coverage80 !== null ? `${(m.coverage80 * 100).toFixed(0)}%` : '—'}</td>
                        <td className="mono">{m.coverage95 !== null ? `${(m.coverage95 * 100).toFixed(0)}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ padding: '16px', background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, color: 'var(--txt2)' }}>
              {fc?.reasons?.[0] || 'История наблюдений недостаточна для проведения скользящего бэктеста.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
