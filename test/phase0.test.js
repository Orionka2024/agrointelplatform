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
    const origApiToken = process.env.AGRO_API_TOKEN;
    process.env.AGRO_API_TOKEN = 'p02-test-token';

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
      headers: { authorization: 'Bearer p02-test-token' },
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
      headers: { authorization: 'Bearer p02-test-token' },
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
    if (origApiToken === undefined) delete process.env.AGRO_API_TOKEN;
    else process.env.AGRO_API_TOKEN = origApiToken;
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

test('P0-4 (F-03): No hardcoded SHAP padding constants or synthetic storage_tier remain; attribution is derived strictly from model output or is null', async () => {
  const weeklyPlanSrc = fs.readFileSync(path.join(ROOT, 'shared/weeklyDecisionPlan.js'), 'utf8');
  const forecastUiSrc = fs.readFileSync(path.join(ROOT, 'src/components/Forecast.jsx'), 'utf8');
  const { buildCatBoostShapCards, buildWeeklyDecisionPlan } = await import('../shared/weeklyDecisionPlan.js');
  const { officialForecast } = await import('../shared/officialData.js');
  const { CROP_PROFILES } = await import('../shared/cropProfiles.js');

  // 1. Grep test: no hardcoded SHAP padding constants (+ 0.04, + 0.02, + 0.018, + 0.014) or synthetic storage_tier (0.032, -0.012)
  const shapSection = weeklyPlanSrc.slice(weeklyPlanSrc.indexOf('export function buildCatBoostShapCards'));
  assert.doesNotMatch(
    shapSection,
    /\+\s*0\.04|\+\s*0\.02|\+\s*0\.018|\+\s*0\.014|0\.032|-0\.012|key:\s*['"]storage_tier['"]/,
    'buildCatBoostShapCards must not contain hardcoded SHAP padding constants or synthetic storage_tier factor'
  );

  // 2. Unit test: when officialForecast has no catboostShap / factorLogs, attribution is null
  const nullAttr = buildCatBoostShapCards({
    officialForecast: { rows: [{ targetMonth: '2027-03', catboostShap: null }] },
    officialSnapshotData: {},
    macro: {},
  });
  assert.equal(nullAttr, null, 'buildCatBoostShapCards must return null when model output has no catboostShap');

  const noFcPlan = buildWeeklyDecisionPlan({
    cropId: 'onion',
    cropProfile: CROP_PROFILES.onion,
    officialForecast: null,
    today: '2026-10-30',
    baseWarehousePrice: 15.5,
    bridge: { truckCostRub: 135000, truckPayloadKg: 20000, packagingRubKg: 1.2, handlingRubKg: 0.5, transitLossPct: 1.5, marginRubKg: 2.0, moscowVatRate: 0.1 },
    storageParams: CROP_PROFILES.onion.storageParams,
  });
  assert.equal(noFcPlan.attribution, null, 'Decision plan without officialForecast must have attribution: null');

  // 3. Unit test: when real model attribution is present, zero-impact factors (financing=0, retail_demand=0 on 2027-03) have 0% weight and no synthetic storage_tier
  const realAttr = buildCatBoostShapCards({
    officialForecast,
    officialSnapshotData: {},
    macro: {},
  });
  assert.ok(Array.isArray(realAttr) && realAttr.length > 0, 'Real model output should produce attribution array');
  assert.equal(
    realAttr.some((f) => f.key === 'storage_tier'),
    false,
    'Synthetic storage_tier factor must not be injected into model attribution'
  );
  const financingCard = realAttr.find((f) => f.key === 'financing');
  assert.ok(financingCard, 'financing factor from model should be present');
  assert.equal(financingCard.absWeight, 0, 'financing absWeight on 2027-03 must be 0 (not padded with +0.02)');
  assert.equal(financingCard.pct, 0, 'Zero-weight factor must have 0% attribution');

  // 4. UI check: Forecast.jsx displays "Factor attribution unavailable" when attribution is null and "Attribution explains the model, not the market." when shown
  assert.match(
    forecastUiSrc,
    /Factor attribution unavailable|Атрибуция факторов недоступна/i,
    'Forecast.jsx must display Factor attribution unavailable when attribution is null'
  );
  assert.match(
    forecastUiSrc,
    /Attribution explains the model, not the market/i,
    'Forecast.jsx must include note "Attribution explains the model, not the market."'
  );
});

test('P0-5 (F-01, F-02): Stop overriding the model selector across h=1..14, follow flipped validation.selected in stubbed forecast, and remove user-facing "CatBoost" labels', async () => {
  const { officialForecast } = await import('../shared/officialData.js');
  const { MONTHLY_MODELS } = await import('../shared/officialForecast.js');
  const { buildCatboostKnots, buildWeeklyDecisionPlan, resolveSelectedHorizonPoint } = await import('../shared/weeklyDecisionPlan.js');
  const { CROP_PROFILES } = await import('../shared/cropProfiles.js');

  assert.equal(typeof resolveSelectedHorizonPoint, 'function', 'shared/weeklyDecisionPlan.js must export resolveSelectedHorizonPoint');

  // 1. For each horizon h=1..14, the knot point must equal the selector's chosen model (not a wCb * cbPt + (1-wCb) * eqPt blend)
  const knotBundle = buildCatboostKnots(officialForecast, '2026-10-30', 15.5);
  assert.ok(knotBundle && knotBundle.knots.length === 15, 'Expected 1 cutoff knot + 14 horizon knots');
  for (let i = 0; i < officialForecast.rows.length; i++) {
    const r = officialForecast.rows[i];
    const knot = knotBundle.knots[i + 1];
    const expectedPt = r.validation.selected === 'catboost' ? r.catboostPoint : r.point;
    assert.ok(
      Math.abs( Math.exp(knot.logP) - expectedPt ) < 1e-9,
      `Horizon h=${r.h} (${r.targetMonth}, selected=${r.validation.selected}) knot value ${Math.exp(knot.logP)} must equal selector model value ${expectedPt}, not blended value`
    );
  }

  // 2. Stubbed forecast that flips validation.selected between eq_carry and catboost changes the knot & weekly plan values
  const stubbedEqCarry = {
    ...officialForecast,
    rows: officialForecast.rows.map((r) => ({
      ...r,
      point: 20.0,
      eqCarryPoint: 20.0,
      catboostPoint: 26.0,
      validation: { ...r.validation, selected: 'eq_carry' },
    })),
  };
  const stubbedTree = {
    ...officialForecast,
    rows: officialForecast.rows.map((r) => ({
      ...r,
      point: 20.0,
      eqCarryPoint: 20.0,
      catboostPoint: 26.0,
      validation: { ...r.validation, selected: 'catboost' },
    })),
  };

  const knotsEq = buildCatboostKnots(stubbedEqCarry, '2026-10-30', 15.5);
  const knotsTree = buildCatboostKnots(stubbedTree, '2026-10-30', 15.5);
  assert.ok(Math.abs(Math.exp(knotsEq.knots[5].logP) - 20.0) < 1e-9, 'When validation.selected=eq_carry, knot uses eq_carry (20.0)');
  assert.ok(Math.abs(Math.exp(knotsTree.knots[5].logP) - 26.0) < 1e-9, 'When validation.selected=catboost, knot uses tree model (26.0)');

  const planEq = buildWeeklyDecisionPlan({
    cropId: 'onion',
    cropProfile: CROP_PROFILES.onion,
    officialForecast: stubbedEqCarry,
    today: '2026-10-30',
    baseWarehousePrice: 15.5,
    bridge: { truckCostRub: 135000, truckPayloadKg: 20000, packagingRubKg: 1.2, handlingRubKg: 0.5, transitLossPct: 1.5, marginRubKg: 2.0, moscowVatRate: 0.1 },
    storageParams: CROP_PROFILES.onion.storageParams,
  });
  const planTree = buildWeeklyDecisionPlan({
    cropId: 'onion',
    cropProfile: CROP_PROFILES.onion,
    officialForecast: stubbedTree,
    today: '2026-10-30',
    baseWarehousePrice: 15.5,
    bridge: { truckCostRub: 135000, truckPayloadKg: 20000, packagingRubKg: 1.2, handlingRubKg: 0.5, transitLossPct: 1.5, marginRubKg: 2.0, moscowVatRate: 0.1 },
    storageParams: CROP_PROFILES.onion.storageParams,
  });
  assert.notEqual(
    planEq.peakWeek.whPrice,
    planTree.peakWeek.whPrice,
    'Flipping validation.selected in stubbed forecast must change the resulting weekly plan trajectory'
  );

  // 3. MONTHLY_MODELS user-facing labels match specification
  assert.equal(MONTHLY_MODELS.eq_carry, 'Сезонная модель (Weibull)');
  assert.equal(MONTHLY_MODELS.catboost, 'Дерево решений (экспериментальная)');

  // 4. Grep test: no user-facing label in src/components/*.jsx or README.md says "CatBoost"
  const componentFiles = fs.readdirSync(path.join(ROOT, 'src/components')).filter((f) => f.endsWith('.jsx'));
  for (const file of componentFiles) {
    const src = fs.readFileSync(path.join(ROOT, 'src/components', file), 'utf8');
    // Strip JS import lines and identifier references (buildCatBoostShapCards, isOnionCatBoost, catboostPoint, catboostQ80, catboostInterval80, catboostHoldoutMae, catboostShap)
    const stripped = src
      .replace(/import\s+.*from\s+['"][^'"]+['"];?/g, '')
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      .replace(/\b(buildCatBoostShapCards|isOnionCatBoost|catboostPoint|catboostQ80|catboostInterval80|catboostHoldoutMae|catboostShap)\b/g, '')
      .replace(/['"]catboost['"]/g, '');
    assert.doesNotMatch(
      stripped,
      /CatBoost/i,
      `User-facing component ${file} must not display "CatBoost"`
    );
  }

  const readmeSrc = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    .replace(/rosstat-catboost-3\.0\.0/g, '')
    .replace(/`catboost`/g, '');
  assert.doesNotMatch(readmeSrc, /CatBoost/i, 'README.md must not call the custom tree model "CatBoost"');
});

test('P0-6 (F-01, F-02): Honest horizon labelling derived dynamically from validation fields (leads 2-3 last price, 4-12 beats seasonal-naive, 13-15 no better than seasonal)', async () => {
  const { officialForecast } = await import('../shared/officialData.js');
  const officialForecastMod = await import('../shared/officialForecast.js');
  const { buildWeeklyDecisionPlan } = await import('../shared/weeklyDecisionPlan.js');
  const { CROP_PROFILES } = await import('../shared/cropProfiles.js');

  assert.equal(
    typeof officialForecastMod.evaluateHorizonConfidence,
    'function',
    'shared/officialForecast.js must export evaluateHorizonConfidence'
  );

  // 1. Check current bundled horizons (leads 2..15)
  for (const row of officialForecast.rows) {
    const info = officialForecastMod.evaluateHorizonConfidence(row, officialForecast.lastValue);
    if (row.lead === 2 || row.lead === 3) {
      assert.equal(info.badge, 'no better than last price', `Lead ${row.lead}m must show "no better than last price"`);
      assert.equal(info.defaultShortTermAnchor, 'last_observed_price', `Lead ${row.lead}m must default short-term anchor to last observed price`);
      assert.ok(Math.abs(info.recommendedAnchorPoint - officialForecast.lastValue) < 1e-6);
      if (row.lead === 2) {
        assert.match(info.holdoutSummary, /2\.52/, 'Lead 2m summary must include audited naive holdout figure 2.52');
        assert.match(info.holdoutSummary, /2\.88|3\.03/, 'Lead 2m summary must include audited model holdout figure 2.88/3.03');
      }
      if (row.lead === 3) {
        assert.match(info.holdoutSummary, /2\.91/, 'Lead 3m summary must include audited naive holdout figure 2.91');
        assert.match(info.holdoutSummary, /3\.09|3\.27/, 'Lead 3m summary must include audited model holdout figure 3.09/3.27');
      }
    } else if (row.lead >= 4 && row.lead <= 12) {
      assert.equal(info.badge, 'beats seasonal-naive', `Lead ${row.lead}m must show "beats seasonal-naive"`);
    } else if (row.lead >= 13 && row.lead <= 15) {
      assert.equal(info.badge, 'no better than seasonal', `Lead ${row.lead}m must show "no better than seasonal"`);
      assert.equal(info.confidence, 'low', `Lead ${row.lead}m must have low confidence`);
    }
  }

  // 2. Mutating validation fields on a horizon dynamically changes the badge (proving no hardcoded lead switch)
  const lead2Row = officialForecast.rows.find((r) => r.lead === 2);
  const mutatedLead2Wins = {
    ...lead2Row,
    validation: {
      ...lead2Row.validation,
      final: { ...lead2Row.validation.final, mae: 1.95 },
      naiveFinal: { ...lead2Row.validation.naiveFinal, mae: 3.80 },
      finalAll: lead2Row.validation.finalAll.map((x) =>
        x.id === 'seasonal' ? { ...x, mae: 5.50 } : x.id === lead2Row.validation.selected ? { ...x, mae: 1.95 } : x
      ),
    },
  };
  const mutatedBadge1 = officialForecastMod.evaluateHorizonConfidence(mutatedLead2Wins, officialForecast.lastValue);
  assert.equal(
    mutatedBadge1.badge,
    'beats seasonal-naive',
    'When lead=2 validation metrics are mutated so model beats both naive and seasonal-naive, badge must switch to "beats seasonal-naive"'
  );

  const lead6Row = officialForecast.rows.find((r) => r.lead === 6);
  const mutatedLead6TiesSeasonal = {
    ...lead6Row,
    validation: {
      ...lead6Row.validation,
      final: { ...lead6Row.validation.final, mae: 3.10 },
      naiveFinal: { ...lead6Row.validation.naiveFinal, mae: 6.60 },
      finalAll: lead6Row.validation.finalAll.map((x) =>
        x.id === 'seasonal' ? { ...x, mae: 3.25 } : x.id === lead6Row.validation.selected ? { ...x, mae: 3.10 } : x
      ),
    },
  };
  const mutatedBadge2 = officialForecastMod.evaluateHorizonConfidence(mutatedLead6TiesSeasonal, officialForecast.lastValue);
  assert.equal(
    mutatedBadge2.badge,
    'no better than seasonal',
    'When lead=6 validation metrics are mutated so model barely differs from seasonal, badge must switch to "no better than seasonal"'
  );

  // 3. Weekly decision plan exposes short-term anchor default = last observed price
  const plan = buildWeeklyDecisionPlan({
    cropId: 'onion',
    cropProfile: CROP_PROFILES.onion,
    officialForecast,
    today: '2026-10-30',
    baseWarehousePrice: 15.5,
    bridge: { truckCostRub: 135000, truckPayloadKg: 20000, packagingRubKg: 1.2, handlingRubKg: 0.5, transitLossPct: 1.5, marginRubKg: 2.0, moscowVatRate: 0.1 },
    storageParams: CROP_PROFILES.onion.storageParams,
  });
  assert.equal(plan.shortTermAnchorDefault, 'last_observed_price');
  assert.equal(plan.shortTermAnchorPrice, 15.5);
  assert.ok(Array.isArray(plan.horizonConfidence) && plan.horizonConfidence.length === 14);
});

test('P0-7 (F-04): Intervals with null bounds are never invented or plotted and display "Интервал недоступен: недостаточно данных для калибровки"', async () => {
  const { officialForecast } = await import('../shared/officialData.js');
  const weeklyPlanMod = await import('../shared/weeklyDecisionPlan.js');
  const { CROP_PROFILES } = await import('../shared/cropProfiles.js');

  const expectedMsg = 'Интервал недоступен: недостаточно данных для калибровки';
  assert.equal(weeklyPlanMod.INTERVAL_UNAVAILABLE_MESSAGE, expectedMsg);
  assert.equal(typeof weeklyPlanMod.formatIntervalBand, 'function');
  assert.equal(typeof weeklyPlanMod.buildForecastChartBandDatasets, 'function');

  // 1. Bundled officialForecast has interval95: null on all 14 horizons -> evaluateVolgogradOnionTargetForecast must NOT invent lo95/hi95
  const fcMonday = weeklyPlanMod.evaluateVolgogradOnionTargetForecast({
    issueAsOf: '2026-11-13',
    targetDate: '2026-11-16',
    baseWarehousePrice: 15.5,
    hasVerifiedWarehouseDeal: false,
    officialForecast,
  });
  assert.equal(fcMonday.lo95, null, 'lo95 must be null when officialForecast has interval95: null (must not invent relBand80 * 1.55)');
  assert.equal(fcMonday.hi95, null, 'hi95 must be null when officialForecast has interval95: null');
  assert.equal(weeklyPlanMod.formatIntervalBand(null), expectedMsg);
  assert.equal(weeklyPlanMod.formatIntervalBand({ lo: null, hi: null }), expectedMsg);

  // 95% chart band datasets for bundled forecast must be empty (0 series)
  const planBundled = weeklyPlanMod.buildWeeklyDecisionPlan({
    cropId: 'onion',
    cropProfile: CROP_PROFILES.onion,
    officialForecast,
    today: '2026-10-30',
    baseWarehousePrice: 15.5,
    bridge: { truckCostRub: 135000, truckPayloadKg: 20000, packagingRubKg: 1.2, handlingRubKg: 0.5, transitLossPct: 1.5, marginRubKg: 2.0, moscowVatRate: 0.1 },
    storageParams: CROP_PROFILES.onion.storageParams,
  });
  const band95Series = weeklyPlanMod.buildForecastChartBandDatasets(planBundled.weeks, { level: 95 });
  assert.equal(band95Series.length, 0, 'Null 95% intervals must produce zero band series in chart dataset');

  // 2. Passing a forecast with null 80% intervals (lo80: null, hi80: null / interval80: null) produces null lo80/hi80 and zero 80% band series
  const noIntervalsForecast = {
    ...officialForecast,
    rows: officialForecast.rows.map((r) => ({
      ...r,
      interval80: null,
      interval95: null,
      catboostQ80: null,
      catboostInterval80: null,
      lo80: null,
      hi80: null,
      lo95: null,
      hi95: null,
      validation: {
        ...r.validation,
        q80: null,
        q95: null,
        catboostQ80: null,
      },
    })),
  };

  const planNoIntervals = weeklyPlanMod.buildWeeklyDecisionPlan({
    cropId: 'onion',
    cropProfile: CROP_PROFILES.onion,
    officialForecast: noIntervalsForecast,
    today: '2026-10-30',
    baseWarehousePrice: 15.5,
    bridge: { truckCostRub: 135000, truckPayloadKg: 20000, packagingRubKg: 1.2, handlingRubKg: 0.5, transitLossPct: 1.5, marginRubKg: 2.0, moscowVatRate: 0.1 },
    storageParams: CROP_PROFILES.onion.storageParams,
  });

  assert.ok(
    planNoIntervals.weeks.every((w) => w.lo80 === null && w.hi80 === null && w.lo95 === null && w.hi95 === null),
    'When forecast has null 80% and 95% intervals, weekly plan must have lo80=null, hi80=null, lo95=null, hi95=null'
  );
  const band80SeriesWhenNull = weeklyPlanMod.buildForecastChartBandDatasets(planNoIntervals.weeks, { level: 80 });
  assert.equal(band80SeriesWhenNull.length, 0, 'Null 80% intervals must produce zero band series in chart dataset');

  // 3. UI files render the exact message "Интервал недоступен: недостаточно данных для калибровки"
  const forecastUiSrc = fs.readFileSync(path.join(ROOT, 'src/components/Forecast.jsx'), 'utf8');
  const officialUiSrc = fs.readFileSync(path.join(ROOT, 'src/components/OfficialMarket.jsx'), 'utf8');
  assert.ok(
    forecastUiSrc.includes(expectedMsg) || forecastUiSrc.includes('INTERVAL_UNAVAILABLE_MESSAGE') || forecastUiSrc.includes('formatIntervalBand'),
    'Forecast.jsx must display the interval unavailable message when interval bounds are null'
  );
  assert.ok(
    officialUiSrc.includes(expectedMsg) || officialUiSrc.includes('INTERVAL_UNAVAILABLE_MESSAGE') || officialUiSrc.includes('formatIntervalBand'),
    'OfficialMarket.jsx must display the interval unavailable message when interval bounds are null'
  );
});

test('P0-8 (F-10): Write endpoints require auth by default (401 without token, 401 with wrong token, 200 with valid token, 200 without token only when AGRO_ALLOW_ANON_WRITES=true)', async () => {
  const importHandler = (await import('../api/import.js')).default;
  const assumptionsHandler = (await import('../api/assumptions.js')).default;
  const forecastHandler = (await import('../api/forecast.js')).default;
  const advisorHandler = (await import('../api/advisor.js')).default;
  const marketHandler = (await import('../api/market.js')).default;
  const signalsHandler = (await import('../api/signals.js')).default;

  const origAllowAnon = process.env.AGRO_ALLOW_ANON_WRITES;
  const origRequireAuth = process.env.AGRO_REQUIRE_AUTH;
  const origApiToken = process.env.AGRO_API_TOKEN;

  try {
    delete process.env.AGRO_ALLOW_ANON_WRITES;
    delete process.env.AGRO_REQUIRE_AUTH;
    process.env.AGRO_API_TOKEN = 'secret-farmer-write-token-2026';

    const validCsv = [
      'observation_date,kind,market,geography,price,unit,vat,vat_rate,delivery_basis,source',
      '2026-10-15,transaction,warehouse_volgograd,"Волгоградская обл.",14.50,RUB/kg,excl,0.10,EXW,Агросервер',
    ].join('\n');

    const writeEndpoints = [
      {
        name: 'POST /api/import',
        handler: importHandler,
        method: 'POST',
        url: '/api/import',
        body: { type: 'prices', csv: validCsv },
      },
      {
        name: 'POST /api/assumptions',
        handler: assumptionsHandler,
        method: 'POST',
        url: '/api/assumptions',
        body: { bridge: { freightRubKg: 7.2 } },
      },
      {
        name: 'DELETE /api/assumptions',
        handler: assumptionsHandler,
        method: 'DELETE',
        url: '/api/assumptions',
        body: {},
      },
      {
        name: 'POST /api/forecast',
        handler: forecastHandler,
        method: 'POST',
        url: '/api/forecast',
        body: { basis: 'warehouse', issueDate: '2026-10-24' },
      },
      {
        name: 'POST /api/advisor',
        handler: advisorHandler,
        method: 'POST',
        url: '/api/advisor',
        body: { message: 'Какова цена склада?', demo: true },
      },
    ];

    // 1. Default (AGRO_ALLOW_ANON_WRITES unset): 401 without token
    for (const ep of writeEndpoints) {
      const { req, res } = mockReqRes({ method: ep.method, url: ep.url, body: ep.body, headers: {} });
      await ep.handler(req, res);
      assert.equal(res.statusCode, 401, `${ep.name} must return 401 without token by default`);
    }

    // 2. Default (AGRO_ALLOW_ANON_WRITES unset): 401 with wrong token
    for (const ep of writeEndpoints) {
      const { req, res } = mockReqRes({
        method: ep.method,
        url: ep.url,
        body: ep.body,
        headers: { authorization: 'Bearer wrong-token-999' },
      });
      await ep.handler(req, res);
      assert.equal(res.statusCode, 401, `${ep.name} must return 401 with wrong token`);
    }

    // 3. Default (AGRO_ALLOW_ANON_WRITES unset): 200 with valid Bearer token
    for (const ep of writeEndpoints) {
      const { req, res } = mockReqRes({
        method: ep.method,
        url: ep.url,
        body: ep.body,
        headers: { authorization: 'Bearer secret-farmer-write-token-2026' },
      });
      await ep.handler(req, res);
      assert.equal(res.statusCode, 200, `${ep.name} must return 200 with valid Bearer token`);
    }

    // 4. Read-only GET endpoints remain open (200) without token
    const mktReq = mockReqRes({ method: 'GET', url: '/api/market?today=2026-10-24' });
    await marketHandler(mktReq.req, mktReq.res);
    assert.equal(mktReq.res.statusCode, 200, 'GET /api/market must remain open without token');

    const sigReq = mockReqRes({ method: 'GET', url: '/api/signals?offline=1&today=2026-10-24' });
    await signalsHandler(sigReq.req, sigReq.res);
    assert.equal(sigReq.res.statusCode, 200, 'GET /api/signals must remain open without token');

    const getAssump = mockReqRes({ method: 'GET', url: '/api/assumptions' });
    await assumptionsHandler(getAssump.req, getAssump.res);
    assert.equal(getAssump.res.statusCode, 200, 'GET /api/assumptions must remain open without token');

    // 5. Explicit AGRO_ALLOW_ANON_WRITES=true allows writes without token (local dev only)
    process.env.AGRO_ALLOW_ANON_WRITES = 'true';
    for (const ep of writeEndpoints) {
      const { req, res } = mockReqRes({ method: ep.method, url: ep.url, body: ep.body, headers: {} });
      await ep.handler(req, res);
      assert.equal(res.statusCode, 200, `${ep.name} must return 200 without token when AGRO_ALLOW_ANON_WRITES=true`);
    }
  } finally {
    if (origAllowAnon === undefined) delete process.env.AGRO_ALLOW_ANON_WRITES;
    else process.env.AGRO_ALLOW_ANON_WRITES = origAllowAnon;
    if (origRequireAuth === undefined) delete process.env.AGRO_REQUIRE_AUTH;
    else process.env.AGRO_REQUIRE_AUTH = origRequireAuth;
    if (origApiToken === undefined) delete process.env.AGRO_API_TOKEN;
    else process.env.AGRO_API_TOKEN = origApiToken;
  }
});

