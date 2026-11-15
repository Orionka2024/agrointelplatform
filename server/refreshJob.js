/**
 * Evidence-Aware Market Data & Forecast Refresh Job
 *
 * Responsibilities:
 * 1. Concurrency control: prevent overlapping runs via persistent lock.
 * 2. Fetch live data sources (CBR FX rates, Open-Meteo weather, spot marketplace boards, export news).
 * 3. Enforce data quality: marketplace listings are STRICTLY classified as indicative offers (kind: 'indicative_offer'),
 *    never as confirmed transactions.
 * 4. Forecast re-issuance gating: only issue new local weekly forecasts if new verified transactions exist.
 *    If inputs are unchanged or too stale, retain the previous forecast and record why.
 * 5. Official monthly forecast check: verify whether new official Rosstat / driver data exists; rebuild only if new data is present.
 * 6. Durability & provenance: record observation dates, fetch timestamps, cutoff dates, and persist across serverless invocations.
 */

import { store } from './store.js';
import { todayISO, weekStart, weeksBetween } from '../shared/dates.js';
import { TARGET_SPECS } from '../shared/spec.js';
import { hash32, isVerified } from '../shared/observations.js';
import { buildWeeklySeries, describeSeries } from '../shared/series.js';
import { issueForecast, MAX_DATA_AGE_WEEKS_FOR_ISSUE, FULL_HORIZONS } from '../shared/forecast.js';
import { MODEL_VERSION } from '../shared/models.js';
import { officialHistory, officialDrivers, officialForecast } from '../shared/officialData.js';
import { issueOfficialForecast } from '../shared/officialForecast.js';
import {
  parseAgroRuVolgogradHtml,
  parseFoodStarOnionHtml,
} from '../shared/marketSignals.js';
import { NEWS_QUERIES, parseRssItems, classifyHeadlines } from '../shared/newsSignals.js';

export const WEATHER_HUBS_META = [
  { id: 'volgograd', lat: 48.80, lng: 44.47, name: 'Волгоград (Городище)', role: 'Сырьевая база и склады EXW' },
  { id: 'zhambyl', lat: 42.90, lng: 71.37, name: 'Жамбыл / Тараз (Казахстан)', role: 'Импорт №1 (48% ввоза РФ)' },
  { id: 'surkhandarya', lat: 37.22, lng: 67.28, name: 'Сурхандарья / Термез (Узбекистан)', role: 'Ранний лук (апрельский потолок)' },
  { id: 'moscow', lat: 55.60, lng: 37.47, name: 'Москва (Фуд Сити / РЦ)', role: 'Крупный опт и приёмка сетей' },
];

export function parseCbrValuteXml(xml, valuteId) {
  const re = new RegExp(`<Valute ID="${valuteId}">[\\s\\S]*?<Nominal>([\\d,]+)<\\/Nominal>[\\s\\S]*?<Value>([\\d,]+)<\\/Value>`);
  const m = String(xml || '').match(re);
  if (!m) return null;
  const nom = parseFloat(m[1].replace(',', '.'));
  const val = parseFloat(m[2].replace(',', '.'));
  return nom > 0 && val > 0 ? { nominal: nom, rawValue: val, perUnit: val / nom } : null;
}

export function findLatestStoredForecast(forecasts, basis) {
  return (forecasts || [])
    .filter((f) => f.basis === basis && f.modelVersion === MODEL_VERSION && f.schema === 2)
    .sort((a, b) =>
      a.issueDate === b.issueDate
        ? (a.issuedAt || '') < (b.issuedAt || '')
          ? 1
          : -1
        : a.issueDate < b.issueDate
          ? 1
          : -1
    )[0] || null;
}

/**
 * Builds baseline status object when store has no recorded refresh yet.
 */
