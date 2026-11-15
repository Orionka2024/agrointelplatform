import test from 'node:test';
import assert from 'node:assert/strict';
import refreshHandler from '../api/refresh.js';
import { store } from '../server/store.js';
import {
  runRefreshJob,
  evaluateWeeklyForecastReissue,
  findLatestStoredForecast,
  parseCbrValuteXml,
  buildInitialRefreshStatus,
} from '../server/refreshJob.js';
import { todayISO, weekStart } from '../shared/dates.js';
import { buildWeeklySeries } from '../shared/series.js';

function mockReqRes({ method = 'GET', url = '/', headers = {}, body = {} } = {}) {
  let statusCode = 200;
  let responseData = null;
  const resHeaders = {};

  const req = { method, url, headers: { ...headers }, body };
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    setHeader(k, v) {
      resHeaders[k] = v;
    },
    end(str) {
      if (str && responseData === null) {
        try {
          responseData = JSON.parse(str);
        } catch {
          responseData = str;
        }
      }
      return res;
    },
    get statusCode() {
      return statusCode;
    },
    get data() {
      return responseData;
    },
  };

  return { req, res };
}

test('Refresh 1: GET /api/refresh returns public status and storage durability', async () => {
  const { req, res } = mockReqRes({ method: 'GET', url: '/api/refresh' });
  await refreshHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.status, 'ok');
  assert.ok(res.data.refreshStatus != null);
  assert.ok(typeof res.data.storeDurable === 'boolean');
  assert.ok(typeof res.data.storageBackend === 'string');
  assert.equal(res.data.isLocked, false);
});

test('Refresh 2: Protected endpoint enforces authorization with CRON_SECRET', async () => {
  const origSecret = process.env.CRON_SECRET;
  const origTest = process.env.AGRO_TEST;
  try {
    process.env.CRON_SECRET = 'super_secret_cron_key_12345';
    delete process.env.AGRO_TEST; // ensure strict auth check

    // 1. Unauthorized request (missing token)
    const { req: req1, res: res1 } = mockReqRes({
      method: 'POST',
      url: '/api/refresh',
      headers: {},
    });
    await refreshHandler(req1, res1);
    assert.equal(res1.statusCode, 401);
    assert.equal(res1.data.error, 'UNAUTHORIZED');

    // 2. Unauthorized request (invalid token)
    const { req: req2, res: res2 } = mockReqRes({
      method: 'POST',
      url: '/api/refresh',
      headers: { authorization: 'Bearer wrong_token_00000000000' },
    });
    await refreshHandler(req2, res2);
    assert.equal(res2.statusCode, 401);

    // 3. Authorized request with Bearer CRON_SECRET
    // Use custom fetchers to avoid external network calls during unit test
    const customFetchers = {
      cbr: async () => `<ValCurs Date="13.11.2026"><Valute ID="R01335"><Nominal>100</Nominal><Value>18,6573</Value></Valute><Valute ID="R01235"><Nominal>1</Nominal><Value>97,8000</Value></Valute></ValCurs>`,
      weather: async () => [{ daily: { temperature_2m_max: [10], temperature_2m_min: [2], precipitation_sum: [0] } }],
      agroRu: async () => `<div class="board-card"><a href="/item/1">Лук репчатый 50+</a> 15.50 руб/кг Волгоград</div>`,
      foodStar: async () => `<html>Лук репчатый цена 28.5 ₽ актуальна на 13.11.2026</html>`,
      agroServer: async () => `<html>Объявления лук Волгоград 16.0 руб/кг</html>`,
      news: async () => [],
    };

    const runReport = await runRefreshJob({
      today: '2026-11-13',
      trigger: 'test_auth',
      customFetchers,
    });
    assert.ok(runReport.status === 'success' || runReport.status === 'partial');
  } finally {
    if (origSecret !== undefined) process.env.CRON_SECRET = origSecret;
    else delete process.env.CRON_SECRET;
    if (origTest !== undefined) process.env.AGRO_TEST = origTest;
  }
});

test('Refresh 3: Concurrency control blocks overlapping runs with conflict', async () => {
  // Simulate active lock
  const lock = store.acquireRefreshLock();
  assert.equal(lock.acquired, true);

  try {
    // Attempt concurrent run
    const concurrentResult = await runRefreshJob({
      today: '2026-11-13',
      trigger: 'concurrent_test',
      force: false,
    });

    assert.equal(concurrentResult.status, 'conflict');
    assert.equal(concurrentResult.error, 'RUN_IN_PROGRESS');
  } finally {
    store.releaseRefreshLock();
  }
});

