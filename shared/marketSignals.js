/**
 * Multi-source market intelligence & dynamic factor scanner for the Russian onion market.
 *
 * Strictly separates:
 *  - Spot marketplace `ask` quotes (AgroRU, AgroServer, Avito, Food Star) -> used for real-time
 *    market radar & optional user-triggered spot calibration, NEVER silently injected into
 *    verified `transaction` history.
 *  - Official CBR currency & rate feeds (USD/RUB, KZT/RUB, UZS/RUB, CNY/RUB, KeyRate) -> used to
 *    compute live Kazakhstan (Zhambyl), Uzbekistan (Surkhandarya), and Egypt landed import parity.
 *  - Live Open-Meteo 10-day agro-meteorology across 4 hubs (Volgograd, Zhambyl KZ, Termez UZ, Moscow) ->
 *    detects unheated-shed freeze dumping, Central Asian clamp frost shocks, and reefer logistics surcharges.
 */

const RU_MONTH_MAP = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
};

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(2);
}

function quantile(nums, q) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return s[base + 1] !== undefined
    ? +(s[base] + rest * (s[base + 1] - s[base])).toFixed(2)
    : +s[base].toFixed(2);
}

export function parseRuListingDate(text) {
  const m = String(text || '')
    .toLowerCase()
    .match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(20\d{2})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = RU_MONTH_MAP[m[2]];
  const year = Number(m[3]);
  return {
    iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    year,
    month,
    day,
  };
}

/**
 * Parses AgroRU Volgograd Oblast onion board HTML (`rg-243620-p1.htm`) and filters out:
 *  - stale years (< referenceYear) or early summer/spring remnants,
 *  - peeled / vacuum / cut HoReCa onions (50–70 RUB/kg),
 *  - 2nd grade / small 2–5 cm peeling onions (8–11 RUB/kg),
 *  - green-forcing (`на перо`) or specialty red/white onions.
 */
