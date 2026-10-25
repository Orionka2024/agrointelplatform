import { useState, useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { CROPS, MACRO, IMPORTERS } from '../data/marketData';
import { useLiveData } from '../hooks/useLiveData';
import { useStoragePrices } from '../hooks/useStoragePrices';
import DataStatusBadge from './DataStatusBadge';
import WeatherWidget from './WeatherWidget';

Chart.register(...registerables);

const CROP_LIST = Object.values(CROPS);

function signalClass(signal) {
  return signal === 'BUY' ? 'up' : signal === 'SELL' ? 'dn' : 'warn';
}
function defClass(idx) {
  if (idx < 1) return 'up';
  if (idx < 1.1) return 'neu';
  if (idx < 1.2) return 'warn';
  return 'dn';
}
function potentialClass(p) {
  if (p === 'Очень высокий' || p === 'Высокий') return 'up';
  if (p === 'Средне-высокий' || p === 'Средний') return 'warn';
  return 'dn';
}
function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return n;
}

function MainChart({ storagePrices }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const [chartBasis, setChartBasis] = useState('wholesale');

  useEffect(() => {
    if (!ref.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const isStor = chartBasis === 'storage';
    const onionData = isStor
      ? CROPS.onion.forecast.map(wp => +(storagePrices.onion * (wp / CROPS.onion.price)).toFixed(1))
      : CROPS.onion.forecast;
    const carrotData = isStor
      ? CROPS.carrot.forecast.map(wp => +(storagePrices.carrot * (wp / CROPS.carrot.price)).toFixed(1))
      : CROPS.carrot.forecast;
    const potatoData = isStor
      ? CROPS.potato.forecast.map(wp => +(storagePrices.potato * (wp / CROPS.potato.price)).toFixed(1))
      : CROPS.potato.forecast;

    const labels = Array.from({ length: 26 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + (i + 1) * 7);
      const dt = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      return `W+${i + 1} (${dt})`;
    });

    chartRef.current = new Chart(ref.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Лук', data: onionData, borderColor: '#1A56A8', backgroundColor: 'rgba(26,86,168,.05)', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
          { label: 'Морковь', data: carrotData, borderColor: '#0D7C4A', backgroundColor: 'rgba(13,124,74,.05)', borderWidth: 1.5, pointRadius: 0, tension: 0.3, borderDash: [4, 2] },
          { label: 'Картофель', data: potatoData, borderColor: '#8C97A8', backgroundColor: 'rgba(140,151,168,.04)', borderWidth: 1.5, pointRadius: 0, tension: 0.3, borderDash: [2, 2] },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { color: '#8C97A8', font: { size: 10, family: 'JetBrains Mono' }, maxTicksLimit: 13 } },
          y: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { color: '#8C97A8', font: { size: 10, family: 'JetBrains Mono' }, callback: v => v.toFixed(0) + '₽' } },
        },
        interaction: { mode: 'index', intersect: false },
      },
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [chartBasis, storagePrices]);

  return (
    <div className="panel" style={{ marginTop: 0 }}>
      <div className="panel-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span className="panel-title">Прогноз цен · 26 недель ({chartBasis === 'storage' ? 'Базис: Склад / Нал' : 'Базис: Опт Москва'})</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="basis-switcher" style={{ margin: 0, padding: 2 }}>
            <button
              type="button"
              className={`basis-btn ${chartBasis === 'wholesale' ? 'active' : ''}`}
              style={{ padding: '3px 8px', fontSize: 11 }}
              onClick={() => setChartBasis('wholesale')}
            >
              🏢 Опт
            </button>
            <button
              type="button"
              className={`basis-btn ${chartBasis === 'storage' ? 'active' : ''}`}
              style={{ padding: '3px 8px', fontSize: 11 }}
              onClick={() => setChartBasis('storage')}
            >
              🏬 Склад
            </button>
          </div>
          <div className="chart-legend">
            <div className="legend-item"><div className="legend-swatch" style={{ background: '#1A56A8' }} />Лук</div>
            <div className="legend-item"><div className="legend-swatch" style={{ background: '#0D7C4A' }} />Морковь</div>
            <div className="legend-item"><div className="legend-swatch" style={{ background: '#8C97A8' }} />Картофель</div>
          </div>
        </div>
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div className="chart-wrap">
          <canvas ref={ref} aria-label="Price forecast chart for selected crops over 26 weeks" role="img" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const onion = CROPS.onion;
  const { liveData, isLoading, isStale, isOffline, lastUpdated, refresh } = useLiveData();
  const { storagePrices, isCustom } = useStoragePrices();
  const [tableBasis, setTableBasis] = useState('wholesale');

  return (
    <>
      {/* Stat cards */}
      <div className="row-4">
        <div className="panel"><div className="panel-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <div className="stat-label">Цена · Лук</div>
            {isCustom('onion') && (
              <span className="badge info" style={{ fontSize: 9, padding: '2px 5px' }} title="Задана своя цена отгрузки со склада">вручную</span>
            )}
          </div>
          <div className="stat-val warn">{onion.price.toFixed(1)} ₽</div>
          <div className="stat-meta">
            <span className="badge up">▲ +{onion.change}%</span>
            <span className="stat-sub">склад {storagePrices.onion.toFixed(1)} ₽ (спред +{(onion.price - storagePrices.onion).toFixed(1)} ₽)</span>
          </div>
        </div></div>

        <div className="panel"><div className="panel-body">
          <div className="stat-label">Индекс дефицита</div>
          <div className="stat-val dn">{onion.deficitIdx.toFixed(2)}</div>
          <div className="stat-meta">
            <span className="badge warn">ДЕФИЦИТ</span>
            <span className="stat-sub">порог &gt;1.1</span>
          </div>
        </div></div>

        <div className="panel"><div className="panel-body">
          <div className="stat-label">NDVI · Sentinel-2</div>
          <div className="stat-val up">{onion.ndvi.toFixed(2)}</div>
          <div className="stat-meta">
            <span className="badge up">НОРМА</span>
            <span className="stat-sub">обн. 4 дня назад</span>
          </div>
        </div></div>

        <div className="panel"><div className="panel-body">
          <div className="stat-label">Импорт давление</div>
          <div className="stat-val">37.1B</div>
          <div className="stat-meta">
            <span className="badge warn">СРЕДНЕЕ</span>
            <span className="stat-sub">КЗ · УЗ · ЕГ</span>
          </div>
        </div></div>
      </div>

      {/* Crop table + side panels */}
      <div className="row-32">
        <div className="panel">
          <div className="panel-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="panel-title">Рейтинг культур · потенциал 2026</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="basis-switcher" style={{ margin: 0, padding: 2 }}>
                <button
                  type="button"
                  className={`basis-btn ${tableBasis === 'wholesale' ? 'active' : ''}`}
                  style={{ padding: '3px 8px', fontSize: 11 }}
                  onClick={() => setTableBasis('wholesale')}
                >
                  🏢 Опт
                </button>
                <button
                  type="button"
                  className={`basis-btn ${tableBasis === 'storage' ? 'active' : ''}`}
                  style={{ padding: '3px 8px', fontSize: 11 }}
                  onClick={() => setTableBasis('storage')}
                >
                  🏬 Склад
                </button>
              </div>
              <span className="badge info">CatBoost</span>
            </div>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="pl">Культура</th>
                  <th>Потенциал</th>
                  <th>Индекс деф.</th>
                  <th>{tableBasis === 'storage' ? 'Склад ₽/кг' : 'Опт ₽/кг'}</th>
                  <th>Прибыль/га</th>
                  <th>Сигнал</th>
                </tr>
              </thead>
              <tbody>
                {CROP_LIST.map(c => {
                  const storPrice = storagePrices[c.id];
                  const hasCustom = isCustom(c.id);
                  const displayPrice = tableBasis === 'storage' ? storPrice : c.price;
                  const calculatedProfit = tableBasis === 'storage'
                    ? Math.round((c.yield * storPrice * 1000) - (c.cost * 1000))
                    : c.profitPerHa;

                  return (
                    <tr key={c.id}>
                      <td className="pl fw">{c.emoji} {c.label}</td>
                      <td><span className={`pill ${potentialClass(c.potential)}`}>{c.potential}</span></td>
                      <td className={`mono ${defClass(c.deficitIdx)}`}>{c.deficitIdx.toFixed(2)}</td>
                      <td className="mono">
                        {displayPrice.toFixed(1)}
                        {tableBasis === 'storage' && hasCustom && (
                          <span style={{ color: 'var(--blue)', marginLeft: 4 }} title="Задано вручную">✏️</span>
                        )}
                      </td>
                      <td className={`mono ${calculatedProfit > 600000 ? 'up' : calculatedProfit < 300000 ? 'dn' : ''}`}>{fmt(calculatedProfit)}</td>
                      <td><span className={`pill ${signalClass(c.signal)}`}>{c.signal}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col-stack">
          {/* Macro */}
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Макроэкономика</span>
              <DataStatusBadge
                isLoading={isLoading}
                isOffline={isOffline}
                isStale={isStale}
                lastUpdated={lastUpdated}
                onRefresh={refresh}
              />
            </div>
            <div className="panel-body" style={{ padding: '8px 14px' }}>
              <div className="macro-row">
                <span className="macro-lbl">USD/RUB · ЦБ РФ</span>
                {isLoading
                  ? <span className="macro-val skeleton" style={{ width: 60 }}>—</span>
                  : <span className="macro-val" style={{ color: liveData.usdRub > 100 ? 'var(--red)' : liveData.usdRub > 90 ? 'var(--amber)' : 'inherit' }}>
                      {(liveData.usdRub ?? MACRO.usdRub).toFixed(2)}
                    </span>
                }
              </div>
              <div className="macro-row">
                <span className="macro-lbl">KZT/RUB · ЦБ РФ</span>
                {isLoading
                  ? <span className="macro-val skeleton" style={{ width: 60 }}>—</span>
                  : <span className="macro-val">
                      {(liveData.kztRub ?? MACRO.kztRub).toFixed(3)}
                    </span>
                }
              </div>
              <div className="macro-row">
                <span className="macro-lbl">Ключевая ставка ЦБ</span>
                <span className="macro-val" style={{ color: 'var(--red)' }}>{(liveData.keyRate ?? MACRO.keyRate).toFixed(1)}%</span>
              </div>
              <div className="macro-row"><span className="macro-lbl">Фура на Москву (Волгоград)</span><span className="macro-val" style={{ color: 'var(--amber)' }}>{(MACRO.truckRateMsk / 1000).toFixed(0)}K ₽</span></div>
              <div className="macro-row"><span className="macro-lbl">Дизель</span><span className="macro-val" style={{ color: 'var(--amber)' }}>{MACRO.diesel.toFixed(1)} ₽/л</span></div>
              <div className="macro-row"><span className="macro-lbl">Остатки урожая</span><span className="macro-val" style={{ color: 'var(--red)' }}>{MACRO.harvestStock}% нормы</span></div>
            </div>
          </div>

          {/* Importers */}
          <div className="panel">
            <div className="panel-hd"><span className="panel-title">Импортёры · лук</span></div>
            <div className="panel-body" style={{ padding: '10px 14px' }}>
              {IMPORTERS.map(imp => (
                <div key={imp.country} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: 'var(--txt2)' }}>{imp.country}</span>
                    <span style={{ fontFamily: 'var(--mono)' }}>{imp.share}%</span>
                  </div>
                  <div className="progress">
                    <div className="progress-fill" style={{ width: `${imp.share}%`, background: imp.risk === 'up' ? '#0D7C4A' : imp.risk === 'dn' ? '#C0303A' : '#EF9F27' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <WeatherWidget />

      <MainChart storagePrices={storagePrices} />
    </>
  );
}
