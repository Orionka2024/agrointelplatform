export default function QualityTierStrategyModule3({ model }) {
  if (!model) return null;

  const strategy = model.qualityTierSalesStrategy || {
    qualityAllocation: {
      totalAllocatedTons: 1500,
      tranches: [
        {
          tierId: 'risky',
          name: 'Транш 1: Рискованный лук (сброс)',
          allocatedTons: 300,
          sharePct: 20,
          timingWindow: 'Октябрь – Ноябрь (Срочно)',
          expectedPriceRubKg: 16.0,
          expectedRevenueRub: 4728000,
          purposeRu: 'Спасение от шейковой гнили, покрытие первоочередных кассовых разрывов и процентов по кредиту.',
        },
        {
          tierId: 'standard',
          name: 'Транш 2: Средний калибр (4–5 см)',
          allocatedTons: 600,
          sharePct: 40,
          timingWindow: 'Ноябрь – Январь',
          expectedPriceRubKg: 20.7,
          expectedRevenueRub: 11056500,
          purposeRu: 'Гибкие плановые продажи по подтверждённым контрактам оптовиков и торговых сетей.',
        },
        {
          tierId: 'premium_keeping',
          name: 'Транш 3: Премиум лёжкий (5+ см)',
          allocatedTons: 600,
          sharePct: 40,
          timingWindow: 'Февраль – 20 Марта',
          expectedPriceRubKg: 26.5,
          expectedRevenueRub: 13737000,
          purposeRu: 'Максимальная сезонная премия на пике истощения запасов до прихода ранней Средней Азии.',
        },
      ],
      totalRevenueRub: 29521500,
      financialAdvantageVsNaiveHoldAll: {
        totalGainRub: 864000,
        gainRubKg: 0.58,
        rotSavedTons: 62,
        summaryRu: 'Сегментация по качеству сохраняет 62 т лука от списания в гниль и даёт дополнительно +0.86 млн ₽ (+0.58 ₽/кг) чистой прибыли по сравнению со стратегией «держать весь объём до весны».',
      },
    },
    threeFarmerQuestions: {
      risky: {
        holdingDays: 90,
        question1_cashTodayPerKg: 16.0,
        question2_holdingCostTotalRubKg: 4.88,
        question3_breakEvenFuturePrice: 23.45,
        futurePriceRubKg: 21.0,
        netGainVsSellNowRubKg: -2.45,
        verdict: 'SELL_NOW_AVOID_ROT',
        recommendationRu: 'Продавать прямо сейчас. При удержании на 90 дн. потери от шейковой гнили превысят 20%, а требуемая цена безубыточности (23.45 ₽/кг) выше прогноза (21.0 ₽/кг). Чистый убыток: −2.45 ₽/кг.',
      },
      premium: {
        holdingDays: 90,
        question1_cashTodayPerKg: 16.0,
        question2_holdingCostTotalRubKg: 2.85,
        question3_breakEvenFuturePrice: 19.55,
        futurePriceRubKg: 26.5,
        netGainVsSellNowRubKg: 4.55,
        verdict: 'HOLD_FOR_PREMIUM',
        recommendationRu: 'Держать до планового горизонта. Ожидаемая цена (26.50 ₽/кг) полностью покрывает затраты и даёт чистую расчётную премию: +4.55 ₽/кг.',
      },
    },
  };

  const { qualityAllocation, threeFarmerQuestions } = strategy;
  const adv = qualityAllocation.financialAdvantageVsNaiveHoldAll;

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
            🧅 Модуль 3: Стратегия продаж по 3 категориям качества и оптимизация партий
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
            Сегментация запасов: немедленный сброс рискованного лука, гибкие продажи среднего калибра и максимизация маржи лёжкого лука.
          </p>
        </div>
        <span
          style={{
            fontSize: '0.8rem',
            padding: '4px 10px',
            borderRadius: 12,
            background: '#dcfce7',
            color: '#15803d',
            border: '1px solid #bbf7d0',
            fontWeight: 700,
          }}
        >
          Симуляция (расчётный эффект): +{adv.totalGainRub ? (adv.totalGainRub / 1000).toFixed(0) : '864'} тыс. ₽
        </span>
      </div>

      {/* 3 Tranches Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1.25rem',
          marginBottom: '1.25rem',
        }}
      >
        {qualityAllocation.tranches.map((tr) => {
          const isRisky = tr.tierId === 'risky';
          const isPremium = tr.tierId === 'premium_keeping';
          const badgeBg = isRisky ? '#fee2e2' : isPremium ? '#dcfce7' : '#e0f2fe';
          const badgeText = isRisky ? '#b91c1c' : isPremium ? '#15803d' : '#0369a1';

          return (
            <div
              key={tr.tierId}
              style={{
                background: '#f8fafc',
                border: `1px solid ${isRisky ? '#fca5a5' : isPremium ? '#86efac' : '#bae6fd'}`,
                borderRadius: 6,
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: badgeBg,
                      color: badgeText,
                    }}
                  >
                    {tr.timingWindow}
                  </span>
                  <strong style={{ fontSize: '1rem', color: '#0f172a' }}>
                    {tr.allocatedTons} т ({tr.sharePct}%)
                  </strong>
                </div>

                <h4 style={{ margin: '0 0 0.4rem', fontSize: '1rem', color: '#0f172a' }}>{tr.name}</h4>
                <p style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 1.45, margin: '0 0 0.75rem' }}>
                  {tr.purposeRu}
                </p>
              </div>

              <div style={{ background: '#fff', padding: '0.65rem', borderRadius: 4, border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: '#64748b' }}>Целевая цена продажи:</span>
                  <strong className="mono">{tr.expectedPriceRubKg.toFixed(2)} ₽/кг</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0369a1', fontWeight: 600 }}>
                  <span>Ожидаемая выручка:</span>
                  <span>{(tr.expectedRevenueRub / 1000000).toFixed(2)} млн ₽</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* The 3 Daily Farmer Questions Comparison Panel */}
      <div
        style={{
          background: '#f1f5f9',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          padding: '1rem',
          marginBottom: '1rem',
        }}
      >
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.5rem' }}>
          💡 Калькулятор 3-х ежедневных вопросов фермера (удержание на 90 дней):
        </span>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
          {/* Risky Lot Answers */}
          <div style={{ background: '#fff', padding: '0.85rem', borderRadius: 6, border: '1px solid #fecaca' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: '0.9rem', color: '#991b1b' }}>Рискованный лук (толстая шейка / очаги гнили)</strong>
              <span style={{ fontSize: '0.75rem', background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>
                {threeFarmerQuestions.risky?.verdict === 'SELL_NOW_AVOID_ROT' ? 'СБРОС СЕЙЧАС' : 'ДЕРЖАТЬ'}
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
              <div>1. <strong>Деньги сегодня:</strong> {threeFarmerQuestions.risky?.question1_cashTodayPerKg?.toFixed(2)} ₽/кг</div>
              <div>2. <strong>Затраты удержания 90 дн:</strong> +{threeFarmerQuestions.risky?.question2_holdingCostTotalRubKg?.toFixed(2)} ₽/кг (убыль массы более 20%)</div>

              <div>3. <strong>Порог безубыточности:</strong> {threeFarmerQuestions.risky?.question3_breakEvenFuturePrice?.toFixed(2)} ₽/кг vs Прогноз {threeFarmerQuestions.risky?.futurePriceRubKg?.toFixed(2)} ₽/кг</div>
              <div style={{ color: '#b91c1c', fontWeight: 600, marginTop: 4 }}>
                Результат: {threeFarmerQuestions.risky?.recommendationRu}
              </div>
            </div>
          </div>

          {/* Premium Lot Answers */}
          <div style={{ background: '#fff', padding: '0.85rem', borderRadius: 6, border: '1px solid #bbf7d0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: '0.9rem', color: '#166534' }}>Премиум лёжкий лук (5+ см, сухая шейка)</strong>
              <span style={{ fontSize: '0.75rem', background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>
                {threeFarmerQuestions.premium?.verdict === 'HOLD_FOR_PREMIUM' ? 'ДЕРЖАТЬ НА ВЕСНУ' : 'ПРОДАТЬ'}
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
              <div>1. <strong>Деньги сегодня:</strong> {threeFarmerQuestions.premium?.question1_cashTodayPerKg?.toFixed(2)} ₽/кг</div>
              <div>2. <strong>Затраты удержания 90 дн:</strong> +{threeFarmerQuestions.premium?.question2_holdingCostTotalRubKg?.toFixed(2)} ₽/кг (убыль всего 3.5%)</div>
              <div>3. <strong>Порог безубыточности:</strong> {threeFarmerQuestions.premium?.question3_breakEvenFuturePrice?.toFixed(2)} ₽/кг vs Прогноз {threeFarmerQuestions.premium?.futurePriceRubKg?.toFixed(2)} ₽/кг</div>
              <div style={{ color: '#15803d', fontWeight: 600, marginTop: 4 }}>
                Результат: {threeFarmerQuestions.premium?.recommendationRu}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Advantage Banner */}
      <div
        style={{
          background: '#ecfdf5',
          border: '1px solid #a7f3d0',
          borderRadius: 6,
          padding: '0.75rem 1rem',
          fontSize: '0.85rem',
          color: '#065f46',
          lineHeight: 1.45,
        }}
      >
        <strong>🎯 Экономический эффект стратегии качества:</strong> {adv.summaryRu}
      </div>
    </div>
  );
}
