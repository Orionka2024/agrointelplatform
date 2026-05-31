import { useState } from 'react';
import { DATA_SOURCES } from '../data/marketData';

const SYSTEM_PROMPT = `Ты аналитик Agro Intelligence Platform — профессиональной торговой системы для российского агрорынка (2026). Отвечай кратко, конкретно, с числами. Данные платформы:

КУЛЬТУРЫ:
- Лук: 28.4 ₽/кг, дефицит-индекс 1.18, тренд +15–20% за 8 нед, урожайность 55 т/га, затраты 700K ₽/га, прибыль ~900K ₽/га. Фаза цикла: охлаждение.
- Чеснок: 142 ₽/кг, острый дефицит 1.28, рост +58% за год, прибыль 1.5–1.8M ₽/га. BUY — максимальные посевы.
- Морковь: 22.6 ₽/кг, баланс рынка 1.02, прибыль 700K ₽/га. HOLD.
- Картофель: 19.2 ₽/кг, избыток 0.91, цена снижается. Сократить площади.
- Свекла: 17.8 ₽/кг, баланс 0.98, прибыль 480K ₽/га. HOLD.
- Капуста: 11.4 ₽/кг, обвал рынка 0.82. SELL — избегать.

МАКРО: USD/RUB 88.3, ключевая ставка ЦБ 16%, дизель 64.2 ₽/л (+11%), остатки урожая 47% нормы.
ИМПОРТ: ЕАЭС обнулял пошлины в 2026. Казахстан 38%, Узбекистан 27%, Египет 19%, Китай 16%.
МОДЕЛЬ: CatBoost, R²=0.84, признаки: price_lag, NDVI, погода, импорт, USD/RUB, дизель.

Формат: максимум 6 предложений. Структурируй ответ. Пиши на русском.`;

const QUICK_QUESTIONS = [
  'Что посадить в следующем сезоне для максимальной прибыли?',
  'Прогноз цены на лук на 3 месяца',
  'Риски импорта из Казахстана в 2026',
  'Оптимальный объём посевов лука на 50 гектар',
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
              AI имеет доступ к текущим ценам, индексам дефицита, прогнозам CatBoost, макропоказателям и данным импорта по состоянию на Май 2026.
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
