/**
 * Vercel Serverless Function & Local Dev Handler: /api/macro
 * Fetches live macro data from Central Bank of Russia (cbr.ru).
 * Handles partial failures honestly without masking missing fields as live.
 */
import { store } from '../server/store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const cached = store.getMacroCache();
  const errors = [];
  let usdRub = null;
  let kztRub = null;
  let keyRate = null;
  let cbrDate = null;
  const now = new Date().toISOString();

  // 1. Fetch currency rates from CBR XML
  try {
    const cbrRes = await fetch('https://www.cbr.ru/scripts/XML_daily.asp', {
      headers: { 'Accept': 'application/xml' },
      signal: AbortSignal.timeout(6000),
    });

    if (cbrRes.ok) {
      const xml = await cbrRes.text();
      const usdMatch = xml.match(/<Valute ID="R01235">[\s\S]*?<Value>([\d,]+)<\/Value>/);
      usdRub = usdMatch ? parseFloat(usdMatch[1].replace(',', '.')) : null;

      const kztMatch = xml.match(/<Valute ID="R01335">[\s\S]*?<Nominal>([\d,]+)<\/Nominal>[\s\S]*?<Value>([\d,]+)<\/Value>/);
      kztRub = kztMatch ? parseFloat(kztMatch[2].replace(',', '.')) / parseFloat(kztMatch[1].replace(',', '.')) : null;

      const dateMatch = xml.match(/Date="(\d{2})\.(\d{2})\.(\d{4})"/);
      if (dateMatch) {
        cbrDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
      }
    } else {
      errors.push(`CBR Currency HTTP ${cbrRes.status}`);
    }
  } catch (err) {
    errors.push(`CBR Currency fetch error: ${err.message}`);
  }

  // 2. Fetch key rate from CBR KeyRate page
  try {
    const krRes = await fetch(
      'https://www.cbr.ru/hd_base/KeyRate/?UniDbQuery.Posted=True&UniDbQuery.From=' +
        new Date(Date.now() - 7 * 86400000).toLocaleDateString('ru-RU') +
        '&UniDbQuery.To=' +
        new Date().toLocaleDateString('ru-RU'),
      { signal: AbortSignal.timeout(5000) }
    );
    if (krRes.ok) {
      const krHtml = await krRes.text();
      const krMatch = krHtml.match(/(\d{1,2}[.,]\d{2})\s*<\/td>\s*<\/tr>/);
      if (krMatch) {
        keyRate = parseFloat(krMatch[1].replace(',', '.'));
      }
    } else {
      errors.push(`CBR KeyRate HTTP ${krRes.status}`);
    }
  } catch (err) {
    errors.push(`CBR KeyRate fetch error: ${err.message}`);
  }

  // Update durable cache for whatever succeeded
  const updatedCache = {
    usdRub: usdRub !== null ? { value: usdRub, asOf: cbrDate || now.slice(0, 10), fetchedAt: now, source: 'cbr.ru' } : cached?.usdRub ?? null,
    kztRub: kztRub !== null ? { value: kztRub, asOf: cbrDate || now.slice(0, 10), fetchedAt: now, source: 'cbr.ru' } : cached?.kztRub ?? null,
    keyRate: keyRate !== null ? { value: keyRate, asOf: now.slice(0, 10), fetchedAt: now, source: 'cbr.ru' } : cached?.keyRate ?? null,
    lastAttemptAt: now,
  };
  store.saveMacroCache(updatedCache);

  // Build honest response per series
  const responseData = {
    usdRub: usdRub !== null ? {
      value: usdRub,
      status: 'live',
      asOf: cbrDate || now.slice(0, 10),
      source: 'cbr.ru',
      fetchedAt: now,
    } : updatedCache.usdRub ? {
      value: updatedCache.usdRub.value,
      status: 'cached',
      asOf: updatedCache.usdRub.asOf,
      source: 'cbr.ru (кэш)',
      fetchedAt: updatedCache.usdRub.fetchedAt,
    } : {
      value: null,
      status: 'unavailable',
      asOf: null,
      source: null,
    },

    kztRub: kztRub !== null ? {
      value: kztRub,
      status: 'live',
      asOf: cbrDate || now.slice(0, 10),
      source: 'cbr.ru',
      fetchedAt: now,
    } : updatedCache.kztRub ? {
      value: updatedCache.kztRub.value,
      status: 'cached',
      asOf: updatedCache.kztRub.asOf,
      source: 'cbr.ru (кэш)',
      fetchedAt: updatedCache.kztRub.fetchedAt,
    } : {
      value: null,
      status: 'unavailable',
      asOf: null,
      source: null,
    },

    keyRate: keyRate !== null ? {
      value: keyRate,
      status: 'live',
      asOf: now.slice(0, 10),
      source: 'cbr.ru',
      fetchedAt: now,
    } : updatedCache.keyRate ? {
      value: updatedCache.keyRate.value,
      status: 'cached',
      asOf: updatedCache.keyRate.asOf,
      source: 'cbr.ru (кэш)',
      fetchedAt: updatedCache.keyRate.fetchedAt,
    } : {
      value: null,
      status: 'unavailable',
      asOf: null,
      source: null,
    },

    errors: errors.length > 0 ? errors : null,
    serverTime: now,
  };

  res.status(200).json(responseData);
}
