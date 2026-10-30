/** Collect real Bank of Russia history used as forecast drivers: USD/RUB (official daily rate)
 * and the key rate. Raw responses are kept by SHA-256; monthly values are derived without
 * interpolation. A monthly value is only "available" from the first day after that month ends.
 * Usage: node scripts/collect_cbr.mjs [YYYY-MM-DD]   (default: today)
 */
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const root = new URL('../', import.meta.url);
const today = process.argv[2] || new Date().toISOString().slice(0, 10);
const FROM = '2020-01-01';
const sha = b => createHash('sha256').update(b).digest('hex');
const ru = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const rawDir = new URL('data/sources/cbr/', root);
fs.mkdirSync(rawDir, {recursive: true});

async function get(url, init) {
  const r = await fetch(url, {...init, signal: AbortSignal.timeout(60000)});
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
function keep(name, buf) {
  const digest = sha(buf), file = `${digest.slice(0, 16)}-${name}`;
  const path = new URL(file, rawDir);
  if (!fs.existsSync(path)) fs.writeFileSync(path, buf);
  return {sha256: digest, file: 'data/sources/cbr/' + file};
}
function lastDayOfMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function nextDay(iso) { return new Date(Date.parse(iso) + 864e5).toISOString().slice(0, 10); }

// USD/RUB daily
const usdUrl = `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${ru(FROM)}&date_req2=${ru(today)}&VAL_NM_RQ=R01235`;
const usdBuf = await get(usdUrl);
const usdSrc = {url: usdUrl, retrievedDate: today, ...keep('usd_rub.xml', usdBuf)};
const usdDaily = [...usdBuf.toString('latin1').matchAll(/<Record Date="(\d\d)\.(\d\d)\.(\d{4})"[^>]*>\s*<Nominal>(\d+)<\/Nominal>\s*<Value>([\d,]+)<\/Value>/g)]
  .map(m => ({date: `${m[3]}-${m[2]}-${m[1]}`, value: Number(m[5].replace(',', '.')) / Number(m[4])}));
if (usdDaily.length < 500) throw new Error('USD/RUB history too short: ' + usdDaily.length);

// Key rate (SOAP, official)
const keyUrl = 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx';
const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><KeyRate xmlns="http://web.cbr.ru/"><fromDate>${FROM}T00:00:00</fromDate><ToDate>${today}T00:00:00</ToDate></KeyRate></soap:Body></soap:Envelope>`;
const keyBuf = await get(keyUrl, {method: 'POST', headers: {'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://web.cbr.ru/KeyRate'}, body});
const keySrc = {url: keyUrl + ' (KeyRate)', retrievedDate: today, ...keep('key_rate.xml', keyBuf)};
const keyDaily = [...keyBuf.toString('utf8').matchAll(/<KR[^>]*>\s*<DT>(\d{4}-\d{2}-\d{2})T[^<]*<\/DT>\s*<Rate>([\d.]+)<\/Rate>\s*<\/KR>/g)]
  .map(m => ({date: m[1], value: Number(m[2])})).sort((a, b) => a.date.localeCompare(b.date));
if (keyDaily.length < 500) throw new Error('Key rate history too short: ' + keyDaily.length);

function monthly(daily, how) {
  const by = new Map();
  for (const r of daily) { const p = r.date.slice(0, 7); if (!by.has(p)) by.set(p, []); by.get(p).push(r); }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([p]) => lastDayOfMonth(p) < today) // only complete months
    .map(([period, rows]) => ({
      period, n: rows.length,
      value: how === 'mean' ? rows.reduce((s, r) => s + r.value, 0) / rows.length : rows.at(-1).value,
      availableDate: nextDay(lastDayOfMonth(period)),
    }));
}
const out = {
  schema: 1, collectedAt: today,
  note: 'Official Bank of Russia series. Monthly USD/RUB = mean of daily official rates; key rate = level at last quoted day of month. Complete months only; no interpolation.',
  sources: {usdRub: usdSrc, keyRate: keySrc},
  usdRub: monthly(usdDaily, 'mean'),
  keyRate: monthly(keyDaily, 'last'),
};
fs.writeFileSync(new URL('data/official-drivers.json', root), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({usdMonths: out.usdRub.length, keyMonths: out.keyRate.length,
  usdLast: out.usdRub.at(-1), keyLast: out.keyRate.at(-1)}, null, 2));
