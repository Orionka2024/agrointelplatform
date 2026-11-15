import { useState } from 'react';
import { DEFAULT_FARM_PROFILE } from '../../shared/marketModel.js';
import { useMarket } from '../context/useMarket';

export default function FarmProfile({ onSave, onClose }) {
  const { model, updateAssumptions } = useMarket();
  const currentFp = { ...DEFAULT_FARM_PROFILE, ...(model.assumptions?.farmProfile || {}) };

  const [form, setForm] = useState({
    areaHa: currentFp.areaHa ?? 78,
    storageCapacityTons: currentFp.storageCapacityTons ?? 1500,
    storageType: currentFp.storageType ?? 'ventilated',
    energyTariffRubKwh: currentFp.energyTariffRubKwh ?? 6.5,
    loanRatePct: currentFp.loanRatePct ?? 19.0,
    usualBuyerType: currentFp.usualBuyerType || currentFp.buyerType || 'exw_wholesaler',
  });

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const isDefault = (field) => form[field] === DEFAULT_FARM_PROFILE[field];

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      if (typeof updateAssumptions === 'function') {
        await updateAssumptions({ farmProfile: form });
      }
      setSaved(true);
      if (typeof onSave === 'function') onSave(form);
    } catch (err) {
      console.error('Failed to save farm profile:', err);
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setForm({ ...DEFAULT_FARM_PROFILE, usualBuyerType: DEFAULT_FARM_PROFILE.buyerType || 'exw_wholesaler' });
  }

  return (
    <div className="panel farm-profile-panel" style={{ padding: '1.25rem', marginTop: '1rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Параметры хозяйства (Профиль фермы)</h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
            Настройка площади, ёмкости склада и финансово-энергетических затрат для индивидуального расчёта точки безубыточности.
          </p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
        )}
      </div>

      <form onSubmit={handleSave}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          {/* Area */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
              Орошаемая площадь, га:
              <span style={{ marginLeft: 6, fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4, background: isDefault('areaHa') ? '#f1f5f9' : '#dbeafe', color: isDefault('areaHa') ? '#64748b' : '#1d4ed8' }}>
                {isDefault('areaHa') ? 'по умолчанию' : 'настроено'}
              </span>
            </label>
            <input
              type="number"
              min="1"
              max="5000"
              value={form.areaHa}
              onChange={(e) => setForm({ ...form, areaHa: Number(e.target.value) })}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
            />
          </div>

          {/* Storage capacity */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
              Ёмкость склада, тонн:
              <span style={{ marginLeft: 6, fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4, background: isDefault('storageCapacityTons') ? '#f1f5f9' : '#dbeafe', color: isDefault('storageCapacityTons') ? '#64748b' : '#1d4ed8' }}>
                {isDefault('storageCapacityTons') ? 'по умолчанию' : 'настроено'}
              </span>
            </label>
            <input
              type="number"
              min="10"
              max="50000"
              value={form.storageCapacityTons}
              onChange={(e) => setForm({ ...form, storageCapacityTons: Number(e.target.value) })}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
            />
          </div>

          {/* Storage Type */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
              Тип склада:
              <span style={{ marginLeft: 6, fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4, background: isDefault('storageType') ? '#f1f5f9' : '#dbeafe', color: isDefault('storageType') ? '#64748b' : '#1d4ed8' }}>
                {isDefault('storageType') ? 'по умолчанию' : 'настроено'}
              </span>
            </label>
            <select
              value={form.storageType}
              onChange={(e) => setForm({ ...form, storageType: e.target.value })}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
            >
              <option value="ventilated">Активная вентиляция (без охлаждения)</option>
              <option value="refrigerated">Холодильный склад (+0.5…+1°C)</option>
              <option value="ambient">Навал без вентиляции (краткосрочно)</option>
            </select>
          </div>

          {/* Electricity tariff */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
              Тариф электроэнергии, ₽/кВт⋅ч:
              <span style={{ marginLeft: 6, fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4, background: isDefault('energyTariffRubKwh') ? '#f1f5f9' : '#dbeafe', color: isDefault('energyTariffRubKwh') ? '#64748b' : '#1d4ed8' }}>
                {isDefault('energyTariffRubKwh') ? 'по умолчанию' : 'настроено'}
              </span>
            </label>
            <input
              type="number"
              step="0.1"
              min="1"
              max="30"
              value={form.energyTariffRubKwh}
              onChange={(e) => setForm({ ...form, energyTariffRubKwh: Number(e.target.value) })}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
            />
          </div>

          {/* Loan rate */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
              Ставка кредита, % годовых:
              <span style={{ marginLeft: 6, fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4, background: isDefault('loanRatePct') ? '#f1f5f9' : '#dbeafe', color: isDefault('loanRatePct') ? '#64748b' : '#1d4ed8' }}>
                {isDefault('loanRatePct') ? 'по умолчанию' : 'настроено'}
              </span>
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="50"
              value={form.loanRatePct}
              onChange={(e) => setForm({ ...form, loanRatePct: Number(e.target.value) })}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
            />
          </div>

          {/* Buyer type */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
              Основной покупатель:
              <span style={{ marginLeft: 6, fontSize: '0.75rem', padding: '2px 6px', borderRadius: 4, background: isDefault('usualBuyerType') ? '#f1f5f9' : '#dbeafe', color: isDefault('usualBuyerType') ? '#64748b' : '#1d4ed8' }}>
                {isDefault('usualBuyerType') ? 'по умолчанию' : 'настроено'}
              </span>
            </label>
            <select
              value={form.usualBuyerType}
              onChange={(e) => setForm({ ...form, usualBuyerType: e.target.value })}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
            >
              <option value="exw_wholesaler">Оптовый трейдер (самовывоз EXW склад)</option>
              <option value="retail_chain">Федеральная розничная сеть (DAP распределительный центр)</option>
              <option value="local_retail">Местная розница / рынки Волгограда</option>
              <option value="processor">Перерабатывающий завод (сушка / заморозка)</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button type="submit" disabled={busy} className="btn-primary" style={{ padding: '8px 16px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            {busy ? 'Сохранение…' : 'Сохранить параметры фермы'}
          </button>
          <button type="button" onClick={handleReset} style={{ padding: '8px 14px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer' }}>
            Сбросить к стандартам Волгограда (78 га)
          </button>
          {saved && <span style={{ color: '#16a34a', fontSize: '0.9rem', fontWeight: 600 }}>✓ Параметры сохранены</span>}
        </div>
      </form>
    </div>
  );
}
