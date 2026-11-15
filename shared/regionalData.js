/**
 * Regional producer prices (EMISS/Rosstat OKPD2 01.13.43.110) & HS 070310 onion imports.
 * Provides schema validation, CSV parsing fallback, and reference series layers.
 */
import regionalHistoryJson from '../data/regional-history.json' with { type: 'json' };
import importsHs070310Json from '../data/imports-hs070310.json' with { type: 'json' };

export const SUPPORTED_REGIONS = [
  'Волгоградская область',
  'Астраханская область',
  'Ростовская область',
];

export const SUPPORTED_IMPORT_PARTNERS = [
  'Казахстан',
  'Узбекистан',
  'Египет',
  'Таджикистан',
  'Китай',
];

/**
 * Validates regional producer price series schema.
 * Must include schema=1, valid indicator, and non-empty valid month series for supported regions.
 */
export function validateRegionalSeriesSchema(data, { throwOnError = false } = {}) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    errors.push('Regional data must be a non-null object');
  } else {
    if (data.schema !== 1) errors.push('schema must equal 1');
    if (!data.indicator) errors.push('indicator is required (e.g. 31448)');
    if (!data.series || typeof data.series !== 'object') {
      errors.push('series map is required');
    } else {
      for (const [regionKey, rows] of Object.entries(data.series)) {
        if (!Array.isArray(rows) || rows.length === 0) {
          errors.push(`series.${regionKey} must be a non-empty array`);
          continue;
        }
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.period || '')) {
            errors.push(`series.${regionKey}[${i}]: period must be YYYY-MM format`);
          }
          if (!Number.isFinite(r.value) || r.value <= 0) {
            errors.push(`series.${regionKey}[${i}]: value must be a positive number`);
          }
        }
      }
    }
  }

  const valid = errors.length === 0;
  if (!valid && throwOnError) {
    const err = new Error(`REGIONAL_SCHEMA_ERROR: ${errors.join('; ')}`);
    err.code = 'REGIONAL_SCHEMA_ERROR';
    err.validationErrors = errors;
    throw err;
  }
  return { valid, errors };
}

/**
 * Validates HS 070310 import trade volume & value schema.
 */
export function validateImportsHs070310Schema(data, { throwOnError = false } = {}) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    errors.push('Imports data must be a non-null object');
  } else {
    if (data.schema !== 1) errors.push('schema must equal 1');
    if (data.hsCode !== '070310') errors.push('hsCode must be 070310');
    if (!Array.isArray(data.monthly) || data.monthly.length === 0) {
      errors.push('monthly array must be a non-empty array of records');
    } else {
      for (let i = 0; i < data.monthly.length; i++) {
        const r = data.monthly[i];
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.period || '')) {
          errors.push(`monthly[${i}]: period must be YYYY-MM format`);
        }
        if (!r.partner || typeof r.partner !== 'string') {
          errors.push(`monthly[${i}]: partner country is required`);
        }
        if (!Number.isFinite(r.netWeightTons) || r.netWeightTons < 0) {
          errors.push(`monthly[${i}]: netWeightTons must be >= 0`);
        }
        if (!Number.isFinite(r.cifValueUsd) || r.cifValueUsd < 0) {
          errors.push(`monthly[${i}]: cifValueUsd must be >= 0`);
        }
      }
    }
  }

  const valid = errors.length === 0;
  if (!valid && throwOnError) {
    const err = new Error(`IMPORTS_SCHEMA_ERROR: ${errors.join('; ')}`);
    err.code = 'IMPORTS_SCHEMA_ERROR';
    err.validationErrors = errors;
    throw err;
  }
  return { valid, errors };
}

/**
 * Parses CSV regional producer prices fallback.
 */
export function parseRegionalCsv(csvText, { region = 'Волгоградская область' } = {}) {
  if (!csvText || typeof csvText !== 'string') return [];
  const lines = csvText.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(/[,;]/).map((h) => h.trim().toLowerCase());
  const periodIdx = headers.findIndex((h) => ['period', 'month', 'месяц', 'дата'].includes(h));
  const priceIdx = headers.findIndex((h) => ['price', 'value', 'цена', 'руб/кг'].includes(h));
  const dateIdx = headers.findIndex((h) => ['availabledate', 'available_date', 'дата_публикации'].includes(h));

  if (periodIdx === -1 || priceIdx === -1) {
    throw new Error('CSV must contain period and price columns');
  }

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/[,;]/).map((p) => p.trim());
    if (parts.length <= Math.max(periodIdx, priceIdx)) continue;
    const period = parts[periodIdx];
    const val = Number(parts[priceIdx].replace(',', '.'));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !Number.isFinite(val) || val <= 0) continue;

    results.push({
      period,
      region,
      unit: 'RUB/kg',
      value: val,
      availableDate: dateIdx !== -1 && parts[dateIdx] ? parts[dateIdx] : `${period}-25`,
      sourceId: 'csv_upload',
    });
  }
  return results;
}

/**
 * Parses CSV HS 070310 imports fallback.
 */
export function parseImportsCsv(csvText) {
  if (!csvText || typeof csvText !== 'string') return [];
  const lines = csvText.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(/[,;]/).map((h) => h.trim().toLowerCase());
  const periodIdx = headers.findIndex((h) => ['period', 'month', 'месяц'].includes(h));
  const partnerIdx = headers.findIndex((h) => ['partner', 'country', 'страна'].includes(h));
  const tonsIdx = headers.findIndex((h) => ['netweighttons', 'tons', 'тонн', 'вес_тонн'].includes(h));
  const usdIdx = headers.findIndex((h) => ['cifvalueusd', 'usd', 'долл', 'стоимость_usd'].includes(h));

  if (periodIdx === -1 || tonsIdx === -1) {
    throw new Error('CSV must contain period and tons columns');
  }

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/[,;]/).map((p) => p.trim());
    if (parts.length <= Math.max(periodIdx, tonsIdx)) continue;
    const period = parts[periodIdx];
    const partner = partnerIdx !== -1 && parts[partnerIdx] ? parts[partnerIdx] : 'Казахстан';
    const tons = Number(parts[tonsIdx].replace(',', '.'));
    const usd = usdIdx !== -1 && parts[usdIdx] ? Number(parts[usdIdx].replace(',', '.')) : 0;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !Number.isFinite(tons) || tons < 0) continue;

    results.push({
      period,
      partner,
      netWeightTons: tons,
      cifValueUsd: Number.isFinite(usd) ? usd : 0,
      rubPerKgEquivalent: tons > 0 && usd > 0 ? +((usd * 90) / (tons * 1000)).toFixed(2) : null,
      availableDate: `${period}-28`,
      sourceId: 'csv_upload',
    });
  }
  return results;
}

export function loadBundledRegionalData() {
  return regionalHistoryJson;
}

export function loadBundledImportsData() {
  return importsHs070310Json;
}
