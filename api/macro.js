import { allowRequest } from '../server/access.js';
/**
 * Vercel Serverless Function & Local Dev Handler: /api/macro
 * Fetches live macro data from Central Bank of Russia (cbr.ru).
 * Handles partial failures honestly without masking missing fields as live.
 */
import { store } from '../server/store.js';

export default async function handler(req, res) {
  if (!allowRequest(req, res, {costly: true})) return;

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

  // 2. Fetch key rate from CBR SOAP DailyInfo.asmx (with HTML fallback)
  let krAsOf = null;
  try {
    const fromIso = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const toIso = now.slice(0, 10);
    const soap = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><KeyRate xmlns="http://web.cbr.ru/"><fromDate>${fromIso}T00:00:00</fromDate><ToDate>${toIso}T00:00:00</ToDate></KeyRate></soap:Body></soap:Envelope>`;
    const krRes = await fetch('https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://web.cbr.ru/KeyRate' },
      body: soap,
      signal: AbortSignal.timeout(6000),
    });
    if (krRes.ok) {
      const krXml = await krRes.text();
      const rows = [...krXml.matchAll(/<KR[^>]*>\s*<DT>(\d{4}-\d{2}-\d{2})[^<]*<\/DT>\s*<Rate>([\d.]+)<\/Rate>\s*<\/KR>/g)];
      if (rows.length) {
        rows.sort((a, b) => a[1].localeCompare(b[1]));
        krAsOf = rows.at(-1)[1];
        keyRate = parseFloat(rows.at(-1)[2]);
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
    keyRate: keyRate !== null ? { value: keyRate, asOf: krAsOf || now.slice(0, 10), fetchedAt: now, source: 'cbr.ru' } : cached?.keyRate ?? null,
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
      asOf: krAsOf || now.slice(0, 10),
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
