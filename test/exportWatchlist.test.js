import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExportWatchlist, watchlistLogOffset, watchWeekWeight, WATCH_HORIZON_WEEKS } from '../shared/exportWatchlist.js';
import { EXPORT_SIGNAL_RECORDS } from '../shared/exportSignalsData.js';
import { computeMarketFactorAnalytics } from '../shared/marketSignals.js';
import { buildShortTermDrivers } from '../shared/shortTermDrivers.js';
import { parseRssItems, classifyHeadlines, mergeDetectedSignals } from '../shared/newsSignals.js';
import { sanitizeDisabledFactors } from '../shared/factorToggles.js';

test('Export watchlist - shipped records are unconfirmed and do not move the forecast', () => {
  const wl = buildExportWatchlist(EXPORT_SIGNAL_RECORDS);
  assert.equal(wl.items.length, 4);
  assert.ok(wl.items.every((i) => i.state === 'unknown' && !i.quantified));
  assert.equal(wl.totalPeakPct, 0);
  assert.equal(computeMarketFactorAnalytics({}).watchlist.totalPeakPct, 0);
});

test('Export watchlist - direction without sourced magnitude does not move the price', () => {
  const wl = buildExportWatchlist({ iraqImport: { state: 'up', asOf: '2026-11-20' } });
  assert.equal(wl.items[0].state, 'up');
  assert.equal(wl.items[0].quantified, false);
  assert.equal(wl.totalPeakPct, 0);
});

test('Export watchlist - quantified and sourced signal fades over the 6-week window', () => {
  const wl = buildExportWatchlist({ volgogradBids: { state: 'raised', impactPct: 2, source: 'https://example.org/bids' } });
  assert.ok(wl.totalPeakPct > 0);
  assert.ok(watchlistLogOffset(wl, 3) > watchlistLogOffset(wl, 1));
  assert.ok(watchlistLogOffset(wl, 6) < watchlistLogOffset(wl, 4));
  assert.equal(watchWeekWeight(WATCH_HORIZON_WEEKS + 1), 0);
  assert.equal(watchlistLogOffset(wl, 7), 0);
});

test('Export watchlist - unknown state names and unsourced magnitudes are ignored', () => {
  const wl = buildExportWatchlist({ iranCorridor: { state: 'bogus', impactPct: 3, source: 'x' }, cisExportPrices: { state: 'rising', impactPct: 3 } });
  assert.equal(wl.items[1].state, 'unknown');
  assert.equal(wl.items[2].quantified, false);
  assert.equal(wl.totalPeakPct, 0);
});

test('Short-term drivers - only inside the 6-week window, key rate never moves price', () => {
  const live = { analytics: computeMarketFactorAnalytics({}), fx: {}, weatherHubs: {} };
  assert.equal(buildShortTermDrivers(live, 7, 'STORAGE_SHIFT'), null);
  const p = buildShortTermDrivers(live, 1, 'KZ_TRANSIT_SHEDS');
  assert.equal(p.items.length, 5);
  assert.equal(p.items.find((i) => i.id === 'keyRate').appliedPct, 0);
  assert.equal(p.items.find((i) => i.id === 'uzParity').appliedPct, 0);
});

test('Automated news classifier - detects clear direction, rejects conflicting headlines, never invents impactPct', () => {
  const rss = `
    <rss><channel>
      <item>
        <title>Ирак возобновил импорт лука из Узбекистана</title>
        <link>https://news.example/iraq-up</link>
        <pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate>
        <source>ExampleMedia</source>
      </item>
      <item>
        <title>На границе Ирана закрыт погранпункт для грузовых фур</title>
        <link>https://news.example/iran-1</link>
        <pubDate>Tue, 10 Nov 2026 11:00:00 GMT</pubDate>
      </item>
      <item>
        <title>На границе Ирана открыт переход для грузовиков</title>
        <link>https://news.example/iran-2</link>
        <pubDate>Tue, 10 Nov 2026 12:00:00 GMT</pubDate>
      </item>
    </channel></rss>
  `;
  const items = parseRssItems(rss);
  assert.equal(items.length, 3);
  const detected = classifyHeadlines(items, '2026-11-13');
  assert.equal(detected.iraqImport?.state, 'up');
  assert.equal(detected.iranCorridor, undefined);
  const merged = mergeDetectedSignals(EXPORT_SIGNAL_RECORDS, detected);
  const wl = buildExportWatchlist(merged);
  assert.equal(wl.items.find((i) => i.id === 'iraqImport').state, 'up');
  assert.equal(wl.totalPeakPct, 0);
});

test('Factor toggles - disabling a factor zeroes its watchlist and model impulse influence', () => {
  const exportSignals = {
    volgogradBids: { state: 'raised', impactPct: 2.0, source: 'https://example.org/bids' },
  };
  const on = computeMarketFactorAnalytics({
    weatherHubs: { volgograd: { minTemp10d: -6 } },
    exportSignals,
    disabledFactors: [],
  });
  const off = computeMarketFactorAnalytics({
    weatherHubs: { volgograd: { minTemp10d: -6 } },
    exportSignals,
    disabledFactors: sanitizeDisabledFactors(['volgogradBids', 'weather', 'bogus']),
  });
  assert.ok(on.watchlist.totalPeakPct > 0);
  assert.equal(off.watchlist.totalPeakPct, 0);
  assert.ok(on.impulses.vlgFrostDumpPct !== 0);
  assert.equal(off.impulses.vlgFrostDumpPct, 0);
  assert.equal(off.impulses.vlgWinterTighteningPct, 0);
});
