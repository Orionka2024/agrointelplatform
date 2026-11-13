/**
 * Automated detection of watchlist signal states from published news headlines.
 *
 * Only DIRECTION is detected, and only when a headline matches strict keyword rules; each
 * detected state carries the headline, link and date as its source. Conflicting headlines
 * (both directions) leave the signal unknown. Magnitudes are NEVER inferred from news, so a
 * detected state shows on the forecast cards but does not move the price unless a sourced
 * `impactPct` exists (see exportWatchlist.js).
 */

export const NEWS_QUERIES = [
  'Ирак импорт лука',
  'Иран граница торговля грузовики',
  'экспорт лука Узбекистан Казахстан цена',
];

const MAX_AGE_DAYS = 30;

const has = (text, re) => re.test(text);

// JS `\b` ignores Cyrillic, so word starts/ends are expressed with Unicode lookarounds.
const W = String.raw`(?<![\p{L}])`;
const E = String.raw`(?![\p{L}])`;
const re = (src) => new RegExp(src, 'iu');

const ONION = re(`${W}(лук|onions?)`);

const RULES = {
  iraqImport: {
    scope: (t) => has(t, re(`${W}(ирак|iraq)`)) && has(t, ONION),
    up: (t) => has(t, re(`(возобнов|разреш|отмен|открыл|сняли запрет|увелич|нарастил|reopen|lift|resum|increase)`)),
    down: (t) =>
      has(t, re(`(запрет|ограничи|квот|приостанов|${W}ban${E}|restrict|suspend|quota)`)) &&
      !has(t, re(`(lift|reopen|resum|сня[лт]|отмен|возобнов|разреш).{0,40}(ban|запрет|restrict|ограничен)|(ban|запрет|restrict|ограничен).{0,40}(lifted|снят|отмен)`)),
  },
  iranCorridor: {
    scope: (t) =>
      has(t, re(`${W}(иран|iran)`)) &&
      has(t, re(`(граница|границ|переход|погранпункт|checkpoint|border|crossing)`)) &&
      has(t, re(`(грузов|${W}фур|торгов|truck|cargo|trade)`)),
    up: (t) => has(t, re(`(закрыт|ограничен|приостанов|closed|restrict|suspend)`)),
    down: (t) => has(t, re(`(открыт|возобнов|reopen|resum)`)),
  },
  cisExportPrices: {
    scope: (t) => has(t, re(`(узбекистан|казахстан|uzbekistan|kazakhstan)`)) && has(t, ONION) && has(t, re(`(цен|price)`)),
    up: (t) => has(t, re(`(${W}рост${E}|вырос|подорож|повыш|${W}rise|${W}rose${E}|increase|${W}up${E})`)),
    down: (t) => has(t, re(`(${W}падени|${W}пад(а|ают|ает)${E}|снизи|подешев|удешев|${W}fall|${W}drop|declin|${W}down${E})`)),
  },
};

const STATE_MAP = {
  iraqImport: { up: 'up', down: 'down' },
  iranCorridor: { up: 'restricted', down: 'open' },
  cisExportPrices: { up: 'rising', down: 'falling' },
};

function decodeXml(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Parses RSS 2.0 <item> blocks into { title, link, pubDate(ISO), source }. */
export function parseRssItems(xml) {
  const items = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => decodeXml((m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) || [])[1] || '').trim();
    const d = new Date(pick('pubDate'));
    const title = pick('title');
    const link = pick('link');
    if (!title || !link || Number.isNaN(d.getTime())) continue;
    items.push({ title, link, pubDate: d.toISOString(), source: pick('source') || null });
  }
  return items;
}

/**
 * @param {Array<{title,link,pubDate,source}>} items
 * @param {string} today ISO date (YYYY-MM-DD)
 * @returns {Record<string, {state, asOf, source, evidenceTitle, evidenceSource}>} records for confirmed signals only
 */
export function classifyHeadlines(items, today) {
  const nowMs = Date.parse(`${today}T23:59:59Z`);
  const fresh = (items || []).filter((it) => {
    const age = (nowMs - Date.parse(it.pubDate)) / 86400000;
    return age >= 0 && age <= MAX_AGE_DAYS;
  });
  const out = {};
  for (const [id, rule] of Object.entries(RULES)) {
    const hits = { up: [], down: [] };
    for (const it of fresh) {
      if (!rule.scope(it.title)) continue;
      const u = rule.up(it.title);
      const d = rule.down(it.title);
      if (u && !d) hits.up.push(it);
      else if (d && !u) hits.down.push(it);
    }
    // Conflicting directions -> not confirmed.
    if ((hits.up.length > 0) === (hits.down.length > 0)) continue;
    const dir = hits.up.length ? 'up' : 'down';
    const newest = hits[dir].sort((a, b) => b.pubDate.localeCompare(a.pubDate))[0];
    out[id] = {
      state: STATE_MAP[id][dir],
      asOf: newest.pubDate.slice(0, 10),
      source: newest.link,
      evidenceTitle: newest.title,
      evidenceSource: newest.source,
    };
  }
  return out;
}

/** Merges auto-detected records over the static context records without creating magnitudes. */
export function mergeDetectedSignals(base, detected) {
  const out = {};
  for (const id of new Set([...Object.keys(base || {}), ...Object.keys(detected || {})])) {
    const b = base?.[id] || {};
    const d = detected?.[id];
    out[id] = d ? { ...b, ...d, impactPct: b.impactPct } : { ...b };
  }
  return out;
}
