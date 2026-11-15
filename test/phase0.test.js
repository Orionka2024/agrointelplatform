import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificationOf, validatePriceRow, importPriceCSV } from '../shared/observations.js';
import * as localBasisMod from '../shared/localBasis.js';
const { buildUserPriceCsv } = localBasisMod;
import { store } from '../server/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('P0-1 (F-06): Spot-calibration preview creates zero rows in observations table and cannot set verification_status=verified from a listing source', async () => {
  // 1. No code path in verificationOf / validatePriceRow / importPriceCSV can set verification_status=verified from a listing source or ask kind
  const listingAttempt1 = verificationOf({
    kind: 'transaction',
    source: 'AgroRU / доска объявлений Волгоград',
    source_ref: 'agroru-listing-123',
    verification_status: 'verified',
    verified_by: 'user_ui',
    verified_at: '2026-11-13',
  });
  assert.equal(
    listingAttempt1.status,
    'unverified',
    'Listing source (AgroRU) must never be accepted as verification_status=verified'
  );

  const listingAttempt2 = verificationOf({
    kind: 'indicative_offer',
    source: 'Собственная сделка',
    source_ref: 'offer-123',
    verification_status: 'verified',
    verified_by: 'user_ui',
    verified_at: '2026-11-13',
  });
  assert.equal(
    listingAttempt2.status,
    'unverified',
    'indicative_offer / ask kind must never be accepted as verification_status=verified'
  );

  const csvListingSpoof = [
    'observation_date,retrieved_date,kind,market,geography,price,unit,vat,vat_rate,delivery_basis,source,source_ref,verification_status,verified_by,verified_at',
    '2026-11-13,2026-11-13,transaction,warehouse_volgograd,"Волгоградская обл.",15.0,RUB/kg,excl,0.10,EXW,Агросервер оферта ask,spot-15,verified,user_ui,2026-11-13',
  ].join('\n');
  const imported = importPriceCSV(csvListingSpoof, [], { today: '2026-11-13', importDate: '2026-11-13' });
  assert.equal(imported.accepted.length, 1);
  assert.equal(
    imported.accepted[0].verification.status,
    'unverified',
    'CSV import from a listing source must strip verification_status=verified'
  );

  // 2. buildUserPriceCsv must reject listing / session-only ask entries
  assert.throws(
    () =>
      buildUserPriceCsv(
        [{ basis: 'warehouse', date: '2026-11-13', price: 15.0, vat: 'excl', source: 'AgroRU ask', isListing: true }],
        '2026-11-13'
      ),
    /listing|ask|оферт/i,
    'buildUserPriceCsv must refuse to serialize listing/ask entries as verified user transactions'
  );

  // 3. Invoking the spot-calibration preview action creates zero rows in SQLite observations and marks session-only ask
  const beforeCount = store.getObservations().length;
  assert.equal(typeof localBasisMod.applySpotAskPreview, 'function', 'applySpotAskPreview must be exported');
  const preview = localBasisMod.applySpotAskPreview(15.0, { today: '2026-11-13' });
  const afterCount = store.getObservations().length;
  assert.equal(afterCount, beforeCount, 'Spot preview action must create zero rows in observations table');
  assert.equal(preview.sessionOnly, true);
  assert.equal(preview.kind, 'unverified_ask');
  assert.equal(preview.verification_status, 'unverified');
  assert.equal(preview.priceExVat, 15.0);
  assert.match(preview.label, /unverified ask|оферта|не сделка/i);

  // 4. Dashboard.jsx and Forecast.jsx must not wire spot calibration to importData or buildUserPriceCsv, and UI label must state it is an ask, not a deal
  const dashboardSrc = fs.readFileSync(path.join(ROOT, 'src/components/Dashboard.jsx'), 'utf8');
  const forecastSrc = fs.readFileSync(path.join(ROOT, 'src/components/Forecast.jsx'), 'utf8');
  assert.ok(
    !dashboardSrc.includes('buildUserPriceCsv'),
    'Dashboard.jsx must not call buildUserPriceCsv from the spot button'
  );
  assert.ok(
    !forecastSrc.includes('buildUserPriceCsv'),
    'Forecast.jsx must not call buildUserPriceCsv from the preview toolbar'
  );
  assert.match(
    dashboardSrc,
    /unverified ask|оферта.*не сделка|не сделка.*только сессия/i,
    'Dashboard.jsx UI label must state the spot price is an unverified ask (session only), not a deal'
  );
  assert.match(
    forecastSrc,
    /unverified ask|оферта.*не сделка|не сделка.*только сессия/i,
    'Forecast.jsx UI label must state the spot price is an unverified ask (session only), not a deal'
  );
});

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

