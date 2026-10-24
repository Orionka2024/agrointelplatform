/**
 * DataStatusBadge — индикатор актуальности данных
 * Показывает состояние: свежие / из кеша / оффлайн
 */

export default function DataStatusBadge({ isLoading, isOffline, isStale, lastUpdated, onRefresh }) {
  if (isLoading) {
    return (
      <div className="data-status loading" aria-label="Загрузка данных">
        <span className="status-dot loading" />
        <span className="status-text">Загрузка актуальных данных…</span>
      </div>
    );
  }

  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) +
      ' · ' +
      lastUpdated.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;

  if (isOffline) {
    return (
      <div className="data-status offline" aria-label="Работа в оффлайн-режиме">
        <span className="status-dot offline" />
        <span className="status-text">
          Оффлайн-режим{timeStr ? ` · данные за ${timeStr}` : ' · нет подключения'}
        </span>
        <button className="status-refresh" onClick={onRefresh} title="Повторить запрос">
          ↺
        </button>
      </div>
    );
  }

  if (isStale) {
    return (
      <div className="data-status stale" aria-label="Данные из кеша">
        <span className="status-dot stale" />
        <span className="status-text">
          Данные из кеша{timeStr ? ` · ${timeStr}` : ''}
        </span>
        <button className="status-refresh" onClick={onRefresh} title="Обновить данные">
          ↺
        </button>
      </div>
    );
  }

  return (
    <div className="data-status fresh" aria-label="Данные актуальны">
      <span className="status-dot fresh" />
      <span className="status-text">
        Обновлено{timeStr ? ` · ${timeStr}` : ' сегодня'}
      </span>
    </div>
  );
}
