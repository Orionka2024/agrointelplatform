/** Collect real Bank of Russia & Open-Meteo ERA5 agro-climatic history used as forecast drivers:
 *   - USD/RUB & KZT/RUB (official Bank of Russia daily rates, R01235 & R01335)
 *   - Bank of Russia Key Rate (SOAP DailyInfo.asmx KeyRate)
 *   - Historical daily weather (ERA5 archive) for Volgograd (48.71N, 44.51E) and
 *     Taraz/Zhambyl Kazakhstan (42.90N, 71.37E — primary onion import origin)
 * Raw responses are kept by SHA-256; monthly values are derived without interpolation.
 * CBR monthly values are available on the 1st day after month end; ERA5 monthly summaries use a
 * conservative 5-day consolidation lag after month end.
 * Usage: node scripts/collect_cbr.mjs [YYYY-MM-DD]   (default: today)
 */
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const root = new URL('../', import.meta.url);
const today = process.argv[2] || new Date().toISOString().slice(0, 10);
const FROM = '2020-01-01';
const sha = b => createHash('sha256').update(b).digest('hex');
const ru = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const cbrDir = new URL('data/sources/cbr/', root);
const wxDir = new URL('data/sources/weather/', root);
fs.mkdirSync(cbrDir, {recursive: true});
fs.mkdirSync(wxDir, {recursive: true});

async function get(url, init) {
  const r = await fetch(url, {...init, signal: AbortSignal.timeout(60000)});
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
function keep(dir, relPrefix, name, buf) {
  const digest = sha(buf), file = `${digest.slice(0, 16)}-${name}`;
  const path = new URL(file, dir);
  if (!fs.existsSync(path)) fs.writeFileSync(path, buf);
  return {sha256: digest, file: relPrefix + file};
}
function lastDayOfMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function addDaysIso(iso, d) { return new Date(Date.parse(iso) + d * 864e5).toISOString().slice(0, 10); }

function parseCbrXml(buf) {
  return [...buf.toString('latin1').matchAll(/<Record Date="(\d\d)\.(\d\d)\.(\d{4})"[^>]*>\s*<Nominal>(\d+)<\/Nominal>\s*<Value>([\d,]+)<\/Value>/g)]
    .map(m => ({date: `${m[3]}-${m[2]}-${m[1]}`, value: Number(m[5].replace(',', '.')) / Number(m[4])}));
}

// 1. USD/RUB daily
const usdUrl = `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${ru(FROM)}&date_req2=${ru(today)}&VAL_NM_RQ=R01235`;
const usdBuf = await get(usdUrl);
const usdSrc = {url: usdUrl, retrievedDate: today, ...keep(cbrDir, 'data/sources/cbr/', 'usd_rub.xml', usdBuf)};
const usdDaily = parseCbrXml(usdBuf);
if (usdDaily.length < 500) throw new Error('USD/RUB history too short: ' + usdDaily.length);

// 2. KZT/RUB daily (Kazakhstan tenge — #1 onion exporter currency)
const kztUrl = `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${ru(FROM)}&date_req2=${ru(today)}&VAL_NM_RQ=R01335`;
const kztBuf = await get(kztUrl);
const kztSrc = {url: kztUrl, retrievedDate: today, ...keep(cbrDir, 'data/sources/cbr/', 'kzt_rub.xml', kztBuf)};
const kztDaily = parseCbrXml(kztBuf);
if (kztDaily.length < 500) throw new Error('KZT/RUB history too short: ' + kztDaily.length);

// 3. Key rate (SOAP, official)
const keyUrl = 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx';
const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><KeyRate xmlns="http://web.cbr.ru/"><fromDate>${FROM}T00:00:00</fromDate><ToDate>${today}T00:00:00</ToDate></KeyRate></soap:Body></soap:Envelope>`;
const keyBuf = await get(keyUrl, {method: 'POST', headers: {'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://web.cbr.ru/KeyRate'}, body});
const keySrc = {url: keyUrl + ' (KeyRate)', retrievedDate: today, ...keep(cbrDir, 'data/sources/cbr/', 'key_rate.xml', keyBuf)};
const keyDaily = [...keyBuf.toString('utf8').matchAll(/<KR[^>]*>\s*<DT>(\d{4}-\d{2}-\d{2})T[^<]*<\/DT>\s*<Rate>([\d.]+)<\/Rate>\s*<\/KR>/g)]
  .map(m => ({date: m[1], value: Number(m[2])})).sort((a, b) => a.date.localeCompare(b.date));
if (keyDaily.length < 500) throw new Error('Key rate history too short: ' + keyDaily.length);

// 4. Historical ERA5 weather through last complete month
const lastCompleteEnd = lastDayOfMonth(addDaysIso(today.slice(0, 7) + '-01', -1).slice(0, 7));
async function fetchWeather(name, lat, lon) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${FROM}&end_date=${lastCompleteEnd}&daily=temperature_2m_mean,temperature_2m_min,precipitation_sum&timezone=UTC`;
  const buf = await get(url);
  const src = {url, retrievedDate: today, ...keep(wxDir, 'data/sources/weather/', `${name}.json`, buf)};
  const j = JSON.parse(buf.toString('utf8'));
  const t = j.daily.time, tMean = j.daily.temperature_2m_mean, tMin = j.daily.temperature_2m_min, pr = j.daily.precipitation_sum;
  const by = new Map();
  for (let i = 0; i < t.length; i++) {
    if (tMean[i] == null || tMin[i] == null || pr[i] == null) continue;
    const p = t[i].slice(0, 7);
    if (!by.has(p)) by.set(p, []);
    by.get(p).push({tMean: tMean[i], tMin: tMin[i], pr: pr[i]});
  }
  const rows = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([p, d]) => lastDayOfMonth(p) <= lastCompleteEnd && d.length >= 28)
    .map(([period, d]) => ({
      period,
      n: d.length,
      tempMeanC: +(d.reduce((s, r) => s + r.tMean, 0) / d.length).toFixed(2),
      tempMinC: +Math.min(...d.map(r => r.tMin)).toFixed(2),
      frostDays12C: d.filter(r => r.tMin <= -12).length,
      precipMm: +d.reduce((s, r) => s + r.pr, 0).toFixed(1),
      availableDate: addDaysIso(lastDayOfMonth(period), 6), // 5-day ERA5 consolidation lag
    }));
  if (rows.length < 75) throw new Error(`Weather history too short for ${name}: ${rows.length}`);
  return {src, rows};
}

