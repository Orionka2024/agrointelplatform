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

import { STORAGE_TIERS } from './storageEconomics.js';
import { buildExportWatchlist } from './exportWatchlist.js';
import { EXPORT_SIGNAL_RECORDS } from './exportSignalsData.js';
import { sanitizeDisabledFactors, applyDisabledToImpulses } from './factorToggles.js';
import { CBR_KZT_DAILY_META, CBR_KZT_DAILY_RECORDS, lookupCbrKztRate } from './cbrKztDailyData.js';

export { CBR_KZT_DAILY_META, CBR_KZT_DAILY_RECORDS, lookupCbrKztRate };

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

export const NON_STANDARD_ONION_VARIETY_RE =
  /на перо|зелен|выгонк|севок|чернушк|шалот|шаллот|ялтинск|красн(?:ый|ого|ому|ым|ом|ая|ой|ую|ые|ых|ым|ыми)?|бел(?:ый|ого|ому|ым|ом|ая|ой|ую|ые|ых|ым|ыми)|фиолетов|синий|синего|сладк(?:ий|ого|ая|ие)|редарроу|ред\s*барон|кармен|камперо|экзибишен/i;

/**
 * Parses AgroRU Volgograd Oblast onion board HTML (`rg-243620-p1.htm`) and filters out:
 *  - stale years (< referenceYear) or early summer/spring remnants,
 *  - peeled / vacuum / cut HoReCa onions (50–70 RUB/kg),
 *  - 2nd grade / small 2–5 cm peeling onions (8–11 RUB/kg),
 *  - green-forcing (`на перо`) or specialty red/white/purple/Yalta/shallot onions.
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
    if (NON_STANDARD_ONION_VARIETY_RE.test(blob)) {
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

export const CBR_RATES_BY_DATE = {
  '2026-11-13': {
    asOf: '2026-11-13',
    usdRub: 97.8,
    kztRub: 0.186573,
    kztRawValue: 18.6573,
    kztNominal: 100,
    uzsPer10k: 76.2,
    cnyRub: 13.52,
    keyRate: 14.0,
    sourceUrl: 'https://www.cbr.ru/scripts/XML_daily.asp',
    keyRateUrl: 'https://www.cbr.ru/hd_base/KeyRate/',
  },
  '2026-10-31': {
    asOf: '2026-10-31',
    usdRub: 92.85,
    kztRub: 0.177552,
    kztRawValue: 17.7552,
    kztNominal: 100,
    previousVersion: { value: 0.1908, errorPct: 7.461 },
    uzsPer10k: 72.6,
    cnyRub: 13.04,
    keyRate: 19.0,
    sourceUrl: 'https://www.cbr.ru/scripts/XML_daily.asp',
    keyRateUrl: 'https://www.cbr.ru/hd_base/KeyRate/',
  },
  '2026-10-24': {
    asOf: '2026-10-24',
    usdRub: 96.75,
    kztRub: 0.179797,
    kztRawValue: 17.9797,
    kztNominal: 100,
    previousVersion: { value: 0.198, errorPct: 10.124 },
    uzsPer10k: 75.5,
    cnyRub: 13.52,
    keyRate: 21.0,
    sourceUrl: 'https://www.cbr.ru/scripts/XML_daily.asp',
    keyRateUrl: 'https://www.cbr.ru/hd_base/KeyRate/',
  },
};

/**
 * Resolves point-in-time CBR macro indicators as of `today` without ever looking ahead
 * to a future date (`effectiveDate <= today`).
 */
