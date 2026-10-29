import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { parseSafeMarkdown } from '../../shared/safeMarkdown.js';
import { buildSnapshot } from '../../shared/snapshot.js';

const QUICK_QUESTIONS = [
  'Какова текущая цена лука на складе в Волгограде и оптом в Москве?',
  'Выгодно ли хранить лук до марта или продать сейчас со склада?',
  'Как повлияет возможное ограничение импорта из Казахстана?',
  'Каковы результаты валидации модели прогноза и доверительные интервалы?',
];

function SafeMarkdownView({ text }) {
  const blocks = parseSafeMarkdown(text);
  return (
    <div className="safe-markdown-content" style={{ fontSize: 12, lineHeight: 1.6 }}>
      {blocks.map((block, idx) => {
        if (block.type === 'ul') {
          return (
            <ul key={idx} style={{ margin: '6px 0 8px 18px', paddingLeft: 0 }}>
              {block.items.map((item, iIdx) => (
                <li key={iIdx} style={{ marginBottom: 4 }}>
                  {item.map((t, tIdx) => (
                    t.t === 'bold' ? <strong key={tIdx}>{t.v}</strong> : <span key={tIdx}>{t.v}</span>
                  ))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={idx} style={{ margin: '6px 0' }}>
            {block.children.map((t, tIdx) => (
              t.t === 'bold' ? <strong key={tIdx}>{t.v}</strong> : <span key={tIdx}>{t.v}</span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export default function AIAdvisor() {
  const { model, basis, scenario, demo } = useMarket();

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [modelName, setModelName] = useState('AI Advisor');

  async function ask(q) {
    const query = q || question.trim();
    if (!query) return;
    setQuestion(query);
    setLoading(true);
    setAnswer('');
    setError(null);

    // Build structured snapshot of the CURRENT market state
    const snapshot = buildSnapshot(model, {
      selectedBasis: basis,
      selectedScenario: scenario,
    });

    try {
      const res = await fetch('/api/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          snapshot,
          demo,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }

      if (data.model) {
        setModelName(data.model);
      }

      setAnswer(data.answer || 'Ответ не получен.');
    } catch (err) {
      setError(err.message || 'Ошибка подключения к AI-сервису.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="row-2">
      {/* AI Chat Panel */}
      <div className="panel">
        <div className="panel-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="panel-title">AI-советник · анализ рынка и экономики</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {demo && <span className="badge warn" style={{ fontSize: 10 }}>ДЕМО-КОНТЕКСТ</span>}
            <span className="badge info">{modelName}</span>
          </div>
        </div>

        <div className="panel-body">
          <div className="ask-wrap">
            <input
              className="ask-inp"
              type="text"
              placeholder="Задайте вопрос по ценам, хранению или сценариям..."
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

          <div className="ai-box">
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="live-dot" style={{ animation: 'pulse 1.2s infinite' }} />
                <span className="ai-hint">Анализирую текущий срез данных и рассчитываю ответ...</span>
              </div>
            )}

            {error && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ color: 'var(--red)', fontWeight: 600, fontSize: 12 }}>
                  ⚠️ Ошибка AI-сервиса
                </div>
                <div style={{ color: 'var(--txt2)', fontSize: 11, lineHeight: 1.5 }}>
                  {error}
                </div>
                {error.includes('API_KEY') && (
                  <div style={{ padding: '8px 10px', background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 4, color: 'var(--amber)', fontSize: 11 }}>
                    Добавьте <code>GEMINI_API_KEY</code>, <code>OPENAI_API_KEY</code> или <code>ANTHROPIC_API_KEY</code> в файл <code>.env.local</code>.
                  </div>
                )}
              </div>
            )}

            {!loading && !error && !answer && (
              <span className="ai-hint">Задайте вопрос — AI-советник работает на структурированном срезе текущих данных платформы.</span>
            )}

            {!loading && !error && answer && (
              <SafeMarkdownView text={answer} />
            )}
          </div>

          <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
              Контекст модели (Snapshot Security)
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.55 }}>
              AI получает структурированный срез текущего состояния: статус цен ({model.prices.warehouse.provenance.status} / {model.prices.moscow.provenance.status}), валидацию бэктеста, параметры моста издержек и сценарий <em>{scenario}</em>. Текст ответа рендерится через безопасный токенизатор без выполнения произвольного HTML.
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Context Information */}
      <div className="panel">
        <div className="panel-hd"><span className="panel-title">Срез данных в контексте AI</span></div>
        <div className="panel-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
            <div style={{ background: 'var(--surface2)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
              <strong>Режим работы:</strong> {demo ? 'Демонстрационный (иллюстративные данные)' : 'Реальные наблюдения'}
            </div>
            <div style={{ background: 'var(--surface2)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
              <strong>Базис цен:</strong> {basis === 'warehouse' ? 'Склад (Волгоград, EXW без НДС)' : 'Москва (DAP с доставкой, с НДС)'}
            </div>
            <div style={{ background: 'var(--surface2)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
              <strong>Статус прогноза:</strong> {model.forecasts[basis]?.status || 'не выпущен'}
            </div>
            <div style={{ background: 'var(--surface2)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
              <strong>Мост доставки:</strong> {model.bridgeResult.status === 'ok' ? `Фрахт ${(model.bridgeResult.components.freight).toFixed(2)} ₽/кг + потери` : 'неполная смета'}
            </div>
            <div style={{ background: 'var(--surface2)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
              <strong>Активный сценарий:</strong> {model.scenarios.results.find(s => s.id === scenario)?.label}
            </div>
          </div>

          <div className="divider" />

          <div style={{ fontSize: 10, color: 'var(--txt3)', lineHeight: 1.5 }}>
            🔒 <strong>Безопасность:</strong> Все импортированные текстовые строки (источники, примечания) экранируются и передаются в модель как пассивные данные. Инструкции пользователя изолированы от системного промпта.
          </div>
        </div>
      </div>
    </div>
  );
}
