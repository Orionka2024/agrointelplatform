import { allowRequest } from '../server/access.js';
import { todayISO } from '../shared/dates.js';
import {
  buildDefaultMarketSignals,
  computeMarketFactorAnalytics,
  parseAgroRuVolgogradHtml,
  parseFoodStarOnionHtml,
} from '../shared/marketSignals.js';

let cachedPayload = null;
let cachedAtMs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

const WEATHER_HUBS_META = [
  { id: 'volgograd', lat: 48.80, lng: 44.47, name: 'Волгоград (Городище)', role: 'Сырьевая база и склады EXW' },
  { id: 'zhambyl', lat: 42.90, lng: 71.37, name: '🇰🇿 Жамбыл / Тараз (КЗ)', role: 'Импорт №1 (48% ввоза РФ)' },
  { id: 'surkhandarya', lat: 37.22, lng: 67.28, name: '🇺🇿 Сурхандарья / Термез (УЗ)', role: 'Ранний лук (апрельский потолок)' },
  { id: 'moscow', lat: 55.60, lng: 37.47, name: 'Москва (Фуд Сити / РЦ)', role: 'Крупный опт и приёмка сетей' },
];

function parseCbrValute(xml, valuteId) {
  const re = new RegExp(`<Valute ID="${valuteId}">[\\s\\S]*?<Nominal>([\\d,]+)<\\/Nominal>[\\s\\S]*?<Value>([\\d,]+)<\\/Value>`);
  const m = xml.match(re);
  if (!m) return null;
  const nom = parseFloat(m[1].replace(',', '.'));
  const val = parseFloat(m[2].replace(',', '.'));
  return nom > 0 && val > 0 ? { nominal: nom, rawValue: val, perUnit: val / nom } : null;
}

function summarizeHubWeather(meta, daily) {
  const mins = (daily?.temperature_2m_min || []).filter(Number.isFinite);
  const maks = (daily?.temperature_2m_max || []).filter(Number.isFinite);
  const precs = (daily?.precipitation_sum || []).filter(Number.isFinite);
  if (!mins.length || !maks.length) return null;

  const minTemp10d = +Math.min(...mins).toFixed(1);
  const maxTemp10d = +Math.max(...maks).toFixed(1);
  const precipMm10d = +precs.reduce((a, b) => a + b, 0).toFixed(1);
  const frostDays = mins.filter((t) => t <= 0).length;

  let summary = 'Штатные погодные условия для хранения и отгрузок';
  if (meta.id === 'volgograd') {
    summary =
      minTemp10d <= -4
        ? `Мороз до ${minTemp10d}°C: ускоренный сброс партий из холодных ангаров, рост затрат на обогрев`
        : minTemp10d <= 0
          ? `Ночные заморозки (${minTemp10d}°C, ${frostDays} дн.): завершение вывоза из временных складов`
          : `Мягкая погода (${minTemp10d}..+${maxTemp10d}°C): спокойный режим вентиляции хранилищ`;
  } else if (meta.id === 'zhambyl') {
    summary =
      minTemp10d <= -8
        ? `Риск подмерзания буртов в Южном Казахстане (${minTemp10d}°C): сжатие транзита в РФ`
        : minTemp10d <= -2
          ? `Похолодание в Таразе до ${minTemp10d}°C: переход отгрузок КЗ на утеплённый автотранспорт`
          : `Тараз ${minTemp10d}..+${maxTemp10d}°C: беспрепятственный осенний транзит лука из Казахстана`;
  } else if (meta.id === 'surkhandarya') {
    summary =
      minTemp10d <= -3
        ? `Заморозки на юге Узбекистана (${minTemp10d}°C): риск задержки весеннего раннего урожая`
        : `Термез +${minTemp10d}..+${maxTemp10d}°C: нормальная вегетация озимого лука под апрельский экспорт`;
  } else if (meta.id === 'moscow') {
    summary =
      minTemp10d <= -10
        ? `Москва до ${minTemp10d}°C: доставка по М-6 только рефрижератором с подогревом (+фрахт)`
        : `Москва ${minTemp10d}..+${maxTemp10d}°C: приёмка РЦ и оптовых баз без морозных простоев`;
  }

  return {
    id: meta.id,
    name: meta.name,
    role: meta.role,
    status: 'live',
    minTemp10d,
    maxTemp10d,
    precipMm10d,
    frostDays,
    daily: {
      time: daily.time?.slice(0, 7) || [],
      max: maks.slice(0, 7),
      min: mins.slice(0, 7),
      precip: precs.slice(0, 7),
      code: (daily.weathercode || []).slice(0, 7),
    },
    summary,
  };
}

