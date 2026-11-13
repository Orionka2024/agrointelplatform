/**
 * Daily Market Factors Telegram Dispatcher
 *
 * Fetches live market indicators (CBR FX rates, Open-Meteo weather across hubs,
 * wholesale and retail prices) and dispatches a formatted briefing to Telegram.
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from .env.local or process.env.
 * Usage: node scripts/send_telegram_digest.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDefaultMarketSignals,
  computeMarketFactorAnalytics,
  parseAgroRuVolgogradHtml,
  parseFoodStarOnionHtml,
} from '../shared/marketSignals.js';
import { computeSpotTrend, evaluateExternalFactors } from '../shared/externalFactors.js';
import { fetchPressReview } from '../shared/pressReview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Load .env.local if present
const envLocalPath = path.join(rootDir, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('❌ ERROR: Missing Telegram credentials!');
  if (!BOT_TOKEN) console.error('  -> TELEGRAM_BOT_TOKEN is missing or empty.');
  if (!CHAT_ID) console.error('  -> TELEGRAM_CHAT_ID is missing or empty.');
  console.error('\nEnsure both secrets are added under:');
  console.error('GitHub Repo -> Settings -> Secrets and variables -> Actions -> Repository secrets');
  process.exit(1);
}

const WEATHER_HUBS_META = [
  { id: 'volgograd', lat: 48.80, lng: 44.47, name: 'Волгоград (Городище)', role: 'Сырьевая база EXW' },
  { id: 'zhambyl', lat: 42.90, lng: 71.37, name: 'Жамбыл / Тараз (Казахстан)', role: 'Импорт №1 (48% ввоза)' },
  { id: 'surkhandarya', lat: 37.22, lng: 67.28, name: 'Термез (Узбекистан)', role: 'Ранний лук (весна)' },
  { id: 'moscow', lat: 55.60, lng: 37.47, name: 'Москва (Фуд Сити / РЦ)', role: 'Крупный опт и сети' },
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

  let summary = 'Штатный режим';
  if (meta.id === 'volgograd') {
    summary = minTemp10d <= -2 ? `Заморозки (${minTemp10d}°C): сброс ангаров` : `Мягкая погода (${minTemp10d}..+${maxTemp10d}°C)`;
  } else if (meta.id === 'zhambyl') {
    summary = minTemp10d <= -8 ? `Морозы до ${minTemp10d}°C: бурты перемерзают, стоп транзита!` : `Мин ${minTemp10d}°C: штатный транзит в РФ`;
  } else if (meta.id === 'moscow') {
    summary = minTemp10d <= -10 ? `Морозы до ${minTemp10d}°C: доставка только отапливаемым рефом` : `Штатная доставка изотермой`;
  }

  return {
    id: meta.id,
    name: meta.name,
    role: meta.role,
    minTemp10d,
    maxTemp10d,
    precipMm10d,
    frostDays,
    summary,
  };
}

async function collectLiveFactors() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const baseline = buildDefaultMarketSignals(todayIso, 15.5);

  const fx = structuredClone(baseline.fx);
  const weatherHubs = structuredClone(baseline.weatherHubs);
  const spotChannels = structuredClone(baseline.spotChannels);

  const lats = WEATHER_HUBS_META.map((h) => h.lat).join(',');
  const lngs = WEATHER_HUBS_META.map((h) => h.lng).join(',');

  const tasks = await Promise.allSettled([
    // 0: CBR daily FX
    fetch('https://www.cbr.ru/scripts/XML_daily.asp', {
      headers: { Accept: 'application/xml' },
      signal: AbortSignal.timeout(5000),
    }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),

    // 1: Open-Meteo weather
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=Europe/Moscow&forecast_days=10`,
      { signal: AbortSignal.timeout(5000) }
    ).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),

    // 2: AgroRU Volgograd live
    fetch('https://agroru.com/doska/luk/rg-243620-p1.htm', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgroIntel/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(4500),
    }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),

    // 3: Food Star Moscow live
    fetch('https://www.food-star.ru/tovar/luk-repchatyy/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgroIntel/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(4500),
    }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),
  ]);

  // Process CBR FX
  if (tasks[0].status === 'fulfilled') {
    const xml = tasks[0].value;
    const usd = parseCbrValute(xml, 'R01235');
    const kzt = parseCbrValute(xml, 'R01335');
    if (usd) fx.usdRub = { value: +usd.perUnit.toFixed(2), source: 'ЦБ РФ' };
    if (kzt) fx.kztRub = { value: +kzt.perUnit.toFixed(4), source: 'ЦБ РФ' };
  }

  // Process Weather
  if (tasks[1].status === 'fulfilled' && Array.isArray(tasks[1].value)) {
    tasks[1].value.forEach((hubJson, idx) => {
      const meta = WEATHER_HUBS_META[idx];
      if (!meta || !hubJson?.daily) return;
      const s = summarizeHubWeather(meta, hubJson.daily);
      if (s) weatherHubs[meta.id] = s;
    });
  }

  // Process AgroRU
  if (tasks[2].status === 'fulfilled') {
    const parsed = parseAgroRuVolgogradHtml(tasks[2].value, {
      referenceYear: Number(todayIso.slice(0, 4)) || 2026,
      minMonth: 8,
    });
    if (parsed.acceptedCount > 0 && parsed.medianExVat) {
      const idx = spotChannels.findIndex((c) => c.id === 'agroru_vlg');
      if (idx >= 0) {
        spotChannels[idx].priceExVat = parsed.medianExVat;
        spotChannels[idx].offersCount = parsed.acceptedCount;
      }
    }
  }

  // Process Food Star Moscow
  if (tasks[3].status === 'fulfilled') {
    const fsParsed = parseFoodStarOnionHtml(tasks[3].value);
    if (fsParsed?.price) {
      const idx = spotChannels.findIndex((c) => c.id === 'foodstar_msk');
      if (idx >= 0) {
        spotChannels[idx].priceExVat = +(fsParsed.price / 1.1).toFixed(2);
        spotChannels[idx].quotedPrice = fsParsed.price;
      }
    }
  }

  // Read latest official retail price from data/official-history.json
  let latestRetailPrice = 49.19;
  let latestRetailDate = '2026-10-26';
  try {
    const histPath = path.join(rootDir, 'data/official-history.json');
    if (fs.existsSync(histPath)) {
      const hist = JSON.parse(fs.readFileSync(histPath, 'utf8'));
      const weekly = hist?.retail?.weekly || [];
      if (weekly.length > 0) {
        const last = weekly[weekly.length - 1];
        if (last?.value) {
          latestRetailPrice = last.value;
          latestRetailDate = last.date;
        }
      }
    }
  } catch (err) {
    console.warn('Could not read official-history.json:', err.message);
  }

  // Compute composite analytics
  const analytics = computeMarketFactorAnalytics({
    fx,
    weatherHubs,
    spotChannels,
    baseWarehouseExVat: 15.5,
    today: todayIso,
  });

  // External factors (Iran / Iraq / UZ / KZ / Volgograd bids) from data/market-events.json
  let events = [];
  try {
    const evPath = path.join(rootDir, 'data/market-events.json');
    if (fs.existsSync(evPath)) events = JSON.parse(fs.readFileSync(evPath, 'utf8'));
  } catch (err) {
    console.warn('Could not read market-events.json:', err.message);
  }
  const external = evaluateExternalFactors(events, todayIso);

  // Volgograd spot history: record today's live value (only if live data was parsed) and compute trend
  let spotTrend = null;
  try {
    const liveVlg = spotChannels.find((c) => c.id === 'agroru_vlg');
    const histPath = path.join(rootDir, 'data/spot-history.json');
    const history = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, 'utf8')) : [];
    const liveParsed = tasks[2].status === 'fulfilled' && Number.isFinite(liveVlg?.priceExVat);
    if (liveParsed && !history.some((h) => h.date === todayIso)) {
      history.push({ date: todayIso, value: liveVlg.priceExVat });
      fs.writeFileSync(histPath, JSON.stringify(history.slice(-120), null, 2));
    }
    spotTrend = computeSpotTrend(history);
  } catch (err) {
    console.warn('Could not process spot-history.json:', err.message);
  }

  return {
    today: todayIso,
    fx,
    weatherHubs,
    spotChannels,
    analytics,
    retail: { price: latestRetailPrice, date: latestRetailDate },
    external,
    spotTrend,
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildExternalFactorsHtml(external, spotTrend) {
  const lines = [];
  const fmt = (icon, e) =>
    `${icon} <b>${escapeHtml(e.title)}</b> ${e.confirmed ? '✔️' : '❓'} <i>(${escapeHtml(e.source)})</i>\n   ${escapeHtml(e.note)}`;

  if (external) {
    external.positives.forEach((e) => lines.push(fmt('🟢', e)));
    external.negatives.forEach((e) => lines.push(fmt('🔴', e)));
    external.watch.forEach((e) => lines.push(fmt('🟡', e)));
    if (external.stale.length) {
      lines.push(`⏳ Устарело (&gt;14 дней, не учтено): ${external.stale.map((e) => escapeHtml(e.title)).join('; ')}`);
    }
  }
  if (spotTrend) {
    const sign = spotTrend.changePct > 0 ? '+' : '';
    const icon = spotTrend.changePct >= 2 ? '🟢' : spotTrend.changePct <= -2 ? '🔴' : '🟡';
    lines.push(
      `${icon} <b>Спот Волгоград:</b> ${spotTrend.fromValue} → ${spotTrend.toValue} ₽/кг (${sign}${spotTrend.changePct}% с ${spotTrend.from})`
    );
  }
  if (!lines.length) return '';
  return `<b>🌍 ВНЕШНИЕ ФАКТОРЫ (Иран, Ирак, Узбекистан, Казахстан):</b>\n${lines.join('\n')}\n✔️ — подтверждено источником, ❓ — пока не подтверждено.\n`;
}

function buildTelegramHtml(data) {
  const { today, fx, weatherHubs, spotChannels, analytics, retail } = data;

  const kztPer100 = (fx.kztRub.value * 100).toFixed(2);
  const usd = fx.usdRub.value.toFixed(2);
  const keyRate = fx.keyRate?.value || 19.0;

  const kzWeather = weatherHubs.zhambyl;
  const vlgWeather = weatherHubs.volgograd;
  const mskWeather = weatherHubs.moscow;

  const mskWholesale = spotChannels.find((c) => c.id === 'foodstar_msk')?.quotedPrice || 44.0;
  const vlgSpot = spotChannels.find((c) => c.id === 'agroru_vlg')?.priceExVat || 15.0;

  const regimeLabel = analytics.signalRegime?.label || 'ОСЕННЕЕ ДАВЛЕНИЕ ИМПОРТА КЗ И АНГАРОВ';
  const tension = analytics.tensionScore ?? -14;
  const kzParity = analytics.parity?.kzLandedVolgogradExVat?.toFixed(2) || '17.50';

  const formatTemp = (w) => {
    if (!w) return 'н/д';
    const min = w.minTemp10d > 0 ? `+${w.minTemp10d}` : `${w.minTemp10d}`;
    const max = w.maxTemp10d > 0 ? `+${w.maxTemp10d}` : `${w.maxTemp10d}`;
    return `${min}..${max}°C (${w.summary})`;
  };

  const external = data.external;
  const spotTrend = data.spotTrend;
  const extAdj = external?.adjustment || 0;
  const adjustedTension = Math.max(-100, Math.min(100, tension + extAdj));

  const summaryHtml = buildFarmerSummary({
    tension: adjustedTension,
    kzParity: Number(kzParity),
    vlgSpot,
    kzWeather,
    mskWeather,
    keyRate,
    external,
    spotTrend,
  });

  const externalHtml = buildExternalFactorsHtml(external, spotTrend);

  return `<b>🧅 АГРО-РАДАР | Сводка факторов на ${today}</b>

${summaryHtml}

<b>📊 РЕЖИМ РЫНКА:</b>
• <b>${regimeLabel}</b>
• Индекс рыночной напряженности: <b>${tension > 0 ? '+' : ''}${tension}</b> / 100${extAdj ? ` (с учётом внешних факторов: <b>${adjustedTension > 0 ? '+' : ''}${adjustedTension}</b>)` : ''}

${externalHtml}

<b>💱 КУРСЫ ВАЛЮТ И ИМПОРТНЫЙ ПАРИТЕТ:</b>
• <b>KZT/RUB:</b> ${fx.kztRub.value.toFixed(4)} ₽ (100 ₸ = <b>${kztPer100} ₽</b>)
• <b>USD/RUB:</b> <b>${usd} ₽</b>
• Импортный паритет лука из Казахстана в РФ (EXW ЮФО): <b>~${kzParity} ₽/кг</b>

<b>🌡 ТЕМПЕРАТУРА В ХАБАХ (10 дней):</b>
• 🇰🇿 <b>Жамбыл / Тараз (КЗ):</b> ${formatTemp(kzWeather)}
• 🇷🇺 <b>Волгоград (Склады EXW):</b> ${formatTemp(vlgWeather)}
• 🇷🇺 <b>Москва (РЦ сетей):</b> ${formatTemp(mskWeather)}

<b>💰 ЦЕНЫ (ОПТ И РОЗНИЦА):</b>
• 🏢 <b>Опт / Дистрибуция Москва:</b> <b>${mskWholesale.toFixed(2)} ₽/кг</b>
• 🌾 <b>Спот Волгоград (склад EXW):</b> <b>${vlgSpot.toFixed(2)} ₽/кг</b> без НДС
• 🛒 <b>Розница РФ (Росстат):</b> <b>${retail.price.toFixed(2)} ₽/кг</b> (от ${retail.date})

<b>🏦 СТОИМОСТЬ ФИНАНСИРОВАНИЯ:</b>
• Ключевая ставка ЦБ: <b>${keyRate}%</b> (~${analytics.macroTransmission?.monthlyFinancingCostRubKg || '0.35'} ₽/кг в месяц за хранение)

<b>ℹ️ КАК ЧИТАТЬ ПОКАЗАТЕЛИ:</b>
• <i>Индекс напряженности</i>: от −100 до +100. Ниже −15 — рынок давит на цену, выше +18 — предложения мало, цена поддерживается. Между ними — баланс.
• <i>Импортный паритет КЗ</i>: цена, по которой казахский лук может прийти в ЮФО. Если она ниже вашей цены — покупатель уйдёт к импорту; если выше — вы в выигрыше.
• <i>Курс тенге и рубля</i>: сильный рубль делает импорт дешевле (плохо для вас), слабый — дороже (хорошо).
• <i>Температура</i>: морозы в Казахстане задерживают импорт, а в Волгограде угрожают хранению.
• <i>Ключевая ставка</i>: чем выше, тем дороже держать лук на складе.
• <i>Внешние факторы</i>: события в Иране, Ираке, Узбекистане и Казахстане. 🟢 — поддерживают цену в России, 🔴 — давят. Сигнал с ✔️ весомее, чем с ❓.

<i>Генерация: Agro Intelligence Platform</i>`;
}

function buildFarmerSummary({ tension, kzParity, vlgSpot, kzWeather, mskWeather, keyRate, external, spotTrend }) {
  let trend;
  let advice;
  if (tension >= 18) {
    trend = '📈 Тренд: РОСТ — предложения мало, цены поддерживаются.';
    advice = '✅ Можно придержать часть урожая, если хранение в порядке.';
  } else if (tension <= -15) {
    trend = '📉 Тренд: ДАВЛЕНИЕ НА ЦЕНУ — много импорта и лука в ангарах.';
    advice = '⚠️ Не рассчитывайте на быстрый рост: продавайте по плану, особенно лук с риском порчи.';
  } else {
    trend = '➡️ Тренд: БОКОВОЙ — рынок в равновесии.';
    advice = '👀 Продавайте по графику и следите за изменениями.';
  }

  const signals = [];
  if (Number.isFinite(kzParity) && Number.isFinite(vlgSpot)) {
    signals.push(
      kzParity > vlgSpot
        ? '🟢 Казахстанский лук дороже вашего спота — импорт вам не мешает.'
        : '🔴 Казахстанский лук дешевле вашего спота — риск потери покупателей.'
    );
  }
  if (kzWeather && kzWeather.minTemp10d <= -8) {
    signals.push('🟢 Морозы в Казахстане: транзит может замедлиться — это поддерживает цену.');
  }
  if (mskWeather && mskWeather.minTemp10d <= -10) {
    signals.push('🟡 Сильные морозы в Москве: доставка дороже, нужен отапливаемый реф.');
  }
  if (keyRate >= 15) {
    signals.push('🟡 Высокая ключевая ставка: хранение и кредит дорогие, не затягивайте с продажей.');
  }
  if (spotTrend) {
    if (spotTrend.changePct >= 2) signals.push(`🟢 Спот в Волгограде вырос на ${spotTrend.changePct}% — это подтверждает позитивный сигнал.`);
    else if (spotTrend.changePct <= -2) signals.push(`🔴 Спот в Волгограде упал на ${Math.abs(spotTrend.changePct)}% — рынок слабеет.`);
  }
  if (external) {
    const ups = external.positives.length;
    const downs = external.negatives.length;
    const confirmedUps = external.positives.filter((e) => e.confirmed).length;
    if (ups || downs) {
      signals.push(`🌍 Внешние факторы (Иран/Ирак/УЗ/КЗ): 🟢 ${ups} / 🔴 ${downs}, подтверждено источниками: ${confirmedUps + external.negatives.filter((e) => e.confirmed).length}.`);
    }
    if (ups > 0 && confirmedUps === 0) {
      signals.push('⚠️ Позитивные внешние сигналы пока не подтверждены — не увеличивайте запас только из-за новостей.');
    }
  }

  return `<b>🧭 ГЛАВНОЕ ДЛЯ ФЕРМЕРА:</b>
${trend}
${advice}
${signals.length ? signals.join('\n') : '• Явных сигналов сегодня нет.'}
<i>Это ориентир, а не гарантия. Решение — по качеству лука и вашей цене.</i>`;
}

async function sendTelegramMessage(htmlText) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram API Error: ${json.description || JSON.stringify(json)}`);
  }
  return json;
}

function buildPressReviewHtml(review) {
  if (!review || !review.count) {
    return '<b>📰 ПРЕСС-ОБЗОР</b>\nЗа последние 3 дня значимых публикаций по теме не найдено.';
  }
  const dateFmt = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7);
  const blocks = review.groups.map((g) => {
    const rows = g.items.map(
      (i) =>
        `• ${i.trusted ? '✔️' : '❓'} <a href="${escapeHtml(i.link)}">${escapeHtml(i.title)}</a> — <i>${escapeHtml(i.source)}, ${dateFmt(i.publishedAt)}</i>`
    );
    return `${g.topic.flag} <b>${escapeHtml(g.topic.label)}</b>\n${rows.join('\n')}`;
  });
  const warn = review.feedErrors ? `\n⚠️ Часть источников недоступна (${review.feedErrors} из ${review.feedsTotal}).` : '';
  return `<b>📰 ПРЕСС-ОБЗОР (последние 3 дня)</b>\n\n${blocks.join('\n\n')}\n\n✔️ — надёжный источник, ❓ — проверьте оригинал. Заголовки сами по себе не меняют индекс: сначала подтверждение ценами и объёмами.${warn}`;
}

function splitForTelegram(text, limit = 4000) {
  if (text.length <= limit) return [text];
  const parts = [];
  let cur = '';
  for (const para of text.split('\n\n')) {
    if (cur && (cur + '\n\n' + para).length > limit) {
      parts.push(cur);
      cur = para;
    } else {
      cur = cur ? cur + '\n\n' + para : para;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

async function main() {
  console.log('1. Gathering live factors...');
  const data = await collectLiveFactors();

  console.log('2. Collecting press review...');
  let review = null;
  try {
    review = await fetchPressReview();
    fs.writeFileSync(path.join(rootDir, 'data/press-review.json'), JSON.stringify(review, null, 2));
    console.log(`   press review: ${review.count} items, feed errors ${review.feedErrors}/${review.feedsTotal}`);
  } catch (err) {
    console.warn('Press review failed:', err.message);
  }

  console.log('3. Formatting Telegram briefing...');
  const messageHtml = buildTelegramHtml(data);

  console.log('4. Sending to Telegram chat:', CHAT_ID);
  for (const part of splitForTelegram(messageHtml)) {
    await sendTelegramMessage(part);
  }
  if (review) {
    for (const part of splitForTelegram(buildPressReviewHtml(review))) {
      await sendTelegramMessage(part);
    }
  }

  console.log('SUCCESS: Telegram digest delivered successfully!');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