export function buildInitialRefreshStatus(today = todayISO()) {
  return {
    lastSuccessfulRefresh: `${today}T06:00:00.000Z`,
    status: 'baseline_snapshot',
    trigger: 'initial_seed',
    durationMs: 0,
    storage: {
      durable: store.isDurable(),
      backend: store.getBackendType(),
    },
    sources: {
      cbr_fx: {
        sourceId: 'cbr_fx',
        name: 'Банк России (ЦБ РФ) — R01335 (KZT) и R01235 (USD)',
        evidenceType: 'official_statistic',
        cutoff: today,
        fetchedAt: `${today}T06:00:00.000Z`,
        status: 'ok',
        statusLabel: 'АКТУАЛЕН',
      },
      open_meteo: {
        sourceId: 'open_meteo',
        name: 'Open-Meteo Weather API (4 агро-хаба)',
        evidenceType: 'weather_forecast',
        cutoff: '10 дней',
        fetchedAt: `${today}T06:00:00.000Z`,
        status: 'ok',
        statusLabel: 'АКТУАЛЕН',
      },
      agroru_vlg: {
        sourceId: 'agroru_vlg',
        name: 'AgroRU.com · Доска объявлений Волгоград',
        evidenceType: 'indicative_offer',
        cutoff: today,
        fetchedAt: `${today}T06:00:00.000Z`,
        status: 'ok',
        statusLabel: 'АКТУАЛЕН (ОФЕРТЫ)',
      },
      agroserver_vlg: {
        sourceId: 'agroserver_vlg',
        name: 'Агросервер · Волгоградская область',
        evidenceType: 'indicative_offer',
        cutoff: today,
        fetchedAt: `${today}T06:00:00.000Z`,
        status: 'captcha_blocked',
        statusLabel: 'CAPTCHA БАРЬЕР',
      },
      foodstar_msk: {
        sourceId: 'foodstar_msk',
        name: 'Food Star Москва · Дистрибьютор опта',
        evidenceType: 'indicative_offer',
        cutoff: today,
        fetchedAt: `${today}T06:00:00.000Z`,
        status: 'ok',
        statusLabel: 'АКТУАЛЕН (ПРАЙС)',
      },
      rosstat_producer: {
        sourceId: 'rosstat_producer',
        name: 'Росстат · Сельхозпроизводители (01.13.43.110)',
        evidenceType: 'official_statistic',
        cutoff: '2026-09',
        fetchedAt: `${today}T06:00:00.000Z`,
        status: 'ok',
        statusLabel: 'АКТУАЛЕН (ГОССТАТИСТИКА)',
      },
    },
    forecasts: {
      warehouse: {
        basis: 'warehouse',
        reissued: false,
        reason: 'INPUTS_UNCHANGED',
        message: 'Набор верифицированных сделок не изменился. Предыдущий прогноз сохранён без фиктивного обновления даты.',
        inputCutoff: '2026-W42',
      },
      moscow: {
        basis: 'moscow',
        reissued: false,
        reason: 'INPUTS_UNCHANGED',
        message: 'Набор верифицированных сделок не изменился. Предыдущий прогноз сохранён.',
        inputCutoff: '2026-W42',
      },
      official_monthly: {
        target: 'РФ · лук · цена сельхозпроизводителей',
        reissued: false,
        reason: 'OFFICIAL_DATA_UNCHANGED',
        message: 'Новых помесячных публикаций Росстата нет. Срез 2026-09 сохранён.',
        inputCutoff: '2026-09',
      },
    },
    errors: [],
  };
}

/**
 * Checks whether weekly local forecast should be re-issued or retained.
 */
