import { useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { officialHistory as history, officialForecast as fc, officialDrivers as drivers } from '../../shared/officialData.js';
import { MONTHLY_MODELS, monthNumber } from '../../shared/officialForecast.js';
import { localBasis, applyBasis } from '../../shared/localBasis.js';
import { useMarket } from '../context/useMarket';
import OfficialSummary from './OfficialSummary';
import AddActualPrice from './AddActualPrice';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: d }) : '—');
const band = (v) => (v ? `${fmt(v.lo)}–${fmt(v.hi)}` : 'Недостаточно ошибок');
const STRENGTH = {
  calibrated: 'Калибровка по ≥6 мес.',
  weak: 'Предварительная привязка (3–5 мес.)',
  anchor: 'Первичная привязка по текущим сделкам (1–2 мес.)',
};

export default function OfficialMarket() {
  const { model } = useMarket();
  const hasWh = (model.series?.warehouse?.points?.length ?? 0) > 0;
  const hasMsk = (model.series?.moscow?.points?.length ?? 0) > 0;
  const [view, setView] = useState('producer');
  const [selected, setSelected] = useState(3);
  const [calBasis, setCalBasis] = useState(!hasWh && hasMsk ? 'moscow' : 'warehouse');
  const activeBasis =
    calBasis === 'moscow' && !hasMsk && hasWh
      ? 'warehouse'
      : calBasis === 'warehouse' && !hasWh && hasMsk
      ? 'moscow'
      : calBasis;

  const available = history.producer.monthly.filter(
    (r) => r.availableDate <= model.today && r.period <= model.today.slice(0, 7)
  );
  const cal = localBasis(model.series?.[activeBasis]?.points, available);
  const rows = fc.issueDate <= model.today ? fc.rows : [];
  const r = rows.find((x) => x.h === selected) || rows[0];
  const v = r?.validation;
  const stale = monthNumber(model.today.slice(0, 7)) - monthNumber(fc.inputCutoff) > 2;

  const monthly = available.slice(-36);
  const future = rows.map((x) => x.targetMonth);
  const labels = [
    ...new Set([
      ...monthly.map((x) => x.period),
      ...(cal ? cal.months.map((x) => x.month) : []),
      fc.issueDate.slice(0, 7),
      ...future,
    ]),
  ].sort();

  const monthlyMap = new Map(monthly.map((x) => [x.period, x.value]));
  const cbMap = new Map(rows.map((x) => [x.targetMonth, x.catboostPoint ?? x.point]));
  const selMap = new Map(rows.map((x) => [x.targetMonth, x.point]));
  const userObsMap = new Map((cal?.months || []).map((x) => [x.month, x.user]));
  const localCbMap = new Map(
    cal
      ? rows.map((x) => [
          x.targetMonth,
          applyBasis({ point: x.catboostPoint ?? x.point, interval80: x.catboostInterval80 }, cal)?.point,
        ])
      : []
  );

  const datasets = [
    {
      label: 'Росстат: наблюдения РФ',
      data: labels.map((m) => monthlyMap.get(m) ?? null),
      borderColor: '#2563a6',
      backgroundColor: '#2563a6',
      pointRadius: 2,
    },
    {
      label: 'CatBoost GBDT (РФ, все факторы)',
      data: labels.map((m) => cbMap.get(m) ?? null),
      borderColor: '#0D7C4A',
      borderDash: [5, 4],
      pointRadius: 3,
    },
    {
      label: 'Строгий выбор на настройке',
      data: labels.map((m) => selMap.get(m) ?? null),
      borderColor: '#ad7024',
      borderDash: [3, 4],
      pointRadius: 2,
    },
  ];

  if (cal) {
    datasets.push({
      label: `Ваши сделки (${activeBasis === 'warehouse' ? 'склад без НДС' : 'Москва без НДС'})`,
      data: labels.map((m) => userObsMap.get(m) ?? null),
      borderColor: '#7C3AED',
      backgroundColor: '#7C3AED',
      pointRadius: 4,
    });
    datasets.push({
      label: 'CatBoost под ваш уровень цен',
      data: labels.map((m) => localCbMap.get(m) ?? null),
      borderColor: '#7C3AED',
      borderDash: [4, 4],
      pointRadius: 3,
    });
  }

  const retail = history.retail.weekly.filter((x) => x.availableDate <= model.today && x.date <= model.today);
  const tuningById = new Map((v?.comparisons || []).map((c) => [c.id, c]));

  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="panel-title">Лук · официальная история Росстата, макрофакторы ЦБ, погода ERA5 и аудит моделей</span>
        <span className="badge info">{fc.modelVersion}</span>
      </div>
      <div className="panel-body">
        <OfficialSummary />
        <AddActualPrice defaultOpen={false} />

        <div className="audit-controls">
          <label>
            Ряд{' '}
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="producer">Производители РФ · месяцы · без НДС + CatBoost GBDT</option>
              <option value="retail">Розница РФ · недели · наблюдения (246 нед.)</option>
            </select>
          </label>
          {(hasWh || hasMsk) && view === 'producer' && (
            <label>
              Базис калибровки{' '}
              <select value={activeBasis} onChange={(e) => setCalBasis(e.target.value)}>
                <option value="warehouse">Склад Волгоград (без НДС)</option>
                <option value="moscow">Опт Москва (без НДС)</option>
              </select>
            </label>
          )}
        </div>

        {view === 'retail' ? (
          <>
            <p>
              Розничные цены Росстата используются в CatBoost как опережающий сигнал рознично-оптового спреда, но никогда не пересчитываются в складскую цену фиксированным делителем.
            </p>
            <div className="official-chart">
              <Line
                data={{
                  labels: retail.map((x) => x.date),
                  datasets: [{ label: 'Розница РФ, ₽/кг', data: retail.map((x) => x.value), borderColor: '#2563a6', pointRadius: 0 }],
                }}
                options={{ responsive: true, maintainAspectRatio: false }}
              />
            </div>
            <details>
              <summary>История и ссылки на ячейки ({retail.length})</summary>
              <HistoryTable rows={retail} dateKey="date" />
            </details>
          </>
        ) : (
          <>
            <p>
              Сохранённый выпуск: <strong>{fc.issueDate}</strong> · Последнее наблюдение Росстата: <strong>{fc.inputCutoff}</strong> ({fmt(fc.lastValue)} ₽/кг) · Модель: <code>{fc.modelVersion}</code>. Ансамбль CatBoost обучается на отклонениях от сезонного равновесия Weibull с учётом <strong>KZT/RUB</strong> ({fc.drivers?.kztRubLast ? `${fmt(fc.drivers.kztRubLast.value, 4)} ₽` : '—'}), <strong>USD/RUB</strong> ({fc.drivers?.usdRubLast ? `${fmt(fc.drivers.usdRubLast.value)} ₽` : '—'}), <strong>ключевой ставки ЦБ</strong> ({fc.drivers?.keyRateLast ? `${fmt(fc.drivers.keyRateLast.value)}%` : '—'}), рознично-оптового спреда и морозных шоков ERA5 в Жамбылской обл. и Волгограде.
            </p>
            {cal && (
              <div className="basis-banner">
                <strong>Калибровка под ваши сделки активна ({activeBasis === 'warehouse' ? 'склад EXW без НДС' : 'Москва без НДС'}):</strong>{' '}
                коэффициент уровня <strong>×{fmt(cal.factor)}</strong> · учтено месяцев: <strong>{cal.n}</strong> ({STRENGTH[cal.strength]}).
              </div>
            )}
            {stale && <p className="audit-warning">Данные устарели. Требуется обновление архива Росстата.</p>}

            <div className="official-chart">
              <Line
                data={{ labels, datasets }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: { y: { title: { display: true, text: '₽/кг без НДС' } } },
                }}
              />
            </div>

            <div className="table-wrapper" role="region" tabIndex={0} aria-label="Помесячный прогноз CatBoost и сравнение моделей">
              <table className="tbl sticky-hd">
                <thead>
                  <tr>
                    <th className="sticky-col">Месяц</th>
                    <th>CatBoost РФ</th>
                    {cal && <th>Ваш CatBoost</th>}
                    <th>Выбор селектора</th>
                    <th>80% диапазон CatBoost</th>
                    <th>MAE holdout: CatBoost / Равновесие / Naive</th>
                    <th>Выбранная на настройке модель</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const cbPt = row.catboostPoint ?? row.point;
                    const loc = applyBasis({ point: cbPt, interval80: row.catboostInterval80 }, cal);
                    const cbFinal = row.validation.finalAll?.find((x) => x.id === 'catboost');
                    const eqFinal = row.validation.finalAll?.find((x) => x.id === 'eq_carry');
                    return (
                      <tr key={row.h}>
                        <td className="mono fw sticky-col">{row.targetMonth}</td>
                        <td className="mono fw" style={{ color: 'var(--green)' }}>{fmt(cbPt)} ₽</td>
                        {cal && <td className="mono fw" style={{ color: '#7C3AED' }}>{fmt(loc?.point)} ₽</td>}
                        <td className="mono">{fmt(row.point)} ₽</td>
                        <td className="mono">{band(row.catboostInterval80 ?? row.interval80)}</td>
                        <td className="mono">
                          <strong>{fmt(cbFinal?.mae)}</strong> / {fmt(eqFinal?.mae)} / {fmt(row.validation.naiveFinal.mae)} ₽
                        </td>
                        <td style={{ fontSize: 11 }}>{MONTHLY_MODELS[row.validation.selected]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <details>
              <summary>Детальное сравнение всех 7 моделей по горизонтам (настройка vs финальные 12 мес.)</summary>
              <label>
                Целевой месяц{' '}
                <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
                  {rows.map((x) => (
                    <option key={x.h} value={x.h}>
                      {x.targetMonth} (лаг +{x.lead} мес.)
                    </option>
                  ))}
                </select>
              </label>
              {v && (
                <>
                  <p>
                    Выбрана на участке настройки: <strong>{MONTHLY_MODELS[v.selected]}</strong>. Настройка до {v.split.tuningEnds || '—'}; калибровка интервалов {v.split.calibrationStarts}–{v.split.calibrationEnds} ({v.calibrationN} ошибок); независимый финальный тест {v.split.finalStarts}–{v.split.finalEnds} ({v.final.n} прогнозов).
                  </p>
                  <div className="table-wrapper" role="region" tabIndex={0} aria-label="Сравнение кандидатов на настройке и holdout">
                    <table className="tbl sticky-hd">
                      <thead>
                        <tr>
                          <th>Кандидат</th>
                          <th>MAE на настройке</th>
                          <th>Отношение к naive</th>
                          <th>MAE на финальных 12 мес. (holdout)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(v.finalAll || []).map((f) => {
                          const t = tuningById.get(f.id);
                          return (
                            <tr key={f.id}>
                              <td>
                                {MONTHLY_MODELS[f.id] || f.id}
                                {f.id === v.selected ? ' ✓' : ''}
                              </td>
                              <td className="mono">
                                {f.id === 'naive'
                                  ? `${fmt(v.comparisons?.[0]?.naiveMAE)} (n=${v.comparisons?.[0]?.n ?? '—'})`
                                  : `${fmt(t?.mae)} (n=${t?.n ?? 0})`}
                              </td>
                              <td className="mono">{f.id === 'naive' ? '1,00' : fmt(t?.ratio)}</td>
                              <td className="mono fw">{fmt(f.mae)} ₽ (n={f.n})</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </details>

            <details>
              <summary>Проверенная месячная история Росстата ({available.length})</summary>
              <HistoryTable rows={available} dateKey="period" />
            </details>
          </>
        )}

        <details>
          <summary>Источники, контрольные суммы SHA-256 и методологические ограничения</summary>
          {history.sources.map((s) => (
            <p key={s.id}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.url.split('/').at(-1)}
              </a>{' '}
              · опубликовано {s.publishedDate} · SHA-256: <code style={{ overflowWrap: 'anywhere' }}>{s.sha256}</code>
            </p>
          ))}
          {Object.entries(drivers.sources).map(([k, s]) => (
            <p key={k}>
              Источник ({k}): <code>{s.url}</code> · получено {s.retrievedDate} · SHA-256:{' '}
              <code style={{ overflowWrap: 'anywhere' }}>{s.sha256}</code>
            </p>
          ))}
          <ul>
            {history.limitations.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

function HistoryTable({ rows, dateKey }) {
  return (
    <div className="official-history table-wrapper" role="region" tabIndex={0} aria-label="Таблица первичных наблюдений Росстата">
      <table className="tbl sticky-hd">
        <thead>
          <tr>
            <th>Период</th>
            <th>₽/кг</th>
            <th>Лист / ячейка</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr key={r[dateKey]}>
              <td className="mono">{r[dateKey]}</td>
              <td className="mono">{fmt(r.value)}</td>
              <td className="mono">
                {r.sheet}!{r.cell}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
