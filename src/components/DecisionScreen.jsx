import { useState, useEffect } from 'react';
import { useMarket } from '../context/useMarket';
import { computeFarmerDecisions } from '../../shared/decisionScreenEngine.js';
import { getPendingQueue, flushPendingQueue, initOfflineSyncListener } from '../../shared/offlineQueue.js';
import FarmProfile from './FarmProfile';
import AddActualPrice from './AddActualPrice';
import MarketIntelligenceModule1 from './MarketIntelligenceModule1';
import CentralAsiaCorridorModule2 from './CentralAsiaCorridorModule2';


export default function DecisionScreen() {
  const { model } = useMarket();
  const [showProfile, setShowProfile] = useState(false);
  const [showDealForm, setShowDealForm] = useState(false);
  const [pendingQueue, setPendingQueue] = useState(getPendingQueue);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const decisions = computeFarmerDecisions(model);
  const { sellNowOrHold, bestTranche, currentMonthBreakEven, farmProfile } = decisions;

  useEffect(() => {
    const cleanup = initOfflineSyncListener({
      onSync: (res) => {
        setPendingQueue(getPendingQueue());
        if (res.successCount > 0) {
          setSyncMsg(`Успешно синхронизировано ${res.successCount} офлайн-сделок`);
        }
      },
    });
    return cleanup;
  }, []);

  async function handleManualSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await flushPendingQueue();
      setPendingQueue(getPendingQueue());
      setSyncMsg(`Синхронизировано: ${res.successCount}, осталось: ${res.remaining}`);
    } catch (err) {
      setSyncMsg(`Ошибка синхронизации: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  const isCustomized = farmProfile?.customizedFields?.length > 0;

  return (
    <div className="decision-screen" style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem 0' }}>
      {/* Top Header & Farm Summary Banner */}
      <div style={{ background: '#f8fafc', padding: '1rem 1.25rem', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.35rem', color: '#0f172a' }}>Решения фермера (Волгоград, EXW склад)</h2>
            <span style={{ fontSize: '0.8rem', padding: '2px 8px', borderRadius: 12, background: isCustomized ? '#dbeafe' : '#f1f5f9', color: isCustomized ? '#1e40af' : '#475569', fontWeight: 600 }}>
              {isCustomized ? 'Профиль фермы: настроен' : 'Профиль фермы: стандарт (78 га)'}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: '#64748b' }}>
            Хозяйство: {farmProfile.areaHa} га, склад: {farmProfile.storageCapacityTons} т ({farmProfile.storageType === 'ventilated' ? 'активная вентиляция' : 'холодильник'}), ставка кредита: {farmProfile.loanRatePct}%.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {pendingQueue.length > 0 && (
            <button
              type="button"
              onClick={handleManualSync}
              disabled={syncing}
              style={{ background: '#fef3c7', border: '1px solid #f59e0b', color: '#b45309', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
            >
              {syncing ? 'Синхронизация…' : `Офлайн-очередь: ${pendingQueue.length} сделки`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowProfile(!showProfile)}
            style={{ padding: '6px 12px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
          >
            {showProfile ? 'Скрыть параметры фермы' : 'Настроить профиль фермы'}
          </button>
          <button
            type="button"
            onClick={() => setShowDealForm(!showDealForm)}
            style={{ padding: '6px 12px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
          >
            {showDealForm ? 'Скрыть форму сделки' : '+ Внести подтверждённую сделку'}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div style={{ padding: '8px 12px', background: '#ecfdf5', color: '#065f46', borderRadius: 6, marginBottom: '1rem', border: '1px solid #a7f3d0' }}>
          {syncMsg}
        </div>
      )}

      {showProfile && (
        <FarmProfile onClose={() => setShowProfile(false)} />
      )}

      {showDealForm && (
        <div style={{ marginBottom: '1.5rem' }}>
          <AddActualPrice defaultOpen={true} />
        </div>
      )}

      {/* 3 Core Decision Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
        {/* Card 1: Sell Now or Hold? */}
        <div className="panel" style={{ padding: '1.25rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>Решение 1</span>
              <span style={{
                padding: '4px 10px',
                borderRadius: 12,
                fontSize: '0.85rem',
                fontWeight: 700,
                background: sellNowOrHold.badgeColor === 'green' ? '#dcfce7' : sellNowOrHold.badgeColor === 'yellow' ? '#fef9c3' : '#fee2e2',
                color: sellNowOrHold.badgeColor === 'green' ? '#15803d' : sellNowOrHold.badgeColor === 'yellow' ? '#854d0e' : '#b91c1c',
              }}>
                {sellNowOrHold.verdict === 'HOLD' ? 'ДЕРЖАТЬ НА СКЛАДЕ' : sellNowOrHold.verdict === 'SPLIT_TRANCHES' ? 'ДЕЛИТЬ НА ТРАНШИ' : 'ПРОДАВАТЬ СЕЙЧАС'}
              </span>
            </div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem', color: '#0f172a' }}>Продавать сейчас или держать?</h3>
            <p style={{ fontSize: '0.925rem', lineHeight: 1.5, color: '#334155', margin: '0 0 1rem' }}>
              {sellNowOrHold.recommendationRu}
            </p>
          </div>
          <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: 6, fontSize: '0.85rem', border: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#64748b' }}>Текущая цена склада EXW:</span>
              <strong>{sellNowOrHold.currentPriceRubKg.toFixed(2)} ₽/кг</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#64748b' }}>Безубыточность к марту:</span>
              <strong>{sellNowOrHold.beSpringRubKg.toFixed(2)} ₽/кг</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16a34a' }}>
              <span>Ожидаемая цена в марте:</span>
              <strong>{sellNowOrHold.expectedSpringPriceRubKg.toFixed(2)} ₽/кг</strong>
            </div>
          </div>
        </div>

        {/* Card 2: Best Tranche Timing */}
        <div className="panel" style={{ padding: '1.25rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>Решение 2</span>
              <span style={{ padding: '4px 10px', borderRadius: 12, fontSize: '0.85rem', fontWeight: 700, background: '#e0f2fe', color: '#0369a1' }}>
                ПИК: {bestTranche.targetMonth}
              </span>
            </div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem', color: '#0f172a' }}>Лучший транш и график продаж</h3>
            <p style={{ fontSize: '0.925rem', lineHeight: 1.5, color: '#334155', margin: '0 0 1rem' }}>
              Сезонный пик цены модели Weibull наступает в марте (**{bestTranche.expectedPriceRubKg.toFixed(2)} ₽/кг**). Оптимально распределить партии по 4 траншам.
            </p>
          </div>
          <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: 6, fontSize: '0.825rem', border: '1px solid #f1f5f9' }}>
            {bestTranche.schedule.slice(0, 3).map((tr, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#475569' }}>{tr.label.split('(')[0]}:</span>
                <strong>{tr.sharePct}% объёма</strong>
              </div>
            ))}
          </div>
        </div>

        {/* Card 3: Break-Even Price This Month */}
        <div className="panel" style={{ padding: '1.25rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>Решение 3</span>
              <span style={{ padding: '4px 10px', borderRadius: 12, fontSize: '0.85rem', fontWeight: 700, background: '#fef3c7', color: '#92400e' }}>
                {currentMonthBreakEven.breakEvenRubKg.toFixed(2)} ₽/кг
              </span>
            </div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem', color: '#0f172a' }}>Точка безубыточности в этом месяце</h3>
            <p style={{ fontSize: '0.925rem', lineHeight: 1.5, color: '#334155', margin: '0 0 1rem' }}>
              {currentMonthBreakEven.recommendationRu}
            </p>
          </div>
          <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: 6, fontSize: '0.825rem', border: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: '#64748b' }}>Базовая цена закладки:</span>
              <span>{currentMonthBreakEven.breakdown.basePriceRubKg.toFixed(2)} ₽/кг</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: '#64748b' }}>Потери массы (усушка):</span>
              <span>+{currentMonthBreakEven.breakdown.shrinkageLossRubKg.toFixed(2)} ₽/кг</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: '#64748b' }}>Электроэнергия вентиляторов:</span>
              <span>+{currentMonthBreakEven.breakdown.electricityRubKg.toFixed(2)} ₽/кг</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b45309', fontWeight: 600 }}>
              <span>Проценты по кредиту (19%):</span>
              <span>+{currentMonthBreakEven.breakdown.loanInterestRubKg.toFixed(2)} ₽/кг</span>
            </div>
          </div>
        </div>
      </div>

      {/* Module 1: Market Intelligence, Supply Pressure Index, Quality-Adjusted Deficit */}
      <MarketIntelligenceModule1 model={model} />

      {/* Module 2: Central Asian Trade Corridors, FX Triggers & Spring Influx Window */}
      <CentralAsiaCorridorModule2 model={model} />
    </div>
  );
}