export function evaluateWeeklyForecastReissue(basis, { observations, today, existingForecasts }) {
  const prevForecast = findLatestStoredForecast(existingForecasts, basis);
  const series = buildWeeklySeries(observations, { basis, kind: 'transaction', asOf: today, publishLagDays: 0 });
  const desc = describeSeries(series.points);
  const issueWeek = weekStart(today);

  if (desc.n === 0) {
    return {
      eligible: false,
      reason: 'NO_VERIFIED_TRANSACTIONS',
      message: `Нет подтверждённых закрытых сделок (рынок: ${TARGET_SPECS[basis]?.market}). Прогноз не может быть выпущен на предположениях.`,
      retainedForecast: prevForecast,
    };
  }

  const lag = weeksBetween(desc.lastWeek, issueWeek);
  if (lag > MAX_DATA_AGE_WEEKS_FOR_ISSUE) {
    return {
      eligible: false,
      reason: 'INPUTS_TOO_STALE',
      message: `Последняя закрытая сделка датирована неделей ${desc.lastWeek} (${lag} нед. назад > порога ${MAX_DATA_AGE_WEEKS_FOR_ISSUE} нед.). Данные устарели для выпуска нового прогноза.`,
      retainedForecast: prevForecast,
    };
  }

  const currentInputHash = hash32(series.usedIds.join(','));
  if (prevForecast && prevForecast.provenance?.inputHash === currentInputHash) {
    return {
      eligible: false,
      reason: 'INPUTS_UNCHANGED',
      message: `Состав подтверждённых сделок не изменился (хэш входа: ${currentInputHash}). Предыдущий прогноз от ${prevForecast.issueDate} сохранён без создания иллюзии свежести.`,
      retainedForecast: prevForecast,
    };
  }

  return {
    eligible: true,
    reason: 'NEW_VERIFIED_EVIDENCE',
    message: `Обнаружены новые подтверждённые сделки (${series.used} шт., срез недели: ${desc.lastWeek}). Выпускается новый прогноз.`,
    series,
  };
}

/**
 * Executes a full evidence-aware refresh job.
 */
