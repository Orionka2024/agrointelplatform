import { CROPS, MARKET_CYCLE_STAGES } from '../data/marketData';

const CYCLE_POSITIONS = [
  { id: 'garlic',     phase: 'Дефицит предложения', pCls: 'dn',   rec: 'Озимый сев / расширение', rStyle: { color: 'var(--green)', fontWeight: 500 } },
  { id: 'onion',      phase: 'Сезонная закладка',   pCls: 'warn', rec: 'Оценка окупаемости хранения', rStyle: { color: 'var(--blue)', fontWeight: 500 } },
  { id: 'watermalon', phase: 'Завершение сезона',   pCls: 'up',   rec: 'Планирование площадей 2027', rStyle: { color: 'var(--txt2)', fontWeight: 500 } },
  { id: 'carrot',     phase: 'Закладка фондов',     pCls: 'info', rec: 'Контроль лежкости и влаги',  rStyle: { color: 'var(--blue)', fontWeight: 500 } },
  { id: 'melon',      phase: 'Межсезонье',          pCls: 'info', rec: 'Стандартный севооборот',     rStyle: { color: 'var(--txt2)', fontWeight: 500 } },
  { id: 'potato',     phase: 'Баланс',              pCls: 'info', rec: 'Плановая контрактация',      rStyle: { color: 'var(--txt2)', fontWeight: 500 } },
  { id: 'beet',       phase: 'Баланс',              pCls: 'info', rec: 'Стандартная закладка',       rStyle: { color: 'var(--txt2)', fontWeight: 500 } },
  { id: 'cabbage',    phase: 'Избыток сбора',       pCls: 'dn',   rec: 'Оперативный сбыт',           rStyle: { color: 'var(--amber)', fontWeight: 500 } },
];

export default function Cycle() {
  return (
    <div className="row-2">
      {/* Cycle stages */}
      <div className="panel">
        <div className="panel-hd"><span className="panel-title">Структура многолетнего рыночного цикла</span></div>
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
          <div className="panel-hd"><span className="panel-title">Оценка фазы цикла по культурам</span></div>
          <div className="panel-body" style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="pl">Культура</th>
                  <th>Фаза цикла</th>
                  <th>Ориентир стратегии</th>
                </tr>
              </thead>
              <tbody>
                {CYCLE_POSITIONS.map(cp => {
                  const c = CROPS[cp.id] || { emoji: '🌱', label: cp.id };
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
          <div className="panel-hd"><span className="panel-title">Методологический комментарий</span></div>
          <div className="panel-body">
            <div className="signal-box hold">
              <div className="signal-label hold">Многолетняя циклическая динамика</div>
              <div className="signal-text hold" style={{ marginTop: 6, fontSize: 11, lineHeight: 1.55 }}>
                Рыночные циклы в овощеводстве формируются реакцией производителей на рентабельность предыдущего сезона (эффект «паутинообразной модели»). Высокие цены одного года стимулируют расширение сева в следующем, что может приводить к перепроизводству. Решения о закладке на хранение должны опираться на детальный расчет безубыточной будущей цены с учетом усушки, гнили и стоимости капитала (раздел «Экономика хранения»).
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd"><span className="panel-title">Бизнес-применение</span></div>
          <div className="panel-body" style={{ padding: '8px 14px' }}>
            {['Фермеры и агрохолдинги', 'Трейдеры и овощные базы', 'Банки, кредитующие АПК', 'Поставщики семян и агрохимии'].map(t => (
              <div className="macro-row" key={t}>
                <span className="macro-lbl">{t}</span>
                <span className="badge info">СУБЪЕКТ</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
