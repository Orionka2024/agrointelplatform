import {
  computeCurrentMarketIndex,
  computeSupplyPressureIndex,
  computeQualityAdjustedDeficit,
  SOURCE_TIERS,
} from '../../shared/marketIndex.js';

export default function MarketIntelligenceModule1({ model }) {
  if (!model) return null;

  // Use precomputed or compute dynamically
  const marketIndex =
    model.currentMarketIndex ||
    computeCurrentMarketIndex({
      observations: model.verifiedObservations || [],
      today: model.today,
      benchmarkBasePrice: model.prices?.warehouse?.exVat || 16.0,
    });

  const pressureIndex =
    model.supplyPressureIndex ||
    computeSupplyPressureIndex({
      activeOffersCount: 18,
      availableTonnage: Number(model.farmProfile?.storageCapacityTons || 1500),
      salesVelocityTonsPerWeek: Math.max(100, Math.round(Number(model.farmProfile?.storageCapacityTons || 1500) / 12)),
      importTonnageMonth: 4000,
      weeklyListingsGrowthPct: 0,
      marketableGradeShare: 0.85,
    });

  const qualityDeficit =
    model.qualityAdjustedDeficit ||
    computeQualityAdjustedDeficit(
      {
        totalHarvestTons: Number(model.farmProfile?.storageCapacityTons || 1500),
        initialQualityGradeShare: 0.85,
        storageType: model.farmProfile?.storageType || 'ventilated',
      },
      { horizonsMonths: [1, 2, 3, 5] }
    );

  const { exwVolgograd, destinations } = marketIndex;
  const isEarlyWarning = pressureIndex.earlyWarningSignal;

  const tierBadgeColor =
    exwVolgograd.tier === SOURCE_TIERS.CLOSED_DEAL
      ? { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' }
      : exwVolgograd.tier === SOURCE_TIERS.BUYER_BID
      ? { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' }
      : { bg: '#fef3c7', text: '#b45309', border: '#fde68a' };

  const pressureBadgeColor =
    pressureIndex.pressureLevel === 'critical'
      ? { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca' }
      : pressureIndex.pressureLevel === 'moderate'
      ? { bg: '#fef9c3', text: '#854d0e', border: '#fef08a' }
      : { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' };

  return (
    <div
      className="panel"
      style={{
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        background: '#fff',
        padding: '1.25rem',
        marginBottom: '1.5rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#0f172a' }}>
            📊 Модуль 1: Рыночная разведка, давление предложения и дефицит качества
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
            5-уровневая иерархия источников, региональные DAP нетбэки, индекс давления I_sp и кондиционный фонд Q_товарный.
          </p>

        </div>
        <span
          style={{
            fontSize: '0.8rem',
            padding: '4px 10px',
            borderRadius: 12,
            background: tierBadgeColor.bg,
            color: tierBadgeColor.text,
            border: `1px solid ${tierBadgeColor.border}`,
            fontWeight: 600,
          }}
        >
          Уровень {exwVolgograd.tier}: {exwVolgograd.sourceTierName}
        </span>
      </div>

      {/* Grid: Level A (Market Index) & Level B (Supply Pressure) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '1.25rem',
          marginBottom: '1.25rem',
        }}
      >
        {/* Level A: EXW Volgograd & DAP Netbacks */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                Уровень A · Индекс текущего рынка
              </span>
              <strong style={{ fontSize: '1.1rem', color: '#0f172a' }}>
                {exwVolgograd.priceRubKg !== null ? `${exwVolgograd.priceRubKg.toFixed(2)} ₽/кг` : 'Неопределённость'}
              </strong>
            </div>

            {exwVolgograd.status === 'closed_deals' ? (
              <p style={{ fontSize: '0.85rem', color: '#16a34a', margin: '0 0 0.75rem', fontWeight: 500 }}>
                ✓ {exwVolgograd.note}
              </p>
            ) : exwVolgograd.status === 'bids_available' ? (
              <div style={{ background: '#eff6ff', padding: '8px', borderRadius: 4, marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: '#1e40af' }}>Лучшая подтверждённая заявка (Bid):</span>
                  <strong>{exwVolgograd.bestBidRubKg.toFixed(2)} ₽/кг</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: '#475569' }}>Минимальная оферта продавцов (Ask):</span>
                  <strong>{exwVolgograd.lowestAskRubKg ? `${exwVolgograd.lowestAskRubKg.toFixed(2)} ₽/кг` : '—'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b45309' }}>
                  <span>Спред рынка (Ask − Bid):</span>
                  <strong>{exwVolgograd.spreadRubKg ? `${exwVolgograd.spreadRubKg.toFixed(2)} ₽/кг` : '—'}</strong>
                </div>
              </div>
            ) : (
              <div style={{ background: '#fef3c7', padding: '8px', borderRadius: 4, marginBottom: '0.75rem', fontSize: '0.825rem', color: '#92400e' }}>
                ⚠️ {exwVolgograd.note}
              </div>
            )}
          </div>

          <div>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.4rem' }}>
              Региональные направления и Чистый возврат (EXW Netback):
            </span>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #cbd5e1', color: '#64748b' }}>
                    <th style={{ padding: '4px 6px' }}>Направление</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>DAP</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>Фрахт</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>EXW Netback</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(destinations || {}).map((d) => (
                    <tr key={d.key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '5px 6px', fontWeight: 500, color: '#1e293b' }}>{d.name}</td>
                      <td style={{ padding: '5px 6px', textAlign: 'right' }}>{d.dapPriceRubKg.toFixed(2)} ₽</td>
                      <td style={{ padding: '5px 6px', textAlign: 'right', color: '#64748b' }}>−{d.freightRubKg.toFixed(2)} ₽</td>
                      <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 700, color: '#0369a1' }}>
                        {d.exwNetbackRubKg.toFixed(2)} ₽
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Level B: Supply Pressure Index */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                Уровень B · Давление предложения (I_sp)
              </span>
              <span
                style={{
                  fontSize: '0.8rem',
                  padding: '2px 8px',
                  borderRadius: 12,
                  background: pressureBadgeColor.bg,
                  color: pressureBadgeColor.text,
                  border: `1px solid ${pressureBadgeColor.border}`,
                  fontWeight: 700,
                }}
              >
                {pressureIndex.pressureLevel === 'critical'
                  ? 'Критическое'
                  : pressureIndex.pressureLevel === 'moderate'
                  ? 'Умеренное'
                  : 'Низкое'}
              </span>
            </div>

            {isEarlyWarning && (
              <div
                style={{
                  background: '#fee2e2',
                  border: '1px solid #fca5a5',
                  color: '#991b1b',
                  padding: '8px 10px',
                  borderRadius: 6,
                  fontSize: '0.85rem',
                  marginBottom: '0.75rem',
                  fontWeight: 600,
                }}
              >
                ⚡ Ранний сигнал снижения цены! Темп появления новых объявлений опережает фактический объём выборки.
              </div>
            )}

            <p style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.45, margin: '0 0 0.75rem' }}>
              {pressureIndex.interpretationRu}
            </p>
          </div>

          <div style={{ background: '#fff', padding: '0.75rem', borderRadius: 4, border: '1px solid #e2e8f0', fontSize: '0.825rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#64748b' }}>Индекс давления (I_sp):</span>
              <strong>{pressureIndex.indexValue}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#64748b' }}>Запас предложения:</span>
              <strong>{pressureIndex.weeksOfSupply} нед. темпа продаж</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#64748b' }}>Активные оферты на рынке:</span>
              <strong>{pressureIndex.metrics?.activeOffersCount || 0} лотов</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0369a1' }}>
              <span>Доля кондиционного лука:</span>
              <strong>{((pressureIndex.metrics?.marketableGradeShare || 0.85) * 100).toFixed(0)}% партии</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Level C: Quality-Adjusted Deficit (Q_товарный) */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              Уровень C · Индекс будущего дефицита товарного качества (Q_товарный)
            </span>
            <p style={{ margin: '2px 0 0', fontSize: '0.825rem', color: '#64748b' }}>
              Расчёт реального кондиционного лука по горизонтам: <em>Q_товарный = Q_остаток × (1 − потери) × доля товарного качества</em>
            </p>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 600 }}>
            Склад: {model.farmProfile?.storageCapacityTons || 1500} т ({model.farmProfile?.storageType === 'refrigerated' ? 'Холод 0..+1°C' : 'Активная продувка'})
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
          {qualityDeficit.map((qd) => (
            <div
              key={qd.monthHorizon}
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                padding: '0.75rem',
                borderTop: qd.monthHorizon === 5 ? '3px solid #0284c7' : '1px solid #e2e8f0',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>
                  {qd.monthHorizon === 5 ? 'Горизонт 5 мес (Март)' : `Горизонт +${qd.monthHorizon} мес`}
                </strong>
                {qd.monthHorizon === 5 && (
                  <span style={{ fontSize: '0.75rem', background: '#e0f2fe', color: '#0284c7', padding: '1px 6px', borderRadius: 8, fontWeight: 700 }}>
                    Пик дефицита
                  </span>
                )}
              </div>

              <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
                <span>Физический остаток:</span>
                <span className="mono">{qd.physicalRemainingTons} т</span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 600, marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
                <span>Товарный лук (Q_тов):</span>
                <span className="mono">{qd.marketableTons} т</span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#b91c1c', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
                <span>Отход (гниль/перо):</span>
                <span className="mono">−{qd.substandardDiscardTons} т</span>
              </div>
              <div style={{ fontSize: '0.775rem', color: '#64748b', borderTop: '1px dashed #e2e8f0', paddingTop: 4, marginTop: 4 }}>
                Усушка: <strong>{qd.physicalLossPct}%</strong> · Товарность: <strong>{(qd.marketableGradeShare * 100).toFixed(0)}%</strong>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
