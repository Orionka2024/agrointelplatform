import { useEffect, useState } from 'react';
import { useMarket } from '../context/useMarket';
import { buildForecastScorecard } from '../../shared/scorecard.js';
import { officialHistory, officialForecast } from '../../shared/officialData.js';

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: d }) : '—');

export default function Scorecard() {
  const { model } = useMarket();
  const [scorecard, setScorecard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    async function loadScorecard() {
      try {
        setLoading(true);
        const res = await fetch('/api/scorecard');
        if (res.ok) {
          const data = await res.json();
          if (active && data?.scorecard) {
            setScorecard(data.scorecard);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Fallback to client-side computation from active model context
      }
      if (active) {
        try {
          const forecasts = model.forecastHistory || [officialForecast];
          const actuals = officialHistory?.producer?.monthly || [];
          const sc = buildForecastScorecard(forecasts, actuals);
          setScorecard(sc);
        } catch (e) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      }
    }
    loadScorecard();
    return () => {
      active = false;
    };
  }, [model.forecastHistory]);

  if (loading) {
    return (
      <div className="panel" role="region" aria-label="Карточка точности прогнозов">
        <div className="panel-hd">
          <span className="panel-title">Карточка точности прогнозов (Forecast Scorecard)</span>
        </div>
        <div className="panel-body">
          <p>Загрузка реализованных оценок точности...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel" role="region" aria-label="Карточка точности прогнозов">
        <div className="panel-hd">
          <span className="panel-title">Карточка точности прогнозов</span>
        </div>
        <div className="panel-body">
          <div className="signal-box warn">Ошибка формирования карточки: {error}</div>
        </div>
      </div>
    );
  }

  const rolling = scorecard?.rolling12m || {};

  return (
    <div className="panel" role="region" aria-label="Карточка точности прогнозов">
      <div className="panel-hd">
        <span className="panel-title">Карточка точности прогнозов (Forecast Scorecard)</span>
        <span className="badge info">Скользящие 12 мес.</span>
      </div>
      <div className="panel-body">
        <p style={{ color: 'var(--txt2)', fontSize: 13, marginBottom: 14 }}>
          Реализованная ошибка зафиксированных выпусков прогнозов против поступивших фактических цен
          Росстата и подтверждённых сделок. Никакой прогноз не переписывается задним числом.
        </p>

        <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
          <div className="card" style={{ padding: '10px 14px', background: 'var(--bg2)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--txt2)' }}>Реализованный MAE (12 мес.)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)' }}>{fmt(rolling.modelMae)} ₽/кг</div>
          </div>
          <div className="card" style={{ padding: '10px 14px', background: 'var(--bg2)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--txt2)' }}>MAE последней цены (Naive)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt2)' }}>{fmt(rolling.naiveMae)} ₽/кг</div>
          </div>
          <div className="card" style={{ padding: '10px 14px', background: 'var(--bg2)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--txt2)' }}>MAE сезонного бенчмарка</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt2)' }}>{fmt(rolling.seasonalMae)} ₽/кг</div>
          </div>
          <div className="card" style={{ padding: '10px 14px', background: 'var(--bg2)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--txt2)' }}>Точность направления тренда</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>
              {rolling.directionalHitRate !== null ? `${Math.round(rolling.directionalHitRate * 100)}%` : '—'}
            </div>
          </div>
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 14, marginBottom: 8 }}>
          Точность по горизонтам прогнозирования (лаг +N мес.)
        </h3>
        <div className="table-wrapper" tabIndex={0} role="region" aria-label="Точность по горизонтам">
          <table className="tbl sticky-hd">
            <thead>
              <tr>
                <th>Горизонт (лаг)</th>
                <th>Проверено точек (N)</th>
                <th>MAE модели</th>
                <th>MAE последней цены</th>
                <th>MAE сезонного</th>
                <th>Статус против бенчмарка</th>
                <th>Угаданное направление</th>
              </tr>
            </thead>
            <tbody>
              {(scorecard?.byHorizon || []).map((row) => (
                <tr key={row.lead}>
                  <td className="mono fw">+{row.lead} мес.</td>
                  <td className="mono">{row.n}</td>
                  <td className="mono fw">{fmt(row.modelMae)} ₽</td>
                  <td className="mono">{fmt(row.naiveMae)} ₽</td>
                  <td className="mono">{fmt(row.seasonalMae)} ₽</td>
                  <td>
                    {row.beatsNaive && row.beatsSeasonal ? (
                      <span className="badge up">Точнее наивного и сезонного</span>
                    ) : row.beatsNaive ? (
                      <span className="badge up">Точнее последней цены</span>
                    ) : (
                      <span className="badge warn">Не точнее последней цены</span>
                    )}
                  </td>
                  <td className="mono">
                    {row.directionalHitRate !== null ? `${Math.round(row.directionalHitRate * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 20, marginBottom: 8 }}>
          Журнал неизменяемых выпусков прогнозов (Аудит-след)
        </h3>
        <div className="table-wrapper" tabIndex={0} role="region" aria-label="Журнал неизменяемых выпусков">
          <table className="tbl sticky-hd">
            <thead>
              <tr>
                <th>Дата выпуска</th>
                <th>Отсечка данных</th>
                <th>Версия модели</th>
                <th>Хеш входов</th>
                <th>Реализовано точек</th>
                <th>Ожидает факт</th>
                <th>MAE выпуска</th>
                <th>Точность тренда</th>
              </tr>
            </thead>
            <tbody>
              {(scorecard?.issues || []).map((iss) => (
                <tr key={iss.id || iss.issueDate}>
                  <td className="mono fw">{iss.issueDate}</td>
                  <td className="mono">{iss.dataCutoff || '—'}</td>
                  <td className="mono">{iss.modelVersion || '—'}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--txt2)' }}>
                    {iss.inputsHash ? String(iss.inputsHash).slice(0, 10) + '…' : '—'}
                  </td>
                  <td className="mono">{iss.realizedCount}</td>
                  <td className="mono">{iss.pendingCount}</td>
                  <td className="mono fw">{fmt(iss.modelMae)} ₽</td>
                  <td className="mono">
                    {iss.directionalHitRate !== null ? `${Math.round(iss.directionalHitRate * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