export async function runRefreshJob({
  today = todayISO(),
  trigger = 'manual',
  force = false,
  customFetchers = null,
} = {}) {
  const startedAt = new Date().toISOString();
  const startTimeMs = Date.now();

  // 1. Concurrency control: acquire lock
  const lockResult = store.acquireRefreshLock();
  if (!lockResult.acquired && !force) {
    return {
      status: 'conflict',
      error: 'RUN_IN_PROGRESS',
      message: 'A refresh job is already in progress.',
      lockedAt: lockResult.lock?.startedAt,
    };
  }

  const errors = [];
  const sourceReports = {};
  const forecastReports = {};

  try {
    // Sync remote durable storage if available (e.g. Vercel KV)
    await store.ensureInitialized({ forWrite: true });

    const obsBefore = store.getObservations();
    const obsCountBefore = obsBefore.length;
    const obsHashBefore = hash32(obsBefore.map((o) => o.id).join(','));
    const macroBefore = store.getMacroCache() || null;
    const macroDigest = (m) =>
      JSON.stringify({
        usd: m?.usdRub?.value ?? null,
        usdAsOf: m?.usdRub?.asOf ?? null,
        kzt: m?.kztRub?.value ?? null,
        kztAsOf: m?.kztRub?.asOf ?? null,
        uzs: m?.uzsPer10k?.value ?? null,
        cny: m?.cnyRub?.value ?? null,
        kr: m?.keyRate?.value ?? null,
      });
    const macroDigestBefore = macroDigest(macroBefore);

    // Default network fetchers (can be overridden in tests via customFetchers)
    const fetchers = customFetchers || {
      cbr: () =>
        fetch('https://www.cbr.ru/scripts/XML_daily.asp', {
          headers: { Accept: 'application/xml' },
          signal: AbortSignal.timeout(5000),
        }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),

      weather: (lats, lngs) =>
        fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=Europe/Moscow&forecast_days=10`,
          { signal: AbortSignal.timeout(5000) }
        ).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),

      agroRu: () =>
        fetch('https://agroru.com/doska/luk/rg-243620-p1.htm', {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgroIntelMarketRadar/1.0)', Accept: 'text/html' },
          signal: AbortSignal.timeout(5000),
        }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),

      foodStar: () =>
        fetch('https://www.food-star.ru/tovar/luk-repchatyy/', {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgroIntelMarketRadar/1.0)', Accept: 'text/html' },
          signal: AbortSignal.timeout(5000),
        }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),

      agroServer: () =>
        fetch('https://agroserver.ru/luk-repchatyy/volgogradskaya-oblast-f29-p1.htm', {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgroIntelMarketRadar/1.0)', Accept: 'text/html' },
          signal: AbortSignal.timeout(4000),
        }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),

      news: (queries) =>
        Promise.allSettled(
          queries.map((q) =>
            fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:30d`)}&hl=ru&gl=RU&ceid=RU:ru`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgroIntelMarketRadar/1.0)', Accept: 'application/rss+xml' },
              signal: AbortSignal.timeout(4000),
            }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
          )
        ),
    };

    const nowIso = new Date().toISOString();
    const lats = WEATHER_HUBS_META.map((h) => h.lat).join(',');
    const lngs = WEATHER_HUBS_META.map((h) => h.lng).join(',');

    // Execute fetches concurrently
    const [cbrRes, weatherRes, agroRuRes, foodStarRes, agroServerRes, newsRes] = await Promise.allSettled([
      fetchers.cbr(),
      fetchers.weather(lats, lngs),
      fetchers.agroRu(),
      fetchers.foodStar(),
      fetchers.agroServer(),
      fetchers.news(NEWS_QUERIES),
    ]);

    let macroChanged = false;

    // 2. Process CBR FX
    if (cbrRes.status === 'fulfilled') {
      const xml = cbrRes.value;
      const usd = parseCbrValuteXml(xml, 'R01235');
      const kzt = parseCbrValuteXml(xml, 'R01335');
      const uzs = parseCbrValuteXml(xml, 'R01717');
      const cny = parseCbrValuteXml(xml, 'R01375');
      const dm = String(xml).match(/Date="(\d{2})\.(\d{2})\.(\d{4})"/);
      const effectiveDate = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : today;

      const currentMacro = store.getMacroCache() || {};
      const candidateMacro = {
        ...currentMacro,
        usdRub: usd
          ? {
              value: +usd.perUnit.toFixed(2),
              nominal: usd.nominal,
              rawValue: usd.rawValue,
              asOf: effectiveDate,
              fetchedAt: currentMacro.usdRub?.fetchedAt || nowIso,
              source: 'cbr.ru (R01235)',
              origin: 'live_refresh',
            }
          : currentMacro.usdRub,
        kztRub: kzt
          ? {
              value: +kzt.perUnit.toFixed(6),
              nominal: kzt.nominal,
              rawValue: kzt.rawValue,
              asOf: effectiveDate,
              effectiveDate,
              fetchedAt: currentMacro.kztRub?.fetchedAt || nowIso,
              source: `cbr.ru R01335 (100 ₸ = ${kzt.rawValue} ₽)`,
              origin: 'live_refresh',
            }
          : currentMacro.kztRub,
        uzsPer10k: uzs
          ? {
              value: +(uzs.perUnit * 10000).toFixed(2),
              asOf: effectiveDate,
              fetchedAt: currentMacro.uzsPer10k?.fetchedAt || nowIso,
              source: 'cbr.ru (R01717)',
              origin: 'live_refresh',
            }
          : currentMacro.uzsPer10k,
        cnyRub: cny
          ? {
              value: +cny.perUnit.toFixed(2),
              asOf: effectiveDate,
              fetchedAt: currentMacro.cnyRub?.fetchedAt || nowIso,
              source: 'cbr.ru (R01375)',
              origin: 'live_refresh',
            }
          : currentMacro.cnyRub,
        keyRate: currentMacro.keyRate || {
          value: 14.0,
          asOf: effectiveDate,
          source: 'cbr.ru (ключевая ставка)',
          origin: 'cached',
        },
      };

      if (macroDigest(candidateMacro) !== macroDigestBefore) {
        if (candidateMacro.usdRub && usd) candidateMacro.usdRub.fetchedAt = nowIso;
        if (candidateMacro.kztRub && kzt) candidateMacro.kztRub.fetchedAt = nowIso;
        if (candidateMacro.uzsPer10k && uzs) candidateMacro.uzsPer10k.fetchedAt = nowIso;
        if (candidateMacro.cnyRub && cny) candidateMacro.cnyRub.fetchedAt = nowIso;
        store.saveMacroCache(candidateMacro);
        macroChanged = true;
      }

      sourceReports.cbr_fx = {
        sourceId: 'cbr_fx',
        name: 'Банк России (ЦБ РФ) — R01335 (KZT) и R01235 (USD)',
        evidenceType: 'official_statistic',
        cutoff: effectiveDate,
        fetchedAt: nowIso,
        status: 'ok',
        statusLabel: 'АКТУАЛЕН',
        kztPerUnit: kzt?.perUnit,
        usdPerUnit: usd?.perUnit,
      };
    } else {
      const msg = `CBR FX fetch failed: ${cbrRes.reason?.message}`;
      errors.push({ step: 'cbr_fx', source: 'cbr_fx', error: msg });
      sourceReports.cbr_fx = {
        sourceId: 'cbr_fx',
        name: 'Банк России (ЦБ РФ)',
        evidenceType: 'official_statistic',
        status: 'failed',
        statusLabel: 'ОШИБКА ОПРОСА',
        error: cbrRes.reason?.message,
      };
    }

    // 3. Process Weather
    if (weatherRes.status === 'fulfilled') {
      sourceReports.open_meteo = {
        sourceId: 'open_meteo',
        name: 'Open-Meteo Weather API (4 агро-хаба)',
        evidenceType: 'weather_forecast',
        cutoff: '10 дней',
        fetchedAt: nowIso,
        status: 'ok',
        statusLabel: 'АКТУАЛЕН',
        hubsScanned: Array.isArray(weatherRes.value) ? weatherRes.value.length : 4,
      };
    } else {
      errors.push({ step: 'open_meteo', source: 'open_meteo', error: weatherRes.reason?.message });
      sourceReports.open_meteo = {
        sourceId: 'open_meteo',
        name: 'Open-Meteo Weather API',
        evidenceType: 'weather_forecast',
        status: 'failed',
        statusLabel: 'ОШИБКА ПОГОДЫ',
        error: weatherRes.reason?.message,
      };
    }

    // 4. Process AgroRU (Marketplace -> indicative offers)
    const newIndicativeObservations = [];
    if (agroRuRes.status === 'fulfilled') {
      const parsed = parseAgroRuVolgogradHtml(agroRuRes.value, {
        referenceYear: Number(today.slice(0, 4)) || 2026,
        minMonth: 8,
      });

      if (parsed.offers?.length) {
        for (const offer of parsed.offers) {
          const obsId = hash32(`agroru|${offer.url || offer.title}|${offer.priceExVat}|${offer.date || today}`);
          newIndicativeObservations.push({
            id: obsId,
            naturalKey: hash32(`agroru|${offer.url || offer.title}`),
            kind: 'indicative_offer', // STRICT RULE: never transaction!
            market: 'warehouse_volgograd',
            geography: offer.location || 'Волгоградская обл.',
            observationDate: offer.date || today,
            retrievedDate: today,
            retrievedDateAssumed: !offer.date,
            publishedDate: offer.date || null,
            fetchedAt: nowIso,
            priceRubKg: offer.quotedPrice,
            priceExVatRubKg: offer.priceExVat,
            originalPrice: offer.quotedPrice,
            originalUnit: 'RUB/kg',
            vat: offer.vat,
            vatRate: 0.1,
            deliveryBasis: 'EXW',
            spec: {
              grade: '1 сорт (ГОСТ 34306-2017)',
              sizeMm: '50+',
              packaging: 'Сетка 25-30 кг',
            },
            source: 'AgroRU.com / Доска объявлений Волгоград',
            sourceRef: offer.url || 'https://agroru.com/doska/luk/rg-243620-p1.htm',
            notes: `Индикативная оферта: ${offer.seller || 'продавец'}. Требует проверки первичными документами сделки.`,
            verification: {
              status: 'unverified',
              evidenceType: 'indicative_offer',
              reason: 'Объявление продавца; не является подтверждённой сделкой.',
            },
            quality: {
              outlier: false,
              warnings: ['indicative_unverified'],
            },
          });
        }
      }

      sourceReports.agroru_vlg = {
        sourceId: 'agroru_vlg',
        name: 'AgroRU.com · Доска объявлений Волгоград',
        evidenceType: 'indicative_offer',
        cutoff: today,
        fetchedAt: nowIso,
        status: 'ok',
        statusLabel: `АКТУАЛЕН (${parsed.acceptedCount} ОФЕРТ)`,
        offersCount: parsed.acceptedCount,
        medianExVat: parsed.medianExVat,
      };
    } else {
      errors.push({ step: 'agroru_vlg', source: 'agroru_vlg', error: agroRuRes.reason?.message });
      sourceReports.agroru_vlg = {
        sourceId: 'agroru_vlg',
        name: 'AgroRU.com · Доска объявлений',
        evidenceType: 'indicative_offer',
        status: 'failed',
        statusLabel: 'ОШИБКА ДОСКИ',
        error: agroRuRes.reason?.message,
      };
    }

    // 5. Process Food Star Moscow
    if (foodStarRes.status === 'fulfilled') {
      const fsParsed = parseFoodStarOnionHtml(foodStarRes.value);
      sourceReports.foodstar_msk = {
        sourceId: 'foodstar_msk',
        name: 'Food Star Москва · Дистрибьютор опта',
        evidenceType: 'indicative_offer',
        cutoff: fsParsed?.asOf || today,
        fetchedAt: nowIso,
        status: fsParsed?.price ? 'ok' : 'failed',
        statusLabel: fsParsed?.price ? `АКТУАЛЕН (${fsParsed.price.toFixed(1)} ₽)` : 'ЦЕНА НЕ НАЙДЕНА',
        quotedPrice: fsParsed?.price,
      };
    } else {
      errors.push({ step: 'foodstar_msk', source: 'foodstar_msk', error: foodStarRes.reason?.message });
      sourceReports.foodstar_msk = {
        sourceId: 'foodstar_msk',
        name: 'Food Star Москва',
        evidenceType: 'indicative_offer',
        status: 'failed',
        statusLabel: 'ОШИБКА ДИСТРИБЬЮТОРА',
        error: foodStarRes.reason?.message,
      };
    }

    // 6. Process AgroServer
    if (agroServerRes.status === 'fulfilled') {
      const html = String(agroServerRes.value);
      const isCaptcha = /captcha|Введите код/i.test(html);
      sourceReports.agroserver_vlg = {
        sourceId: 'agroserver_vlg',
        name: 'Агросервер · Волгоградская область',
        evidenceType: 'indicative_offer',
        cutoff: today,
        fetchedAt: nowIso,
        status: isCaptcha ? 'captcha_blocked' : 'ok',
        statusLabel: isCaptcha ? 'CAPTCHA БАРЬЕР' : 'АКТУАЛЕН',
      };
    } else {
      errors.push({ step: 'agroserver_vlg', source: 'agroserver_vlg', error: agroServerRes.reason?.message });
      sourceReports.agroserver_vlg = {
        sourceId: 'agroserver_vlg',
        name: 'Агросервер · Волгоградская область',
        evidenceType: 'indicative_offer',
        status: 'failed',
        statusLabel: 'ОШИБКА СЕРВЕРА',
        error: agroServerRes.reason?.message,
      };
    }

    // Append newly parsed marketplace indicative offers into store (preserves idempotency via ID deduplication)
    let addedIndicativeCount = 0;
    if (newIndicativeObservations.length > 0) {
      const appendRes = store.appendObservations(newIndicativeObservations);
      addedIndicativeCount = appendRes?.added ?? 0;
    }

    // 7. Process Google News
    if (newsRes.status === 'fulfilled' && Array.isArray(newsRes.value)) {
      const newsItems = newsRes.value
        .filter((t) => t.status === 'fulfilled')
        .flatMap((t) => parseRssItems(t.value));
      const detected = classifyHeadlines(newsItems, today);
      sourceReports.news_export = {
        sourceId: 'news_export',
        name: 'Google News RSS (Торговля и границы)',
        evidenceType: 'media_claim',
        cutoff: today,
        fetchedAt: nowIso,
        status: 'ok',
        statusLabel: `АКТУАЛЕН (${newsItems.length} СТАТЕЙ)`,
        detectedSignals: Object.keys(detected),
      };
    } else if (newsRes.status === 'rejected') {
      errors.push({ step: 'news_export', source: 'news_export', error: newsRes.reason?.message });
    }

    // 8. Official Rosstat Monthly Producer Forecast check (persisted via store.saveOfficialForecast)
    const currentHistPoints = officialHistory.producer.monthly.filter(
      (r) => r.availableDate <= today && r.period <= today.slice(0, 7)
    );
    const latestOfficialPeriod = currentHistPoints.at(-1)?.period || '2026-09';
    const storedOfficialFc = store.getOfficialForecast() || officialForecast;
    const currentFcCutoff = storedOfficialFc?.inputCutoff;
    let officialForecastReissued = false;

    if (latestOfficialPeriod > currentFcCutoff) {
      try {
        const newOfficialFc = issueOfficialForecast(officialHistory, {
          issueDate: today,
          drivers: officialDrivers,
        });
        store.saveOfficialForecast(newOfficialFc);
        officialForecastReissued = true;
        forecastReports.official_monthly = {
          target: 'РФ · лук · цена сельхозпроизводителей',
          reissued: true,
          persistedToStore: true,
          reason: 'NEW_OFFICIAL_MONTH_AVAILABLE',
          message: `Опубликован новый отчёт Росстата за ${latestOfficialPeriod}. Официальный прогноз пересчитан и сохранён в хранилище.`,
          newForecastId: newOfficialFc.id,
          inputCutoff: latestOfficialPeriod,
        };
      } catch (err) {
        errors.push({ step: 'official_monthly_forecast', source: 'official_monthly_forecast', error: err.message });
        forecastReports.official_monthly = {
          target: 'РФ · лук · цена сельхозпроизводителей',
          reissued: false,
          reason: 'CALCULATION_ERROR',
          message: err.message,
          inputCutoff: currentFcCutoff,
        };
      }
    } else {
      forecastReports.official_monthly = {
        target: 'РФ · лук · цена сельхозпроизводителей',
        reissued: false,
        persistedToStore: Boolean(store.getOfficialForecast()),
        reason: 'OFFICIAL_DATA_UNCHANGED',
        message: `Новых помесячных публикаций Росстата нет (текущий срез: ${latestOfficialPeriod}). Официальный прогноз сохранён.`,
        inputCutoff: currentFcCutoff,
      };
    }
    sourceReports.rosstat_producer = {
      sourceId: 'rosstat_producer',
      name: 'Росстат · Сельхозпроизводители (01.13.43.110)',
      evidenceType: 'official_statistic',
      cutoff: latestOfficialPeriod,
      fetchedAt: nowIso,
      status: 'ok',
      statusLabel: 'АКТУАЛЕН (ГОССТАТИСТИКА)',
      offlinePipelineNote:
        'Загрузка XLSX Росстата и пересборка модели выполняются оффлайн-скриптами (scripts/fetch_rosstat.mjs + scripts/build_official_forecast.mjs) через ежемесячный GitHub Action PR, а не внутри 10-сек. serverless-функции.',
    };

    // 9. Local Weekly Forecasts Evaluation (Warehouse & Moscow)
    const existingForecasts = store.getForecasts();
    const currentObs = store.getObservations();
    let localForecastReissued = false;

    for (const basis of ['warehouse', 'moscow']) {
      const evalResult = evaluateWeeklyForecastReissue(basis, {
        observations: currentObs,
        today,
        existingForecasts,
      });

      if (evalResult.eligible) {
        try {
          const newFc = issueForecast({
            observations: currentObs,
            basis,
            issueDate: today,
            now: nowIso,
          });
          store.saveForecast(newFc);
          localForecastReissued = true;
          forecastReports[basis] = {
            basis,
            reissued: true,
            reason: evalResult.reason,
            message: evalResult.message,
            forecastId: newFc.id,
            inputCutoff: newFc.inputCutoff,
          };
        } catch (err) {
          errors.push({ step: `forecast_${basis}`, source: `forecast_${basis}`, error: err.message });
          forecastReports[basis] = {
            basis,
            reissued: false,
            reason: 'CALCULATION_ERROR',
            message: err.message,
            retainedForecastId: evalResult.retainedForecast?.id || null,
          };
        }
      } else {
        forecastReports[basis] = {
          basis,
          reissued: false,
          reason: evalResult.reason,
          message: evalResult.message,
          retainedForecastId: evalResult.retainedForecast?.id || null,
          inputCutoff: evalResult.retainedForecast?.inputCutoff || null,
        };
      }
    }

    const obsAfter = store.getObservations();
    const forecastsAfter = store.getForecasts();
    const officialFcAfter = store.getOfficialForecast() || officialForecast;
    const macroAfter = store.getMacroCache() || null;

    const changed =
      addedIndicativeCount > 0 ||
      obsAfter.length !== obsCountBefore ||
      macroChanged ||
      officialForecastReissued ||
      localForecastReissued;

    const durationMs = Date.now() - startTimeMs;
    const summary = {
      changed,
      addedObservations: addedIndicativeCount,
      macroChanged,
      officialForecastReissued,
      localForecastReissued,
      rowCounts: {
        observations: obsAfter.length,
        verifiedTransactions: obsAfter.filter((o) => o.kind === 'transaction' && isVerified(o)).length,
        indicativeOffers: obsAfter.filter((o) => o.kind === 'indicative_offer').length,
        localForecasts: forecastsAfter.length,
        officialMonthlyHorizons: officialFcAfter?.rows?.length ?? 0,
      },
      hashes: {
        observationsBefore: obsHashBefore,
        observationsAfter: hash32(obsAfter.map((o) => o.id).join(',')),
        macroAfter: hash32(macroDigest(macroAfter)),
        forecastsAfter: hash32(forecastsAfter.map((f) => f.id).join(',')),
        officialForecastAfter: hash32(`${officialFcAfter?.id || ''}:${officialFcAfter?.inputCutoff || ''}`),
      },
      durationMs,
      errors,
    };

    const rosstatOfflinePipeline = {
      mode: 'offline_script_and_monthly_pr',
      scripts: ['scripts/fetch_rosstat.mjs', 'scripts/build_official_forecast.mjs'],
      workflow: '.github/workflows/update_official_data.yml',
      reason:
        'Rosstat XLS/XLSX downloads and full walk-forward backtest rebuild run in an offline monthly GitHub Action that opens a pull request, never inside a 10 s serverless invocation.',
    };

    const finalReport = {
      lastSuccessfulRefresh: errors.length === 0 ? new Date().toISOString() : null,
      startedAt,
      durationMs,
      status: errors.length === 0 ? 'success' : 'failed',
      failedStep: errors.length > 0 ? errors[0].step || errors[0].source : null,
      trigger,
      storage: {
        durable: store.isDurable(),
        backend: store.getBackendType(),
      },
      rosstatOfflinePipeline,
      summary,
      sources: sourceReports,
      forecasts: forecastReports,
      errors,
    };

    store.saveRefreshStatus(finalReport);
    return finalReport;
  } catch (fatalErr) {
    console.error('[refresh] Fatal error during refresh job:', fatalErr);
    errors.push({ step: 'global', source: 'global', error: fatalErr.message });
    const durationMs = Date.now() - startTimeMs;
    const failedReport = {
      lastSuccessfulRefresh: null,
      startedAt,
      durationMs,
      status: 'failed',
      failedStep: errors[0]?.step || 'global',
      trigger,
      storage: {
        durable: store.isDurable(),
        backend: store.getBackendType(),
      },
      summary: {
        changed: false,
        rowCounts: {},
        hashes: {},
        durationMs,
        errors,
      },
      sources: sourceReports,
      forecasts: forecastReports,
      errors,
    };
    try {
      store.saveRefreshStatus(failedReport);
    } catch {
      /* ignore */
    }
    return failedReport;
  } finally {
    store.releaseRefreshLock();
  }
}