test('P0-2 (F-08): Cold start syncs from KV before write, rejects writes with 503 when KV sync fails, and prevents stale revision overwrite', async () => {
  const os = await import('node:os');
  const importHandler = (await import('../api/import.js')).default;
  const origFetch = global.fetch;
  const origKvUrl = process.env.KV_REST_API_URL;
  const origKvToken = process.env.KV_REST_API_TOKEN;
  const origDataDir = process.env.DATA_DIR;

  const tmpDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'agro-kv-cold1-'));
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'agro-kv-cold2-'));

  try {
    // Fake KV storage in memory
    const kvData = new Map();
    const existingKvTx = {
      id: 'kv-tx-existing-001',
      naturalKey: 'kv-nat-001',
      kind: 'transaction',
      market: 'warehouse_volgograd',
      geography: 'Волгоградская обл.',
      verification: { status: 'verified', by: 'farmer_1', at: '2026-10-10', evidence: 'UPD-101' },
      observationDate: '2026-10-10',
      retrievedDate: '2026-10-10',
      priceRubKg: 16.2,
      priceExVatRubKg: 16.2,
      originalPrice: 16.2,
      originalUnit: 'RUB/kg',
      vat: 'excl',
      vatRate: 0.1,
      deliveryBasis: 'EXW',
      source: 'Собственная сделка КФХ',
      sourceRef: 'UPD-101',
      quality: { outlier: false, warnings: [] },
    };
    kvData.set('agro_observations', JSON.stringify([existingKvTx]));

    let kvReadShouldFail = false;
    let kvSetCalls = 0;

    global.fetch = async (urlStr, opts = {}) => {
      const u = String(urlStr);
      if (u.startsWith('https://fake-kv.local/get/')) {
        if (kvReadShouldFail) {
          return { ok: false, status: 500, json: async () => ({ error: 'KV Down' }) };
        }
        const key = decodeURIComponent(u.slice('https://fake-kv.local/get/'.length));
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: kvData.has(key) ? kvData.get(key) : null }),
        };
      }
      if (u.startsWith('https://fake-kv.local/set/')) {
        kvSetCalls++;
        const key = decodeURIComponent(u.slice('https://fake-kv.local/set/'.length));
        const parsedBody = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
        kvData.set(key, typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody));
        return { ok: true, status: 200, json: async () => ({ result: 'OK' }) };
      }
      return origFetch(urlStr, opts);
    };

    process.env.KV_REST_API_URL = 'https://fake-kv.local';
    process.env.KV_REST_API_TOKEN = 'fake-kv-token';

    // Part 1: Cold instance with empty tmpDir1 receives POST /api/import
    process.env.DATA_DIR = tmpDir1;
    if (typeof store.resetForTests === 'function') store.resetForTests();

    const newTxCsv = [
      'observation_date,retrieved_date,kind,market,geography,price,unit,vat,vat_rate,delivery_basis,source,source_ref,verification_status,verified_by,verified_at',
      '2026-10-20,2026-10-20,transaction,warehouse_volgograd,"Волгоградская обл.",16.80,RUB/kg,excl,0.10,EXW,Собственная сделка КФХ,UPD-102,verified,farmer_1,2026-10-20',
    ].join('\n');

    const { req: req1, res: res1 } = mockReqRes({
      method: 'POST',
      url: '/api/import',
      headers: { 'x-bypass-auth': '1' },
      body: { type: 'prices', csv: newTxCsv, importDate: '2026-10-24' },
    });
    await importHandler(req1, res1);
    assert.equal(res1.statusCode, 200, 'Import after successful KV sync should return 200');

    const rawKvObs = JSON.parse(kvData.get('agro_observations'));
    const storedObsList = Array.isArray(rawKvObs) ? rawKvObs : rawKvObs.data;
    assert.ok(
      storedObsList.some((o) => o.id === 'kv-tx-existing-001' || o.sourceRef === 'UPD-101'),
      'KV must still contain the original pre-existing transaction after cold-start write'
    );
    assert.ok(
      storedObsList.some((o) => o.sourceRef === 'UPD-102' && o.priceExVatRubKg === 16.8),
      'KV must also contain the newly imported transaction'
    );

    // Part 2: Cold instance where KV read fails must reject the write with 503 and NOT overwrite KV
    process.env.DATA_DIR = tmpDir2;
    store.resetForTests();
    kvReadShouldFail = true;
    const kvCallsBeforeFail = kvSetCalls;

    const { req: req2, res: res2 } = mockReqRes({
      method: 'POST',
      url: '/api/import',
      headers: { 'x-bypass-auth': '1' },
      body: { type: 'prices', csv: newTxCsv, importDate: '2026-10-24' },
    });
    await importHandler(req2, res2);
    assert.equal(res2.statusCode, 503, 'Write must fail with 503 when KV sync fails on cold start');
    assert.equal(kvSetCalls, kvCallsBeforeFail, 'Failed KV sync must never push seed data to KV');

    // Part 3: Revision check prevents an older state from overwriting a newer revision in KV
    kvReadShouldFail = false;
    store.resetForTests();
    await store.ensureInitialized({ forWrite: true });
    // Simulate another instance bumping the remote revision in KV ahead of this instance
    const currentEnvelope = JSON.parse(kvData.get('agro_observations'));
    const bumpedRev = (currentEnvelope?.__agro_rev || 1) + 5;
    kvData.set(
      'agro_observations',
      JSON.stringify({ __agro_rev: bumpedRev, data: storedObsList })
    );
    await assert.rejects(
      async () => {
        await store.persistToDurable('observations', []);
      },
      /revision|conflict|stale|outdated/i,
      'Stale instance with lower revision must not overwrite newer KV state'
    );
  } finally {
    global.fetch = origFetch;
    if (origKvUrl !== undefined) process.env.KV_REST_API_URL = origKvUrl;
    else delete process.env.KV_REST_API_URL;
    if (origKvToken !== undefined) process.env.KV_REST_API_TOKEN = origKvToken;
    else delete process.env.KV_REST_API_TOKEN;
    if (origDataDir !== undefined) process.env.DATA_DIR = origDataDir;
    else delete process.env.DATA_DIR;
    if (typeof store.resetForTests === 'function') store.resetForTests();
    fs.rmSync(tmpDir1, { recursive: true, force: true });
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  }
});

