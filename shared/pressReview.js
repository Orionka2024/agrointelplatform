/**
 * Daily press review: pulls fresh headlines from Google News RSS (aggregates Reuters, EastFruit,
 * FreshPlaza, Kun.uz, 964media, TASS, Interfax and others), filters them to onion-market-relevant
 * topics, flags trusted sources and removes duplicates.
 *
 * Headlines are NEVER scored automatically: they are candidates for a human to promote into
 * data/market-events.json (with confirmed true/false) after checking the original article.
 */

const gnUrl = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:3d')}&hl=ru&gl=RU&ceid=RU:ru`;

/** topic id -> search queries and relevance matcher applied to the headline */
export const PRESS_TOPICS = [
  {
    id: 'uz',
    flag: '🇺🇿',
    label: 'Узбекистан',
    queries: ['лук Узбекистан цены экспорт', 'Uzbekistan onion export price'],
    match: /^(?=.*(лук|onion|пиёз|piyoz))(?=.*(узбек|uzbek|ўзбек))/i,
  },
  {
    id: 'kz',
    flag: '🇰🇿',
    label: 'Казахстан',
    queries: ['лук Казахстан цены экспорт', 'Kazakhstan onion export'],
    match: /^(?=.*(лук|onion))(?=.*(казах|kazakh))/i,
  },
  {
    id: 'ir',
    flag: '🇮🇷',
    label: 'Иран',
    queries: ['Iran onion export', 'иранский лук экспорт'],
    match: /^(?=.*(onion|лук))(?=.*(иран|iran|iranian|bonab))/i,
  },
  {
    id: 'iq',
    flag: '🇮🇶',
    label: 'Ирак',
    queries: ['Iraq onion import', 'Iraq import ban vegetables onions', 'Iraq Iran border crossing'],
    match: /^(?=.*(ирак|iraq|iraqi|kurdistan|курдистан))(?=.*(onion|лук|vegetable|овощ|border|crossing|пограничн|переход))/i,
  },
  {
    id: 'cis_other',
    flag: '🌍',
    label: 'Регион (Киргизия, Таджикистан, Турция, Египет)',
    queries: ['onion prices Kyrgyzstan Tajikistan', 'Turkey Egypt onion export'],
    match: /^(?=.*(onion|лук))(?=.*(таджик|tajik|киргиз|kyrgyz|турци|turkey|turkish|египет|egypt|морокк|марокк|morocco|китай|china|азербайджан|azerbaijan|индия|india|пакистан|pakistan))/i,
  },
  {
    id: 'ru_onion',
    flag: '🇷🇺',
    label: 'Россия / Волгоград',
    queries: ['лук репчатый цены опт', 'лук Волгоградская область', 'лук урожай Россия цены'],
    match: /^(?=.*(лук|onion))(?=.*(росси|рф\b|russia|волгоград|астрахан|дагестан|ставрополь|ростов|краснодар|воронеж|самар|нижегород))/i,
  },
];

/** Headlines about gardening / cooking etc. that merely contain the word 'лук' */
const NOISE = /посадк|посадить|огород|дач[аеи]|рассад|стрелк|грядк|рецепт|приготов|похуд|здоровь|гороскоп|севок/i;

/** Lower-case source-name fragments treated as reliable / primary */
export const TRUSTED_SOURCES = [
  'reuters',
  'eastfruit',
  'east-fruit',
  'freshplaza',
  'kun.uz',
  'gov.uz',
  'interfax',
  'tass',
  'тасс',
  'риа новости',
  'ukragroconsult',
  'агроинвестор',
  'ab-centre',
  'аб-центр',
  'rusagridata',
  'гтрк',
  '964media',
  'shafaq',
  'rudaw',
  'bloomberg',
  'fruitnet',
  'uzdaily',
  'kazinform',
  'forbes',
  'коммерсант',
  'rbc',
  'ргк',
];

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

