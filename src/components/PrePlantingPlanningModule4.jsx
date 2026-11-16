export default function PrePlantingPlanningModule4({ model }) {
  if (!model) return null;

  const prePlanting = model.prePlantingEconomics || {
    hectareEconomics: {
      grossYieldTHa: 55,
      marketableSharePct: 85,
      marketableYieldTHa: 46.75,
      weightedPriceRubKg: 20.8,
      totalCostRubHa: 680000,
      costBreakdown: {
        seedsAndCultivation: 320000,
        harvestAndHauling: 140000,
        sortingAndPackaging: 95000,
        storageOpexAndFinance: 85000,
        logisticsLocal: 40000,
      },
      expectedRevenueRubHa: 972400,
      expectedProfitRubHa: 292400,
      profitMarginPct: 30.1,
      breakEvenGrossYieldTHa: 38.46,
      yieldSafetyMarginPct: 43.0,
    },
    prePlantingScenarios: [
      {
        id: 'cautious',
        name: 'Осторожный (Пессимистичный)',
        marketContext: 'Перепроизводство, избыток предложения, дешёвый импорт',
        realizationPriceRubKg: 13.5,
        expectedYieldTHa: 45,
        productionCostRubHa: 680000,
        recommendedOnionAreaHa: 25,
        expectedProfitPerHa: -163625,
        recommendationRu: 'Не расширять площади! Сократить площадь сева до 20–25 га под подтверждённые твёрдые контракты.',
      },
      {
        id: 'base',
        name: 'Базовый (Реалистичный)',
        marketContext: 'Нормальный спрос, стабильный баланс спроса и предложения',
        realizationPriceRubKg: 18.0,
        expectedYieldTHa: 50,
        productionCostRubHa: 680000,
        recommendedOnionAreaHa: 33,
        expectedProfitPerHa: 85000,
        recommendationRu: 'Сохранять плановую площадь в пределах севооборота (33 га), делать упор на лёжкие гибриды.',
      },
      {
        id: 'optimistic',
        name: 'Оптимистичный (Дефицитный)',
        marketContext: 'Региональный дефицит в ЮФО, экспортный спрос, высокая товарность',
        realizationPriceRubKg: 24.5,
        expectedYieldTHa: 55,
        productionCostRubHa: 680000,
        recommendedOnionAreaHa: 33,
        expectedProfitPerHa: 465375,
        recommendationRu: 'Ограничить площадь сева 33 га (33% пашни): агрономический предел защищает от кризиса перепроизводства.',
      },
    ],
    cropDiversification: {
      totalArableLandHa: 100,
      totalAllocatedHa: 100,
      totalExpectedProfitRub: 18960000,
      portfolioRiskScore: 0.44,
      onionMonocultureLossProtectionRu: 'Диверсификация портфеля (лук + морковь + бахчевые) снижает совокупный риск с 0.65 до 0.44 и снижает риск банкротства при обвале цен на одну культуру.',
      allocationRows: [
        { cropKey: 'Лук репчатый (лёжкий)', areaHa: 30, sharePct: 30, expectedProfitPerHa: 292000, totalProfitRub: 8760000, riskIndex: 0.65 },
        { cropKey: 'Морковь столовая (мытая)', areaHa: 30, sharePct: 30, expectedProfitPerHa: 190000, totalProfitRub: 5700000, riskIndex: 0.35 },
        { cropKey: 'Арбуз поливной (ЮФО)', areaHa: 20, sharePct: 20, expectedProfitPerHa: 240000, totalProfitRub: 4800000, riskIndex: 0.45 },
        { cropKey: 'Сидеральный пар / отдых', areaHa: 20, sharePct: 20, expectedProfitPerHa: -15000, totalProfitRub: -300000, riskIndex: 0.05 },
      ],
    },
  };

  const { hectareEconomics: he, prePlantingScenarios: sc, cropDiversification: cd } = prePlanting;

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
            🌱 Модуль 4: Экономика посевных площадей и планирование сева следующего сезона
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
            Формула прибыли с гектара, порог безубыточности урожайности, 3 сценария сева и защита от монокультурного кризиса.
          </p>
        </div>
        <span
          style={{
            fontSize: '0.8rem',
            padding: '4px 10px',
            borderRadius: 12,
            background: '#e0f2fe',
            color: '#0369a1',
            border: '1px solid #bae6fd',
            fontWeight: 700,
          }}
        >
          Прибыль: +{Math.round(he.expectedProfitRubHa / 1000)} тыс. ₽/га
        </span>
      </div>

      {/* Grid: 1 Hectare Economics & Break-Even Yield */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1.25rem',
          marginBottom: '1.25rem',
        }}
      >
        {/* Card 1: Hectare Profitability Formula */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              Экономика 1 гектара лука
            </span>
            <strong style={{ fontSize: '1.05rem', color: '#15803d' }}>
              +{Math.round(he.expectedProfitRubHa).toLocaleString()} ₽/га
            </strong>
          </div>
          <p style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 1.4, margin: '0 0 0.65rem' }}>
            Товарная урожайность <strong>{he.marketableYieldTHa} т/га</strong> при средневзвешенной цене реализации <strong>{he.weightedPriceRubKg.toFixed(2)} ₽/кг</strong>.
          </p>
          <div style={{ background: '#fff', padding: '0.65rem', borderRadius: 4, border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>Выручка с гектара:</span>
              <strong className="mono">{Math.round(he.expectedRevenueRubHa).toLocaleString()} ₽</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>Полные затраты (C_total):</span>
              <span className="mono">−{Math.round(he.totalCostRubHa).toLocaleString()} ₽</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>В т.ч. сев, СЗР, капельный полив:</span>
              <span className="mono">{Math.round(he.costBreakdown.seedsAndCultivation).toLocaleString()} ₽</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>В т.ч. уборка, сортировка, хранение:</span>
              <span className="mono">{Math.round(he.costBreakdown.harvestAndHauling + he.costBreakdown.sortingAndPackaging + he.costBreakdown.storageOpexAndFinance).toLocaleString()} ₽</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#15803d', fontWeight: 600, borderTop: '1px dashed #e2e8f0', paddingTop: 3, marginTop: 3 }}>
              <span>Рентабельность / Маржа:</span>
              <span>+{he.profitMarginPct}%</span>
            </div>
          </div>
        </div>

        {/* Card 2: Break-Even Gross Yield */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              Точка безубыточности урожайности
            </span>
            <strong style={{ fontSize: '1.05rem', color: '#0369a1' }}>
              {he.breakEvenGrossYieldTHa} т/га
            </strong>
          </div>
          <p style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 1.4, margin: '0 0 0.65rem' }}>
            Минимальный валовой сбор для покрытия всех прямых затрат ({Math.round(he.totalCostRubHa).toLocaleString()} ₽/га).
          </p>
          <div style={{ background: '#fff', padding: '0.65rem', borderRadius: 4, border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>Плановая урожайность:</span>
              <strong className="mono">{he.grossYieldTHa} т/га</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>Порог безубыточности:</span>
              <strong className="mono" style={{ color: '#b45309' }}>{he.breakEvenGrossYieldTHa} т/га</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#15803d', fontWeight: 600, borderTop: '1px dashed #e2e8f0', paddingTop: 3, marginTop: 3 }}>
              <span>Запас прочности по урожайности:</span>
              <span>+{he.yieldSafetyMarginPct}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3 Pre-Planting Scenarios */}
      <div style={{ marginBottom: '1.25rem' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.5rem' }}>
          📋 3 Сценария перед посевной (планирование риска перепроизводства):
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
          {sc.map((s) => {
            const isCautious = s.id === 'cautious';
            const isOpt = s.id === 'optimistic';
            const cardBorder = isCautious ? '#fca5a5' : isOpt ? '#86efac' : '#bae6fd';
            const badgeBg = isCautious ? '#fee2e2' : isOpt ? '#dcfce7' : '#e0f2fe';
            const badgeText = isCautious ? '#b91c1c' : isOpt ? '#15803d' : '#0369a1';

            return (
              <div
                key={s.id}
                style={{
                  background: '#f8fafc',
                  border: `1px solid ${cardBorder}`,
                  borderRadius: 6,
                  padding: '0.85rem 1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: badgeBg, color: badgeText }}>
                      {s.name}
                    </span>
                    <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>
                      {s.recommendedOnionAreaHa} га
                    </strong>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: 4 }}>
                    Контекст: {s.marketContext}
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#334155', margin: '0 0 0.5rem', fontWeight: 500 }}>
                    {s.recommendationRu}
                  </p>
                </div>
                <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: '0.775rem' }}>
                  <span style={{ color: '#64748b' }}>Ожидаемая цена: {s.realizationPriceRubKg} ₽/кг</span>
                  <span style={{ fontWeight: 600, color: s.expectedProfitPerHa >= 0 ? '#15803d' : '#b91c1c' }}>
                    {s.expectedProfitPerHa >= 0 ? `+${Math.round(s.expectedProfitPerHa / 1000)}` : Math.round(s.expectedProfitPerHa / 1000)} тыс. ₽/га
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Crop Diversification Shield */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              🛡️ Щит диверсификации культур (100 га пашни)
            </span>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              {cd.onionMonocultureLossProtectionRu}
            </p>
          </div>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#15803d' }}>
            Общая прибыль: {(cd.totalExpectedProfitRub / 1000000).toFixed(2)} млн ₽
          </span>
        </div>

        <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #cbd5e1', color: '#64748b' }}>
                <th style={{ padding: '4px 6px' }}>Культура</th>
                <th style={{ padding: '4px 6px', textAlign: 'right' }}>Площадь, га</th>
                <th style={{ padding: '4px 6px', textAlign: 'right' }}>Доля, %</th>
                <th style={{ padding: '4px 6px', textAlign: 'right' }}>Прибыль/га</th>
                <th style={{ padding: '4px 6px', textAlign: 'right' }}>Итоговая прибыль</th>
              </tr>
            </thead>
            <tbody>
              {cd.allocationRows.map((row) => (
                <tr key={row.cropKey} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '5px 6px', fontWeight: 600, color: '#1e293b' }}>{row.cropKey}</td>
                  <td style={{ padding: '5px 6px', textAlign: 'right' }}>{row.areaHa} га</td>
                  <td style={{ padding: '5px 6px', textAlign: 'right', color: '#64748b' }}>{row.sharePct}%</td>
                  <td style={{ padding: '5px 6px', textAlign: 'right' }}>{Math.round(row.expectedProfitPerHa / 1000)} тыс. ₽</td>
                  <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 700, color: row.totalProfitRub >= 0 ? '#0369a1' : '#b91c1c' }}>
                    {(row.totalProfitRub / 1000000).toFixed(2)} млн ₽
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