export default async function handler(req, res) {
  if (!allowRequest(req, res, { costly: false })) return;

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url || '/api/signals', 'http://localhost');
  const today = url.searchParams.get('today') || todayISO();
  const baseWh = Number(url.searchParams.get('baseWh')) || 15.5;
  const force = url.searchParams.get('force') === '1';
  const offlineOnly = url.searchParams.get('offline') === '1';

  const baseline = buildDefaultMarketSignals(today, baseWh);
  if (offlineOnly) {
    return res.status(200).json(baseline);
  }

  if (!force && cachedPayload && Date.now() - cachedAtMs < CACHE_TTL_MS) {
    const recomputed = {
      ...cachedPayload,
      analytics: computeMarketFactorAnalytics({
        fx: cachedPayload.fx,
        weatherHubs: cachedPayload.weatherHubs,
        spotChannels: cachedPayload.spotChannels,
        baseWarehouseExVat: baseWh,
        today,
      }),
    };
    return res.status(200).json(recomputed);
  }

  const nowIso = new Date().toISOString();
  const fx = structuredClone(baseline.fx);
  const weatherHubs = structuredClone(baseline.weatherHubs);
  const spotChannels = structuredClone(baseline.spotChannels);
  let liveCount = 0;

  const lats = WEATHER_HUBS_META.map((h) => h.lat).join(',');
  const lngs = WEATHER_HUBS_META.map((h) => h.lng).join(',');

  const tasks = await Promise.allSettled([
    // 0: CBR daily currencies (USD, KZT, UZS, CNY)
    fetch('https://www.cbr.ru/scripts/XML_daily.asp', {
      headers: { Accept: 'application/xml' },
      signal: AbortSignal.timeout(4500),
    }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),

    // 1: Open-Meteo 10-day forecast for all 4 hubs
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=Europe/Moscow&forecast_days=10`,
      { signal: AbortSignal.timeout(4500) }
    ).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),

    // 2: AgroRU Volgograd Oblast live board
    fetch('https://agroru.com/doska/luk/rg-243620-p1.htm', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgroIntelMarketRadar/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(4500),
    }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),

    // 3: Food Star Moscow distributor price
    fetch('https://www.food-star.ru/tovar/luk-repchatyy/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgroIntelMarketRadar/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(4500),
    }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),

    // 4: AgroServer Volgograd check (detects CAPTCHA honestly)
    fetch('https://agroserver.ru/luk-repchatyy/volgogradskaya-oblast-f29-p1.htm', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgroIntelMarketRadar/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(3500),
    }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),
  ]);

  // Process 0: CBR FX
  if (tasks[0].status === 'fulfilled') {
    const xml = tasks[0].value;
    const usd = parseCbrValute(xml, 'R01235');
    const kzt = parseCbrValute(xml, 'R01335');
    const uzs = parseCbrValute(xml, 'R01717');
    const cny = parseCbrValute(xml, 'R01375');
    const dm = xml.match(/Date="(\d{2})\.(\d{2})\.(\d{4})"/);
    if (usd) fx.usdRub = { value: +usd.perUnit.toFixed(2), source: 'ЦБ РФ (LIVE)' };
    if (kzt) fx.kztRub = { value: +kzt.perUnit.toFixed(4), source: 'ЦБ РФ (LIVE)' };
    if (uzs) fx.uzsPer10k = { value: +(uzs.perUnit * 10000).toFixed(2), source: 'ЦБ РФ (LIVE)' };
    if (cny) fx.cnyRub = { value: +cny.perUnit.toFixed(2), source: 'ЦБ РФ (LIVE)' };
    if (usd || kzt) {
      fx.status = 'live';
      fx.asOf = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : today;
      liveCount++;
    }
  }

  // Process 1: Open-Meteo 4 hubs
  if (tasks[1].status === 'fulfilled' && Array.isArray(tasks[1].value)) {
    tasks[1].value.forEach((hubJson, idx) => {
      const meta = WEATHER_HUBS_META[idx];
      if (!meta || !hubJson?.daily) return;
      const summary = summarizeHubWeather(meta, hubJson.daily);
      if (summary) weatherHubs[meta.id] = summary;
    });
    liveCount++;
  }

  // Process 2: AgroRU Volgograd live offers
  if (tasks[2].status === 'fulfilled') {
    const parsed = parseAgroRuVolgogradHtml(tasks[2].value, {
      referenceYear: Number(today.slice(0, 4)) || 2026,
      minMonth: 8,
    });
    if (parsed.acceptedCount > 0 && parsed.medianExVat) {
      const idx = spotChannels.findIndex((c) => c.id === 'agroru_vlg');
      if (idx >= 0) {
        const lo = parsed.p25ExVat ?? parsed.medianExVat;
        const hi = parsed.p75ExVat ?? parsed.medianExVat;
        spotChannels[idx] = {
          ...spotChannels[idx],
          priceExVat: parsed.medianExVat,
          corridorText: `${lo.toFixed(2)}–${hi.toFixed(2)} ₽ без НДС (${parsed.acceptedCount} свежих из ${parsed.totalScanned})`,
          offersCount: parsed.acceptedCount,
          liveOffers: parsed.offers,
          status: 'live',
          statusLabel: `LIVE · ${parsed.acceptedCount} оферт`,
          note: `Отфильтровано некондиции/архивов: ${parsed.rejectedCount} из ${parsed.totalScanned}`,
        };
        liveCount++;
      }
    }
  }

  // Process 3: Food Star Moscow live distributor price
  if (tasks[3].status === 'fulfilled') {
    const fsParsed = parseFoodStarOnionHtml(tasks[3].value);
    if (fsParsed?.price) {
      const idx = spotChannels.findIndex((c) => c.id === 'foodstar_msk');
      if (idx >= 0) {
        spotChannels[idx] = {
          ...spotChannels[idx],
          quotedPrice: fsParsed.price,
          priceExVat: +(fsParsed.price / 1.1).toFixed(2),
          corridorText: `${fsParsed.price.toFixed(2)} ₽/кг с доставкой HoReCa`,
          status: 'live',
          statusLabel: fsParsed.asOf ? `LIVE · ${fsParsed.asOf}` : 'LIVE прайс',
        };
        liveCount++;
      }
    }
  }

  // Process 4: AgroServer Volgograd (honest CAPTCHA detection vs live parse)
  if (tasks[4].status === 'fulfilled') {
    const html = tasks[4].value;
    const isCaptcha = /captcha|Введите код/i.test(html);
    const idx = spotChannels.findIndex((c) => c.id === 'agroserver_vlg');
    if (idx >= 0 && !isCaptcha) {
      const matches = [...html.matchAll(/(\d{2}(?:[.,]\d+)?)\s*(?:руб\.?\/кг|₽\/кг)/gi)]
        .map((m) => parseFloat(m[1].replace(',', '.')))
        .filter((v) => v >= 12 && v <= 30);
      if (matches.length) {
        const avg = +(matches.reduce((a, b) => a + b, 0) / matches.length).toFixed(2);
        spotChannels[idx] = {
          ...spotChannels[idx],
          priceExVat: avg,
          offersCount: matches.length,
          status: 'live',
          statusLabel: `LIVE · ${matches.length} оферт`,
        };
        liveCount++;
      }
    }
  }

  const analytics = computeMarketFactorAnalytics({
    fx,
    weatherHubs,
    spotChannels,
    baseWarehouseExVat: baseWh,
    today,
  });

  const payload = {
    asOf: today,
    fetchedAt: nowIso,
    mode: liveCount > 0 ? 'live_hybrid' : 'baseline_snapshot',
    liveFeedsConnected: liveCount,
    fx,
    weatherHubs,
    spotChannels,
    analytics,
  };

  cachedPayload = payload;
  cachedAtMs = Date.now();
  return res.status(200).json(payload);
}
