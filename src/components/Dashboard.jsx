import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { useMarket } from '../context/useMarket';
import WeatherWidget from './WeatherWidget';

Chart.register(...registerables);

function MainChart({ forecast, demo }) {
  const ref = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const horizons = forecast?.horizons || [];
    const validRows = horizons.filter(h => h.point !== null);

    if (validRows.length === 0) {
      return;
    }

    const labels = validRows.map(r => `W+${r.h} (${r.targetDate.slice(5)})`);
    const points = validRows.map(r => r.point);
    const lo80 = validRows.map(r => r.interval?.lo80 ?? null);
    const hi80 = validRows.map(r => r.interval?.hi80 ?? null);
    const lo95 = validRows.map(r => r.interval?.lo95 ?? null);
    const hi95 = validRows.map(r => r.interval?.hi95 ?? null);

    const datasets = [
      {
        label: demo ? 'Прогноз лука (ДЕМО)' : 'Прогноз лука (Базовый)',
        data: points,
        borderColor: '#1A56A8',
        backgroundColor: 'rgba(26,86,168,.08)',
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 2,
      },
    ];

    if (!demo && hi80.some(v => v !== null)) {
      datasets.push(
        {
          label: 'Верхняя граница 80%',
          data: hi80,
          borderColor: 'rgba(26,86,168,.35)',
          borderDash: [4, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'Нижняя граница 80%',
          data: lo80,
          borderColor: 'rgba(26,86,168,.35)',
          borderDash: [4, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        }
      );
    }

    if (!demo && hi95.some(v => v !== null)) {
      datasets.push(
        {
          label: 'Интервал 95%',
          data: hi95,
          borderColor: 'rgba(239,159,39,.4)',
          borderDash: [2, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'Нижняя 95%',
          data: lo95,
          borderColor: 'rgba(239,159,39,.4)',
          borderDash: [2, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        }
      );
    }

    chartRef.current = new Chart(ref.current, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 10 } } },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { color: '#8C97A8', font: { size: 10 } } },
          y: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { color: '#8C97A8', callback: v => v.toFixed(1) + ' ₽' } },
        },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [forecast, demo]);

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="panel-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="panel-title">
          График прогноза цен · {forecast?.basis === 'moscow' ? 'Опт Москва (с НДС)' : 'Склад продавца (Волгоград, без НДС)'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {demo && <span className="badge warn">ДЕМО (иллюстративный ряд)</span>}
          {forecast?.status === 'validated' && <span className="badge up">Валидирован бэктестом</span>}
          {forecast?.status === 'baseline_unvalidated' && <span className="badge info">Базовая модель (без валидации)</span>}
          {forecast?.status === 'insufficient_data' && <span className="badge dn">Недостаточно данных</span>}
        </div>
      </div>
      <div style={{ padding: '12px 14px' }}>
        {(!forecast || !forecast.horizons || forecast.horizons.filter(h => h.point !== null).length === 0) ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--txt2)', background: 'var(--surface2)', borderRadius: 6 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📊</div>
            <div style={{ fontWeight: 600, color: 'var(--txt)', marginBottom: 4 }}>
              Нет расчетного прогноза для отображения на графике
            </div>
            <div style={{ fontSize: 11, maxWidth: 500, margin: '0 auto' }}>
              {forecast?.reasons?.[0] || 'Для построения математического прогноза импортируйте исторические цены или включите «Демо-режим» в верхнем меню.'}
            </div>
          </div>
        ) : (
          <div className="chart-wrap">
            <canvas ref={ref} aria-label="Forecast chart" role="img" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { model, demo, setDemo, basis, setBasis } = useMarket();

  const whPrice = model.prices.warehouse;
  const mskPrice = model.prices.moscow;
  const balance = model.balance;
  const fc = model.forecasts[basis] || model.forecasts.warehouse;

  return (
    <>
      {/* Mode Status Banner */}
      {!demo && whPrice.exVat === null && (
        <div style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid var(--amber)', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            ℹ️ <strong>В базе пока нет загруженных реальных сделок</strong> (активен режим «Факт»). Чтобы увидеть демонстрационный 26-недельный прогноз и расчеты, включите ДЕМО-режим или импортируйте сделки через вкладку «Импорт данных (CSV)».
          </div>
          <button
            type="button"
            className="basis-btn active"
            onClick={() => setDemo(true)}
            style={{ fontSize: 11, padding: '4px 12px', whiteSpace: 'nowrap', marginLeft: 12 }}
          >
            Включить ДЕМО-режим
          </button>
        </div>
      )}
      {demo && (
        <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            ℹ️ <strong>Активен ДЕМО-режим:</strong> в платформу уже встроена <strong>6-летняя база наблюдений (313 недель, 2020–2026)</strong>. Вам не требуется загружать CSV-файлы — просто переключитесь на режим «Факт» для работы с реальными ценами и валидацией бэктестом.
          </div>
          <button
            type="button"
            className="basis-btn active"
            onClick={() => setDemo(false)}
            style={{ fontSize: 11, padding: '4px 12px', whiteSpace: 'nowrap', marginLeft: 12 }}
          >
            Включить режим «Факт (313 нед.)»
          </button>
        </div>
      )}

      {/* Stat KPI Cards */}
      <div className="row-4">
        {/* Card 1: Warehouse Price */}
        <div className="panel">
          <div className="panel-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <div className="stat-label">Лук · Склад EXW (Волгоград)</div>
              <span className={`badge ${whPrice.provenance.status === 'observed' ? 'up' : whPrice.provenance.status === 'demo' ? 'warn' : 'neu'}`} style={{ fontSize: 9 }}>
                {whPrice.provenance.status}
              </span>
            </div>
            <div className="stat-val" style={{ color: 'var(--blue)' }}>
              {whPrice.exVat !== null ? `${whPrice.exVat.toFixed(1)} ₽/кг` : '—'}
            </div>
            <div className="stat-meta">
              <span className="stat-sub">
                {whPrice.provenance.asOf ? `на дату ${whPrice.provenance.asOf}` : 'без даты'} · {whPrice.provenance.source || 'нет источника'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Moscow Wholesale Price */}
        <div className="panel">
          <div className="panel-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <div className="stat-label">Лук · Опт Москва (с доставкой)</div>
              <span className="badge neu" style={{ fontSize: 9 }}>
                {mskPrice.provenance.status}
              </span>
            </div>
            <div className="stat-val warn">
              {mskPrice.inclVat !== null ? `${mskPrice.inclVat.toFixed(1)} ₽/кг` : '—'}
            </div>
            <div className="stat-meta">
              <span className="stat-sub">
                с НДС 10% · без НДС: {mskPrice.exVat !== null ? `${mskPrice.exVat.toFixed(1)} ₽` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Deficit Index */}
        <div className="panel">
          <div className="panel-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <div className="stat-label">Индекс баланса (D / Supply)</div>
              <span className={`badge ${balance.provenance.status === 'demo' ? 'warn' : 'info'}`} style={{ fontSize: 9 }}>
                {balance.provenance.status}
              </span>
            </div>
            <div className="stat-val dn">
              {balance.result.index !== null ? balance.result.index.toFixed(2) : '—'}
            </div>
            <div className="stat-meta">
              <span className={`badge ${balance.result.cls || 'neu'}`} style={{ fontSize: 10 }}>
                {balance.result.badge || 'НЕТ ДАННЫХ'}
              </span>
              <span className="stat-sub">D=2.2 / S=2.25 млн т</span>
            </div>
          </div>
        </div>

        {/* Card 4: Cost Bridge / Spread */}
        <div className="panel">
          <div className="panel-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <div className="stat-label">Спред Москва − Склад</div>
              <span className={`badge ${model.bridgeResult.status === 'ok' ? 'up' : 'warn'}`} style={{ fontSize: 9 }}>
                {model.bridgeResult.status === 'ok' ? 'смета моста' : 'неполная смета'}
              </span>
            </div>
            <div className="stat-val" style={{ color: 'var(--amber)' }}>
              {model.spread.bridgeGrossDifferenceExVat !== null ? `+${model.spread.bridgeGrossDifferenceExVat.toFixed(1)} ₽/кг` : '—'}
            </div>
            <div className="stat-meta">
              <span className="stat-sub">
                Фура 6.75 ₽ + потери + фасовка + маржа
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Split: Market Overview & Macro */}
      <div className="row-32">
        <div className="panel">
          <div className="panel-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="panel-title">Текущий статус рядов и базисов</span>
            <div className="basis-switcher" style={{ margin: 0, padding: 2 }}>
              <button
                type="button"
                className={`basis-btn ${basis === 'warehouse' ? 'active' : ''}`}
                style={{ padding: '3px 8px', fontSize: 11 }}
                onClick={() => setBasis('warehouse')}
              >
                🏬 Склад EXW
              </button>
              <button
                type="button"
                className={`basis-btn ${basis === 'moscow' ? 'active' : ''}`}
                style={{ padding: '3px 8px', fontSize: 11 }}
                onClick={() => setBasis('moscow')}
              >
                🏢 Опт Москва
              </button>
            </div>
          </div>
          <div className="panel-body" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ background: 'var(--surface2)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>Ряд: {basis === 'warehouse' ? 'Склад (Волгоград)' : 'Опт Москва'}</span>
                  <span className="badge info">{model.series[basis]?.n ?? 0} наблюдений по неделям</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.5 }}>
                  {model.series[basis]?.n > 0 ? (
                    <>
                      Период данных: с <strong>{model.series[basis].firstWeek}</strong> по <strong>{model.series[basis].lastWeek}</strong>. Исключено выбросов: {model.series[basis].excluded?.outlier || 0}.
                    </>
                  ) : (
                    <>
                      В базе нет реальных наблюдений сделок для данного ряда. Вкладка «Прогноз» работает в режиме демонстрации или ожидает импорта CSV.
                    </>
                  )}
                </div>
              </div>

              {/* Data Freshness Matrix */}
              <table className="tbl" style={{ marginTop: 4 }}>
                <thead>
                  <tr>
                    <th>Показатель</th>
                    <th>Базис / Единицы</th>
                    <th>Источник</th>
                    <th>Дата / Свежесть</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {model.dataStatus.map(d => (
                    <tr key={d.id}>
                      <td className="fw">{d.label}</td>
                      <td>{d.id.includes('warehouse') ? 'EXW склад без НДС' : d.id.includes('moscow') ? 'DAP Москва' : '—'}</td>
                      <td style={{ color: 'var(--txt2)', fontSize: 11 }}>{demo ? 'ДЕМО (иллюстрация)' : (d.asOf ? 'БД платформы' : '—')}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{d.asOf || 'нет даты'}</td>
                      <td>
                        <span className={`pill ${d.status === 'live' || d.status === 'observed' ? 'up' : d.status === 'demo' ? 'warn' : 'neu'}`}>
                          {d.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Macro Card */}
        <div className="col-stack">
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Макроэкономика и логистика</span>
            </div>
            <div className="panel-body" style={{ padding: '8px 14px' }}>
              <div className="macro-row">
                <span className="macro-lbl">USD/RUB · Банк России</span>
                <span className="macro-val">
                  {model.macro.usdRub.value ? `${model.macro.usdRub.value.toFixed(2)} ₽` : '—'}
                  <span className="badge neu" style={{ fontSize: 9, marginLeft: 6 }}>{model.macro.usdRub.provenance.status}</span>
                </span>
              </div>
              <div className="macro-row">
                <span className="macro-lbl">KZT/RUB · Банк России</span>
                <span className="macro-val">
                  {model.macro.kztRub.value ? `${model.macro.kztRub.value.toFixed(3)} ₽` : '—'}
                  <span className="badge neu" style={{ fontSize: 9, marginLeft: 6 }}>{model.macro.kztRub.provenance.status}</span>
                </span>
              </div>
              <div className="macro-row">
                <span className="macro-lbl">Ключевая ставка ЦБ</span>
                <span className="macro-val" style={{ color: 'var(--red)' }}>
                  {model.macro.keyRate.value ? `${model.macro.keyRate.value.toFixed(1)}%` : '—'}
                </span>
              </div>
              <div className="macro-row">
                <span className="macro-lbl">Фура Волгоград–Москва</span>
                <span className="macro-val" style={{ color: 'var(--amber)' }}>
                  {model.bridge.truckCostRub ? `${Math.round(model.bridge.truckCostRub / 1000)}K ₽` : 'не задана'}
                </span>
              </div>
              <div className="macro-row">
                <span className="macro-lbl">Стоимость фрахта на 1 кг</span>
                <span className="macro-val">
                  {model.bridge.truckCostRub && model.bridge.truckPayloadKg ? `${(model.bridge.truckCostRub / model.bridge.truckPayloadKg).toFixed(2)} ₽/кг` : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Импорт и поставки</span>
            </div>
            <div className="panel-body" style={{ padding: '10px 14px', fontSize: 11, color: 'var(--txt2)', lineHeight: 1.55 }}>
              <div>• <strong>Казахстан:</strong> основной объем поставок (Жамбылская обл., Туркестанская обл.). Осенняя уборка продолжается в августе–октябре.</div>
              <div style={{ marginTop: 6 }}>• <strong>Узбекистан:</strong> ранний лук нового урожая поступает на российский рынок в апреле–мае.</div>
              <div style={{ marginTop: 6, fontStyle: 'italic', color: 'var(--txt3)' }}>
                * Объемы импорта моделируются в сценариях как независимые шоки предложения без приписывания вымышленных вероятностей.
              </div>
            </div>
          </div>
        </div>
      </div>

      <WeatherWidget />

      <MainChart forecast={fc} demo={demo} />
    </>
  );
}
