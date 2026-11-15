import { useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import {
  officialHistory as history,
  officialForecast as fc,
  officialDrivers as drivers,
  computeForecastFreshness,
} from '../../shared/officialData.js';
import { MONTHLY_MODELS, monthNumber, evaluateHorizonConfidence } from '../../shared/officialForecast.js';
import { localBasis, applyBasis } from '../../shared/localBasis.js';
import { resolveSelectedHorizonMetrics, INTERVAL_UNAVAILABLE_MESSAGE } from '../../shared/weeklyDecisionPlan.js';
import { useMarket } from '../context/useMarket';
import OfficialSummary from './OfficialSummary';
import AddActualPrice from './AddActualPrice';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: d }) : '—');
const band = (v, reason = null) =>
  v && Number.isFinite(v.lo) && Number.isFinite(v.hi)
    ? `${fmt(v.lo)}–${fmt(v.hi)}`
    : (reason || INTERVAL_UNAVAILABLE_MESSAGE);
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
  const freshness = computeForecastFreshness(fc, { today: model.today });
  const stale = freshness.isStale || monthNumber(model.today.slice(0, 7)) - monthNumber(fc.inputCutoff) > 2;

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
  const selMap = new Map(rows.map((x) => [x.targetMonth, resolveSelectedHorizonMetrics(x).point]));
  const treeMap = new Map(rows.map((x) => [x.targetMonth, x.catboostPoint ?? x.point]));
  const userObsMap = new Map((cal?.months || []).map((x) => [x.month, x.user]));
  const localSelMap = new Map(
    cal
      ? rows.map((x) => {
          const m = resolveSelectedHorizonMetrics(x);
          return [
            x.targetMonth,
            applyBasis({ point: m.point, interval80: m.interval80, targetMonth: x.targetMonth }, cal)?.point,
          ];
        })
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
      label: 'Выбор селектора (РФ)',
      data: labels.map((m) => selMap.get(m) ?? null),
      borderColor: '#0D7C4A',
      borderDash: [5, 4],
      pointRadius: 3,
    },
    {
      label: 'Дерево решений (экспериментальная)',
      data: labels.map((m) => treeMap.get(m) ?? null),
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
      label: 'Выбор селектора под ваш уровень цен',
      data: labels.map((m) => localSelMap.get(m) ?? null),
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
        <div
          style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 12px',
            marginBottom: 8,
            fontSize: 11,
            fontFamily: 'var(--mono)',
            color: 'var(--txt2)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span>{freshness.stampText}</span>
          <span>Возраст данных Росстата: {freshness.ageDays} дн.</span>
        </div>
        {freshness.staleWarning && (
          <div
            className="signal-box warn"
            role="alert"
            style={{
              marginBottom: 8,
              padding: '10px 14px',
              background: 'var(--amber-bg, #fffbeb)',
              border: '1px solid var(--amber-border, #f59e0b)',
              borderRadius: 6,
              color: 'var(--amber, #92400e)',
              fontSize: 12,
            }}
          >
            <strong>⚠️ Устаревшие официальные данные ({freshness.ageDays} дн.):</strong> {freshness.staleWarning}
          </div>
        )}
        <OfficialSummary />
        <AddActualPrice defaultOpen={false} />

        <div className="audit-controls">
          <label>
            Ряд{' '}
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="producer">Производители РФ · месяцы · без НДС + выбор селектора</option>
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
              Розничные цены Росстата используются в Дереве решений (экспериментальная) как опережающий сигнал рознично-оптового спреда, но никогда не пересчитываются в складскую цену фиксированным делителем.
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
              Сохранённый выпуск: <strong>{fc.issueDate}</strong> · Последнее наблюдение Росстата: <strong>{fc.inputCutoff}</strong> ({fmt(fc.lastValue)} ₽/кг) · Модель: <code>{fc.modelVersion}</code>. На каждом горизонте применяется модель, выбранная строгим walk-forward селектором (преимущественно Сезонная модель (Weibull)); экспериментальное Дерево решений обучается на отклонениях от сезонного равновесия с учётом <strong>KZT/RUB</strong> ({fc.drivers?.kztRubLast ? `${fmt(fc.drivers.kztRubLast.value, 4)} ₽` : '—'}), <strong>USD/RUB</strong> ({fc.drivers?.usdRubLast ? `${fmt(fc.drivers.usdRubLast.value)} ₽` : '—'}), <strong>ключевой ставки ЦБ</strong> ({fc.drivers?.keyRateLast ? `${fmt(fc.drivers.keyRateLast.value)}%` : '—'}), рознично-оптового спреда и морозных шоков ERA5 в Жамбылской обл. и Волгограде.
            </p>
            {cal && (
              <div className="basis-banner">
                <strong>Калибровка под ваши сделки активна ({activeBasis === 'warehouse' ? 'склад EXW без НДС' : 'Москва без НДС'}):</strong>{' '}
                сезонная кривая <code>B(m)</code> · {cal.label} ({STRENGTH[cal.strength]}).
              </div>
            )}
            {stale && <p className="audit-warning">{freshness.staleWarning || 'Данные устарели. Требуется обновление архива Росстата.'}</p>}

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

            <div className="table-wrapper" role="region" tabIndex={0} aria-label="Помесячный прогноз и сравнение моделей">
              <table className="tbl sticky-hd">
                <thead>
                  <tr>
                    <th className="sticky-col">Месяц</th>
                    <th>Выбор селектора РФ</th>
                    {cal && <th>Ваш прогноз</th>}
                    <th>Дерево решений (эксп.)</th>
                    <th>80% диапазон</th>
                    <th>MAE holdout: Селектор / Дерево / Naive</th>
                    <th>Оценка горизонта</th>
                    <th>Выбранная на настройке модель</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const selMetrics = resolveSelectedHorizonMetrics(row);
                    const conf = evaluateHorizonConfidence(row, fc.lastValue);
                    const treePt = row.catboostPoint ?? row.point;
                    const loc = applyBasis({ point: selMetrics.point, interval80: selMetrics.interval80, targetMonth: row.targetMonth }, cal);
                    const cbFinal = row.validation.finalAll?.find((x) => x.id === 'catboost');
                    const selFinal = row.validation.finalAll?.find((x) => x.id === selMetrics.selected) ?? row.validation.final;
                    return (
                      <tr key={row.h}>
                        <td className="mono fw sticky-col">{row.targetMonth}</td>
                        <td className="mono fw" style={{ color: 'var(--green)' }}>{fmt(selMetrics.point)} ₽</td>
                        {cal && <td className="mono fw" style={{ color: '#7C3AED' }}>{fmt(loc?.point)} ₽</td>}
                        <td className="mono">{fmt(treePt)} ₽</td>
                        <td className="mono">{band(selMetrics.interval80, selMetrics.interval80UnavailableReason)}</td>
                        <td className="mono">
                          <strong>{fmt(selFinal?.mae)}</strong> / {fmt(cbFinal?.mae)} / {fmt(row.validation.naiveFinal.mae)} ₽
                        </td>
                        <td title={conf.holdoutSummary}>
                          <span
                            className={`badge ${
                              conf.tier === 'beats_seasonal_naive'
                                ? 'up'
                                : conf.tier === 'no_better_than_last_price'
                                  ? 'warn'
                                  : 'neu'
                            }`}
                          >
                            {conf.badgeRu}
                          </span>
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
