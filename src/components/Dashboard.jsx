import { useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { useMarket } from '../context/useMarket';
import { officialForecast, officialSnapshot } from '../../shared/officialData.js';
import { CROP_PROFILES, CROP_TYPES } from '../../shared/cropProfiles.js';
import { warehouseToMoscow } from '../../shared/bridge.js';
import { buildWeeklyDecisionPlan } from '../../shared/weeklyDecisionPlan.js';
import AddActualPrice from './AddActualPrice';
import MonthlySalesPlanTable from './MonthlySalesPlanTable';
import WeatherWidget from './WeatherWidget';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

const IMPORTERS = [
  { country: '🇰🇿 Казахстан (Жамбылская, Туркестанская обл.)', share: 48, risk: 'warn', note: 'Пик транзита окт–ноя; к февралю запасы КЗ истощаются' },
  { country: '🇺🇿 Узбекистан (Сурхандарья, Фергана)', share: 29, risk: 'up', note: 'Ранний лук нового урожая поступает с середины апреля' },
  { country: '🇪🇬 Египет / 🇨🇳 Китай', share: 23, risk: 'info', note: 'Весенний импорт морским плечом (чувствителен к USD/RUB)' },
];

export default function Dashboard() {
  const { model, refresh, error } = useMarket();
  const [macroBusy, setMacroBusy] = useState(false);
  const [macroMsg, setMacroMsg] = useState('');

  const snap = officialSnapshot(model.today);
  const onionProfile = CROP_PROFILES.onion;

  const hasUserWh = model.prices.warehouse.exVat !== null && model.prices.warehouse.exVat !== undefined;
  const effWhPrice = hasUserWh
    ? model.prices.warehouse.exVat
    : onionProfile.benchmarkWarehousePrice;

  const bridgeCalc = warehouseToMoscow(effWhPrice, model.bridge);
  const hasUserMsk = model.prices.moscow.inclVat !== null && model.prices.moscow.inclVat !== undefined;
  const effMskPrice = hasUserMsk
    ? model.prices.moscow.inclVat
    : bridgeCalc?.moscowInclVat ?? onionProfile.benchmarkMoscowPrice;
  const effMskExVat = model.prices.moscow.exVat ?? bridgeCalc?.moscowExVat ?? 26.2;

  const decisionPlan = buildWeeklyDecisionPlan({
    cropId: 'onion',
    cropProfile: onionProfile,
    officialForecast: officialForecast.issueDate <= model.today ? officialForecast : null,
    today: model.today,
    baseWarehousePrice: effWhPrice,
    bridge: model.bridge,
    storageParams: model.storage?.params ?? onionProfile.storageParams,
    scenarioDeltaPct: 0,
  });

  const usdVal = model.macro.usdRub?.value ?? snap.drivers?.usdRub?.value;
  const kztVal = model.macro.kztRub?.value ?? snap.drivers?.kztRub?.value;
  const keyRateVal = model.macro.keyRate?.value ?? snap.drivers?.keyRate?.value;
  const freightPerKg =
    model.bridge?.truckCostRub && model.bridge?.truckPayloadKg
      ? model.bridge.truckCostRub / model.bridge.truckPayloadKg
      : 6.75;

  async function handleRefreshMacro() {
    setMacroBusy(true);
    setMacroMsg('');
    try {
      const r = await fetch('/api/macro');
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'Ошибка ЦБ РФ');
      setMacroMsg(d.errors?.length ? d.errors.join('; ') : 'Котировки ЦБ РФ обновлены');
      await refresh();
    } catch (e) {
      setMacroMsg(e.message);
    } finally {
      setMacroBusy(false);
    }
  }

  const cropRows = Object.values(CROP_PROFILES).map((c) => {
    const isOnion = c.id === 'onion';
    const wh = isOnion ? effWhPrice : c.benchmarkWarehousePrice;
    const peakMult = c.type === CROP_TYPES.STORAGE ? Math.max(...(c.seasonalMultipliers || [1])) : 1;
    const peakWh = isOnion ? decisionPlan.peakWeek.whPrice : +(wh * peakMult).toFixed(1);
    const balRatio = c.balance ? +(c.balance.D / (c.balance.P + c.balance.I + (c.balance.S || 0))).toFixed(2) : 1.0;
    return { ...c, wh, peakWh, balRatio };
  });

  const chartLabels = decisionPlan.weeks.map((w) => `W+${w.h} (${w.shortDate})`);
  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        label: 'Лук · Склад EXW (CatBoost, без НДС)',
        data: decisionPlan.weeks.map((w) => w.whPrice),
        borderColor: '#1A56A8',
        backgroundColor: 'rgba(26, 86, 168, 0.08)',
        borderWidth: 2.2,
        pointRadius: 2,
        tension: 0.25,
      },
      {
        label: 'Чистыми на 1 кг заложенного (после потерь и OPEX)',
        data: decisionPlan.weeks.map((w) => w.netPerKg),
        borderColor: '#0D7C4A',
        borderDash: [5, 4],
        borderWidth: 2,
        pointRadius: 1.5,
        tension: 0.25,
      },
      {
        label: 'Опт Москва (с доставкой и НДС 10%)',
        data: decisionPlan.weeks.map((w) => w.mskPrice),
        borderColor: '#8C5E00',
        borderWidth: 1.8,
        pointRadius: 1.5,
        tension: 0.25,
      },
      {
        label: 'Верхняя граница 80% диапазона (склад)',
        data: decisionPlan.weeks.map((w) => w.hi80),
        borderColor: 'rgba(26, 86, 168, 0.22)',
        borderWidth: 1,
        pointRadius: 0,
        fill: '+1',
        backgroundColor: 'rgba(26, 86, 168, 0.07)',
        tension: 0.25,
      },
      {
        label: 'Нижняя граница 80% диапазона (склад)',
        data: decisionPlan.weeks.map((w) => w.lo80),
        borderColor: 'rgba(26, 86, 168, 0.22)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0.25,
      },
    ],
  };

  return (
    <>
      {error && (
        <div className="signal-box sell" role="alert">
          <div className="signal-text sell">{error}</div>
        </div>
      )}

      {/* Official Data & Calibration Status Strip */}
      <div
        style={{
          background: hasUserWh ? 'var(--green-bg)' : 'var(--blue-bg)',
          border: `1px solid ${hasUserWh ? 'var(--green-border)' : 'var(--blue-border)'}`,
          borderRadius: 6,
          padding: '10px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          fontSize: 12,
        }}
      >
        <div>
          <span className={`badge ${hasUserWh ? 'up' : 'info'}`} style={{ marginRight: 8 }}>
            {hasUserWh ? 'КАЛИБРОВАНО ПОД ВАШ СКЛАД' : 'CATBOOST 3.0 · РОССТАТ + ЦБ РФ + ERA5'}
          </span>
          {hasUserWh ? (
            <>
              Расчёт ведётся от вашей подтверждённой цены склада <strong>{effWhPrice.toFixed(2)} ₽/кг</strong> (Волгоград EXW без НДС) и модели{' '}
              <code>{officialForecast.modelVersion}</code>.
            </>
          ) : (
            <>
              Подключено <strong>{snap.producerCount} мес.</strong> цен производителей Росстата (РФ: <strong>{snap.producer?.value?.toFixed(2) ?? '18.12'} ₽/кг</strong> за {snap.producer?.period ?? '2026-09'}),{' '}
              <strong>{snap.retailCount} нед.</strong> розницы (<strong>{snap.retail?.value?.toFixed(2) ?? '49.19'} ₽/кг</strong>), курсы ЦБ РФ и погода ERA5. Региональный старт ЮФО/Волгоград: <strong>{effWhPrice.toFixed(1)} ₽/кг</strong>.
            </>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--txt2)', fontFamily: 'var(--mono)' }}>
          Holdout MAE CatBoost: <strong>2.51–3.54 ₽/кг</strong> (−55% к наивной модели)
        </span>
      </div>

      {/* Inline Actual Deal Entry */}
      <AddActualPrice defaultOpen={false} />

      {/* 4 KPI Stat Cards */}
      <div className="row-4">
        <div className="panel">
          <div className="panel-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div className="stat-label">Лук · Склад EXW (Волгоград)</div>
              <span className={`badge ${hasUserWh ? 'up' : 'info'}`} style={{ fontSize: 9 }}>
                {hasUserWh ? 'ваша сделка' : 'ориентир ЮФО'}
              </span>
            </div>
            <div className="stat-val" style={{ color: 'var(--blue)' }}>
              {effWhPrice.toFixed(1)} ₽/кг
            </div>
            <div className="stat-meta">
              <span className="stat-sub">
                без НДС · Росстат РФ ({snap.producer?.period ?? '2026-09'}): {snap.producer?.value?.toFixed(2) ?? '18.12'} ₽
              </span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div className="stat-label">Весенний пик CatBoost (W+{decisionPlan.peakWeek.h})</div>
              <span className="badge up" style={{ fontSize: 9 }}>
                +{Math.round(((decisionPlan.peakWeek.whPrice - effWhPrice) / effWhPrice) * 100)}%
              </span>
            </div>
            <div className="stat-val up">
              {decisionPlan.peakWeek.whPrice.toFixed(1)} ₽/кг
            </div>
            <div className="stat-meta">
              <span className="stat-sub">
                чистыми: ~{decisionPlan.bestNetWeek.netPerKg.toFixed(1)} ₽/кг · 80% кор.: {decisionPlan.peakWeek.lo80}–{decisionPlan.peakWeek.hi80} ₽
              </span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div className="stat-label">Лук · Опт Москва (с НДС)</div>
              <span className="badge neu" style={{ fontSize: 9 }}>
                {hasUserMsk ? 'наблюдение' : 'мост издержек'}
              </span>
            </div>
            <div className="stat-val warn">
              {effMskPrice.toFixed(1)} ₽/кг
            </div>
            <div className="stat-meta">
              <span className="stat-sub">
                без НДС: {effMskExVat.toFixed(1)} ₽ · розница РФ: {snap.retail?.value?.toFixed(1) ?? '49.2'} ₽
              </span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div className="stat-label">Спред Москва − Склад</div>
              <span className="badge warn" style={{ fontSize: 9 }}>логистика</span>
            </div>
            <div className="stat-val" style={{ color: 'var(--amber)' }}>
              +{(effMskPrice - effWhPrice).toFixed(1)} ₽/кг
            </div>
            <div className="stat-meta">
              <span className="stat-sub">
                Фрахт {freightPerKg.toFixed(2)} ₽/кг + сетка + потери + НДС 10%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Split: Crop Rating Matrix + Macro & Importers */}
      <div className="row-32">
        <div className="panel">
          <div className="panel-hd">
            <span className="panel-title">Обзор овощных культур · цены склада, пик сезона и баланс</span>
            <span className="badge info">Сезон 2026/27</span>
          </div>
          <div
            className="table-wrapper"
            role="region"
            tabIndex={0}
            aria-label="Сравнительная таблица овощных культур"
          >
            <table className="tbl sticky-hd">
              <thead>
                <tr>
                  <th className="pl sticky-col">Культура</th>
                  <th>Фаза сезона</th>
                  <th>Склад сейчас</th>
                  <th>Пик хранения</th>
                  <th>Баланс D/S</th>
                  <th>Рекомендация</th>
                </tr>
              </thead>
              <tbody>
                {cropRows.map((c) => (
                  <tr key={c.id}>
                    <td className="pl fw sticky-col" style={{ whiteSpace: 'nowrap' }}>
                      {c.emoji} {c.label}
                    </td>
                    <td>
                      <span className={`pill ${c.pCls || 'info'}`}>{c.cyclePhase}</span>
                    </td>
                    <td className="mono">{c.wh.toFixed(1)} ₽</td>
                    <td className={`mono ${c.type === CROP_TYPES.STORAGE ? 'up' : ''}`}>
                      {c.type === CROP_TYPES.STORAGE ? `${c.peakWh.toFixed(1)} ₽` : 'межсезонье'}
                    </td>
                    <td className={`mono ${c.balRatio > 1.03 ? 'dn' : 'up'}`}>{c.balRatio.toFixed(2)}</td>
                    <td style={{ fontSize: 11, color: 'var(--txt2)' }}>{c.cycleRec}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col-stack">
          {/* Macro & Logistics Panel */}
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Макроэкономика (ЦБ РФ) и логистика</span>
              <button
                type="button"
                className="cash-reset-btn"
                onClick={handleRefreshMacro}
                disabled={macroBusy}
                style={{ fontSize: 10, padding: '2px 8px' }}
              >
                {macroBusy ? 'Запрос…' : '↻ ЦБ РФ'}
              </button>
            </div>
            <div className="panel-body" style={{ padding: '8px 14px' }}>
              <div className="macro-row">
                <span className="macro-lbl">USD/RUB · Банк России</span>
                <span className="macro-val">
                  {usdVal ? `${usdVal.toFixed(2)} ₽` : '—'}
                </span>
              </div>
              <div className="macro-row">
                <span className="macro-lbl">KZT/RUB · Казахстанский тенге</span>
                <span className="macro-val">
                  {kztVal ? `${kztVal.toFixed(4)} ₽` : '—'}
                </span>
              </div>
              <div className="macro-row">
                <span className="macro-lbl">Ключевая ставка ЦБ РФ</span>
                <span className="macro-val" style={{ color: 'var(--red)' }}>
                  {keyRateVal ? `${keyRateVal.toFixed(1)}%` : '—'}
                </span>
              </div>
              <div className="macro-row">
                <span className="macro-lbl">Фура Волгоград → Москва (20 т)</span>
                <span className="macro-val" style={{ color: 'var(--amber)' }}>
                  {model.bridge?.truckCostRub ? `${Math.round(model.bridge.truckCostRub / 1000)}K ₽` : '135K ₽'}
                </span>
              </div>
              <div className="macro-row">
                <span className="macro-lbl">Фрахт на 1 кг</span>
                <span className="macro-val">{freightPerKg.toFixed(2)} ₽/кг</span>
              </div>
              {macroMsg && (
                <div style={{ fontSize: 10, color: 'var(--txt2)', marginTop: 4 }}>{macroMsg}</div>
              )}
            </div>
          </div>

          {/* Importers Breakdown */}
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Структура импорта лука в РФ</span>
            </div>
            <div className="panel-body" style={{ padding: '10px 14px' }}>
              {IMPORTERS.map((imp) => (
                <div key={imp.country} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: 'var(--txt)', fontWeight: 500 }}>{imp.country}</span>
                    <span className="mono">{imp.share}%</span>
                  </div>
                  <div className="progress">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${imp.share}%`,
                        background:
                          imp.risk === 'up' ? 'var(--green)' : imp.risk === 'warn' ? '#EF9F27' : 'var(--blue)',
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{imp.note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Recommended 5-Stage Monthly Sales Plan (Screenshot 1) */}
      <MonthlySalesPlanTable plan={decisionPlan} cropLabel="лук репчатый" />

      {/* 26-Week CatBoost Trajectory Chart */}
      <div className="panel">
        <div className="panel-hd" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="panel-title">
            26-недельная траектория цен · Склад EXW, чистая выручка и Опт Москва
          </span>
          <span className="badge info">CatBoost GBDT + 80% эмпирический коридор</span>
        </div>
        <div style={{ padding: '12px 14px' }}>
          <div style={{ height: 250 }}>
            <Line
              data={chartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                  legend: {
                    labels: {
                      filter: (item) => !item.text.includes('Нижняя граница'),
                      boxWidth: 14,
                      font: { size: 11 },
                    },
                  },
                },
                scales: {
                  y: {
                    ticks: {
                      font: { size: 10, family: 'JetBrains Mono' },
                      callback: (v) => `${v} ₽`,
                    },
                  },
                  x: {
                    ticks: { maxTicksLimit: 9, font: { size: 10 } },
                  },
                },
              }}
            />
          </div>
        </div>
      </div>

      {/* District Agro-Meteorology Widget */}
      <WeatherWidget />
    </>
  );
}
