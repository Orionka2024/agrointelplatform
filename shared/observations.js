/**
 * Observation schema, validation and normalisation.
 *
 * Price observations distinguish completed transactions, buyer bids, seller asking prices and
 * published indices. Each record keeps source, observation date, retrieval date, geography,
 * specification, units and tax/delivery basis. Nothing is inferred silently: unknown values stay
 * unknown and are flagged.
 */
import { parseCSV, parseNumber } from './csv.js';
import { parseISODate, isISODate, daysBetween, addDays } from './dates.js';
import { KINDS, MARKETS, DEFAULT_VAT_RATE } from './spec.js';

export const UNIT_FACTORS_TO_RUB_KG = {
  'RUB/kg': 1,
  'RUB/t': 1 / 1000,
  'RUB/100kg': 1 / 100,
};
export const VAT_VALUES = ['incl', 'excl', 'unknown'];
export const DELIVERY_BASES = ['EXW', 'FCA', 'DAP', 'DDP', 'unknown'];

// Plausibility corridor for onion, RUB/kg ex-VAT. Catches RUB/t vs RUB/kg mix-ups. Not a market view.
export const PLAUSIBLE_RUB_KG = { min: 1, max: 300 };
export const STALE_AT_RETRIEVAL_DAYS = 90;

/** Deterministic 32-bit FNV-1a hash → 8 hex chars (ids / dedupe keys; not cryptographic). */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function clean(s, max = 200) {
  if (s == null) return '';
  return String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

export function exVatPrice(priceRubKg, vat, vatRate) {
  if (vat === 'incl') return priceRubKg / (1 + vatRate);
  if (vat === 'excl') return priceRubKg;
  return null;
}

/**
 * Validate a raw row (strings from CSV or JSON) into a normalised observation.
 * @returns {{ok:boolean, errors:string[], warnings:string[], obs:object|null}}
 */
export function validatePriceRow(raw, { today, importDate } = {}) {
  const errors = [];
  const warnings = [];
  const todayIso = today || importDate;

  const observationDate = clean(raw.observation_date, 10);
  if (!isISODate(observationDate)) errors.push('observation_date: ожидается YYYY-MM-DD');
  else if (todayIso && daysBetween(todayIso, observationDate) > 1) errors.push('observation_date: дата в будущем');

  let retrievedDate = clean(raw.retrieved_date, 10);
  let retrievedDateAssumed = false;
  if (!retrievedDate) {
    retrievedDate = importDate || todayIso || '';
    retrievedDateAssumed = true;
    warnings.push('retrieved_date отсутствует — принята дата импорта');
  } else if (!isISODate(retrievedDate)) errors.push('retrieved_date: ожидается YYYY-MM-DD');
  else if (isISODate(observationDate) && daysBetween(observationDate, retrievedDate) < 0) {
    errors.push('retrieved_date раньше observation_date');
  }

  const kind = clean(raw.kind, 20).toLowerCase();
  if (!KINDS.includes(kind)) errors.push(`kind: допустимо ${KINDS.join('|')}`);

  const market = clean(raw.market, 40).toLowerCase();
  if (!MARKETS.includes(market)) errors.push(`market: допустимо ${MARKETS.join('|')}`);

  const geography = clean(raw.geography, 120);
  if (!geography) errors.push('geography: обязательно (регион / город)');

  const source = clean(raw.source, 120);
  if (!source) errors.push('source: обязательно');

  const priceRaw = parseNumber(raw.price);
  if (priceRaw === null) errors.push('price: ожидается число');
  else if (priceRaw <= 0) errors.push('price: должна быть > 0');

  const unit = clean(raw.unit, 20);
  const factor = UNIT_FACTORS_TO_RUB_KG[unit];
  if (!unit) errors.push('unit: обязательно (RUB/kg | RUB/t | RUB/100kg)');
  else if (factor === undefined) errors.push(`unit: неизвестная единица "${unit}"`);

  const vat = (clean(raw.vat, 10) || 'unknown').toLowerCase();
  if (!VAT_VALUES.includes(vat)) errors.push(`vat: допустимо ${VAT_VALUES.join('|')}`);
  let vatRate = parseNumber(raw.vat_rate);
  if (vat === 'incl' || vat === 'excl') {
    if (vatRate === null) {
      vatRate = DEFAULT_VAT_RATE;
      if (vat === 'incl') warnings.push(`vat_rate не указан — принято ${DEFAULT_VAT_RATE}`);
    } else if (vatRate < 0 || vatRate > 0.3) errors.push('vat_rate: ожидается доля 0..0.3');
  } else {
    vatRate = null;
    warnings.push('налоговый базис неизвестен — запись не попадёт в ряды цен');
  }

  const deliveryBasis = (clean(raw.delivery_basis, 10).toUpperCase() || 'unknown');
  const dbNorm = deliveryBasis === 'UNKNOWN' ? 'unknown' : deliveryBasis;
  if (!DELIVERY_BASES.includes(dbNorm)) errors.push(`delivery_basis: допустимо ${DELIVERY_BASES.join('|')}`);
  if (dbNorm === 'unknown') warnings.push('базис поставки неизвестен — запись не попадёт в ряды цен');

  const volumeT = raw.volume_t === undefined || raw.volume_t === '' ? null : parseNumber(raw.volume_t);
  if (raw.volume_t !== undefined && raw.volume_t !== '' && (volumeT === null || volumeT < 0)) errors.push('volume_t: ожидается число ≥ 0');
  const lotSizeT = raw.lot_size_t === undefined || raw.lot_size_t === '' ? null : parseNumber(raw.lot_size_t);
  if (raw.lot_size_t !== undefined && raw.lot_size_t !== '' && (lotSizeT === null || lotSizeT <= 0)) errors.push('lot_size_t: ожидается число > 0');

  const grade = clean(raw.grade, 60) || null;
  const sizeMm = clean(raw.size_mm, 20) || null;
  const packaging = clean(raw.packaging, 60) || null;
  const paymentTerms = clean(raw.payment_terms, 60) || null;
  if (!grade && !packaging) warnings.push('спецификация (grade/packaging) не указана');

  const publishedDate = clean(raw.published_date, 10);
  if (publishedDate && !isISODate(publishedDate)) errors.push('published_date: ожидается YYYY-MM-DD');
  if (publishedDate && isISODate(publishedDate) && isISODate(observationDate) && daysBetween(observationDate, publishedDate) < 0) {
    errors.push('published_date раньше observation_date');
  }

  let priceRubKg = null;
  let priceExVatRubKg = null;
  if (priceRaw !== null && factor !== undefined) {
    priceRubKg = priceRaw * factor;
    priceExVatRubKg = exVatPrice(priceRubKg, vat, vatRate);
    const check = priceExVatRubKg ?? priceRubKg;
    if (check < PLAUSIBLE_RUB_KG.min || check > PLAUSIBLE_RUB_KG.max) {
      errors.push(`price: ${check.toFixed(2)} RUB/kg вне допустимого коридора ${PLAUSIBLE_RUB_KG.min}–${PLAUSIBLE_RUB_KG.max} (проверьте единицы)`);
    }
  }

  if (isISODate(observationDate) && isISODate(retrievedDate) && daysBetween(observationDate, retrievedDate) > STALE_AT_RETRIEVAL_DAYS) {
    warnings.push(`наблюдение устарело на момент получения (> ${STALE_AT_RETRIEVAL_DAYS} дн.)`);
  }

  if (errors.length) return { ok: false, errors, warnings, obs: null };

  const naturalKey = [market, kind, observationDate, source, clean(raw.source_ref, 200), geography, grade || '', packaging || '', lotSizeT ?? ''].join('|');
  const obs = {
    id: hash32(`${naturalKey}|${priceRubKg.toFixed(4)}`),
    naturalKey: hash32(naturalKey),
    kind, market, geography,
    observationDate, retrievedDate, retrievedDateAssumed,
    publishedDate: publishedDate || null,
    priceRubKg, priceExVatRubKg,
    originalPrice: priceRaw, originalUnit: unit,
    vat, vatRate, deliveryBasis: dbNorm,
    spec: { grade, sizeMm, packaging, lotSizeT, paymentTerms },
    volumeT,
    source, sourceRef: clean(raw.source_ref, 200) || null,
    notes: clean(raw.notes, 300) || null,
    quality: { outlier: false, warnings },
  };
  return { ok: true, errors, warnings, obs };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Flag outliers: price deviates > 6 robust sigmas AND > 40 % from the median of same market+kind
 * observations within ±56 days. Flagged rows are kept (visible) but excluded from series by default.
 * Mutates `quality.outlier` on a copy.
 */
export function flagOutliers(observations) {
  const out = observations.map(o => ({ ...o, quality: { ...o.quality, outlier: false } }));
  const groups = new Map();
  out.forEach(o => {
    const k = `${o.market}|${o.kind}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });
  for (const list of groups.values()) {
    for (const o of list) {
      const near = list.filter(x => x !== o && Math.abs(daysBetween(x.observationDate, o.observationDate)) <= 56);
      if (near.length < 4) continue;
      const vals = near.map(x => x.priceExVatRubKg ?? x.priceRubKg);
      const med = median(vals);
      const mad = median(vals.map(v => Math.abs(v - med))) * 1.4826;
      const v = o.priceExVatRubKg ?? o.priceRubKg;
      const rel = Math.abs(v - med) / med;
      const z = mad > 0 ? Math.abs(v - med) / mad : (rel > 0.4 ? Infinity : 0);
      if (z > 6 && rel > 0.4) o.quality.outlier = true;
    }
  }
  return out;
}

/**
 * Validate and de-duplicate a batch against existing observations.
 * Rows are never fabricated; rejected rows are reported with their line numbers.
 */
export function importPriceCSV(csvText, existing = [], { today, importDate } = {}) {
  const parsed = parseCSV(csvText);
  const report = {
    kind: 'prices', totalRows: parsed.rows.length, accepted: [], rejected: [], duplicates: [],
    conflicts: [], warnings: [], fileErrors: [...parsed.errors], outliers: 0,
  };
  const required = ['observation_date', 'kind', 'market', 'geography', 'source', 'price', 'unit'];
  const missingCols = required.filter(c => !parsed.header.includes(c));
  if (missingCols.length) {
    report.fileErrors.push(`Отсутствуют обязательные колонки: ${missingCols.join(', ')}`);
    return report;
  }
  const seenIds = new Set(existing.map(o => o.id));
  const byNatural = new Map();
  existing.forEach(o => byNatural.set(o.naturalKey, o));
  for (const row of parsed.rows) {
    const r = validatePriceRow(row, { today, importDate });
    if (!r.ok) { report.rejected.push({ line: row.__line, errors: r.errors }); continue; }
    if (seenIds.has(r.obs.id)) { report.duplicates.push({ line: row.__line, id: r.obs.id }); continue; }
    const prev = byNatural.get(r.obs.naturalKey);
    if (prev) {
      report.conflicts.push({ line: row.__line, existingPrice: prev.priceRubKg, newPrice: r.obs.priceRubKg });
      r.obs.quality.warnings.push('конфликт: та же запись с другой ценой');
    }
    seenIds.add(r.obs.id);
    byNatural.set(r.obs.naturalKey, r.obs);
    report.accepted.push(r.obs);
    r.warnings.forEach(w => report.warnings.push({ line: row.__line, warning: w }));
  }
  // outliers considered against the existing store as well
  const flagged = flagOutliers([...existing, ...report.accepted]);
  const acceptedIds = new Set(report.accepted.map(o => o.id));
  report.accepted = flagged.filter(o => acceptedIds.has(o.id));
  report.outliers = report.accepted.filter(o => o.quality.outlier).length;
  return report;
}

// ───────────────────────── indicators (non-price evidence) ─────────────────────────

export const INDICATORS = {
  harvest_progress_pct: { unit: '%', label: 'Ход уборки', min: 0, max: 100 },
  field_sales_volume_t: { unit: 't', label: 'Продажи с поля', min: 0 },
  temp_storage_stock_t: { unit: 't', label: 'Запасы во временных/неприспособленных хранилищах', min: 0 },
  quality_loss_share_pct: { unit: '%', label: 'Доля партий с потерей качества (гниль, влага, проращивание, подмерзание)', min: 0, max: 100 },
  long_term_release_t: { unit: 't', label: 'Отгрузки из долгосрочного хранения', min: 0 },
  import_arrivals_t: { unit: 't', label: 'Поступления импорта', min: 0 },
  newcrop_arrivals_t: { unit: 't', label: 'Поступления нового урожая', min: 0 },
  inventory_t: { unit: 't', label: 'Запасы (остатки)', min: 0 },
  dispatches_t: { unit: 't', label: 'Отгрузки (диспетчеризация)', min: 0 },
  crop_size_t: { unit: 't', label: 'Валовой сбор', min: 0 },
  freight_rub_per_truck: { unit: 'RUB', label: 'Ставка фуры', min: 0 },
};
export const QUALITY_CAUSES = ['rot', 'moisture', 'sprouting', 'frost', 'mixed', 'unspecified'];

export function validateIndicatorRow(raw, { today, importDate } = {}) {
  const errors = [];
  const todayIso = today || importDate;
  const observationDate = clean(raw.observation_date, 10);
  if (!isISODate(observationDate)) errors.push('observation_date: ожидается YYYY-MM-DD');
  else if (todayIso && daysBetween(todayIso, observationDate) > 1) errors.push('observation_date: дата в будущем');
  let retrievedDate = clean(raw.retrieved_date, 10);
  if (!retrievedDate) retrievedDate = importDate || todayIso || '';
  else if (!isISODate(retrievedDate)) errors.push('retrieved_date: ожидается YYYY-MM-DD');
  const indicator = clean(raw.indicator, 40);
  const def = INDICATORS[indicator];
  if (!def) errors.push(`indicator: допустимо ${Object.keys(INDICATORS).join('|')}`);
  const value = parseNumber(raw.value);
  if (value === null) errors.push('value: ожидается число');
  else if (def && ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max))) errors.push(`value: вне диапазона для ${indicator}`);
  const unit = clean(raw.unit, 20);
  if (def && unit !== def.unit) errors.push(`unit: для ${indicator} ожидается "${def.unit}"`);
  const region = clean(raw.region, 80);
  if (!region) errors.push('region: обязательно');
  const source = clean(raw.source, 120);
  if (!source) errors.push('source: обязательно');
  const cause = clean(raw.cause, 20).toLowerCase() || null;
  if (cause && !QUALITY_CAUSES.includes(cause)) errors.push(`cause: допустимо ${QUALITY_CAUSES.join('|')}`);
  if (errors.length) return { ok: false, errors, warnings: [], obs: null };
  const key = [indicator, observationDate, region, clean(raw.storage_type, 40), clean(raw.crop_year, 9), source, clean(raw.source_ref, 200)].join('|');
  return {
    ok: true, errors, warnings: [],
    obs: {
      id: hash32(`${key}|${value}`), naturalKey: hash32(key),
      indicator, value, unit, region,
      cropYear: clean(raw.crop_year, 9) || null,
      storageType: clean(raw.storage_type, 40) || null,
      cause,
      observationDate, retrievedDate,
      source, sourceRef: clean(raw.source_ref, 200) || null,
      notes: clean(raw.notes, 300) || null,
    },
  };
}

export function importIndicatorCSV(csvText, existing = [], { today, importDate } = {}) {
  const parsed = parseCSV(csvText);
  const report = { kind: 'indicators', totalRows: parsed.rows.length, accepted: [], rejected: [], duplicates: [], conflicts: [], warnings: [], fileErrors: [...parsed.errors], outliers: 0 };
  const required = ['observation_date', 'indicator', 'value', 'unit', 'region', 'source'];
  const missing = required.filter(c => !parsed.header.includes(c));
  if (missing.length) { report.fileErrors.push(`Отсутствуют обязательные колонки: ${missing.join(', ')}`); return report; }
  const seen = new Set(existing.map(o => o.id));
  for (const row of parsed.rows) {
    const r = validateIndicatorRow(row, { today, importDate });
    if (!r.ok) { report.rejected.push({ line: row.__line, errors: r.errors }); continue; }
    if (seen.has(r.obs.id)) { report.duplicates.push({ line: row.__line, id: r.obs.id }); continue; }
    seen.add(r.obs.id);
    report.accepted.push(r.obs);
  }
  return report;
}

export function availableDate(obs, publishLagDays = 0) {
  return obs.publishedDate || addDays(obs.observationDate, publishLagDays);
}

export const PRICE_CSV_TEMPLATE = [
  'observation_date,retrieved_date,kind,market,geography,price,unit,vat,vat_rate,delivery_basis,grade,size_mm,packaging,lot_size_t,payment_terms,volume_t,source,source_ref,published_date,notes',
  '# пример (не данные!): 2026-01-12,2026-01-13,transaction,warehouse_volgograd,"Волгоградская обл., Городищенский р-н",18.5,RUB/kg,excl,0.10,EXW,1-й сорт,50-70,навалом,20,предоплата,20,ИМЯ_ИСТОЧНИКА,идентификатор_сделки,,',
].join('\n');
export { parseISODate };
