export default function MonthlySalesPlanTable({ plan, cropLabel = 'лук' }) {
  if (!plan?.stages?.length) return null;

  return (
    <div className="panel">
      <div className="panel-hd" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="panel-title">
            Рекомендуемый помесячный план продаж (100% урожая на складе · {cropLabel})
          </span>
          <span className="badge up">CatBoost + Экономика хранения</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--txt2)', fontFamily: 'var(--mono)' }}>
          Средняя чистыми: <strong style={{ color: 'var(--green)' }}>{plan.weightedNetRubKg.toFixed(1)} ₽/кг</strong>
          {' '}({plan.stagedAdvantageRubKg >= 0 ? '+' : ''}{plan.stagedAdvantageRubKg.toFixed(1)} ₽/кг к продаже с осени)
        </div>
      </div>

      <div
        className="table-wrapper"
        role="region"
        tabIndex={0}
        aria-label="Рекомендуемый помесячный план продаж со склада"
      >
        <table className="tbl sticky-hd">
          <thead>
            <tr>
              <th className="pl sticky-col">Период</th>
              <th>Доля %</th>
              <th>Цена со склада</th>
              <th>Выручка чистыми</th>
              <th>Какую партию продавать</th>
            </tr>
          </thead>
          <tbody>
            {plan.stages.map((st) => {
              const isGold = st.id === 'feb_mar';
              const priceRange =
                Math.abs(st.whMax - st.whMin) >= 0.3
                  ? `${st.whMin.toFixed(1)}–${st.whMax.toFixed(1)} ₽/кг`
                  : `${st.whAvg.toFixed(1)} ₽/кг`;
              return (
                <tr key={st.id} className={isGold ? 'sales-plan-highlight' : ''}>
                  <td className="pl fw sticky-col" style={{ whiteSpace: 'nowrap' }}>
                    <div>{st.period}</div>
                    <div style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 400 }}>{st.dateSpan}</div>
                  </td>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    <span className={`pill ${isGold ? 'up' : 'info'}`}>{st.sharePct}%</span>
                  </td>
                  <td className="mono" style={{ fontWeight: 600, color: isGold ? 'var(--green)' : 'var(--blue)', whiteSpace: 'nowrap' }}>
                    {priceRange}
                  </td>
                  <td className="mono" style={{ fontWeight: 600, color: 'var(--green)', whiteSpace: 'nowrap' }}>
                    ~{st.netAvg.toFixed(1)} ₽/кг
                    <div style={{ fontSize: 9, color: 'var(--txt3)', fontWeight: 400 }}>
                      потери ~{st.lossAvg}%
                    </div>
                  </td>
                  <td style={{ fontSize: 11.5, lineHeight: 1.45, minWidth: 260 }}>
                    {st.recommendation}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          padding: '8px 14px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface2)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          fontSize: 11,
          color: 'var(--txt2)',
        }}
      >
        <span>
          Стартовая база расчёта: <strong>{plan.baseWarehousePrice.toFixed(1)} ₽/кг</strong> (EXW без НДС) · Чистыми при продаже сразу: <strong>{plan.sellNowNet.toFixed(1)} ₽/кг</strong>
        </span>
        <span>
          Средневзвешенная отгрузка по плану: <strong>{plan.weightedGrossRubKg.toFixed(1)} ₽/кг</strong> валовая · <strong style={{ color: 'var(--green)' }}>{plan.weightedNetRubKg.toFixed(1)} ₽/кг</strong> чистыми (после усушки, гнили, электроэнергии и ставки ЦБ)
        </span>
      </div>
    </div>
  );
}