export function resolveDatedCbrMacro(today = '2026-11-13') {
  const iso = String(today || '').slice(0, 10);
  const kztLookup = lookupCbrKztRate(iso);
  const snapshotDates = Object.keys(CBR_RATES_BY_DATE).sort();
  let bestSnapshot = null;
  for (const d of snapshotDates) {
    if (d <= iso) bestSnapshot = CBR_RATES_BY_DATE[d];
  }
  // If requested date is earlier than the first full macro snapshot (2026-10-24)
  // but within the CBR KZT daily series (2020-01-01..), never inject 2026-11-13 future rates.
  const earliestSnapshot = CBR_RATES_BY_DATE[snapshotDates[0]];
  const ref = bestSnapshot || earliestSnapshot;
  const effectiveAsOf = kztLookup.effectiveDate || (bestSnapshot ? bestSnapshot.asOf : iso);

  return {
    requestedDate: iso,
    asOf: effectiveAsOf,
    status: kztLookup.status === 'unavailable' ? 'unavailable' : bestSnapshot && bestSnapshot.asOf === iso ? 'official_cbr_dated' : 'official_cbr_effective',
    usdRub: ref.usdRub,
    kztRub: kztLookup.value,
    kztRawValue: kztLookup.rawValue,
    kztNominal: kztLookup.nominal ?? 100,
    kztEffectiveDate: kztLookup.effectiveDate,
    kztStatus: kztLookup.status,
    uzsPer10k: ref.uzsPer10k,
    cnyRub: ref.cnyRub,
    keyRate: bestSnapshot ? bestSnapshot.keyRate : 16.0,
    keyRateAsOf: bestSnapshot ? bestSnapshot.asOf : effectiveAsOf,
    sourceUrl: kztLookup.sourceUrl || ref.sourceUrl,
    keyRateUrl: ref.keyRateUrl,
  };
}

/**
 * Computes landed import parity (RUB/kg) and multi-factor market pressure indices
 * from FX rates, 4-hub weather forecasts, and spot marketplace quotes.
 */
