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
import { buildUserPriceCsv } from '../../shared/localBasis.js';
import { upsertStoredUserPrice } from '../utils/userPriceStore.js';
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
  const {
    model,
    signals,
    signalsBusy,
    refreshSignals,
    refresh,
    importData,
    demo,
    setDemo,
    clearLocalEntries,
    error,
  } = useMarket();
  const [macroBusy, setMacroBusy] = useState(false);
  const [macroMsg, setMacroMsg] = useState('');
  const [spotBusy, setSpotBusy] = useState(false);

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
    scenarioId: 'base',
    liveSignals: signals,
  });

  const usdVal = signals?.fx?.usdRub?.value ?? model.macro.usdRub?.value ?? snap.drivers?.usdRub?.value;
  const kztVal = signals?.fx?.kztRub?.value ?? model.macro.kztRub?.value ?? snap.drivers?.kztRub?.value;
  const uzs10kVal = signals?.fx?.uzsPer10k?.value;
  const keyRateVal = model.macro.keyRate?.value ?? signals?.fx?.keyRate?.value ?? snap.drivers?.keyRate?.value;
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
      setMacroMsg(d.errors?.length ? d.errors.join('; ') : 'Котировки ЦБ РФ и радар площадок обновлены');
      await refresh();
    } catch (e) {
      setMacroMsg(e.message);
    } finally {
      setMacroBusy(false);
    }
  }

  async function handleApplySpotConsensus() {
    const val = signals?.analytics?.impliedDealSpotExVat;
    if (!(val > 0)) return;
    setSpotBusy(true);
    try {
      if (demo) setDemo(false);
      const entry = { basis: 'warehouse', date: model.today, price: val, vat: 'excl' };
      upsertStoredUserPrice(entry);
      const csv = buildUserPriceCsv([entry], model.today);
      await importData('prices', csv);
    } finally {
      setSpotBusy(false);
    }
  }

  const cropRows = Object.values(CROP_PROFILES).map((c) => {
    const isOnion = c.id === 'onion';
    const manualCropVal = Number(model.assumptions?.manualPrices?.[c.id]?.value);
    const wh = isOnion ? effWhPrice : (manualCropVal > 0 ? manualCropVal : c.benchmarkWarehousePrice);
    const isCustom = isOnion ? hasUserWh : manualCropVal > 0;
    const peakMult = c.type === CROP_TYPES.STORAGE ? Math.max(...(c.seasonalMultipliers || [1])) : 1;
    const peakWh = isOnion ? decisionPlan.peakWeek.whPrice : +(wh * peakMult).toFixed(1);
    const balRatio = c.balance ? +(c.balance.D / (c.balance.P + c.balance.I + (c.balance.S || 0))).toFixed(2) : 1.0;
    return { ...c, wh, peakWh, balRatio, isCustom };
  });

  const verifiedObs = model.verifiedObservations || [];
  const manualCropEntries = Object.entries(model.assumptions?.manualPrices || {})
    .filter(([k, v]) => k !== 'warehouse' && k !== 'moscow' && v && Number(v.value) > 0)
    .map(([k, v]) => ({
      cropId: k,
      label: CROP_PROFILES[k]?.label || k,
      emoji: CROP_PROFILES[k]?.emoji || '',
      value: Number(v.value),
      asOf: v.asOf || model.today,
    }));

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
              Подключено <strong>{snap.producerCount} мес.</strong> цен производителей Росстата (РФ: <strong>{snap.producer?.value?.toFixed(2) ?? '18.12'} ₽/кг</strong>, ЮФО: <strong>{snap.producerSouth?.value?.toFixed(2) ?? '17.53'} ₽/кг</strong> за {snap.producer?.period ?? '2026-09'}),{' '}
              <strong>{snap.retailCount} нед.</strong> розницы (<strong>{snap.retail?.value?.toFixed(2) ?? '49.19'} ₽/кг</strong>), курсы ЦБ РФ и погода ERA5. Старт Волгоград EXW (5+ см, от 20 т): <strong>{effWhPrice.toFixed(1)} ₽/кг</strong> без НДС.
            </>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--txt2)', fontFamily: 'var(--mono)' }}>
          Holdout MAE CatBoost: <strong>2.51–3.54 ₽/кг</strong> (−55% к наивной модели)
        </span>
      </div>

      {/* Inline Actual Deal Entry */}
      <AddActualPrice defaultOpen={false} />

      {/* Active User Price Entries Log (visible immediately when user adds/fixes a price) */}
      {(verifiedObs.length > 0 || manualCropEntries.length > 0) && (
        <div className="panel" style={{ borderColor: 'var(--green-border)' }}>
          <div className="panel-hd" style={{ background: 'var(--green-bg)', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge up">ВАШИ ДАННЫЕ АКТИВНЫ</span>
              <span className="panel-title" style={{ color: 'var(--green)' }}>
                Журнал зафиксированных цен ({verifiedObs.length + manualCropEntries.length})
              </span>
            </div>
            {model.storeDurable === false && (
              <button
                type="button"
                className="cash-reset-btn"
                onClick={clearLocalEntries}
                title="Очистить сохранённые в браузере цены и вернуться к региональному ориентиру 15.5 ₽/кг"
              >
                ↺ Сбросить к ориентиру 15.5 ₽
              </button>
            )}
          </div>
          <div
            className="table-wrapper"
            role="region"
            tabIndex={0}
            aria-label="Журнал зафиксированных пользователем цен"
          >
            <table className="tbl sticky-hd">
              <thead>
                <tr>
                  <th scope="col" className="pl sticky-col">Дата</th>
                  <th scope="col">Культура / Рынок</th>
                  <th scope="col">Цена без НДС</th>
                  <th scope="col">Эквивалент с НДС 10%</th>
                  <th scope="col">Статус в расчёте</th>
                </tr>
              </thead>
              <tbody>
                {verifiedObs.map((o) => (
                  <tr key={o.id}>
                    <th scope="row" className="pl mono sticky-col" style={{ fontWeight: 500 }}>
                      {o.observationDate}
                    </th>
                    <td>
                      🧅 Лук · {o.market === 'warehouse_volgograd' ? 'Склад Волгоград (EXW)' : 'Опт Москва (DAP)'}
                    </td>
                    <td className="mono fw" style={{ color: 'var(--green)' }}>
                      {(o.priceExVatRubKg ?? o.priceRubKg).toFixed(2)} ₽/кг
                    </td>
                    <td className="mono">
                      {((o.priceExVatRubKg ?? o.priceRubKg) * 1.1).toFixed(2)} ₽/кг
                    </td>
                    <td>
                      <span className="badge up">подтверждённая сделка</span>{' '}
                      <span style={{ fontSize: 11, color: 'var(--txt2)' }}>
                        калибрует 26-нед. график, 5 этапов и карточки ниже
                      </span>
                    </td>
                  </tr>
                ))}
                {manualCropEntries.map((m) => (
                  <tr key={m.cropId}>
                    <th scope="row" className="pl mono sticky-col" style={{ fontWeight: 500 }}>
                      {m.asOf}
                    </th>
                    <td>
                      {m.emoji} {m.label} · Склад EXW
                    </td>
                    <td className="mono fw" style={{ color: 'var(--blue)' }}>
                      {m.value.toFixed(2)} ₽/кг
                    </td>
                    <td className="mono">{(m.value * 1.1).toFixed(2)} ₽/кг</td>
                    <td>
                      <span className="badge info">стартовое допущение</span>{' '}
                      <span style={{ fontSize: 11, color: 'var(--txt2)' }}>
                        учтено в таблице овощных культур
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4 KPI Stat Cards */}
      <div className="row-4">
        <div className="panel">
          <div className="panel-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div className="stat-label">Лук · Склад EXW (Волгоград)</div>
              <span className={`badge ${hasUserWh ? 'up' : 'info'}`} style={{ fontSize: 9 }}>
                {hasUserWh ? 'ваша сделка' : '5+ см · от 20 т'}
              </span>
            </div>
            <div className="stat-val" style={{ color: 'var(--blue)' }}>
              {effWhPrice.toFixed(1)} ₽/кг
            </div>
            <div className="stat-meta">
              <span className="stat-sub">
                без НДС (~{(effWhPrice * 1.1).toFixed(1)} ₽ с НДС) · ЮФО Росстат: {snap.producerSouth?.value?.toFixed(2) ?? '17.53'} ₽
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

      {/* Live Spot Marketplaces & Multi-Factor Pressure Radar */}
      {signals && (
        <div className="row-32">
          <div className="panel">
            <div className="panel-hd" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="panel-title">
                  📡 Спот-котировки площадок · Лук репчатый (оферты ask ≠ сделки)
                </span>
                <span className={`badge ${signals.mode === 'live_hybrid' ? 'up' : 'info'}`}>
                  {signals.mode === 'live_hybrid'
                    ? `LIVE СКАН (${signals.liveFeedsConnected} канала)`
                    : 'СВЕРЕННЫЙ СРЕЗ'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="cash-reset-btn"
                  onClick={() => refreshSignals(true)}
                  disabled={signalsBusy}
                  style={{ fontSize: 10, padding: '2px 8px' }}
                  title="Повторно опросить AgroRU, Food Star, ЦБ РФ и Open-Meteo"
                >
                  {signalsBusy ? 'Сканирование…' : '↻ Скан площадок'}
                </button>
                <button
                  type="button"
                  className="basis-btn active"
                  onClick={handleApplySpotConsensus}
                  disabled={spotBusy}
                  style={{ fontSize: 10, padding: '3px 9px' }}
                  title="Явно зафиксировать расчётный спот площадок Волгограда (за вычетом торга 0.25 ₽/кг) как стартовую цену склада"
                >
                  {spotBusy
                    ? 'Калибровка…'
                    : `⚡ Калибровать от спота (${signals.analytics.impliedDealSpotExVat.toFixed(1)} ₽)`}
                </button>
              </div>
            </div>

            <div
              className="table-wrapper"
              role="region"
              tabIndex={0}
              aria-labelledby="spot-radar-caption"
            >
              <table className="tbl sticky-hd">
                <caption id="spot-radar-caption" className="vlg-tbl-caption">
                  Мониторинг отпускных оферт и официальных ориентиров (калибр 5+ см, без смешивания с мелким 3–4 см и вакуумной чисткой)
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="pl sticky-col">Площадка / канал</th>
                    <th scope="col">Без НДС</th>
                    <th scope="col">Коридор и условия партии</th>
                    <th scope="col">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {(signals.spotChannels || []).map((ch) => {
                    const badgeCls =
                      ch.status === 'live'
                        ? 'up'
                        : ch.status === 'captcha_protected'
                          ? 'warn'
                          : 'info';
                    return (
                      <tr key={ch.id}>
                        <th scope="row" className="pl sticky-col" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          <a
                            href={ch.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: 'var(--txt)', textDecoration: 'none' }}
                            title={ch.note}
                          >
                            {ch.source} <span style={{ color: 'var(--blue)', fontSize: 10 }}>↗</span>
                          </a>
                          <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--txt3)' }}>{ch.spec}</div>
                        </th>
                        <td className="mono fw" style={{ color: ch.region === 'Москва' ? 'var(--amber)' : 'var(--blue)', whiteSpace: 'nowrap' }}>
                          {ch.priceExVat.toFixed(2)} ₽
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--txt2)' }}>
                          <div>{ch.corridorText}</div>
                          <div style={{ fontSize: 10, color: 'var(--txt3)' }}>{ch.note}</div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className={`badge ${badgeCls}`}>{ch.statusLabel}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(() => {
              const agroRu = (signals.spotChannels || []).find((c) => c.id === 'agroru_vlg');
              if (!agroRu?.liveOffers?.length) return null;
              return (
                <details className="vlg-basis-details">
                  <summary>
                    🔎 Живые объявления Волгоградской обл. с AgroRU ({agroRu.liveOffers.length} отфильтрованных товарных оферт 2026 г.)
                  </summary>
                  <div className="vlg-basis-body">
                    {agroRu.liveOffers.map((of, i) => (
                      <div key={`${of.url}-${i}`} className="macro-row" style={{ padding: '4px 0' }}>
                        <span style={{ fontSize: 11, color: 'var(--txt)' }}>
                          <a href={of.url} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>
                            {of.title}
                          </a>{' '}
                          <span style={{ color: 'var(--txt3)' }}>· {of.seller} ({of.date || 'свежее'})</span>
                        </span>
                        <span className="mono fw" style={{ whiteSpace: 'nowrap' }}>
                          {of.priceExVat.toFixed(2)} ₽ без НДС
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })()}
          </div>

          <div className="col-stack">
            <div className="panel">
              <div className="panel-hd" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span className="panel-title">Импортный паритет и пульс рынка</span>
                <span className={`pill ${signals.analytics.signalRegime.cls}`}>
                  Индекс: {signals.analytics.tensionScore > 0 ? `+${signals.analytics.tensionScore}` : signals.analytics.tensionScore}
                </span>
              </div>
              <div className="panel-body" style={{ padding: '10px 14px' }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--txt2)', marginBottom: 6 }}>
                  {signals.analytics.signalRegime.label}
                </div>
                <div className="progress" style={{ height: 6, marginBottom: 10 }}>
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(8, Math.round((signals.analytics.tensionScore + 100) / 2)))}%`,
                      background:
                        signals.analytics.tensionScore >= 15
                          ? 'var(--green)'
                          : signals.analytics.tensionScore <= -15
                            ? '#EF9F27'
                            : 'var(--blue)',
                    }}
                  />
                </div>

                <div className="macro-row">
                  <span className="macro-lbl">🇰🇿 Паритет Тараз (КЗ) → Волг. EXW</span>
                  <span className="macro-val">
                    {signals.analytics.parity.kzLandedVolgogradExVat.toFixed(2)} ₽{' '}
                    <span
                      className={`fc-delta-pill ${signals.analytics.parity.kzSpreadVsLocal <= 0.5 ? 'dn' : 'up'}`}
                      style={{ marginLeft: 4 }}
                      title="Разница импортного паритета КЗ к вашей цене склада"
                    >
                      {signals.analytics.parity.kzSpreadVsLocal >= 0 ? '+' : ''}
                      {signals.analytics.parity.kzSpreadVsLocal.toFixed(1)} ₽
                    </span>
                  </span>
                </div>

                <div className="macro-row">
                  <span className="macro-lbl">🇺🇿 Ранний лук Термез (УЗ) → Юг РФ (апр.)</span>
                  <span className="macro-val" style={{ color: 'var(--amber)' }}>
                    ~{signals.analytics.parity.uzEarlyLandedSouthExVat.toFixed(1)} ₽/кг
                  </span>
                </div>

                <div className="macro-row">
                  <span className="macro-lbl">🇪🇬 Морской паритет Египет CIF (весна)</span>
                  <span className="macro-val">
                    ~{signals.analytics.parity.egLandedMoscowExVat.toFixed(1)} ₽/кг
                  </span>
                </div>

                <div className="macro-row">
                  <span className="macro-lbl">🌡️ Погода 10 дн. (min °C · 4 хаба)</span>
                  <span className="macro-val" style={{ fontSize: 11 }}>
                    ВЛГ {signals.weatherHubs.volgograd.minTemp10d}° · КЗ {signals.weatherHubs.zhambyl.minTemp10d}° · УЗ +{signals.weatherHubs.surkhandarya.minTemp10d}°
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
                  <th scope="col" className="pl sticky-col">Культура</th>
                  <th scope="col">Фаза сезона</th>
                  <th scope="col">Склад сейчас</th>
                  <th scope="col">Пик хранения</th>
                  <th scope="col">Баланс D/S</th>
                  <th scope="col">Рекомендация</th>
                </tr>
              </thead>
              <tbody>
                {cropRows.map((c) => (
                  <tr key={c.id} className={c.isCustom ? 'sales-plan-highlight' : ''}>
                    <th scope="row" className="pl fw sticky-col" style={{ whiteSpace: 'nowrap' }}>
                      {c.emoji} {c.label}{' '}
                      {c.isCustom && (
                        <span className="badge up" style={{ fontSize: 8, marginLeft: 4 }}>
                          ваша
                        </span>
                      )}
                    </th>
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
              {uzs10kVal && (
                <div className="macro-row">
                  <span className="macro-lbl">UZS/RUB · 10 000 узбекских сумов</span>
                  <span className="macro-val">{uzs10kVal.toFixed(2)} ₽</span>
                </div>
              )}
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
            26-недельная динамика · Склад EXW, чистая выручка и Опт Москва (с учётом спроса РЦ, паузы 1–14 янв. и импорта КЗ/УЗ)
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="badge neu">Ноя: транзит КЗ</span>
            <span className="badge info">Дек: пик РЦ → 1–14 янв: пауза ▼</span>
            <span className="badge up">Мар: пик хранения ▲</span>
            <span className="badge warn">Апр: ранний лук УЗ ▼</span>
          </div>
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