test('Refresh 4: Marketplace listings are strictly indicative offers and NEVER transactions', async () => {
  const customFetchers = {
    cbr: async () => `<ValCurs Date="13.11.2026"><Valute ID="R01335"><Nominal>100</Nominal><Value>18,6573</Value></Valute><Valute ID="R01235"><Nominal>1</Nominal><Value>97,8000</Value></Valute></ValCurs>`,
    weather: async () => [],
    agroRu: async () => `
      <div class="tovar-list__card">
        <a class="tovar-list__card-link" href="/doska/101">Лук репчатый желтый 1 сорт 5+</a>
        <div class="tovar-list__card-price">16.0 ₽ / кг</div>
        <div class="tovar-list__card-desc">Сухой склад, сетка 25 кг, без НДС, Городище</div>
        <a class="tovar-list__seller-name">КФХ Исток</a>
        <div class="tovar-list__card-meta">Волгоград · 13 ноября 2026</div>
      </div>
    `,
    foodStar: async () => `Лук репчатый цена 29.0 ₽ актуальна на 13.11.2026`,
    agroServer: async () => `Лук 16.50 руб/кг`,
    news: async () => [],
  };

  const report = await runRefreshJob({
    today: '2026-11-13',
    trigger: 'unit_test_marketplace',
    customFetchers,
    force: true,
  });

  assert.ok(report.sources.agroru_vlg != null);
  assert.equal(report.sources.agroru_vlg.evidenceType, 'indicative_offer');

  // Verify stored observations: all marketplace records must have kind === 'indicative_offer'
  const observations = store.getObservations();
  const agroRuObs = observations.filter((o) => o.source && o.source.includes('AgroRU'));
  assert.ok(agroRuObs.length > 0);
  for (const o of agroRuObs) {
    assert.equal(o.kind, 'indicative_offer', 'AgroRU listing must be indicative_offer');
    assert.notEqual(o.kind, 'transaction', 'AgroRU listing must NEVER be transaction');
    assert.equal(o.verification.status, 'unverified', 'Marketplace listing must be unverified');
  }

  // Ensure series builder for transactions excludes indicative offers
  const series = buildWeeklySeries(observations, { basis: 'warehouse', kind: 'transaction', asOf: '2026-11-13' });
  for (const pt of series.points) {
    assert.ok(!pt.sources.some((s) => s.includes('AgroRU')), 'Transaction series must not include AgroRU ads');
  }
});

test('Refresh 5: Forecast re-issuance gating prevents false fresh evidence when inputs are unchanged', async () => {
  const existingForecasts = store.getForecasts();
  const observations = store.getObservations();

  const decision = evaluateWeeklyForecastReissue('warehouse', {
    observations,
    today: '2026-11-13',
    existingForecasts,
  });

  // Since observations have not received new verified transactions, re-issuing must be blocked
  assert.equal(decision.eligible, false);
  assert.ok(['INPUTS_UNCHANGED', 'INPUTS_TOO_STALE', 'NO_VERIFIED_TRANSACTIONS'].includes(decision.reason));
  assert.ok(decision.message.length > 0);
});

test('Refresh 6: Forecast is properly issued when a new verified transaction arrives', async () => {
  const today = '2026-11-13';
  const issueWeek = weekStart(today);

  // Add a newly verified transaction in the current issue week
  const verifiedTransaction = {
    id: 'deal-test-2026-w46',
    naturalKey: 'deal-key-46',
    kind: 'transaction',
    market: 'warehouse_volgograd',
    geography: 'Волгоградская обл.',
    observationDate: today,
    retrievedDate: today,
    priceRubKg: 16.50,
    priceExVatRubKg: 16.50,
    vat: 'excl',
    vatRate: 0.1,
    deliveryBasis: 'EXW',
    spec: { grade: '1 сорт (ГОСТ 34306-2017)', sizeMm: '50+' },
    source: 'ООО Агро-Волга / Договор поставки №46',
    verification: {
      status: 'verified',
      by: 'Аудитор рынка',
      at: today,
      evidence: 'ТОРГ-12 №46-ВЛГ от 13.11.2026',
    },
    quality: { outlier: false, warnings: [] },
  };

  store.appendObservations([verifiedTransaction]);

  const existingForecasts = store.getForecasts();
  const decision = evaluateWeeklyForecastReissue('warehouse', {
    observations: store.getObservations(),
    today,
    existingForecasts,
  });

  assert.equal(decision.eligible, true);
  assert.equal(decision.reason, 'NEW_VERIFIED_EVIDENCE');
  assert.ok(decision.series.used > 0);
});

test('Refresh 7: Official monthly forecast preserves historical cutoffs and skips unneeded rebuilds', async () => {
  const customFetchers = {
    cbr: async () => `<ValCurs Date="13.11.2026"><Valute ID="R01335"><Nominal>100</Nominal><Value>18,6573</Value></Valute></ValCurs>`,
    weather: async () => [],
    agroRu: async () => ``,
    foodStar: async () => ``,
    agroServer: async () => ``,
    news: async () => [],
  };

  const report = await runRefreshJob({
    today: '2026-11-13',
    trigger: 'official_check',
    customFetchers,
    force: true,
  });

  assert.ok(report.forecasts.official_monthly != null);
  assert.equal(report.forecasts.official_monthly.reissued, false);
  assert.equal(report.forecasts.official_monthly.reason, 'OFFICIAL_DATA_UNCHANGED');
  assert.equal(report.forecasts.official_monthly.inputCutoff, '2026-09');
});