export function parseGoogleNewsRss(xml) {
  const items = [];
  for (const block of String(xml || '').split('<item>').slice(1)) {
    let title = tag(block, 'title');
    const link = tag(block, 'link');
    const pubDate = tag(block, 'pubDate');
    const srcMatch = block.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i);
    let source = srcMatch ? decodeEntities(srcMatch[2]) : '';
    const sourceUrl = srcMatch ? srcMatch[1] : '';
    // Google appends " - Source" to titles
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const ts = Date.parse(pubDate);
    if (!title || !Number.isFinite(ts)) continue;
    items.push({ title, link, source: source || 'н/д', sourceUrl, publishedAt: new Date(ts).toISOString() });
  }
  return items;
}

export function isTrustedSource(source, sourceUrl = '') {
  const hay = `${source} ${sourceUrl}`.toLowerCase();
  return TRUSTED_SOURCES.some((t) => hay.includes(t));
}

function normTitle(t) {
  return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 70);
}

/**
 * Builds the review from raw feed results.
 * @param {Array<{topic: object, items: Array}>} results
 * @param {{now?: number, maxAgeHours?: number, perTopic?: number, total?: number}} opts
 */
export function buildPressReview(results, { now = Date.now(), maxAgeHours = 72, perTopic = 2, total = 8 } = {}) {
  // Pool every fetched headline, then assign each to the first topic whose matcher accepts it
  // (topics are ordered specific -> general), so an item is judged on its own content, not on the query.
  const pool = results.flatMap((r) => r.items);
  const trustedRank = (i) => Number(isTrustedSource(i.source, i.sourceUrl));
  pool.sort((a, b) => trustedRank(b) - trustedRank(a) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const seen = new Set();
  const groups = new Map();
  for (const it of pool) {
    const ageH = (now - Date.parse(it.publishedAt)) / 3600000;
    if (ageH > maxAgeHours || ageH < -2 || NOISE.test(it.title)) continue;
    const topic = PRESS_TOPICS.find((t) => t.match.test(it.title));
    if (!topic) continue;
    const key = normTitle(it.title);
    if (seen.has(key)) continue;
    const g = groups.get(topic.id) || { topic, items: [] };
    if (g.items.length >= perTopic) continue;
    seen.add(key);
    g.items.push({ ...it, topic: topic.id, trusted: isTrustedSource(it.source, it.sourceUrl) });
    groups.set(topic.id, g);
  }

  const byTopic = PRESS_TOPICS.map((t) => groups.get(t.id)).filter(Boolean);

  // enforce overall cap, keeping at least the top item of each topic
  let flat = byTopic.flatMap((g) => g.items);
  if (flat.length > total) {
    const keep = new Set(byTopic.map((g) => g.items[0]));
    const extra = flat.filter((i) => !keep.has(i)).slice(0, Math.max(0, total - keep.size));
    const allowed = new Set([...keep, ...extra]);
    for (const g of byTopic) g.items = g.items.filter((i) => allowed.has(i));
    flat = byTopic.flatMap((g) => g.items);
  }
  return { generatedAt: new Date(now).toISOString(), groups: byTopic, count: flat.length };
}

export async function fetchPressReview({ fetchImpl = fetch, timeoutMs = 8000, now = Date.now() } = {}) {
  const results = await Promise.all(
    PRESS_TOPICS.map(async (topic) => {
      const settled = await Promise.allSettled(
        topic.queries.map((q) =>
          fetchImpl(gnUrl(q), { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgroIntel/1.0)' }, signal: AbortSignal.timeout(timeoutMs) }).then(
            (r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
          )
        )
      );
      const items = settled.flatMap((s) => (s.status === 'fulfilled' ? parseGoogleNewsRss(s.value) : []));
      const failed = settled.filter((s) => s.status === 'rejected').length;
      return { topic, items, failed };
    })
  );
  const review = buildPressReview(results, { now });
  review.feedErrors = results.reduce((n, r) => n + r.failed, 0);
  review.feedsTotal = results.reduce((n, r) => n + r.topic.queries.length, 0);
  return review;
}