const vlg = await fetchWeather('volgograd_era5', 48.71, 44.51);
const zhm = await fetchWeather('zhambyl_taraz_era5', 42.90, 71.37);

function monthly(daily, how) {
  const by = new Map();
  for (const r of daily) { const p = r.date.slice(0, 7); if (!by.has(p)) by.set(p, []); by.get(p).push(r); }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([p]) => lastDayOfMonth(p) < today)
    .map(([period, rows]) => ({
      period, n: rows.length,
      value: how === 'mean' ? rows.reduce((s, r) => s + r.value, 0) / rows.length : rows.at(-1).value,
      availableDate: addDaysIso(lastDayOfMonth(period), 1),
    }));
}

const out = {
  schema: 2, collectedAt: today,
  note: 'Official Bank of Russia (USD/RUB, KZT/RUB, KeyRate) and Open-Meteo ERA5 (Volgograd & Zhambyl/Taraz onion belt) monthly series. Complete months only; no interpolation.',
  sources: {
    usdRub: usdSrc,
    kztRub: kztSrc,
    keyRate: keySrc,
    volgogradWeather: vlg.src,
    zhambylWeather: zhm.src,
  },
  usdRub: monthly(usdDaily, 'mean'),
  kztRub: monthly(kztDaily, 'mean'),
  keyRate: monthly(keyDaily, 'last'),
  weather: {
    volgograd: vlg.rows,
    zhambyl: zhm.rows,
  },
};
fs.writeFileSync(new URL('data/official-drivers.json', root), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({
  usdMonths: out.usdRub.length,
  kztMonths: out.kztRub.length,
  keyMonths: out.keyRate.length,
  vlgMonths: out.weather.volgograd.length,
  zhmMonths: out.weather.zhambyl.length,
  kztLast: out.kztRub.at(-1),
  zhmJan2023: out.weather.zhambyl.find(r => r.period === '2023-01'),
  vlgLast: out.weather.volgograd.at(-1),
}, null, 2));
