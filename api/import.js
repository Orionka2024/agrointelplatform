import { allowRequest } from '../server/access.js';
import { importAnnualCSV, ANNUAL_TEMPLATE } from '../shared/planning.js';
/**
 * Vercel Serverless Function & Local Dev Handler: /api/import
 * Validates, de-duplicates and imports transactions/offers or indicators.
 */
import { store } from '../server/store.js';
import { importPriceCSV, importIndicatorCSV, PRICE_CSV_TEMPLATE } from '../shared/observations.js';
import { todayISO } from '../shared/dates.js';

const INDICATOR_CSV_TEMPLATE = [
  'observation_date,retrieved_date,indicator,value,unit,region,storage_type,crop_year,cause,source,source_ref,notes,published_date,verification_status,verified_by,verified_at',
  '# пример: 2026-09-15,2026-09-16,harvest_progress_pct,45,%,Волгоградская обл.,,2026,,Комитет с/х Волгоградской обл.,сводка-15,,',
].join('\n');

export default async function handler(req, res) {
  if (!allowRequest(req, res, {costly: false})) return;

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const templateType = url.searchParams.get('template') || 'prices';
    return res.status(200).json({
      annualTemplate: ANNUAL_TEMPLATE,
      priceTemplate: PRICE_CSV_TEMPLATE,
      indicatorTemplate: INDICATOR_CSV_TEMPLATE,
      requestedTemplate: templateType === 'annual' ? ANNUAL_TEMPLATE : templateType === 'indicators' ? INDICATOR_CSV_TEMPLATE : PRICE_CSV_TEMPLATE,
      counts: {
        prices: store.getObservations().length,
        indicators: store.getIndicators().length,
      },
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'POST is required for data import' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const type = body?.type || 'prices';
  const csvContent = body?.csv;
  const importDate = todayISO();

  if (!csvContent || typeof csvContent !== 'string' || !csvContent.trim()) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Поле csv обязательно (содержимое CSV-файла в виде строки)' });
  }

  if (csvContent.length > 2_000_000) return res.status(413).json({message:'CSV превышает 2 MB'});
  try {
    if (type === 'annual') {
      const report = importAnnualCSV(csvContent, store.getAnnual(), {today: importDate});
      if (report.accepted.length) store.appendAnnual(report.accepted);
      return res.status(200).json({success: report.accepted.length > 0, type, report});
    } else if (type === 'prices') {
      const existing = store.getObservations();
      const report = importPriceCSV(csvContent, existing, { importDate, today: importDate });
      if (report.accepted.length > 0) {
        store.appendObservations(report.accepted);
      }
      return res.status(200).json({
        success: report.accepted.length > 0,
        type: 'prices',
        report,
        totalStored: store.getObservations().length,
      });
    } else if (type === 'indicators') {
      const existing = store.getIndicators();
      const report = importIndicatorCSV(csvContent, existing, { importDate, today: importDate });
      if (report.accepted.length > 0) {
        store.appendIndicators(report.accepted);
      }
      return res.status(200).json({
        success: report.accepted.length > 0,
        type: 'indicators',
        report,
        totalStored: store.getIndicators().length,
      });
    } else {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Неизвестный тип импорта: допустимо "prices" или "indicators"' });
    }
  } catch (err) {
    console.error('[api/import] Error:', err);
    return res.status(500).json({ error: 'IMPORT_FAILED', message: err.message });
  }
}
