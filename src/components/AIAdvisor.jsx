import { useState } from 'react';
import { DATA_SOURCES } from '../data/marketData';

const SYSTEM_PROMPT = `Ты аналитик Agro Intelligence Platform — профессиональной торговой системы для российского агрорынка (Октябрь 2026). Отвечай кратко, конкретно, с числами. Данные платформы:

КУЛЬТУРЫ (Октябрь 2026):
- Лук: 31.2 ₽/кг, дефицит-индекс 1.21, прогноз роста +60–75% к весне 2027 (пик 55.1 ₽ на W+22), урожайность 55 т/га, затраты 780K ₽/га, прибыль ~936K ₽/га. BUY — закладка в хранилища.
- Чеснок: 158 ₽/кг, острый дефицит 1.31, прогноз до 278 ₽/кг на W+19, прибыль 1.5–1.9M ₽/га. BUY — максимальные озимые посевы в октябре.
- Морковь: 24.8 ₽/кг, индекс 1.07, прогноз роста до 39.5 ₽/кг к марту, прибыль 740K ₽/га. BUY — хранение до весны.
- Арбуз: 24.5 ₽/кг (завершение сезона), индекс 1.14, прибыль 360K ₽/га. План посевов +15% на 2027.
- Дыня: 52.0 ₽/кг (межсезонье), индекс 1.08, прибыль 540K ₽/га. HOLD.
- Свекла: 19.5 ₽/кг, баланс 1.03, прогноз до 28.3 ₽/кг весной, прибыль 510K ₽/га. HOLD.
- Картофель: 21.4 ₽/кг, баланс 0.96, рост с ноября до 29.2 ₽/кг к марту. HOLD — реализация с февраля.
- Капуста: 13.8 ₽/кг, избыток 0.87, высокий валовой сбор поздней капусты. SELL — сбыт с поля.

МАКРО: USD/RUB 94.6, ключевая ставка ЦБ 19%, дизель 67.8 ₽/л (+12.5%), заполненность хранилищ 78% нормы.
ИМПОРТ: Казахстан 39%, Узбекистан 28%, Египет 18%, Китай 15%.
МОДЕЛЬ: CatBoost v2.6 (Октябрь 2026), R²=0.80–0.89, горизонт 26 недель (Октябрь 2026 – Апрель 2027).

Формат: максимум 6 предложений. Структурируй ответ. Пиши на русском.`;

const QUICK_QUESTIONS = [
  'Что закладывать на зимнее хранение в октябре 2026?',
  'Прогноз цены на лук и морковь к весне 2027',
  'Экономика озимого сева чеснока под урожай 2027',
  'Риски импорта из Казахстана и Узбекистана зимой 2026/27',
];

export default function AIAdvisor() {
  const [question, setQuestion] = useState('');
  const [answer,   setAnswer]   = useState('');
  const [loading,  setLoading]  = useState(false);

  async function ask(q) {
    const query = q || question.trim();
    if (!query) return;
    setQuestion(query);
    setLoading(true);
    setAnswer('');
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: query }],
        }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || '').join('\n') || 'Ошибка ответа.';
      setAnswer(text);
    } catch {
      setAnswer('Ошибка подключения к AI-сервису.');
    } finally {
      setLoading(false);
    }
  }

  function renderAnswer() {
    if (loading) return <span className="ai-hint">Анализирую данные платформы...</span>;
    if (!answer) return <span className="ai-hint">Задайте вопрос — AI-советник работает на данных платформы.</span>;
    return (
      <span dangerouslySetInnerHTML={{
        __html: answer
          .replace(/\n/g, '<br>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      }} />
    );
  }

  return (
    <div className="row-2">
      {/* AI Chat */}
      <div className="panel">
        <div className="panel-hd">
          <span className="panel-title">AI-советник · агрорынок РФ</span>
          <span className="badge info">claude-sonnet-4</span>
        </div>
        <div className="panel-body">
          <div className="ask-wrap">
            <input
              className="ask-inp"
              type="text"
              placeholder="Вопрос по рынку, ценам, культурам..."
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ask()}
            />
            <button className="ask-btn" onClick={() => ask()} disabled={loading}>
              {loading ? '...' : 'Запрос'}
            </button>
          </div>

          <div className="qbtns">
            {QUICK_QUESTIONS.map(q => (
              <button key={q} className="qbtn" onClick={() => ask(q)}>{q}</button>
            ))}
          </div>

          <div className="ai-box">{renderAnswer()}</div>

          <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
              Контекст модели
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.55 }}>
              AI имеет доступ к текущим ценам, индексам дефицита, 26-недельным прогнозам CatBoost, макропоказателям и данным импорта по состоянию на Октябрь 2026.
            </div>
          </div>
        </div>
      </div>

      {/* Data Sources */}
      <div className="panel">
        <div className="panel-hd"><span className="panel-title">Источники данных · {DATA_SOURCES.length} источников</span></div>
        <div className="panel-body">
          <div className="src-grid">
            {DATA_SOURCES.map(s => (
              <div key={s.name} className="src-item">
                <div className="src-name">{s.name}</div>
                <div className="src-cat">{s.cat}</div>
              </div>
            ))}
          </div>

          <div className="divider" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="signal-box info">
              <div className="signal-label info">База данных</div>
              <div className="signal-text info" style={{ marginTop: 4 }}>
                PostgreSQL · Таблицы: commodity_prices, weather, imports, production. Обновление: цены — ежедневно, NDVI — каждые 5 дней, погода — ежечасно.
              </div>
            </div>
            <div className="signal-box hold">
              <div className="signal-label hold">Модель · CatBoost</div>
              <div className="signal-text hold" style={{ marginTop: 4 }}>
                Уровень 1: прогноз цены 1–26 нед. Уровень 2: прогноз урожая по NDVI + погоде. Уровень 3: прогноз прибыли культуры до посадки.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
