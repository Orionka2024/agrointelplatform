import { buildVolgogradOnionIntelligence } from '../../shared/onionValidatedIntel.js';

export default function VolgogradOnionIntelPanel({ model, signals }) {
  const intel = buildVolgogradOnionIntelligence({
    today: model.today,
    observations: (model.verifiedObservations || []).map((o) => ({
      ...o,
      verification: { status: 'verified' },
    })),
    signals,
    storageParams: model.storage?.params || {},
    assumptions: model.assumptions || {},
  });

  const {
    volgogradPriceRange: vlgRange,
    kazakhstanComparison: kzComp,
    tradeAndSupplyIndicators: trade,
    forecast7_30_90: fc,
    farmerDecision: decision,
    storageBreakEvenMatrix: beMatrix,
    missingDataWarnings: warnings,
    traceableSources: sources,
  } = intel;

  const rec = decision.recommendation;
  const recBadgeCls =
    rec.status === 'ACTIONABLE' ? (rec.action === 'HOLD_LOT' ? 'up' : 'warn') : 'dn';

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-hd" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="panel-title">
            🛡️ Верифицированная рыночная разведка · Лук репчатый Волгоград (HS {intel.hsCode})
          </span>
          <span className="badge info">Слой контроля качества данных</span>
          {fc.isConditionalForecast && (
            <span className="badge warn">Условный прогноз (нет подтверждённой сделки EXW)</span>
          )}
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--txt3)' }}>
          Дата среза: <strong className="mono">{intel.asOf}</strong>
        </span>
      </div>

      <div className="panel-body" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {fc.isConditionalForecast && (
          <div style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--bg2)', borderLeft: '3px solid var(--amber)', fontSize: 11.5 }}>
            <strong>⚠️ {fc.conditionalWarning}</strong>
          </div>
        )}

        {/* Section 1 & 2: Verified Volgograd Price Range + Kazakhstan Delivered Comparison */}
        <div className="row-2" style={{ gap: 12, marginBottom: 0 }}>
          {/* 1. Current verified Volgograd price range */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: 12 }}>1. Верифицированный диапазон цен (Волгоград EXW)</strong>
              <span className={`badge ${vlgRange.verified.status === 'verified' ? 'up' : 'warn'}`}>
                {vlgRange.verified.status === 'verified'
                  ? `Сделок: ${vlgRange.verified.countTransactions} · Bid: ${vlgRange.verified.countBids}`
                  : 'Нет подтверждённых сделок'}
              </span>
            </div>

            {vlgRange.verified.status === 'verified' ? (
              <div className="macro-row">
                <span className="macro-lbl">Подтверждённые сделки / заявки (без НДС)</span>
                <span className="macro-val mono">
                  {vlgRange.verified.minExVatRubKg?.toFixed(1)}–{vlgRange.verified.maxExVatRubKg?.toFixed(1)} ₽/кг
                  {' '}(медиана {vlgRange.verified.medianExVatRubKg?.toFixed(1)} ₽ · от {vlgRange.verified.asOf})
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 6, lineHeight: 1.4 }}>
                Верифицированных закрытых сделок (`completed_transaction`) или твёрдых заявок покупателей (`executable_bid`) нет. Значение <strong>null</strong> (не заменяется нулём и не подменяется объявлениями).
              </div>
            )}

            <div className="macro-row" style={{ borderTop: '1px dashed var(--border)', paddingTop: 6, marginTop: 4 }}>
              <span className="macro-lbl">
                Индикативные оферты досок (`indicative_offer`, ask ≠ сделка)
              </span>
              <span className="macro-val mono" style={{ color: 'var(--txt2)' }}>
                {vlgRange.indicativeOffers.minExVatRubKg !== null
                  ? `${vlgRange.indicativeOffers.minExVatRubKg.toFixed(1)}–${vlgRange.indicativeOffers.maxExVatRubKg.toFixed(1)} ₽/кг (${vlgRange.indicativeOffers.countOffers} канал.)`
                  : 'нет данных'}
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 3 }}>
              ⚠️ {vlgRange.indicativeOffers.warning}
            </div>
          </div>

          {/* 2. Kazakhstan delivered-price comparison */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: 12 }}>2. Сценарный паритет Казахстана (34 / 55 / 75 ₸/кг → Волгоград)</strong>
              <span className={`badge ${kzComp.verifiedDeliveredExVatRubKg !== null ? 'up' : 'warn'}`}>
                {kzComp.verifiedDeliveredExVatRubKg !== null ? 'Верифицированная котировка' : 'Сценарный расчёт (не сделка)'}
              </span>
            </div>
            <div className="macro-row">
              <span className="macro-lbl">Курс ЦБ РФ KZT/RUB (на {kzComp.fxKztRub.asOf})</span>
              <span className="macro-val mono">
                {kzComp.fxKztRub.value !== null ? `${kzComp.fxKztRub.value.toFixed(6)} ₽/₸` : 'нет данных'}
              </span>
            </div>
            <div className="macro-row">
              <span className="macro-lbl">Автофрахт 20 т ({kzComp.components.freightStatus})</span>
              <span className="macro-val mono" style={{ fontSize: 11 }}>
                {kzComp.components.freightAndPhytosanitaryRubKg} ₽/кг (116 000 ₽ / 20 т — допущение до подтв. котировок)
              </span>
            </div>
            {kzComp.scenarios?.length > 0 && (
              <div className="table-wrapper" style={{ marginTop: 6 }}>
                <table className="tbl" style={{ fontSize: 10.5 }}>
                  <thead>
                    <tr>
                      <th className="pl">Сценарий закупки КЗ</th>
                      <th>DAP без НДС (ОСНО)</th>
                      <th>Денежный отток с НДС 10%</th>
                      <th>Невозм. НДС (УСН)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kzComp.scenarios.map((sc) => (
                      <tr key={sc.id}>
                        <td className="pl fw">{sc.purchaseKztKg} ₸/кг ({sc.purchaseRubKg.toFixed(2)} ₽)</td>
                        <td className="mono fw">{sc.dapExVatRubKg.toFixed(2)} ₽ (~{sc.dapExVatRounded01?.toFixed(1)} ₽)</td>
                        <td className="mono">{sc.cashOutflowIncVatRubKg.toFixed(2)} ₽ (~{sc.cashOutflowRounded01?.toFixed(1)} ₽)</td>
                        <td className="mono" style={{ color: 'var(--txt2)' }}>+{sc.unrecoverableTaxLoadRubKg.usnNonRecoverableVat.toFixed(2)} ₽</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4 }}>
              ℹ️ {kzComp.scenariosNote}
            </div>
          </div>
        </div>

        {/* 3. Regional trade and supply indicators (HS 070310) */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            <strong style={{ fontSize: 12 }}>3. Региональные торговые потоки (ТН ВЭД {trade.hsCode}) и индикаторы предложения</strong>
            <span className="badge warn">Ирак–Иран: косвенный фактор спроса и логистики</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--txt2)', marginBottom: 8 }}>
            ℹ️ {trade.corridorPolicy.ruleNote} {trade.corridorPolicy.uzbekistanSurplusCaveat}
          </div>
          <div className="table-wrapper" role="region" tabIndex={0} aria-label="Торговые потоки HS 070310">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="pl">Коридор / Индикатор</th>
                  <th>Тип доказательства</th>
                  <th>Текущий объём (т)</th>
                  <th>Статус и дата</th>
                  <th>Примечание</th>
                </tr>
              </thead>
              <tbody>
                {trade.flows.map((f) => (
                  <tr key={f.id}>
                    <td className="pl fw" style={{ whiteSpace: 'nowrap' }}>
                      <a href={f.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>
                        {f.corridor} ↗
                      </a>
                    </td>
                    <td style={{ fontSize: 11 }}>{f.evidenceType}</td>
                    <td className="mono">
                      {f.volumeT !== null ? `${f.volumeT} т` : 'null (нет данных)'}
                      {f.historicalSharePct ? ` · ист. доля ${f.historicalSharePct}%` : ''}
                    </td>
                    <td>
                      <span className={`badge ${f.isHistoricalStatistic ? 'info' : 'warn'}`}>
                        {f.statusLabel} ({f.observationDate})
                      </span>
                    </td>
                    <td style={{ fontSize: 10.5, color: 'var(--txt2)' }}>{f.note}</td>
                  </tr>
                ))}
                {trade.supplyIndicators.map((s) => (
                  <tr key={s.id}>
                    <td className="pl fw">
                      <a href={s.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>
                        {s.title} ↗
                      </a>
                    </td>
                    <td style={{ fontSize: 11 }}>{s.evidenceType}</td>
                    <td className="mono">{s.valueT !== undefined ? (s.valueT !== null ? `${s.valueT} т` : 'null') : '—'}</td>
                    <td>
                      <span className="badge info">{s.status} ({s.asOf || 'нет даты'})</span>
                    </td>
                    <td style={{ fontSize: 10.5, color: 'var(--txt2)' }}>{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. Forecast range and confidence (7, 30, 90 days) & 5. Sell-versus-hold economics */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            <strong style={{ fontSize: 12 }}>
              4 & 5. Прогноз EXW Волгоград (7 / 30 / 90 дней, округление до 0,1 ₽/кг) и экономика «Продать сейчас vs. Держать»
            </strong>
            <span className={`badge ${fc.anchor.hasVerifiedLocalAnchor ? 'up' : 'warn'}`}>
              База: {fc.anchor.priceExVatRubKg?.toFixed(1) ?? '—'} ₽/кг ({fc.anchor.evidenceType}, от {fc.anchor.asOf})
            </span>
          </div>

          <div className="table-wrapper" role="region" tabIndex={0} aria-label="Прогноз 7, 30, 90 дней и экономика хранения">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="pl">Горизонт</th>
                  <th>Прогноз EXW</th>
                  <th>80% интервал</th>
                  <th>95% интервал</th>
                  <th>Бэктест (MAE / MAPE)</th>
                  <th>Потери / OPEX / Кредит</th>
                  <th>Порог безубыт.</th>
                  <th>Ожид. Δ к продаже сейчас</th>
                  <th>Риск P10 (при lo80)</th>
                </tr>
              </thead>
              <tbody>
                {fc.horizons.map((h) => {
                  const econ = decision.horizons.find((d) => d.horizonDays === h.horizonDays);
                  return (
                    <tr key={h.horizonDays}>
                      <td className="pl fw" style={{ whiteSpace: 'nowrap' }}>
                        {h.label} <span style={{ color: 'var(--txt3)', fontSize: 10 }}>({h.targetDate})</span>
                      </td>
                      <td className="mono fw">{h.pointExVatRubKg !== null ? `${h.pointExVatRubKg.toFixed(1)} ₽` : 'null'}</td>
                      <td className="mono">{h.lo80 !== null ? `${h.lo80.toFixed(1)}–${h.hi80.toFixed(1)} ₽` : '—'}</td>
                      <td className="mono" style={{ color: 'var(--txt2)' }}>
                        {h.lo95 !== null ? `${h.lo95.toFixed(1)}–${h.hi95.toFixed(1)} ₽` : '—'}
                      </td>
                      <td className="mono" style={{ fontSize: 10.5 }}>
                        ±{h.backtest?.maeRubKg ?? '—'} ₽ ({h.backtest?.mapePct ?? '—'}%, n={h.backtest?.nHoldout ?? 0})
                      </td>
                      <td className="mono" style={{ fontSize: 10.5 }}>
                        {econ?.status === 'ok'
                          ? `${econ.expectedLossPct}% / ${econ.storageOpexRubKg} ₽ / ${econ.financingCostRubKg} ₽`
                          : '—'}
                      </td>
                      <td className="mono">{econ?.breakEvenPriceRubKg ? `${econ.breakEvenPriceRubKg.toFixed(1)} ₽` : '—'}</td>
                      <td className={`mono fw ${(econ?.expectedGainRubKg ?? 0) > 0 ? 'up' : 'dn'}`}>
                        {econ?.expectedGainRubKg !== undefined && econ?.expectedGainRubKg !== null
                          ? `${econ.expectedGainRubKg >= 0 ? '+' : ''}${econ.expectedGainRubKg.toFixed(1)} ₽/кг`
                          : '—'}
                      </td>
                      <td className={`mono ${(econ?.downsideDeltaVsSellNowRubKg ?? 0) >= 0 ? 'up' : 'dn'}`}>
                        {econ?.downsideDeltaVsSellNowRubKg !== undefined && econ?.downsideDeltaVsSellNowRubKg !== null
                          ? `${econ.downsideDeltaVsSellNowRubKg >= 0 ? '+' : ''}${econ.downsideDeltaVsSellNowRubKg.toFixed(1)} ₽/кг`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* P1.6: 30 / 60 / 90 / 120 / 150-day Storage Break-Even Calculator across 8% / 14% / 19% */}
          {beMatrix?.rows?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong style={{ fontSize: 11.5 }}>
                  Калькулятор безубыточности хранения (30 / 60 / 90 / 120 / 150 дней · ставки 8% / 14% ЦБ / 19%)
                </strong>
                <span className="badge info">
                  База расчёта: {beMatrix.basePriceExVatRubKg.toFixed(1)} ₽/кг ({beMatrix.basePriceStatus})
                </span>
              </div>
              <div className="table-wrapper">
                <table className="tbl" style={{ fontSize: 10.5 }}>
                  <thead>
                    <tr>
                      <th className="pl">Срок хранения</th>
                      <th>Физ. потери / OPEX</th>
                      <th>Порог при 8% (льготный)</th>
                      <th>Порог при 14% (ЦБ РФ 13.11.2026)</th>
                      <th>Порог при 19% (коммерч.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {beMatrix.rows.map((r) => (
                      <tr key={r.horizonDays}>
                        <td className="pl fw">{r.horizonDays} дн. ({r.months} мес.)</td>
                        <td className="mono">{r.totalPhysicalLossPct}% · {r.storageOpexRubKg.toFixed(2)} ₽/кг</td>
                        <td className="mono">
                          {r.rates[8]?.breakEvenRounded01?.toFixed(1)} ₽ (+{r.rates[8]?.requiredDeltaRounded01?.toFixed(1)} ₽)
                        </td>
                        <td className="mono fw">
                          {r.rates[14]?.breakEvenRounded01?.toFixed(1)} ₽ (+{r.rates[14]?.requiredDeltaRounded01?.toFixed(1)} ₽)
                        </td>
                        <td className="mono">
                          {r.rates[19]?.breakEvenRounded01?.toFixed(1)} ₽ (+{r.rates[19]?.requiredDeltaRounded01?.toFixed(1)} ₽)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Evidence-gated decision support banner */}
          <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
              <strong style={{ fontSize: 12 }}>{rec.headline}</strong>
              <span className={`badge ${recBadgeCls}`}>{rec.status}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.45, marginBottom: 6 }}>{rec.explanation}</div>
            {rec.missingEvidence?.length > 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--amber)', marginBottom: 4 }}>
                <strong>Чего не хватает для директивной рекомендации:</strong>{' '}
                {rec.missingEvidence.join(' ')}
              </div>
            )}
            <div style={{ fontSize: 10.5, color: 'var(--txt3)' }}>
              <strong>Что изменит решение:</strong> {rec.whatWouldChangeDecision.join(' · ')}
            </div>
          </div>
        </div>

        {/* 6. Source links, timestamps and missing-data warnings */}
        <div className="row-2" style={{ gap: 12, marginBottom: 0 }}>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              6a. Предупреждения о неполных и неверифицированных данных
            </strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {warnings.map((w) => (
                <div key={w.id} style={{ fontSize: 10.5, lineHeight: 1.4 }}>
                  <span className={`badge ${w.severity === 'high' ? 'dn' : w.severity === 'medium' ? 'warn' : 'info'}`} style={{ marginRight: 6 }}>
                    {w.severity.toUpperCase()}
                  </span>
                  <strong>{w.title}:</strong> <span style={{ color: 'var(--txt2)' }}>{w.detail}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              6b. Реестр проверяемых источников и меток времени
            </strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {sources.map((s) => (
                <div key={s.id} className="macro-row" style={{ padding: '2px 0' }}>
                  <span style={{ fontSize: 10.5 }}>
                    <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>
                      {s.label} ↗
                    </a>
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--txt2)', whiteSpace: 'nowrap' }}>
                    {s.asOf} · {s.verificationStatus}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
