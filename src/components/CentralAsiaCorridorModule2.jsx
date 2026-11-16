export default function CentralAsiaCorridorModule2({ model }) {
  if (!model) return null;

  const corridor = model.centralAsiaCorridor || {
    kzParity: {
      origin: 'KAZAKHSTAN_TARAZ',
      deliveredPriceRubKg: 18.25,
      localVolgogradExwRubKg: 16.5,
      competitivenessGapRubKg: 1.75,
      regime: 'domestic_advantage',
      summaryRu: 'Отечественный лук имеет ценовое преимущество: импорт дороже местного на +1.75 ₽/кг.',
    },
    uzParity: {
      origin: 'UZBEKISTAN_TASHKENT',
      deliveredPriceRubKg: 22.3,
      localVolgogradExwRubKg: 16.5,
      competitivenessGapRubKg: 5.8,
      regime: 'domestic_advantage',
      summaryRu: 'Узбекский лук существенно дороже волгоградского с учётом дальнего плеча доставки.',
    },
    criticalFx: {
      criticalKztRubRate: 0.1666,
      interpretationRu: 'Критический курс KZT/RUB: 0.1666. Если тенге опустится ниже, импорт начнёт демпинговать.',
    },
    flowChain: {
      status: 'transmission_blocked',
      confirmedStagesCount: 1,
      effectivePriceImpulseRubKg: 0.0,
      warningRu: 'Импульс спроса в Ираке не подтверждён отгрузками из Узбекистана: влияние на цену в Волгограде = 0,0 ₽/кг.',
      recommendationRu: 'Не закладывать рост цены на основании зарубежных новостей до подтверждения отгрузок.',
    },
    springWindow: {
      daysUntilSpringWave: 28,
      safeStorageWindowActive: true,
      importHazardLevel: 'low',
      recommendedMaxHoldingDate: '2027-03-20',
      hazardWarningRu: 'Безопасное окно хранения активно: до массового прихода раннего урожая 28 дней.',
    },
  };

  const { kzParity, uzParity, criticalFx, flowChain, springWindow } = corridor;
  const currentKztRate = model.macro?.kztRub?.value || 0.186573;

  const isKzAdvantage = kzParity.regime === 'domestic_advantage';
  const kzBadgeCls = isKzAdvantage
    ? { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0', label: 'Защищено от импорта' }
    : kzParity.regime === 'parity_zone'
    ? { bg: '#fef9c3', text: '#854d0e', border: '#fef08a', label: 'Паритетная зона' }
    : { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca', label: 'Импортный демпинг' };

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
            🌍 Модуль 2: Среднеазиатский коридор импорта и ценовое давление
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
            Импортный паритет (Казахстан / Узбекистан), валютные триггеры KZT/RUB, верификация цепочек Ирак-Узбекистан и весеннее окно отгрузок.
          </p>
        </div>
        <span
          style={{
            fontSize: '0.8rem',
            padding: '4px 10px',
            borderRadius: 12,
            background: kzBadgeCls.bg,
            color: kzBadgeCls.text,
            border: `1px solid ${kzBadgeCls.border}`,
            fontWeight: 600,
          }}
        >
          {kzBadgeCls.label}
        </span>
      </div>

      {/* Grid: Parity & FX Triggers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1.25rem',
          marginBottom: '1.25rem',
        }}
      >
        {/* Card 1: Kazakhstan Taraz Parity */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              Паритет: Казахстан (Тараз → ЮФО)
            </span>
            <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>
              {kzParity.deliveredPriceRubKg?.toFixed(2)} ₽/кг
            </strong>
          </div>
          <p style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 1.4, margin: '0 0 0.75rem' }}>
            {kzParity.summaryRu}
          </p>
          <div style={{ background: '#fff', padding: '0.65rem', borderRadius: 4, border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>Закупка Тараз (55 ₸/кг):</span>
              <span className="mono">{(55 * currentKztRate).toFixed(2)} ₽/кг</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>Фрахт (2200 км / 20 т):</span>
              <span className="mono">+6.20 ₽/кг</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>Фитосанитария + усушка 3%:</span>
              <span className="mono">+0.67 ₽/кг</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0369a1', fontWeight: 600, borderTop: '1px dashed #e2e8f0', paddingTop: 3, marginTop: 3 }}>
              <span>Разница с EXW Волгоград:</span>
              <span>{kzParity.competitivenessGapRubKg > 0 ? `+${kzParity.competitivenessGapRubKg.toFixed(2)}` : kzParity.competitivenessGapRubKg.toFixed(2)} ₽/кг</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.75rem', marginTop: 3 }}>
              <span>Узбекистан (Ташкент) DAP:</span>
              <span className="mono">{uzParity.deliveredPriceRubKg?.toFixed(2)} ₽/кг</span>
            </div>
          </div>
        </div>


        {/* Card 2: Currency (FX) Trigger Analysis */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              Валютный триггер KZT/RUB
            </span>
            <span className="mono" style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>
              Курс ЦБ: {currentKztRate.toFixed(4)}
            </span>
          </div>
          <p style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 1.4, margin: '0 0 0.75rem' }}>
            {criticalFx.interpretationRu}
          </p>
          <div style={{ background: '#fff', padding: '0.65rem', borderRadius: 4, border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>Текущий курс KZT/RUB:</span>
              <strong className="mono">{currentKztRate.toFixed(4)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>Критический курс безубыточности:</span>
              <strong className="mono" style={{ color: '#b91c1c' }}>{criticalFx.criticalKztRubRate}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16a34a', fontWeight: 600, borderTop: '1px dashed #e2e8f0', paddingTop: 3, marginTop: 3 }}>
              <span>Запас прочности отечественного лука:</span>
              <span>{(((currentKztRate / criticalFx.criticalKztRubRate) - 1) * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* Card 3: Spring Arrival Wave Hazard (Uzbek Early Crop) */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              Весенняя волна: Ранний озимый лук
            </span>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: 8,
                background: springWindow.safeStorageWindowActive ? '#dcfce7' : '#fee2e2',
                color: springWindow.safeStorageWindowActive ? '#15803d' : '#b91c1c',
                fontWeight: 700,
              }}
            >
              {springWindow.safeStorageWindowActive ? 'Окно активно' : 'Риск вытеснения'}
            </span>
          </div>
          <p style={{ fontSize: '0.825rem', color: '#334155', lineHeight: 1.4, margin: '0 0 0.75rem' }}>
            {springWindow.hazardWarningRu}
          </p>
          <div style={{ background: '#fff', padding: '0.65rem', borderRadius: 4, border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>Крайняя дата безопасной продажи:</span>
              <strong className="mono">{springWindow.recommendedMaxHoldingDate}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>Дней до среднеазиатской волны:</span>
              <strong className="mono">{springWindow.daysUntilSpringWave} дн.</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#854d0e', borderTop: '1px dashed #e2e8f0', paddingTop: 3, marginTop: 3 }}>
              <span>Фактор конкуренции:</span>
              <span>Новый озимый лук (Узбекистан / РТ)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Flow Diversion Verification Bar */}
      <div
        style={{
          background: flowChain.status === 'corroborated_diversion' ? '#ecfdf5' : '#f8fafc',
          border: `1px solid ${flowChain.status === 'corroborated_diversion' ? '#a7f3d0' : '#e2e8f0'}`,
          borderRadius: 6,
          padding: '0.85rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ maxWidth: '80%' }}>
          <strong style={{ fontSize: '0.85rem', color: '#0f172a', display: 'block', marginBottom: 2 }}>
            🛡️ Верификация новостного импульса: Цепочка «Ирак → Узбекистан → Казахстан → РФ»
          </strong>
          <span style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.4 }}>
            {flowChain.status === 'corroborated_diversion'
              ? flowChain.recommendationRu
              : flowChain.warningRu}
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>Влияние на цену склада:</span>
          <strong
            style={{
              fontSize: '1rem',
              color: flowChain.effectivePriceImpulseRubKg > 0 ? '#16a34a' : '#64748b',
            }}
          >
            {flowChain.effectivePriceImpulseRubKg > 0
              ? `+${flowChain.effectivePriceImpulseRubKg.toFixed(1)} ₽/кг`
              : '0,0 ₽/кг (блокировано)'}
          </strong>
        </div>
      </div>
    </div>
  );
}