test('P0-3 (F-11): Storage duration slider scales physical loss monotonically (2.5% at 1m, 16.4% at 7m) and reduces 7m net proceeds by ~1.60 RUB/kg', async () => {
  const storageEcon = await import('../shared/storageEconomics.js');
  const { CROP_PROFILES } = await import('../shared/cropProfiles.js');
  const baseSp = CROP_PROFILES.onion.storageParams; // reference 4 months, shrink 6%, rot 4%
  const pNow = 15.5;
  const pFuture = 22.0;

  // Verify Profit.jsx imports and uses storageAtHorizon / evaluateStorageAtHorizon so slider duration scales losses
  const profitSrc = fs.readFileSync(path.join(ROOT, 'src/components/Profit.jsx'), 'utf8');
  assert.match(
    profitSrc,
    /storageAtHorizon|evaluateStorageAtHorizon/,
    'Profit.jsx must scale storage parameters by selected duration via storageAtHorizon / evaluateStorageAtHorizon'
  );

  assert.equal(
    typeof storageEcon.evaluateStorageAtHorizon,
    'function',
    'shared/storageEconomics.js must export evaluateStorageAtHorizon as single source of truth for slider duration evaluation'
  );

  const res1m = storageEcon.evaluateStorageAtHorizon(pNow, pFuture, baseSp, 1);
  const res7m = storageEcon.evaluateStorageAtHorizon(pNow, pFuture, baseSp, 7);
  const buggy7m = storageEcon.evaluateStorage(pNow, pFuture, { ...baseSp, months: 7 });

  assert.equal(res1m.totalPhysicalLossPct, 2.5, 'Physical loss at 1 month must be 2.5%');
  assert.equal(res7m.totalPhysicalLossPct, 16.4, 'Physical loss at 7 months must be 16.4%');

  // Monotonically non-decreasing across months 1..7
  let prevLoss = 0;
  for (let m = 1; m <= 7; m += 0.5) {
    const r = storageEcon.evaluateStorageAtHorizon(pNow, pFuture, baseSp, m);
    assert.ok(
      r.totalPhysicalLossPct >= prevLoss,
      `Physical loss must be monotonically non-decreasing: month ${m} (${r.totalPhysicalLossPct}%) < previous (${prevLoss}%)`
    );
    prevLoss = r.totalPhysicalLossPct;
  }

  // Net proceeds at 7 months decrease by ~1.60 RUB/kg vs buggy unscaled evaluation (14.62 -> 13.02 RUB/kg)
  const diffRubKg = +(buggy7m.netLaterPerKgStored - res7m.netLaterPerKgStored).toFixed(2);
  assert.equal(+buggy7m.netLaterPerKgStored.toFixed(2), 14.62);
  assert.equal(+res7m.netLaterPerKgStored.toFixed(2), 13.02);
  assert.equal(diffRubKg, 1.60, '7-month net proceeds must be 1.60 RUB/kg lower than the buggy flat-loss output');
});


