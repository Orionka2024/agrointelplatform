import { useState } from 'react';
import { useMarket } from '../context/useMarket';
import { PRICE_CSV_TEMPLATE } from '../../shared/observations.js';

const INDICATOR_TEMPLATE = [
  'observation_date,retrieved_date,indicator,value,unit,region,storage_type,crop_year,cause,source,source_ref,notes',
  '2026-09-20,2026-09-21,harvest_progress_pct,65,%,Волгоградская обл.,,2026,,Комитет с/х Волгоградской обл.,сводка-15,активная уборка на капельном поливе',
].join('\n');

const SOURCE_CONNECTIONS = [
  { name: 'Банк России (cbr.ru)', cat: 'Макроэкономика', status: 'connected', desc: 'Автоматический ежедневный парсинг XML курсов валют (USD, KZT) и ключевой ставки.' },
  { name: 'Open-Meteo API', cat: 'Погода', status: 'connected', desc: 'Автоматический 7-дневный прогноз для районов Волгоградской области.' },
  { name: 'AgroServer / FruitInfo', cat: 'Оптовые сделки и цены', status: 'manual_csv', desc: 'Прямой API недоступен без платной подписки. Поддерживается регулярная загрузка выгрузок через CSV.' },
  { name: 'Росстат / Минсельхоз РФ', cat: 'Урожай и балансы', status: 'manual_csv', desc: 'Официальные сводки и бюллетени. Импортируются ежемесячно в формате CSV.' },
  { name: 'ФТС РФ / ЕЭК', cat: 'Импорт (Казахстан, Узбекистан)', status: 'manual_csv', desc: 'Таможенные декларации и фитосанитарные отчеты по поставкам овощей.' },
  { name: 'ATI.SU / РЖД', cat: 'Логистика', status: 'manual_csv', desc: 'Ставки фрахта фур Волгоград–Москва. Вводятся в смете моста издержек.' },
  { name: 'Sentinel-2 (NDVI)', cat: 'Спутники', status: 'manual_csv', desc: 'Индексы вегетации. Вводятся по завершению пролетов КА.' },
];

