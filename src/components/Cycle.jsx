import { CROPS, MARKET_CYCLE_STAGES } from '../data/marketData';

const CYCLE_POSITIONS = [
  { id: 'garlic', phase: 'Дефицит',    pCls: 'dn',   rec: 'Максимальные посевы',  rStyle: { color: 'var(--green)', fontWeight: 500 } },
  { id: 'onion',  phase: 'Охлаждение', pCls: 'warn', rec: 'Стандартный объём',     rStyle: { color: 'var(--amber)', fontWeight: 500 } },
  { id: 'carrot', phase: 'Баланс',     pCls: 'info', rec: 'Держать позицию',        rStyle: { color: 'var(--blue)',  fontWeight: 500 } },
  { id: 'potato', phase: 'Избыток',    pCls: 'warn', rec: 'Сократить площади',      rStyle: { color: 'var(--red)',   fontWeight: 500 } },
  { id: 'cabbage',phase: 'Обвал',      pCls: 'dn',   rec: 'Избегать',               rStyle: { color: 'var(--red)',   fontWeight: 500 } },
];

export default function Cycle() {
  return (
    <div className="row-2">
      {/* Cycle stages */}
      <div className="panel">
        <div className="panel-hd"><span className="panel-title">Структура рыночного цикла · 2–3 года</span></div>
        <div className="panel-body">
          {MARKET_CYCLE_STAGES.map(s => (
            <div className="stage-row" key={s.n}>
              <div className="stage-n">{s.n}</div>
              <div className="stage-dot" style={{ background: s.color }} />
              <div>
                <div className="stage-title" style={{ color: s.color }}>{s.title}</div>
                <div className="stage-desc">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right column */}
      <div className="col-stack">
        <div className="panel">
          <div className="panel-hd"><span className="panel-title">Позиция на цикле · Май 2026</span></div>
          <div className="panel-body" style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="pl">Культура</th>
                  <th>Фаза цикла</th>
                  <th>Рекомендация</th>
                </tr>
              </thead>
              <tbody>
                {CYCLE_POSITIONS.map(cp => {
                  const c = CROPS[cp.id];
                  return (
                    <tr key={cp.id}>
                      <td className="pl fw">{c.emoji} {c.label}</td>
                      <td><span className={`pill ${cp.pCls}`}>{cp.phase}</span></td>
                      <td style={{ fontSize: 11, ...cp.rStyle }}>{cp.rec}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd"><span className="panel-title">Ключевой инсайт</span></div>
          <div className="panel-body">
            <div className="signal-box hold">
              <div className="signal-label hold">Аналитика · Май 2026</div>
              <div className="signal-text hold" style={{ marginTop: 6 }}>
                В 2024–2025 наблюдался острый дефицит лука. В 2026 рынок охлаждается — предложение растёт. ЕАЭС временно обнулял пошлины на импорт для сдерживания цен. Чеснок — наиболее перспективная культура для сезона 2026–2027.
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd"><span className="panel-title">Бизнес-применение</span></div>
          <div className="panel-body" style={{ padding: '8px 14px' }}>
            {['Фермеры и агрохолдинги', 'Трейдеры и овощные базы', 'Банки, кредитующие АПК', 'Поставщики семян и удобрений'].map(t => (
              <div className="macro-row" key={t}>
                <span className="macro-lbl">{t}</span>
                <span className="badge info">КЛИЕНТ</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