export function computeMarketFactorAnalytics({
  fx,
  weatherHubs,
  spotChannels,
  baseWarehouseExVat = 15.5,
  today = '2026-11-13',
  exportSignals = null,
  disabledFactors = [],
  warehouseConditions = null,
  farmCreditRatePctYear = null,
  kzContractBasis = 'EXW_separate_freight',
}) {
  const disabled = sanitizeDisabledFactors(disabledFactors);
  const watchlist = buildExportWatchlist(exportSignals ?? EXPORT_SIGNAL_RECORDS, disabled);
  const datedRef = resolveDatedCbrMacro(today);
  const usdRub = fx?.usdRub?.value ?? datedRef.usdRub;
  const kztRub = fx?.kztRub?.value ?? datedRef.kztRub;
  const kztAsOf = fx?.kztRub?.effectiveDate || fx?.kztRub?.asOf || fx?.asOf || datedRef.kztEffectiveDate || datedRef.asOf;
  const uzsPer10k = fx?.uzsPer10k?.value ?? datedRef.uzsPer10k; // RUB per 10,000 UZS
  const keyRate = fx?.keyRate?.value ?? datedRef.keyRate;
  const keyRateAsOf = fx?.keyRate?.asOf || fx?.asOf || datedRef.keyRateAsOf;
  const effectiveCreditRate = Number.isFinite(Number(farmCreditRatePctYear))
    ? Number(farmCreditRatePctYear)
    : keyRate;

  // 1. Kazakhstan (Zhambyl / Taraz) landed parity to Volgograd / Southern RU
  // Base scenario uses 55 KZT/kg (corridor 34 / 55 / 75 KZT/kg, labelled as scenario_assumption)
  // Freight 116 000 RUB / 20 t = 5.80 RUB/kg is explicitly marked as estimate (assumption_pending_quotes)
  const kzExwKztKg = 55;
  const kzFreightRubKg = 5.8;
  const kzSortingBaggingRubKg = 0.7;
  const kzDocsPhytosanitaryRubKg = 0.25;
  const kzLossPct = 2.5;
  const kzSaleableFactor = 1 - kzLossPct / 100;
  const kzImporterMarginRubKg = 0.8;
  const kzPurchaseRubKg = Number.isFinite(kztRub) ? kzExwKztKg * kztRub : null;
  const kzSubTotalBeforeLoss =
    kzPurchaseRubKg !== null
      ? kzPurchaseRubKg + kzFreightRubKg + kzSortingBaggingRubKg + kzDocsPhytosanitaryRubKg
      : null;
  const kzLandedVolgogradExVat =
    kzSubTotalBeforeLoss !== null
      ? +(kzSubTotalBeforeLoss / kzSaleableFactor + kzImporterMarginRubKg).toFixed(2)
      : null;
  // EAEU import VAT (10%) is assessed on the customs contract base (EXW goods or DAP goods+freight),
  // NEVER on the importer's own resale margin (0.80 RUB/kg).
  const kzCustomsTaxBaseShippedRubKg =
    kzPurchaseRubKg === null
      ? null
      : kzContractBasis === 'DAP_included_freight'
        ? kzPurchaseRubKg + kzFreightRubKg
        : kzPurchaseRubKg;
  const kzImportVatRubKg =
    kzCustomsTaxBaseShippedRubKg !== null
      ? +((kzCustomsTaxBaseShippedRubKg * 0.1) / kzSaleableFactor).toFixed(2)
      : null;
  const kzLandedCashOutflowIncVat =
    kzLandedVolgogradExVat !== null && kzImportVatRubKg !== null
      ? +(kzLandedVolgogradExVat + kzImportVatRubKg).toFixed(2)
      : null;
  const kzSpreadVsLocal =
    kzLandedVolgogradExVat !== null ? +(kzLandedVolgogradExVat - baseWarehouseExVat).toFixed(2) : null;

  // 2. Uzbekistan (Surkhandarya / Termez) April early-crop landed parity
  const uzExwUzsKg = 2050;
  const uzRubKg = (uzExwUzsKg / 10000) * uzsPer10k;
  const uzEarlyLandedSouthExVat = +(uzRubKg + 6.4).toFixed(2);
  const uzEarlyLandedMoscowInclVat = +((uzRubKg + 9.2) * 1.1).toFixed(2);

  // 3. Egypt spring maritime parity (Alexandria -> Novorossiysk -> Moscow, $0.34/kg CIF+customs)
  const egLandedMoscowExVat = +(0.34 * usdRub).toFixed(2);

  // 4. Weather shock evaluation across the 4 key hubs
  const vlgMin = weatherHubs?.volgograd?.minTemp10d ?? 1.0;
  const zhmMin = weatherHubs?.zhambyl?.minTemp10d ?? 2.5;
  const uzMax = weatherHubs?.surkhandarya?.maxTemp10d ?? 21.0;
  const uzMin = weatherHubs?.surkhandarya?.minTemp10d ?? 8.0;
  const mskMin = weatherHubs?.moscow?.minTemp10d ?? -1.0;

  // Hub 1: Волгоград / Ростов / Астрахань (ЮФО):
  // P1.7: Outdoor temperature -2°C does NOT automatically trigger urgent sale or price dump.
  // Risk depends on indoor temperature, humidity, ventilation, and lot quality, or severe freeze (<= -5°C) for unheated sheds.
  const hasActiveVentilation = warehouseConditions?.hasActiveVentilation ?? true;
  const indoorTempC = warehouseConditions?.indoorTempC ?? 2.0;
  const indoorHumidityPct = warehouseConditions?.indoorHumidityPct ?? 72;
  const lotNeckRotPct = warehouseConditions?.neckRotPct ?? 1.5;
  const indoorStorageCompromised =
    (!hasActiveVentilation && (indoorTempC < 0 || indoorTempC > 6 || indoorHumidityPct > 85 || lotNeckRotPct > 5)) ||
    vlgMin <= -5;

  const vlgFrostDumpActive = indoorStorageCompromised;
  // At -2°C outdoor, vlgFrostDumpPct is 0 (no automatic urgent sale or price dump at -2°C)
  const vlgFrostDumpPct = indoorStorageCompromised ? (vlgMin <= -5 ? -1.5 : -0.8) : 0;
  const vlgWinterTighteningPct = vlgMin <= -5 ? 1.8 : 0;

  // Hub 2: Жамбыл / Тараз (Казахстан):
  // Морозы ниже −8°C перемерзают казахстанские бурты и парализуют экспорт в РФ
  const kzFrostShockActive = zhmMin <= -8;
  const kzFrostShockPct = zhmMin <= -14 ? 6.5 : zhmMin <= -8 ? 3.2 : zhmMin >= 3 ? -1.2 : 0;

  // Hub 3: Термез / Сурхандарья (Узбекистан):
  const uzWarmSpringActive = uzMax >= 22 || uzMin >= 10;
  const uzWarmSpringShiftPct = uzMax >= 24 ? -1.8 : uzWarmSpringActive ? -1.0 : 0;

  // Hub 4: Москва (РЦ и оптовые базы):
  const mskReeferRequired = mskMin <= -10;
  const mskReeferSurchargeRubKg = mskMin <= -10 || vlgMin <= -10 ? 2.0 : mskMin <= -5 ? 0.8 : 0;

  // Import pressure in November: if KZ landed parity is close to or below local EXW, transit caps prices
  const kzAutumnCapPct =
    kzSpreadVsLocal === null ? 0 : kzSpreadVsLocal <= 0 ? -2.2 : kzSpreadVsLocal <= 1.2 ? -1.0 : 0.4;

  // Monthly financing opportunity cost per kg at official CBR key rate and farm credit rate
  const monthlyFinancingCostRubKg = +(baseWarehouseExVat * (keyRate / 100) / 12).toFixed(2);
  const monthlyFarmCreditCostRubKg = +(baseWarehouseExVat * (effectiveCreditRate / 100) / 12).toFixed(2);

  // Spot Volgograd consensus across clean `ask` boards (minus ~0.3 RUB/kg typical ask->deal discount)
  const vlgAskMedians = (spotChannels || [])
    .filter((c) => c.region === 'Волгоградская обл.' && c.basis === 'ask' && Number.isFinite(c.priceExVat))
    .map((c) => c.priceExVat);
  const rawAskMedian = median(vlgAskMedians) ?? 15.25;
  const impliedDealSpotExVat = +Math.max(12.0, rawAskMedian - 0.25).toFixed(2);

  // Composite Market Tension Score (-100 bearish surplus .. +100 bullish deficit)
  const month = Number(String(today).slice(5, 7)) || 11;
  const seasonalTension = month >= 10 && month <= 11 ? -14 : month === 12 ? 18 : month >= 1 && month <= 3 ? 34 : -10;
  const tensionScore = Math.max(
    -100,
    Math.min(
      100,
      Math.round(
        seasonalTension +
          kzAutumnCapPct * 6 +
          kzFrostShockPct * 7 +
          (kzSpreadVsLocal !== null && kzSpreadVsLocal > 1.5 ? 10 : -6) +
          (keyRate >= 18 ? -5 : 2)
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
    watchlist,
    parity: {
      kzLandedVolgogradExVat,
      kzImportVatRubKg,
      kzLandedCashOutflowIncVat,
      kzContractBasis,
      kzSpreadVsLocal,
      kzExwKztKg,
      kzExwEvidenceStatus: 'scenario_assumption',
      kzFreightRubKg,
      kzFreightEvidenceStatus: 'estimate',
      kztRub,
      kztAsOf,
      uzEarlyLandedSouthExVat,
      uzEarlyLandedMoscowInclVat,
      egLandedMoscowExVat,
      mskReeferSurchargeRubKg,
    },
    hubAlerts: {
      volgograd: {
        active: vlgFrostDumpActive,
        minTemp: vlgMin,
        title: 'Волгоград / Ростов / Астрахань (ЮФО)',
        rule: 'Наружная температура −2°C сама по себе не требует срочной распродажи из вентилируемых хранилищ; риск оценивается по температуре и влажности внутри склада, вентиляции и качеству партии.',
        status: vlgFrostDumpActive
          ? 'РИСК ВНУТРИ НЕВЕНТИЛИРУЕМОГО СКЛАДА'
          : 'Штатный режим внутри вентилируемых камер',
      },
      zhambyl: {
        active: kzFrostShockActive,
        minTemp: zhmMin,
        title: 'Жамбыл / Тараз (Казахстан)',
        rule: 'Морозы ниже −8°C перемерзают казахстанские бурты и парализуют экспорт в РФ (бычий фактор: цены в РФ сразу получают толчок вверх).',
        status: kzFrostShockActive ? 'ИМПОРТНЫЙ ШОК: БУРТЫ ЗАМЁРЗЛИ' : 'Штатный транзит в РФ',
      },
      surkhandarya: {
        active: uzWarmSpringActive,
        maxTemp: uzMax,
        title: 'Термез / Сурхандарья (Узбекистан)',
        rule: 'Аномально теплая весна в феврале-марте смещает начало поставок раннего лука на 1–2 недели вперед (ранний слом цен старого урожая).',
        status: uzWarmSpringActive ? 'УСКОРЕНИЕ РАННЕГО УРОЖАЯ' : 'Штатная вегетация озимого лука',
      },
      moscow: {
        active: mskReeferRequired,
        minTemp: mskMin,
        title: 'Москва (РЦ и оптовые базы)',
        rule: 'Морозы ниже −10°C требуют обязательного использования отапливаемых рефрижераторов (+1.5–2.5 ₽/кг к логистике).',
        status: mskReeferRequired ? 'ОБЯЗАТЕЛЬНЫЙ ОТАПЛИВАЕМЫЙ РЕФ' : 'Штатная доставка изотермой/тентом',
      },
    },
    macroTransmission: {
      kztParityNote: Number.isFinite(kztRub)
        ? `Курс ЦБ РФ (R01335) на ${kztAsOf}: ${kztRub.toFixed(6)} ₽/₸ (100 ₸ = ${(kztRub * 100).toFixed(4)} ₽). Ослабление рубля к тенге удорожает казахстанский импорт.`
        : `Курс ЦБ РФ (R01335) на запрошенную дату ${today} недоступен.`,
      financingNote: `Ключевая ставка Банка России на ${keyRateAsOf}: ${keyRate.toFixed(1)}% годовых (~${monthlyFinancingCostRubKg} ₽/кг в мес.). Фактическая стоимость кредита хозяйства учитывается отдельно (8% льготный / 14% ЦБ / 19% коммерческий: ~${monthlyFarmCreditCostRubKg} ₽/кг в мес.).`,
      cbrKeyRatePct: keyRate,
      cbrKeyRateAsOf: keyRateAsOf,
      farmCreditRatePct: effectiveCreditRate,
      monthlyFinancingCostRubKg,
      monthlyFarmCreditCostRubKg,
    },
    storageTiers: STORAGE_TIERS,
    disabledFactors: disabled,
    impulses: applyDisabledToImpulses(
      {
        vlgFrostDumpPct,
        vlgWinterTighteningPct,
        kzFrostShockPct,
        kzAutumnCapPct,
        fxParityShiftPct: Number.isFinite(kztRub)
          ? +(((kztRub - 0.186573) / 0.186573) * 35 + ((usdRub - 91) / 91) * 15).toFixed(2)
          : 0,
        uzWarmSpringShiftPct,
      },
      disabled
    ),
  };
}

/**
 * Verified baseline snapshot using official CBR rates dated to `today` (default 2026-11-13:
 * keyRate = 14.0%, kztRub = 0.186573 RUB/KZT; or historical point-in-time CBR R01335 rate when requested).
 */
export function buildDefaultMarketSignals(today = '2026-11-13', baseWarehouseExVat = 15.5) {
  const dated = resolveDatedCbrMacro(today);
  const fx = {
    requestedDate: dated.requestedDate,
    asOf: dated.asOf,
    status: dated.status,
    usdRub: { value: dated.usdRub, asOf: dated.asOf, changePct: 0.4, source: `ЦБ РФ на ${dated.asOf}` },
    kztRub: {
      value: dated.kztRub,
      rawValue: dated.kztRawValue,
      nominal: dated.kztNominal,
      valutaId: 'R01335',
      asOf: dated.kztEffectiveDate || dated.asOf,
      effectiveDate: dated.kztEffectiveDate,
      requestedDate: dated.requestedDate,
      status: dated.kztStatus,
      changePct: -0.2,
      source: Number.isFinite(dated.kztRub)
        ? `ЦБ РФ R01335 на ${dated.kztEffectiveDate} (100 ₸ = ${(dated.kztRub * 100).toFixed(4)} ₽)`
        : 'Курс ЦБ РФ недоступен на запрошенную дату',
      sourceUrl: dated.sourceUrl,
    },
    uzsPer10k: {
      value: dated.uzsPer10k,
      asOf: dated.asOf,
      changePct: -0.1,
      source: `ЦБ РФ на ${dated.asOf} (10 000 сум = ${dated.uzsPer10k.toFixed(2)} ₽)`,
    },
    cnyRub: { value: dated.cnyRub, asOf: dated.asOf, changePct: 0.3, source: `ЦБ РФ на ${dated.asOf}` },
    keyRate: {
      value: dated.keyRate,
      asOf: dated.keyRateAsOf,
      changePct: 0,
      source: `Банк России на ${dated.keyRateAsOf} (cbr.ru/hd_base/KeyRate/)`,
      sourceUrl: dated.keyRateUrl,
    },
  };

  const weatherHubs = {
    volgograd: {
      id: 'volgograd',
      name: 'Волгоград / Ростов / Астрахань (ЮФО)',
      role: 'Сырьевая база и склады EXW',
      status: 'snapshot',
      minTemp10d: -1.2,
      maxTemp10d: 11.4,
      precipMm10d: 6.2,
      frostDays: 2,
      summary: 'Ночные переходы к −1..−2°C: для вентилируемых складов режим штатный; риск касается только необорудованных буртов/ангаров при высокой влажности и гнили.',
    },
    zhambyl: {
      id: 'zhambyl',
      name: '🇰🇿 Жамбыл / Тараз (Казахстан)',
      role: 'Импорт №1 (48% ввоза РФ)',
      status: 'snapshot',
      minTemp10d: 1.8,
      maxTemp10d: 15.2,
      precipMm10d: 3.1,
      frostDays: 0,
      summary: 'Штатный осенний транзит в РФ; морозы ниже −8°C перемерзают казахстанские бурты и дают толчок росту цен в РФ',
    },
    surkhandarya: {
      id: 'surkhandarya',
      name: '🇺🇿 Термез / Сурхандарья (Узбекистан)',
      role: 'Ранний озимый лук (апрельский потолок)',
      status: 'snapshot',
      minTemp10d: 8.4,
      maxTemp10d: 22.6,
      precipMm10d: 0.8,
      frostDays: 0,
      summary: 'Благоприятная вегетация озимого лука: аномальное тепло смещает старт экспорта в РФ на 1–2 недели вперёд (ранний слом цен старого фонда)',
    },
    moscow: {
      id: 'moscow',
      name: 'Москва (Фуд Сити / РЦ сетей)',
      role: 'Крупный опт и приёмка сетей',
      status: 'snapshot',
      minTemp10d: -2.0,
      maxTemp10d: 7.5,
      precipMm10d: 11.4,
      frostDays: 3,
      summary: 'Штатная доставка изотермой по М-6; морозы ниже −10°C требуют обязательного использования отапливаемых рефрижераторов (+1.5–2.5 ₽/кг к логистике)',
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