export function parseAgroRuVolgogradHtml(html, { referenceYear = 2026, minMonth = 8 } = {}) {
  const rawCards = String(html || '').split('<div class="tovar-list__card"').slice(1);
  const accepted = [];
  const rejected = [];

  for (const chunk of rawCards) {
    const titleMatch = chunk.match(/class="tovar-list__card-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const priceMatch = chunk.match(/class="tovar-list__card-price"[^>]*>([\s\S]*?)<\/div>/i);
    const descMatch = chunk.match(/class="tovar-list__card-desc"[^>]*>([\s\S]*?)<\/div>/i);
    const sellerMatch = chunk.match(/class="tovar-list__seller-name"[^>]*>([\s\S]*?)<\/a>/i);
    const metaMatch = chunk.match(/class="tovar-list__card-meta"[^>]*>([\s\S]*?)<\/div>/i);

    const title = stripTags(titleMatch?.[2] || '');
    const href = titleMatch?.[1] ? `https://agroru.com${titleMatch[1]}` : 'https://agroru.com/doska/luk/rg-243620-p1.htm';
    const priceText = stripTags(priceMatch?.[1] || '');
    const desc = stripTags(descMatch?.[1] || '');
    const seller = stripTags(sellerMatch?.[1] || 'КФХ Волгоград');
    const meta = stripTags(metaMatch?.[1] || '');

    const numMatch = priceText.match(/(\d+(?:[.,]\d+)?)\s*₽/i);
    const unitIsKg = /\/\s*кг/i.test(priceText) || (!/\/\s*т/i.test(priceText) && numMatch);
    const rawPrice = numMatch ? parseFloat(numMatch[1].replace(',', '.')) : null;

    if (!rawPrice || !unitIsKg) {
      rejected.push({ title, reason: 'no_kg_price' });
      continue;
    }

    const parsedDate = parseRuListingDate(meta);
    if (parsedDate) {
      if (parsedDate.year < referenceYear) {
        rejected.push({ title, rawPrice, date: parsedDate.iso, reason: 'stale_year' });
        continue;
      }
      if (parsedDate.year === referenceYear && parsedDate.month < minMonth) {
        rejected.push({ title, rawPrice, date: parsedDate.iso, reason: 'early_crop_or_old_stock' });
        continue;
      }
    }

    const blob = `${title} ${desc}`.toLowerCase();
    if (/очищ|вакуум|резан|кубик|шинков|кольц|сушен|вялен|заморож/.test(blob) || rawPrice > 36) {
      rejected.push({ title, rawPrice, reason: 'processed_or_peeled' });
      continue;
    }
    if (/на перо|зелен|выгонк|севок|чернушк|шалот|ялтинск|красный|белый/.test(blob)) {
      rejected.push({ title, rawPrice, reason: 'non_standard_variety_or_forcing' });
      continue;
    }
    if (/2-го сорта|2 сорт|второй сорт|нестандарт|некондиц|на чистку|мелк|калибр\s*[23]\s*[-–]/.test(blob) || rawPrice < 11.5) {
      rejected.push({ title, rawPrice, reason: 'substandard_or_small_caliber' });
      continue;
    }

    const mentionsInclVat = /с\s*ндс/i.test(blob) && !/без\s*ндс/i.test(blob);
    const vat = mentionsInclVat ? 'incl' : 'excl';
    const priceExVat = mentionsInclVat ? +(rawPrice / 1.1).toFixed(2) : +rawPrice.toFixed(2);

    accepted.push({
      title,
      seller,
      date: parsedDate?.iso || null,
      location: meta.split('·')[0]?.trim() || 'Волгоградская область',
      quotedPrice: rawPrice,
      vat,
      priceExVat,
      url: href,
    });
  }

  const exPrices = accepted.map((a) => a.priceExVat);
  return {
    totalScanned: rawCards.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    medianExVat: median(exPrices),
    p25ExVat: quantile(exPrices, 0.25),
    p75ExVat: quantile(exPrices, 0.75),
    offers: accepted.slice(0, 6),
    rejected,
  };
}

/**
 * Parses Moscow HoReCa distributor price from Food Star onion product page.
 */
export function parseFoodStarOnionHtml(html) {
  const text = String(html || '');
  const titleMatch = text.match(/Лук репчатый[^<]{0,60}?цена\s*(\d+(?:[.,]\d+)?)\s*(?:₽|руб)/i);
  const bodyMatch = text.match(/Лук репчатый\s*[—–-]\s*(\d+(?:[.,]\d+)?)\s*(?:₽|руб)/i);
  const dateMatch = text.match(/актуальна на\s*(\d{2})\.(\d{2})\.(\d{4})/i);
  const price = titleMatch
    ? parseFloat(titleMatch[1].replace(',', '.'))
    : bodyMatch
      ? parseFloat(bodyMatch[1].replace(',', '.'))
      : null;
  const asOf = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;
  return price > 0 ? { price, asOf } : null;
}

/**
 * Computes landed import parity (RUB/kg) and multi-factor market pressure indices
 * from FX rates, 4-hub weather forecasts, and spot marketplace quotes.
 */
export function computeMarketFactorAnalytics({ fx, weatherHubs, spotChannels, baseWarehouseExVat = 15.5, today = '2026-10-31' }) {
  const usdRub = fx?.usdRub?.value ?? 92.5;
  const kztRub = fx?.kztRub?.value ?? 0.191;
  const uzsPer10k = fx?.uzsPer10k?.value ?? 74.5; // RUB per 10,000 UZS
  const keyRate = fx?.keyRate?.value ?? 18.0;

  // 1. Kazakhstan (Zhambyl / Taraz) autumn-winter landed parity to Volgograd / Southern RU
  // Typical autumn EXW Taraz ~62 KZT/kg + ~4.1 RUB/kg cross-border truck & phytosanitary
  const kzExwKztKg = 62;
  const kzFreightRubKg = 4.1;
  const kzLandedVolgogradExVat = +(kzExwKztKg * kztRub + kzFreightRubKg).toFixed(2);
  const kzSpreadVsLocal = +(kzLandedVolgogradExVat - baseWarehouseExVat).toFixed(2);

  // 2. Uzbekistan (Surkhandarya / Termez) April early-crop landed parity
  // Early April EXW Termez ~2,050 UZS/kg + ~6.4 RUB/kg refrigerated transit to Southern RU / ~9.2 RUB/kg to Moscow
  const uzExwUzsKg = 2050;
  const uzRubKg = (uzExwUzsKg / 10000) * uzsPer10k;
  const uzEarlyLandedSouthExVat = +(uzRubKg + 6.4).toFixed(2);
  const uzEarlyLandedMoscowInclVat = +((uzRubKg + 9.2) * 1.1).toFixed(2);

  // 3. Egypt spring maritime parity (Alexandria -> Novorossiysk -> Moscow, $0.34/kg CIF+customs)
  const egLandedMoscowExVat = +(0.34 * usdRub).toFixed(2);

  // 4. Weather shock evaluation across the 4 hubs
  const vlgMin = weatherHubs?.volgograd?.minTemp10d ?? 1.0;
  const zhmMin = weatherHubs?.zhambyl?.minTemp10d ?? 2.5;
  const uzMax = weatherHubs?.surkhandarya?.maxTemp10d ?? 21.0;
  const mskMin = weatherHubs?.moscow?.minTemp10d ?? -1.0;

  // Unheated Volgograd sheds must liquidate if 10-day minTemp drops <= -2°C in autumn
  const vlgFrostDumpPct = vlgMin <= -5 ? -2.2 : vlgMin <= -2 ? -1.1 : 0;
  const vlgWinterTighteningPct = vlgMin <= -5 ? 1.8 : vlgMin <= -2 ? 0.9 : 0;

  // Zhambyl (KZ) clamp frost shock (< -8°C damages field/burt stocks and cuts transit)
  const kzFrostShockPct = zhmMin <= -14 ? 6.5 : zhmMin <= -8 ? 3.2 : zhmMin >= 3 ? -1.2 : 0;

  // Import pressure in November: if KZ landed parity is close to or below local EXW, transit caps prices
  const kzAutumnCapPct = kzSpreadVsLocal <= 0 ? -2.8 : kzSpreadVsLocal <= 1.2 ? -1.5 : 0.4;

  // Reefer surcharge risk on M-6 Volgograd -> Moscow
  const mskReeferSurchargeRubKg = mskMin <= -12 || vlgMin <= -12 ? 1.4 : mskMin <= -5 ? 0.5 : 0;

  // Spot Volgograd consensus across clean `ask` boards (minus ~0.3 RUB/kg typical ask->deal discount)
  const vlgAskMedians = (spotChannels || [])
    .filter((c) => c.region === 'Волгоградская обл.' && c.basis === 'ask' && Number.isFinite(c.priceExVat))
    .map((c) => c.priceExVat);
  const rawAskMedian = median(vlgAskMedians) ?? 15.25;
  const impliedDealSpotExVat = +Math.max(12.0, rawAskMedian - 0.25).toFixed(2);

  // Composite Market Tension Score (-100 bearish surplus .. +100 bullish deficit)
  const month = Number(String(today).slice(5, 7)) || 10;
  const seasonalTension = month >= 10 && month <= 11 ? -14 : month === 12 ? 18 : month >= 1 && month <= 3 ? 34 : -10;
  const tensionScore = Math.max(
    -100,
    Math.min(
      100,
      Math.round(
        seasonalTension +
          kzAutumnCapPct * 6 +
          kzFrostShockPct * 7 +
          (kzSpreadVsLocal > 1.5 ? 10 : -6) +
          (keyRate >= 18 ? -5 : 4)
      )
    )
  );

  const signalRegime =
    tensionScore >= 18
      ? { code: 'BULLISH_STORAGE', label: 'ДЕФИЦИТ ФОНДОВ · ДЕРЖАТЬ В ХОЛОДЕ', cls: 'up' }
      : tensionScore <= -15
        ? { code: 'AUTUMN_PRESSURE', label: 'ОСЕННЕЕ ДАВЛЕНИЕ ИМПОРТА КЗ И АНГАРОВ', cls: 'warn' }
        : { code: 'BALANCED_ACCUMULATION', label: 'БАЛАНС · СДЕРЖАННЫЙ СПОТ ПЕРЕД ЗИМОЙ', cls: 'info' };

  return {
    impliedDealSpotExVat,
    rawAskMedianExVat: rawAskMedian,
    tensionScore,
    signalRegime,
    parity: {
      kzLandedVolgogradExVat,
      kzSpreadVsLocal,
      uzEarlyLandedSouthExVat,
      uzEarlyLandedMoscowInclVat,
      egLandedMoscowExVat,
      mskReeferSurchargeRubKg,
    },
    impulses: {
      vlgFrostDumpPct,
      vlgWinterTighteningPct,
      kzFrostShockPct,
      kzAutumnCapPct,
      fxParityShiftPct: +(((kztRub - 0.189) / 0.189) * 35 + ((usdRub - 91) / 91) * 15).toFixed(2),
      uzWarmSpringShiftPct: uzMax >= 24 ? -1.8 : 0,
    },
  };
}

/**
 * Verified baseline snapshot (as of 31 October 2026) used before/without network or when
 * individual marketplaces serve anti-bot CAPTCHAs.
 */
export function buildDefaultMarketSignals(today = '2026-10-31', baseWarehouseExVat = 15.5) {
  const fx = {
    asOf: '2026-10-31',
    status: 'snapshot',
    usdRub: { value: 92.85, changePct: 0.4, source: 'ЦБ РФ' },
    kztRub: { value: 0.1908, changePct: 0.2, source: 'ЦБ РФ (100 ₸ = 19.08 ₽)' },
    uzsPer10k: { value: 72.60, changePct: -0.1, source: 'ЦБ РФ (10 000 сум = 72.60 ₽)' },
    cnyRub: { value: 13.04, changePct: 0.3, source: 'ЦБ РФ' },
    keyRate: { value: 19.0, changePct: 0, source: 'Банк России' },
  };

  const weatherHubs = {
    volgograd: {
      id: 'volgograd',
      name: 'Волгоград (Городище)',
      role: 'Сырьевая база и склады EXW',
      status: 'snapshot',
      minTemp10d: -1.2,
      maxTemp10d: 11.4,
      precipMm10d: 6.2,
      frostDays: 2,
      summary: 'Ночные переходы к −1°C ускоряют разгрузку неотапливаемых ангаров в ноябре',
    },
    zhambyl: {
      id: 'zhambyl',
      name: '🇰🇿 Жамбыл / Тараз (КЗ)',
      role: 'Импорт №1 (48% ввоза РФ)',
      status: 'snapshot',
      minTemp10d: 1.8,
      maxTemp10d: 15.2,
      precipMm10d: 3.1,
      frostDays: 0,
      summary: 'Сухая погода без сильных морозов: транзит фур из Казахстана идёт в штатном режиме',
    },
    surkhandarya: {
      id: 'surkhandarya',
      name: '🇺🇿 Сурхандарья / Термез (УЗ)',
      role: 'Ранний лук (апрельский потолок)',
      status: 'snapshot',
      minTemp10d: 8.4,
      maxTemp10d: 22.6,
      precipMm10d: 0.8,
      frostDays: 0,
      summary: 'Благоприятный сев озимого («августовского») лука под ранний экспорт в РФ с середины апреля',
    },
    moscow: {
      id: 'moscow',
      name: 'Москва (Фуд Сити / РЦ)',
      role: 'Крупный опт и приёмка сетей',
      status: 'snapshot',
      minTemp10d: -2.0,
      maxTemp10d: 7.5,
      precipMm10d: 11.4,
      frostDays: 3,
      summary: 'Штатная доставка тентом/термосом по М-6; обязательный реф с подогревом потребуется при < −10°C',
    },
  };

  const spotChannels = [
    {
      id: 'agroru_vlg',
      source: 'AgroRU · Волгоградская обл.',
      region: 'Волгоградская обл.',
      basis: 'ask',
      spec: '5–8 см, 1 сорт, сетка 25–30 кг, от 20 т',
      priceExVat: 15.0,
      corridorText: '14.55–15.45 ₽ без НДС (15–17 ₽ в объявл.)',
      offersCount: 4,
      status: 'verified_snapshot',
      statusLabel: 'HTML панель (66 объявл.)',
      url: 'https://agroru.com/doska/luk/rg-243620-p1.htm',
      note: 'Отсечены 2023 г., мелкий 3–5 см (8–10 ₽) и очищенный вакуум (52–67 ₽)',
    },
    {
      id: 'agroserver_vlg',
      source: 'AgroServer · Волгоградская обл.',
      region: 'Волгоградская обл.',
      basis: 'ask',
      spec: 'Манас / Сибирь / Вольф, 5+, сетка 30 кг',
      priceExVat: 15.45,
      corridorText: '15.0–17.0 ₽/кг (урожай 2026)',
      offersCount: 5,
      status: 'captcha_protected',
      statusLabel: 'Сверка окт. 2026 (CAPTCHA)',
      url: 'https://agroserver.ru/luk-repchatyy/volgogradskaya-oblast-f29-p1.htm',
      note: 'Прямой бот-парсинг закрыт CAPTCHA; подтверждён коридор от 15 ₽/кг',
    },
    {
      id: 'avito_vlg',
      source: 'Авито Опт · Городище / Волгоград',
      region: 'Волгоградская обл.',
      basis: 'ask',
      spec: 'Манас / Лоредо 5–7 см, сетка 30 кг, от 5–20 т',
      priceExVat: 15.2,
      corridorText: '14.5–16.5 ₽ (товарный 5+) · 9–10 ₽ (3–4 см отсечён)',
      offersCount: 7,
      status: 'verified_snapshot',
      statusLabel: 'Спот КФХ (окт. 2026)',
      url: 'https://www.avito.ru/volgogradskaya_oblast?q=%D0%BB%D1%83%D0%BA+%D1%80%D0%B5%D0%BF%D1%87%D0%B0%D1%82%D1%8B%D0%B9+%D0%BE%D0%BF%D1%82%D0%BE%D0%BC',
      note: 'Наличный/безналичный расчёт с поля и складов Городищенского р-на',
    },
    {
      id: 'rosstat_ufo',
      source: 'Росстат · ЮФО (официально)',
      region: 'ЮФО (вкл. Волгоград)',
      basis: 'official_sho',
      spec: 'Крупные СХО без НДС и доставки (табл. 7.1!K1663)',
      priceExVat: 17.53,
      corridorText: '17.53 ₽ (ЮФО) · 18.12 ₽ (РФ) за 2026-09',
      offersCount: null,
      status: 'official',
      statusLabel: 'Росстат SHA-256',
      url: 'https://rosstat.gov.ru/statistics/price',
      note: 'Включает контракты агрохолдингов с сетями; в окт. розница РФ снизилась на −4.7%',
    },
    {
      id: 'foodstar_msk',
      source: 'Food Star · Москва (HoReCa)',
      region: 'Москва',
      basis: 'small_wholesale',
      spec: 'Доставка в рестораны от 25 тыс. ₽, отсрочка',
      priceExVat: 40.0,
      quotedPrice: 44.0,
      corridorText: '44.00 ₽/кг с доставкой (крупный опт 20 т: ~28.8 ₽)',
      offersCount: 1,
      status: 'verified_snapshot',
      statusLabel: 'Прайс 29.10.2026',
      url: 'https://www.food-star.ru/tovar/luk-repchatyy/',
      note: 'Индикатор платёжеспособного мелкооптового спроса Москвы',
    },
  ];

  const analytics = computeMarketFactorAnalytics({
    fx,
    weatherHubs,
    spotChannels,
    baseWarehouseExVat,
    today,
  });

  return {
    asOf: today,
    fetchedAt: null,
    mode: 'baseline_snapshot',
    fx,
    weatherHubs,
    spotChannels,
    analytics,
  };
}
