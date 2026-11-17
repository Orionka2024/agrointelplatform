import { useState } from 'react';

export default function ConsistencyAuditPanel({ consistencyAudit }) {
  const [showAll, setShowAll] = useState(false);

  if (!consistencyAudit) return null;

  const { totalChecks, passedCount, warningCount, criticalCount, status, recommendationsBlocked, checks = [], auditedAt } =
    consistencyAudit;

  const isCritical = criticalCount > 0;
  const isWarning = !isCritical && warningCount > 0;
  const borderColor = isCritical ? '#dc2626' : isWarning ? '#d97706' : '#16a34a';
  const bgColor = isCritical ? '#fef2f2' : isWarning ? '#fffbeb' : '#f0fdf4';
  const textColor = isCritical ? '#991b1b' : isWarning ? '#92400e' : '#166534';

  const visibleChecks = showAll ? checks : checks.filter((c) => !c.passed);

  return (
    <div
      className="panel"
      data-testid="model-consistency-audit"
      style={{
        border: `2px solid ${borderColor}`,
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
          background: bgColor,
          padding: '0.75rem 1rem',
          borderRadius: 6,
          marginBottom: visibleChecks.length > 0 ? '1rem' : 0,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: textColor }}>
            MODEL CONSISTENCY AUDIT · {status === 'PASS' ? 'СОГЛАСОВАНО' : status === 'WARNINGS' ? 'ПРЕДУПРЕЖДЕНИЯ' : 'КРИТИЧЕСКИЕ ОШИБКИ'}
          </h3>
          <div style={{ fontSize: '0.82rem', color: textColor, marginTop: 2 }}>
            Проверено правил: <strong>{totalChecks}</strong> · Пройдено: <strong>{passedCount}</strong> · Предупреждений:{' '}
            <strong>{warningCount}</strong> · Критических ошибок: <strong>{criticalCount}</strong> · Дата: {auditedAt}
          </div>
          {recommendationsBlocked && (
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#b91c1c', marginTop: 4 }}>
              ⛔ Рекомендации заблокированы из-за критических расхождений модели.
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          style={{
            padding: '5px 10px',
            borderRadius: 6,
            border: `1px solid ${borderColor}`,
            background: '#fff',
            color: textColor,
            cursor: 'pointer',
            fontSize: '0.8rem',
            fontWeight: 600,
          }}
        >
          {showAll ? 'Скрыть пройденные' : `Показать все проверки (${totalChecks})`}
        </button>
      </div>

      {visibleChecks.length > 0 && (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {visibleChecks.map((c) => (
            <div
              key={c.id}
              style={{
                padding: '0.6rem 0.75rem',
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                background: c.passed ? '#f8fafc' : c.severity === 'CRITICAL' ? '#fef2f2' : '#fffbeb',
                fontSize: '0.82rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>
                  <strong>[{c.id}]</strong> {c.rule} <span style={{ color: '#64748b' }}>({c.module})</span>
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: c.passed ? '#15803d' : c.severity === 'CRITICAL' ? '#b91c1c' : '#b45309',
                  }}
                >
                  {c.severity}
                </span>
              </div>
              {!c.passed && c.conflictingValues && (
                <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 4, fontFamily: 'monospace' }}>
                  Конфликт: {JSON.stringify(c.conflictingValues)}
                </div>
              )}
              {!c.passed && c.recommendation && (
                <div style={{ fontSize: '0.78rem', color: '#0f172a', marginTop: 2 }}>
                  Исправление: {c.recommendation}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