export default function DataImport() {
  const { importData } = useMarket();

  const [importType, setImportType] = useState('prices'); // 'prices' | 'indicators'
  const [csvText, setCsvText] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  function handleDownloadTemplate() {
    const content = importType === 'prices' ? PRICE_CSV_TEMPLATE : INDICATOR_TEMPLATE;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_${importType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleLoadSample() {
    if (importType === 'prices') {
      setCsvText([
        'observation_date,retrieved_date,kind,market,geography,price,unit,vat,vat_rate,delivery_basis,grade,size_mm,packaging,lot_size_t,payment_terms,volume_t,source,source_ref,published_date,notes',
        '2026-10-14,2026-10-15,transaction,warehouse_volgograd,"Волгоградская обл., Городищенский р-н",15.0,RUB/kg,excl,0.10,EXW,1-й сорт,50-70,навалом,20,предоплата,20,АгроСервер,deal-104,,партии стандартного качества',
        '2026-10-21,2026-10-22,transaction,warehouse_volgograd,"Волгоградская обл., Городищенский р-н",15.5,RUB/kg,excl,0.10,EXW,1-й сорт,50-70,навалом,20,предоплата,20,АгроСервер,deal-105,,отгрузка со склада',
        '2026-10-21,2026-10-22,transaction,moscow_wholesale,"Москва, Фуд Сити",27.5,RUB/kg,excl,0.10,DAP,1-й сорт,50-70,сетка,20,отсрочка 7 дн.,20,ФудИнфо,deal-201,,опт Москва с доставкой',
      ].join('\n'));
    } else {
      setCsvText(INDICATOR_TEMPLATE);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!csvText.trim()) return;
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const res = await importData(importType, csvText);
      setReport(res.report);
      setCsvText('');
    } catch (err) {
      setError(err.message || 'Ошибка импорта данных');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="row-2">
      {/* Left: CSV Import Form */}
      <div className="panel">
        <div className="panel-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="panel-title">Импорт данных через CSV</span>
          <div className="basis-switcher" style={{ margin: 0 }}>
            <button
              type="button"
              className={`basis-btn ${importType === 'prices' ? 'active' : ''}`}
              onClick={() => { setImportType('prices'); setReport(null); }}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              Цены и сделки
            </button>
            <button
              type="button"
              className={`basis-btn ${importType === 'indicators' ? 'active' : ''}`}
              onClick={() => { setImportType('indicators'); setReport(null); }}
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              Индикаторы
            </button>
          </div>
        </div>

        <div className="panel-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--txt2)' }}>
              Вставьте строки CSV или загрузите файл шаблона:
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={handleLoadSample}
                className="cash-reset-btn"
                style={{ fontSize: 10, padding: '2px 7px' }}
              >
                📋 Загрузить образец
              </button>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="cash-reset-btn"
                style={{ fontSize: 10, padding: '2px 7px' }}
              >
                ⬇ Скачать шаблон CSV
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <textarea
              rows={9}
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              placeholder="Вставьте содержимое CSV-файла..."
              style={{
                width: '100%',
                fontFamily: 'var(--mono)',
                fontSize: 11,
                padding: '8px 10px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--surface2)',
                color: 'var(--txt)',
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />

            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="submit"
                disabled={loading || !csvText.trim()}
                className="basis-btn active"
                style={{ fontSize: 12, padding: '6px 14px' }}
              >
                {loading ? 'Проверка и импорт...' : 'Загрузить в базу данных'}
              </button>

              <span style={{ fontSize: 11, color: 'var(--txt3)' }}>
                Валидация: единицы, дубликаты, выбросы, даты
              </span>
            </div>
          </form>

          {error && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', color: 'var(--red)', borderRadius: 4, fontSize: 11 }}>
              {error}
            </div>
          )}

          {/* Import Results Report */}
          {report && (
            <div style={{ marginTop: 14, padding: '12px', background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: 12 }}>Отчёт валидации импорта:</strong>
                <span className={`badge ${report.accepted.length > 0 ? 'up' : 'dn'}`} style={{ fontSize: 10 }}>
                  Принято: {report.accepted.length} из {report.totalRows}
                </span>
              </div>

              <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>• Принято строк: <strong>{report.accepted.length}</strong> {report.outliers > 0 && <span style={{ color: 'var(--amber)' }}>(выбросов: {report.outliers})</span>}</div>
                <div>• Пропущено дубликатов: <strong>{report.duplicates.length}</strong></div>
                {report.rejected.length > 0 && (
                  <div style={{ color: 'var(--red)' }}>
                    • Отклонено некорректных строк: <strong>{report.rejected.length}</strong>
                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                      {report.rejected.slice(0, 5).map((rej, idx) => (
                        <li key={idx}>Строка {rej.line}: {rej.errors.join('; ')}</li>
                      ))}
                      {report.rejected.length > 5 && <li>...и ещё {report.rejected.length - 5} строк</li>}
                    </ul>
                  </div>
                )}
                {report.warnings.length > 0 && (
                  <div style={{ color: 'var(--amber)' }}>
                    • Предупреждений: <strong>{report.warnings.length}</strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Data Sources & Connection Status */}
      <div className="panel">
        <div className="panel-hd">
          <span className="panel-title">Реестр источников данных платформы</span>
        </div>
        <div className="panel-body">
          <div style={{ fontSize: 11, color: 'var(--txt2)', marginBottom: 12 }}>
            Платформа строго разделяет проверенные сетевые API-подключения, ручные импорты и отсутствующие источники. Источники не объявляются «подключенными», если доступ к ним не реализован в коде.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SOURCE_CONNECTIONS.map(src => (
              <div key={src.name} style={{ background: 'var(--surface2)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <strong style={{ fontSize: 11 }}>{src.name}</strong>
                  <span className={`pill ${src.status === 'connected' ? 'up' : 'info'}`} style={{ fontSize: 9 }}>
                    {src.status === 'connected' ? 'LIVE API' : 'РУЧНОЙ CSV'}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 3 }}>{src.cat}</div>
                <div style={{ fontSize: 10, color: 'var(--txt2)', lineHeight: 1.4 }}>{src.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
