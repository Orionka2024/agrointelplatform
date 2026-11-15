import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PHASE1_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agro-phase1-suite-'));
process.env.DATA_DIR = PHASE1_DATA_DIR;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
      resHeaders[String(k).toLowerCase()] = v;
    },
    getHeader(k) {
      return resHeaders[String(k).toLowerCase()];
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
    get headers() {
      return resHeaders;
    },
  };
  return { req, res };
}

test('P1-0a (F-10): Per-user magic-link sign-in, no shared secret in browser bundle, and strict per-user isolation on GET/POST endpoints', async () => {
  const { store } = await import('../server/store.js');
  const marketHandler = (await import('../api/market.js')).default;
  const importHandler = (await import('../api/import.js')).default;
  const assumptionsHandler = (await import('../api/assumptions.js')).default;

  // 1. Browser bundle (src/) must never reference AGRO_API_TOKEN or hold a shared secret
  const srcFiles = [];
  function walkSrc(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkSrc(full);
      else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) srcFiles.push(full);
    }
  }
  walkSrc(path.join(ROOT, 'src'));
  for (const f of srcFiles) {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(
      !content.includes('AGRO_API_TOKEN') && !content.includes('VITE_AGRO_API_TOKEN'),
      `Client file ${path.relative(ROOT, f)} must never embed shared secret AGRO_API_TOKEN`
    );
  }

  // 2. /api/auth must exist and support magic-link sign-in for two distinct farmers (User A and User B)
  assert.ok(fs.existsSync(path.join(ROOT, 'api/auth.js')), 'api/auth.js must exist for per-user sign-in');
  const authHandler = (await import('../api/auth.js')).default;

  const origAllowAnon = process.env.AGRO_ALLOW_ANON_WRITES;
  const origDataDir = process.env.DATA_DIR;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agro-p1-0a-'));

  try {
    process.env.DATA_DIR = tmpDir;
    delete process.env.AGRO_ALLOW_ANON_WRITES;
    store.resetForTests();

    // Unauthenticated write from browser must be rejected with 401
    const unauthWrite = mockReqRes({
      method: 'POST',
      url: '/api/assumptions',
      body: { bridge: { truckCostRub: 150000 } },
    });
    await assumptionsHandler(unauthWrite.req, unauthWrite.res);
    assert.equal(unauthWrite.res.statusCode, 401, 'Unauthenticated browser write must return 401');

    // Request magic link for Farmer A
    const reqLinkA = mockReqRes({
      method: 'POST',
      url: '/api/auth',
      body: { action: 'request_magic_link', email: 'farmerA@volga-onion.ru' },
    });
    await authHandler(reqLinkA.req, reqLinkA.res);
    assert.equal(reqLinkA.res.statusCode, 200);
    assert.ok(reqLinkA.res.data.magicLinkToken, 'Magic link token must be issued for Farmer A');

    // Verify magic link for Farmer A -> receives session cookie + sessionToken
    const verifyA = mockReqRes({
      method: 'POST',
      url: '/api/auth',
      body: { action: 'verify_magic_link', token: reqLinkA.res.data.magicLinkToken },
    });
    await authHandler(verifyA.req, verifyA.res);
    assert.equal(verifyA.res.statusCode, 200);
    assert.equal(verifyA.res.data.authenticated, true);
    assert.equal(verifyA.res.data.user.email, 'farmera@volga-onion.ru');
    const cookieA = verifyA.res.headers['set-cookie'];
    assert.ok(cookieA && cookieA.includes('agro_session='), 'Verify magic link must set HttpOnly agro_session cookie');

    // Single-use magic link token cannot be reused
    const replayA = mockReqRes({
      method: 'POST',
      url: '/api/auth',
      body: { action: 'verify_magic_link', token: reqLinkA.res.data.magicLinkToken },
    });
    await authHandler(replayA.req, replayA.res);
    assert.equal(replayA.res.statusCode, 401, 'Magic link token must be single-use');

    // Request & verify magic link for Farmer B
    const reqLinkB = mockReqRes({
      method: 'POST',
      url: '/api/auth',
      body: { action: 'request_magic_link', email: 'farmerB@achtuba-agro.ru' },
    });
    await authHandler(reqLinkB.req, reqLinkB.res);
    const verifyB = mockReqRes({
      method: 'POST',
      url: '/api/auth',
      body: { action: 'verify_magic_link', token: reqLinkB.res.data.magicLinkToken },
    });
    await authHandler(verifyB.req, verifyB.res);
    assert.equal(verifyB.res.statusCode, 200);
    const cookieB = verifyB.res.headers['set-cookie'];

    // 3. Farmer A imports a verified transaction (16.80 RUB/kg) and saves custom assumptions + farmProfile
    const csvA = [
      'observation_date,retrieved_date,kind,market,geography,price,unit,vat,vat_rate,delivery_basis,source,source_ref,verification_status,verified_by,verified_at',
      '2026-10-25,2026-10-25,transaction,warehouse_volgograd,"Волгоградская обл.",16.80,RUB/kg,excl,0.10,EXW,"Собственная сделка КФХ А","УПД-А1",verified,user_ui,2026-10-25',
    ].join('\n');
    const importA = mockReqRes({
      method: 'POST',
      url: '/api/import',
      headers: { cookie: cookieA },
      body: { type: 'prices', csv: csvA, importDate: '2026-10-25' },
    });
    await importHandler(importA.req, importA.res);
    assert.equal(importA.res.statusCode, 200);
    assert.equal(importA.res.data.success, true);

    const assumpA = mockReqRes({
      method: 'POST',
      url: '/api/assumptions',
      headers: { cookie: cookieA },
      body: {
        bridge: { truckCostRub: 175000 },
        farmProfile: { areaHa: 120, storageCapacityTons: 2400, storageType: 'cold', loanRatePct: 14.5 },
      },
    });
    await assumptionsHandler(assumpA.req, assumpA.res);
    assert.equal(assumpA.res.statusCode, 200);

    // 4. Farmer A's GET /api/market and GET /api/assumptions return Farmer A's transaction, assumptions, and farmProfile
    const mktA = mockReqRes({
      method: 'GET',
      url: '/api/market?today=2026-10-28',
      headers: { cookie: cookieA },
    });
    await marketHandler(mktA.req, mktA.res);
    assert.equal(mktA.res.statusCode, 200);
    assert.equal(mktA.res.data.prices.warehouse.exVat, 16.8);
    assert.equal(mktA.res.data.assumptions.bridge.truckCostRub, 175000);
    assert.equal(mktA.res.data.farmProfile.areaHa, 120);

    // 5. Farmer B's GET /api/market and GET /api/assumptions MUST NEVER return Farmer A's transaction, assumptions, or farmProfile
    const mktB = mockReqRes({
      method: 'GET',
      url: '/api/market?today=2026-10-28',
      headers: { cookie: cookieB },
    });
    await marketHandler(mktB.req, mktB.res);
    assert.equal(mktB.res.statusCode, 200);
    assert.equal(
      mktB.res.data.prices.warehouse.exVat,
      null,
      "Farmer B's GET /api/market must never see Farmer A's verified transaction"
    );
    assert.notEqual(
      mktB.res.data.assumptions.bridge.truckCostRub,
      175000,
      "Farmer B's GET /api/market must never see Farmer A's bridge assumptions"
    );
    assert.notEqual(
      mktB.res.data.farmProfile?.areaHa,
      120,
      "Farmer B's GET /api/market must never see Farmer A's farmProfile"
    );

    const getAssumpB = mockReqRes({
      method: 'GET',
      url: '/api/assumptions',
      headers: { cookie: cookieB },
    });
    await assumptionsHandler(getAssumpB.req, getAssumpB.res);
    assert.equal(getAssumpB.res.statusCode, 200);
    assert.notEqual(getAssumpB.res.data.bridge.truckCostRub, 175000);

    // 6. Unauthenticated GET /api/market MUST NEVER return Farmer A's private data
    const mktAnon = mockReqRes({
      method: 'GET',
      url: '/api/market?today=2026-10-28',
      headers: {},
    });
    await marketHandler(mktAnon.req, mktAnon.res);
    assert.equal(mktAnon.res.statusCode, 200);
    assert.equal(
      mktAnon.res.data.prices.warehouse.exVat,
      null,
      "Unauthenticated GET /api/market must never return Farmer A's verified transactions"
    );
  } finally {
    if (origAllowAnon === undefined) delete process.env.AGRO_ALLOW_ANON_WRITES;
    else process.env.AGRO_ALLOW_ANON_WRITES = origAllowAnon;
    process.env.DATA_DIR = origDataDir;
    store.resetForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('P1-0b (F-07, F-09, F-15): Data scripts and /api/refresh regenerate official-hashes.json atomically and end-to-end refresh+load has no integrity error', async () => {
  // 1. server/officialHashes.js must exist and export writeJsonAtomically & regenerateOfficialHashesAtomically
  const officialHashesPath = path.join(ROOT, 'server/officialHashes.js');
  assert.ok(fs.existsSync(officialHashesPath), 'server/officialHashes.js must exist');
  const { writeJsonAtomically, regenerateOfficialHashesAtomically } = await import('../server/officialHashes.js');
  const { verifyOfficialDataHashes, officialSnapshot, officialHistory, officialDrivers } = await import('../shared/officialData.js');

  // 2. All data scripts (build_official_forecast.mjs, collect_cbr.mjs, collect_rosstat.py, fetch_rosstat.mjs) must regenerate official-hashes.json atomically
  for (const scriptRel of [
    'scripts/build_official_forecast.mjs',
    'scripts/collect_cbr.mjs',
    'scripts/collect_rosstat.py',
    'scripts/fetch_rosstat.mjs',
  ]) {
    const fullPath = path.join(ROOT, scriptRel);
    assert.ok(fs.existsSync(fullPath), `${scriptRel} must exist`);
    const src = fs.readFileSync(fullPath, 'utf8');
    assert.ok(
      src.includes('official-hashes.json') || src.includes('regenerateOfficialHashesAtomically'),
      `${scriptRel} must regenerate official-hashes.json`
    );
  }

  // 3. Test atomic regeneration in an isolated directory with updated official-history.json (new month 2026-10)
  const tmpOfficialDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agro-p1-0b-official-'));
  const origDataDir = process.env.DATA_DIR;
  const { store } = await import('../server/store.js');
  const refreshHandler = (await import('../api/refresh.js')).default;
  const marketHandler = (await import('../api/market.js')).default;

  try {
    process.env.DATA_DIR = tmpOfficialDir;
    process.env.CRON_SECRET = 'test-cron-secret-p1-0b';
    store.resetForTests();

    const updatedHistory = structuredClone(officialHistory);
    updatedHistory.collectedAt = '2026-11-15';
    updatedHistory.producer.monthly.push({
      period: '2026-10',
      unit: 'RUB/kg',
      value: 20.15,
      sourceId: updatedHistory.sources[0].id,
      sheet: '2026',
      cell: 'L74',
      rawValue: 20150,
      availableDate: '2026-11-10',
    });

    const updatedDrivers = structuredClone(officialDrivers);
    updatedDrivers.collectedAt = '2026-11-15';

    writeJsonAtomically(path.join(tmpOfficialDir, 'official-history.json'), updatedHistory);
    writeJsonAtomically(path.join(tmpOfficialDir, 'official-drivers.json'), updatedDrivers);
    const manifest = regenerateOfficialHashesAtomically(tmpOfficialDir);

    assert.ok(manifest.files['official-history.json']?.sha256, 'Manifest must include sha256 for official-history.json');
    assert.ok(manifest.files['official-drivers.json']?.sha256, 'Manifest must include sha256 for official-drivers.json');

    // Verify no leftover .tmp files exist after atomic write
    const filesInDir = fs.readdirSync(tmpOfficialDir);
    assert.ok(!filesInDir.some((f) => f.includes('.tmp')), 'Atomic write must not leave .tmp files behind');

    // Verify integrity against the regenerated official-hashes.json
    const check = verifyOfficialDataHashes({
      rawFiles: {
        'official-history.json': fs.readFileSync(path.join(tmpOfficialDir, 'official-history.json')),
        'official-drivers.json': fs.readFileSync(path.join(tmpOfficialDir, 'official-drivers.json')),
      },
      expected: JSON.parse(fs.readFileSync(path.join(tmpOfficialDir, 'official-hashes.json'), 'utf8')),
    });
    assert.equal(check.ok, true, 'Regenerated official-hashes.json must pass verifyOfficialDataHashes');

    // 4. End-to-end test: run /api/refresh (which detects the new 2026-10 official month in DATA_DIR and regenerates hashes & forecast), then load /api/market
    const refreshReq = mockReqRes({
      method: 'POST',
      url: '/api/refresh?today=2026-11-15',
      headers: { authorization: 'Bearer test-cron-secret-p1-0b' },
      body: {
        today: '2026-11-15',
        customFetchers: {
          cbr: async () =>
            '<ValCurs Date="15.11.2026"><Valute ID="R01235"><Nominal>1</Nominal><Value>98,50</Value></Valute><Valute ID="R01335"><Nominal>100</Nominal><Value>19,80</Value></Valute></ValCurs>',
          weather: async () => [{ daily: { time: ['2026-11-15'] } }],
          agroRu: async () => '<html><body></body></html>',
          foodStar: async () => '<html><body><span>24,50 руб/кг</span></body></html>',
          agroServer: async () => '<html><body></body></html>',
          news: async () => [],
        },
      },
    });
    await refreshHandler(refreshReq.req, refreshReq.res);
    assert.equal(refreshReq.res.statusCode, 200);
    assert.equal(refreshReq.res.data.forecasts.official_monthly.reissued, true);
    assert.equal(refreshReq.res.data.forecasts.official_monthly.inputCutoff, '2026-10');

    // Now load app data via GET /api/market and officialSnapshot -> zero integrity errors and updated cutoff 2026-10
    const mktReq = mockReqRes({
      method: 'GET',
      url: '/api/market?today=2026-11-15',
    });
    await marketHandler(mktReq.req, mktReq.res);
    assert.equal(mktReq.res.statusCode, 200);
    assert.equal(mktReq.res.data.official.status, 'ok', 'GET /api/market official.status must be ok after refresh');
    assert.equal(mktReq.res.data.official.integrity.ok, true, 'GET /api/market official.integrity.ok must be true');
    assert.equal(mktReq.res.data.official.producer.period, '2026-10', 'GET /api/market must reflect refreshed 2026-10 producer data');
    assert.equal(mktReq.res.data.official.forecast.inputCutoff, '2026-10', 'GET /api/market must reflect reissued official forecast');

    const snap = officialSnapshot('2026-11-15');
    assert.equal(snap.status, 'ok');
    assert.equal(snap.integrity.ok, true);
  } finally {
    process.env.DATA_DIR = origDataDir;
    delete process.env.CRON_SECRET;
    store.resetForTests();
    fs.rmSync(tmpOfficialDir, { recursive: true, force: true });
  }
});

test('P1-0c (F-08): Relational schema migrations, audit_revisions log, one-time idempotent import from legacy SQLite, and backup/restore', async () => {
  const migrationsPath = path.join(ROOT, 'server/migrations.js');
  assert.ok(fs.existsSync(migrationsPath), 'server/migrations.js must exist');
  const backupDocPath = path.join(ROOT, 'docs/BACKUP_AND_RESTORE.md');
  assert.ok(fs.existsSync(backupDocPath), 'docs/BACKUP_AND_RESTORE.md must exist');

  const { DatabaseSync } = await import('node:sqlite');
  const { store } = await import('../server/store.js');

  const origDataDir = process.env.DATA_DIR;
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agro-p1-0c-legacy-'));

  try {
    // 1. Create a pre-existing legacy SQLite database with only the old `documents` table
    const legacyDbPath = path.join(legacyDir, 'agro.sqlite');
    const rawLegacyDb = new DatabaseSync(legacyDbPath);
    rawLegacyDb.exec('CREATE TABLE documents (name TEXT PRIMARY KEY, body TEXT NOT NULL)');
    const legacyObs = [
      {
        id: 'legacy-tx-1',
        kind: 'transaction',
        market: 'warehouse_volgograd',
        observationDate: '2026-10-20',
        priceExVatRubKg: 16.4,
        verification: { status: 'verified', verifiedBy: 'user_ui', verifiedAt: '2026-10-20' },
      },
    ];
    const legacyAssumptions = {
      version: 2,
      bridge: { truckCostRub: 168000 },
      farmProfile: { areaHa: 95, storageCapacityTons: 1900, customizedFields: ['areaHa'] },
    };
    const legacyForecasts = [
      {
        id: 'fc-legacy-1',
        basis: 'warehouse',
        issueDate: '2026-10-20',
        inputCutoff: '2026-W42',
        modelVersion: 'local-arx-2.0',
        provenance: { inputHash: 'abc12345' },
        schema: 2,
      },
    ];
    const stmt = rawLegacyDb.prepare('INSERT INTO documents (name, body) VALUES (?, ?)');
    stmt.run('observations', JSON.stringify(legacyObs));
    stmt.run('assumptions', JSON.stringify(legacyAssumptions));
    stmt.run('forecasts', JSON.stringify(legacyForecasts));
    rawLegacyDb.close();

    // 2. Point store at legacyDir -> migrations + one-time import must run automatically and idempotently
    process.env.DATA_DIR = legacyDir;
    store.resetForTests();
    await store.ensureInitialized({ forWrite: true });

    const migrations = store.getAppliedMigrations();
    assert.ok(migrations.length >= 2, 'At least 2 numbered migrations must be applied');
    assert.ok(migrations.some((m) => m.name.includes('relational_schema')));
    assert.ok(migrations.some((m) => m.name.includes('legacy_documents_one_time_import')));

    // Verify legacy observations, assumptions, farmProfile, and forecasts were imported into relational tables
    const importedObs = store.getObservations();
    assert.ok(importedObs.some((o) => o.id === 'legacy-tx-1' && o.priceExVatRubKg === 16.4));
    const importedAssump = store.getAssumptions();
    assert.equal(importedAssump.bridge.truckCostRub, 168000);
    assert.equal(importedAssump.farmProfile.areaHa, 95);
    const importedFc = store.getForecasts();
    assert.ok(importedFc.some((f) => f.id === 'fc-legacy-1'));

    // Re-running importFromLegacySqlite must be a no-op (idempotent)
    const secondImport = store.importFromLegacySqlite();
    assert.equal(secondImport.alreadyImported, true, 'One-time legacy SQLite import must be idempotent');

    // 3. Perform user mutations and verify `audit_revisions` records every change with before/after JSON
    const magic = store.createMagicLink('auditor@volga.ru');
    const session = store.verifyMagicLink(magic.token);
    const userId = session.user.id;

    store.saveAssumptions({ bridge: { truckCostRub: 182000 } }, { userId });
    store.appendObservations(
      [
        {
          id: 'rel-tx-2',
          kind: 'transaction',
          market: 'warehouse_volgograd',
          observationDate: '2026-10-26',
          priceExVatRubKg: 17.2,
          verification: { status: 'verified', verifiedBy: 'user_ui', verifiedAt: '2026-10-26' },
        },
      ],
      { userId }
    );

    const revisions = store.getAuditRevisions({ userId });
    assert.ok(revisions.length >= 2, 'audit_revisions must record user mutations');
    const assumpRev = revisions.find((r) => r.entityType === 'user_assumptions');
    assert.ok(assumpRev, 'audit_revisions must include user_assumptions change');
    assert.equal(assumpRev.after.bridge.truckCostRub, 182000);

    // 4. Test backup export and restore into a fresh ephemeral database
    const backup = store.exportBackupSnapshot();
    assert.ok(backup.exportedAt);
    assert.ok(Array.isArray(backup.tables.user_observations));
    assert.ok(Array.isArray(backup.tables.user_assumptions));

    const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agro-p1-0c-restore-'));
    try {
      process.env.DATA_DIR = restoreDir;
      store.resetForTests();
      await store.ensureInitialized({ forWrite: true });

      store.restoreBackupSnapshot(backup);
      assert.equal(store.getAssumptions({ userId }).bridge.truckCostRub, 182000);
      assert.ok(store.getObservations({ userId }).some((o) => o.priceExVatRubKg === 17.2));
    } finally {
      fs.rmSync(restoreDir, { recursive: true, force: true });
    }
  } finally {
    process.env.DATA_DIR = origDataDir;
    store.resetForTests();
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }
});

test('P1-1 (F-05): Month-of-year seasonal local basis curve B(m) with hierarchical shrinkage, lot-size/recency weights, interval widening, and synthetic backtest', async () => {
  const localBasisMod = await import('../shared/localBasis.js');
  const { localBasis, applyBasis, runSeasonalBasisBacktest } = localBasisMod;

  assert.equal(typeof runSeasonalBasisBacktest, 'function', 'runSeasonalBasisBacktest must be exported from shared/localBasis.js');

  const national = [
    { period: '2026-08', value: 17.05 },
    { period: '2026-09', value: 18.12 },
    { period: '2026-10', value: 18.40 },
  ];

  // 1. Hierarchical shrinkage with user transactions weighted by lot size and recency
  const userPoints = [
    { week: '2026-09-14', value: 12.56, lotSizeT: 20 },
    { week: '2026-09-21', value: 12.90, lotSizeT: 60 }, // larger 60t lot has higher weight than 20t lot
    { week: '2026-10-12', value: 13.05, lotSizeT: 40 },
  ];

  const cal = localBasis(userPoints, national);
  assert.ok(cal, 'localBasis must return a calibration object');
  assert.ok(cal.curve && typeof cal.curve === 'object', 'localBasis must return month-of-year curve B(m)');
  assert.equal(Object.keys(cal.curve).length, 12, 'B(m) curve must cover all 12 calendar months');

  // Autumn months (9, 10) reflect autumn harvest discount (~0.70-0.73), while March (3) shrinks toward spring prior (~0.92-0.95)
  assert.ok(cal.curve[9] >= 0.68 && cal.curve[9] <= 0.76, `September basis ${cal.curve[9]} should be near ~0.71`);
  assert.ok(cal.curve[10] >= 0.68 && cal.curve[10] <= 0.76, `October basis ${cal.curve[10]} should be near ~0.71`);
  assert.ok(cal.curve[3] >= 0.88 && cal.curve[3] <= 0.98, `March basis ${cal.curve[3]} should shrink toward spring prior (~0.94)`);

  // When no regional series is passed explicitly, priorStatus / label notes prior provenance
  const calNoRegional = localBasis(userPoints, national, { regionalSeries: [] });
  assert.equal(calNoRegional.priorStatus, 'no regional prior');
  assert.ok(calNoRegional.uncertaintyCurve[3] > calNoRegional.uncertaintyCurve[10], 'Unobserved March must have wider basis uncertainty than observed October');

  // 2. UI label requirement: "calibrated on N transactions in months X, Y; other months use the prior"
  assert.ok(
    cal.label.includes('calibrated on 3 transactions in months 2026-09, 2026-10; other months use the prior'),
    `Expected label to contain required text, got: ${cal.label}`
  );

  // 3. Propagate basis uncertainty into localized intervals (widen them by the basis variance term)
  const marchRow = {
    targetMonth: '2027-03',
    point: 24.05,
    interval80: { lo: 21.0, hi: 27.1 },
  };
  const localizedMarch = applyBasis(marchRow, cal);
  const fMarch = cal.curve[3];
  assert.ok(Math.abs(localizedMarch.point - 24.05 * fMarch) < 1e-6, 'Localized March point must use B(3)');
  const naiveScaledWidth = (27.1 - 21.0) * fMarch;
  const widenedWidth = localizedMarch.interval80.hi - localizedMarch.interval80.lo;
  assert.ok(
    widenedWidth > naiveScaledWidth,
    `Localized interval width (${widenedWidth.toFixed(3)}) must be widened beyond naive scaled width (${naiveScaledWidth.toFixed(3)}) by basis variance`
  );

  // 4. Synthetic seasonal backtest: true basis 0.71 in autumn and 0.94 in spring (RF March = 24.05, true local March = 22.61)
  const bt = runSeasonalBasisBacktest();
  assert.ok(Math.abs(bt.oldStaticErrorPct - -24.8) < 1.0, `Old static March error should be ~ -24.8%, got ${bt.oldStaticErrorPct}%`);
  assert.ok(Math.abs(bt.newSeasonalErrorPct) < 7.0, `New seasonal March error must be < 7%, got ${bt.newSeasonalErrorPct}%`);
  assert.ok(Math.abs(bt.newSeasonalErrorRub) <= 1.5, `New seasonal March error must be <= 1.50 RUB/kg, got ${bt.newSeasonalErrorRub}`);
  assert.ok(
    Math.abs(bt.noisySingleEntryShiftPct) <= 10.0,
    `Single noisy/distressed entry (9.50 RUB/kg, n=1) must not shift 6-month forecast by > 10%, got ${bt.noisySingleEntryShiftPct}%`
  );
});

test('P1-2 (F-04): Pooled log-relative residuals (n >= 24) with block resampling, empirical coverage tolerance gate (70%..90%), and reliability-gated empirical directional probabilities', async () => {
  const officialForecastMod = await import('../shared/officialForecast.js');
  const { officialHistory } = await import('../shared/officialData.js');
  const { resolveSelectedHorizonMetrics } = await import('../shared/weeklyDecisionPlan.js');

  assert.equal(
    typeof officialForecastMod.computePooledLogRelativeCalibration,
    'function',
    'computePooledLogRelativeCalibration must be exported from shared/officialForecast.js'
  );
  assert.equal(
    typeof officialForecastMod.evaluateReliabilityDiagram,
    'function',
    'evaluateReliabilityDiagram must be exported from shared/officialForecast.js'
  );

  const points = officialHistory.producer.monthly;

  // 1. Evaluate across horizons and verify adjacent-horizon pooling reaches n >= 24 with block resampling
  for (const lead of [2, 6, 12, 14]) {
    const v = officialForecastMod.evaluateMonthly(points, lead);
    assert.ok(v.logRelativeCalibration, `evaluateMonthly at lead=${lead} must include logRelativeCalibration`);
    assert.ok(
      v.logRelativeCalibration.pooledN >= 24,
      `Pooled calibration sample size at lead=${lead} must be >= 24 (got ${v.logRelativeCalibration.pooledN})`
    );
    assert.ok(
      Array.isArray(v.logRelativeCalibration.pooledLeads) && v.logRelativeCalibration.pooledLeads.includes(lead),
      `pooledLeads must include target lead=${lead}`
    );
    assert.equal(v.logRelativeCalibration.resamplingMethod, 'moving_block_bootstrap');
    assert.ok(
      typeof v.logRelativeCalibration.empiricalCoverage80 === 'number',
      'empiricalCoverage80 must be reported on held-out rolling window'
    );

    // Check gating rule: band is valid ONLY when empirical coverage is within [0.70, 0.90] and pooledN >= 24
    const cov = v.logRelativeCalibration.empiricalCoverage80;
    const withinTol = cov >= 0.70 && cov <= 0.90 && v.logRelativeCalibration.pooledN >= 24;
    assert.equal(v.logRelativeCalibration.withinTolerance80, withinTol);
    if (!withinTol) {
      assert.ok(
        v.logRelativeCalibration.unavailableReason80 &&
          v.logRelativeCalibration.unavailableReason80.includes('Интервал недоступен') &&
          v.logRelativeCalibration.unavailableReason80.includes(`n=${v.logRelativeCalibration.pooledN}`),
        `When outside tolerance, unavailableReason80 must state 'Интервал недоступен' with n and observed coverage; got: ${v.logRelativeCalibration.unavailableReason80}`
      );
    }
  }

  // 2. Verify resolveSelectedHorizonMetrics hides the band and returns the explicit reason when coverage is outside 70%..90%
  const outOfTolRow = {
    h: 5,
    lead: 6,
    targetMonth: '2027-03',
    point: 22.4,
    interval80: { lo: 18.0, hi: 26.8 },
    validation: {
      selected: 'eq_carry',
      q80: 4.4,
      final: { mae: 2.5, n: 12 },
      logRelativeCalibration: {
        pooledN: 28,
        q80Log: 0.18,
        empiricalCoverage80: 0.58,
        withinTolerance80: false,
        unavailableReason80: 'Интервал недоступен: n=28, наблюдаемое покрытие 58% вне допуска 70%–90%',
      },
    },
  };
  const resolvedOut = resolveSelectedHorizonMetrics(outOfTolRow);
  assert.equal(resolvedOut.interval80, null, 'Band must be null when empirical coverage is outside 70%..90% tolerance');
  assert.ok(
    resolvedOut.interval80UnavailableReason.includes('Интервал недоступен') &&
      resolvedOut.interval80UnavailableReason.includes('n=28') &&
      resolvedOut.interval80UnavailableReason.includes('58%'),
    `Expected unavailable reason with n and observed coverage, got: ${resolvedOut.interval80UnavailableReason}`
  );

  // 3. Verify empirical directional probabilities and reliability diagram gating
  const goodRel = officialForecastMod.evaluateReliabilityDiagram(
    Array.from({ length: 30 }, (_, i) => ({
      predProbRise: i < 15 ? 0.25 : 0.75,
      actualRose: i < 15 ? (i % 4 === 0 ? 1 : 0) : (i % 4 !== 0 ? 1 : 0),
    }))
  );
  assert.equal(goodRel.passes, true, 'Well-calibrated empirical frequencies must pass reliability diagram test');

  const badRel = officialForecastMod.evaluateReliabilityDiagram(
    Array.from({ length: 30 }, (_, i) => ({
      predProbRise: 0.85,
      actualRose: i < 5 ? 1 : 0, // 85% predicted vs 16.7% observed -> fails reliability diagram
    }))
  );
  assert.equal(badRel.passes, false, 'Miscalibrated probabilities must fail reliability diagram test');
  assert.equal(badRel.gatedRiseProb, null, 'Rise probability must be hidden (null) when reliability diagram test fails');
});

test('P1-3 (F-01, F-02): Seasonal Weibull (eq_carry) is default product forecast, tree model is behind experimental toggle (off by default), permutation test wired in CI, and skill gate script enforces honest horizon badges', async () => {
  const officialForecastMod = await import('../shared/officialForecast.js');
  const { officialHistory, officialDrivers, officialForecast } = await import('../shared/officialData.js');

  // 1. DEFAULT_PRODUCT_MODEL must be 'eq_carry' and resolveProductForecastRow must default to experimentalTree: false
  assert.equal(officialForecastMod.DEFAULT_PRODUCT_MODEL, 'eq_carry');
  assert.equal(typeof officialForecastMod.resolveProductForecastRow, 'function');
  assert.equal(typeof officialForecastMod.runDriverPermutationTest, 'function');
  assert.equal(typeof officialForecastMod.verifySkillGate, 'function');

  const sampleRow = officialForecast.rows.find((r) => r.lead === 6);
  const defaultResolved = officialForecastMod.resolveProductForecastRow(sampleRow);
  assert.equal(defaultResolved.modelId, 'eq_carry', 'Default product forecast must use seasonal Weibull (eq_carry)');
  assert.equal(defaultResolved.experimentalActive, false, 'Experimental tree toggle must be off by default');
  assert.equal(defaultResolved.usesMacroWeatherDrivers, false, 'Default path must not use macro/weather drivers');

  const expResolved = officialForecastMod.resolveProductForecastRow(sampleRow, { experimentalTree: true });
  assert.equal(expResolved.modelId, 'catboost');
  assert.equal(expResolved.experimentalActive, true);
  assert.equal(expResolved.point, sampleRow.catboostPoint);

  // 2. UI component OfficialMarket.jsx must have experimental toggle off by default (useState(false))
  const officialMarketSrc = fs.readFileSync(path.join(ROOT, 'src/components/OfficialMarket.jsx'), 'utf8');
  assert.ok(
    officialMarketSrc.includes('experimentalTree') && officialMarketSrc.includes('useState(false)'),
    'OfficialMarket.jsx must gate tree model behind experimentalTree toggle defaulting to false'
  );

  // 3. Permutation test on macro/weather drivers must be wired and report empirical p-value
  const permResult = officialForecastMod.runDriverPermutationTest(
    officialHistory.producer.monthly,
    officialDrivers,
    officialHistory.retail.weekly,
    { lead: 6, permutations: 15, seed: 42 }
  );
  assert.ok(Number.isFinite(permResult.unpermutedMae), 'Permutation test must report unpermuted MAE');
  assert.ok(Number.isFinite(permResult.permutedMeanMae), 'Permutation test must report mean permuted MAE');
  assert.ok(Number.isFinite(permResult.pValue), 'Permutation test must report empirical p-value');

  // 4. CI skill gate script (scripts/check_skill_gate.mjs) must exist, pass on honest badges, and fail when a badge hides worse-than-naive or worse-than-seasonal MAE
  const skillGateScript = path.join(ROOT, 'scripts/check_skill_gate.mjs');
  assert.ok(fs.existsSync(skillGateScript), 'scripts/check_skill_gate.mjs must exist');

  const gatePass = officialForecastMod.verifySkillGate(officialForecast);
  assert.equal(gatePass.ok, true, `Skill gate must pass on honest badges, got violations: ${JSON.stringify(gatePass.violations)}`);

  // Dishonest badge simulation: model MAE (4.5) is worse than naive (3.1), yet badge claims 'beats seasonal-naive'
  const dishonestForecast = {
    lastValue: 18.12,
    rows: [
      {
        h: 1,
        lead: 2,
        targetMonth: '2026-11',
        point: 19.0,
        badgeOverride: 'beats seasonal-naive',
        validation: {
          selected: 'eq_carry',
          final: { mae: 4.5, n: 12 },
          naiveFinal: { mae: 3.1, n: 12 },
          finalAll: [
            { id: 'eq_carry', mae: 4.5 },
            { id: 'naive', mae: 3.1 },
            { id: 'seasonal', mae: 3.8 },
          ],
        },
      },
    ],
  };
  const gateFail = officialForecastMod.verifySkillGate(dishonestForecast);
  assert.equal(gateFail.ok, false, 'Skill gate must fail when a horizon loses to naive or seasonal-naive without the badge saying so');
  assert.ok(gateFail.violations.length === 1);
});

test('P1-4 (F-01, F-09): Forecast scorecard stores immutable records with metadata, calculates realized errors against actual arrivals, and benchmarks vs naive and seasonal-naive over rolling 12m', async () => {
  const scorecardMod = await import('../shared/scorecard.js');
  assert.equal(typeof scorecardMod.buildForecastScorecard, 'function');
  assert.equal(typeof scorecardMod.computeRealizedErrors, 'function');

  // 1. Mock historical issued forecasts with metadata
  const mockHistory = [
    { period: '2025-01', value: 15.0 },
    { period: '2025-02', value: 16.0 },
    { period: '2025-03', value: 18.0 },
    { period: '2025-04', value: 20.0 },
    { period: '2026-01', value: 16.5 },
    { period: '2026-02', value: 17.0 },
    { period: '2026-03', value: 19.5 },
    { period: '2026-04', value: 22.0 },
  ];

  const issuedForecast1 = {
    id: 'fc_2025_12',
    issueDate: '2025-12-15',
    dataCutoff: '2025-11',
    modelVersion: 'rosstat-catboost-3.0.0',
    inputsHash: 'a1b2c3d4e5f6',
    baseValue: 14.5,
    rows: [
      { h: 1, lead: 2, targetMonth: '2026-01', point: 16.0 },
      { h: 2, lead: 3, targetMonth: '2026-02', point: 18.0 },
      { h: 3, lead: 4, targetMonth: '2026-03', point: 21.0 },
      { h: 4, lead: 5, targetMonth: '2026-05', point: 24.0 }, // future/pending
    ],
  };

  const scorecard = scorecardMod.buildForecastScorecard([issuedForecast1], mockHistory);

  assert.equal(scorecard.totalIssues, 1);
  assert.equal(scorecard.realizedPointsCount, 3);
  assert.equal(scorecard.pendingPointsCount, 1);

  // Check per-horizon realized error evaluation
  const h1 = scorecard.byHorizon.find((h) => h.lead === 2);
  assert.ok(h1, 'Horizon lead 2 must be evaluated');
  assert.equal(h1.n, 1);
  // Actual 2026-01 is 16.5, forecast was 16.0 -> error = -0.5, absError = 0.5
  assert.equal(h1.modelMae, 0.5);
  // Naive (last observed 14.5 vs actual 16.5) -> absError = 2.0
  assert.equal(h1.naiveMae, 2.0);
  // Seasonal naive (2025-01 was 15.0 vs actual 16.5) -> absError = 1.5
  assert.equal(h1.seasonalMae, 1.5);
  assert.equal(h1.beatsNaive, true);
  assert.equal(h1.beatsSeasonal, true);
  assert.equal(h1.directionalHitRate, 1.0);

  // Rolling 12-month metrics
  assert.ok(scorecard.rolling12m, 'Rolling 12m section must exist');
  assert.equal(scorecard.rolling12m.evaluatedN, 3);
  assert.ok(Number.isFinite(scorecard.rolling12m.modelMae));
  assert.ok(Number.isFinite(scorecard.rolling12m.naiveMae));
  assert.ok(Number.isFinite(scorecard.rolling12m.seasonalMae));

  // 2. GET /api/scorecard endpoint
  const scorecardHandler = (await import('../api/scorecard.js')).default;
  const req = { method: 'GET', query: {}, headers: {} };
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    setHeader: () => {},
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => {
          jsonBody = data;
        },
      };
    },
  };
  await scorecardHandler(req, res);
  assert.equal(statusCode, 200);
  assert.ok(jsonBody.scorecard, 'API /api/scorecard must return scorecard payload');

  // 3. UI component Scorecard.jsx must exist and render table and badges
  const scorecardCompSrc = fs.readFileSync(path.join(ROOT, 'src/components/Scorecard.jsx'), 'utf8');
  assert.ok(
    scorecardCompSrc.includes('Scorecard') || scorecardCompSrc.includes('scorecard'),
    'Scorecard component must exist'
  );
});

test('P1-5 (G-01, G-03): Regional EMISS producer prices (Volgograd, Astrakhan, Rostov) and monthly HS 070310 imports have schema validation, hashes, freshness stamps, and fail loudly on layout changes', async () => {
  const regionalMod = await import('../shared/regionalData.js');
  assert.equal(typeof regionalMod.validateRegionalSeriesSchema, 'function');
  assert.equal(typeof regionalMod.validateImportsHs070310Schema, 'function');
  assert.equal(typeof regionalMod.parseRegionalCsv, 'function');
  assert.equal(typeof regionalMod.parseImportsCsv, 'function');

  // 1. Files data/regional-history.json and data/imports-hs070310.json must exist
  const regPath = path.join(ROOT, 'data/regional-history.json');
  const impPath = path.join(ROOT, 'data/imports-hs070310.json');
  assert.ok(fs.existsSync(regPath), 'data/regional-history.json must exist');
  assert.ok(fs.existsSync(impPath), 'data/imports-hs070310.json must exist');

  const regData = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const impData = JSON.parse(fs.readFileSync(impPath, 'utf8'));

  // 2. Validate schema & freshness
  const regVal = regionalMod.validateRegionalSeriesSchema(regData);
  assert.equal(regVal.valid, true, `Regional schema validation failed: ${JSON.stringify(regVal.errors)}`);
  assert.ok(regData.series?.volgograd?.length >= 24, 'Volgograd regional series must contain >= 24 months');
  assert.ok(regData.series?.astrakhan?.length >= 24, 'Astrakhan regional series must contain >= 24 months');
  assert.ok(regData.series?.rostov?.length >= 24, 'Rostov regional series must contain >= 24 months');

  const impVal = regionalMod.validateImportsHs070310Schema(impData);
  assert.equal(impVal.valid, true, `Imports schema validation failed: ${JSON.stringify(impVal.errors)}`);
  assert.ok(impData.monthly?.length >= 24, 'HS 070310 imports must contain >= 24 records');

  // 3. Schema validator must fail loudly on altered layout
  const brokenLayout = {
    schema: 1,
    indicator: '31448',
    series: {
      volgograd: [{ period: 'invalid-date', value: -10 }], // negative price, bad date
    },
  };
  assert.throws(
    () => regionalMod.validateRegionalSeriesSchema(brokenLayout, { throwOnError: true }),
    /REGIONAL_SCHEMA_ERROR/,
    'Validator must throw on corrupted regional layout'
  );

  // 4. Hashes recorded in data/official-hashes.json
  const hashes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/official-hashes.json'), 'utf8'));
  assert.ok(hashes.files?.['regional-history.json'], 'official-hashes.json must track regional-history.json');
  assert.ok(hashes.files?.['imports-hs070310.json'], 'official-hashes.json must track imports-hs070310.json');

  // 5. CSV Fallback parsing
  const csvRegionalSample = `period,price,availableDate\n2026-01,24.50,2026-02-15\n2026-02,26.00,2026-03-15`;
  const parsedRegional = regionalMod.parseRegionalCsv(csvRegionalSample, { region: 'Волгоградская область' });
  assert.equal(parsedRegional.length, 2);
  assert.equal(parsedRegional[0].period, '2026-01');
  assert.equal(parsedRegional[0].value, 24.5);
  assert.equal(parsedRegional[0].unit, 'RUB/kg');

  // 6. UI: OfficialMarket.jsx includes reference regional layer
  const officialMarketSrc = fs.readFileSync(path.join(ROOT, 'src/components/OfficialMarket.jsx'), 'utf8');
  assert.ok(
    officialMarketSrc.includes('regional') || officialMarketSrc.includes('Региональные') || officialMarketSrc.includes('Волгоград'),
    'OfficialMarket.jsx must support regional reference layer'
  );
});

test('P1-6 (F-12, F-13): Plan reconciliation validators flag tranche % mismatch, mass balance gaps, duplicate cash-flow periods, P&L vs cashflow revenue discrepancy, and rotation risk', async () => {
  const planValMod = await import('../shared/planValidators.js');
  assert.equal(typeof planValMod.validateTrancheShares, 'function');
  assert.equal(typeof planValMod.validateMassBalance, 'function');
  assert.equal(typeof planValMod.validateCashFlowPeriods, 'function');
  assert.equal(typeof planValMod.validateRevenueReconciliation, 'function');
  assert.equal(typeof planValMod.validateCropRotation, 'function');
  assert.equal(typeof planValMod.validateFarmStrategyPlan, 'function');

  // Exact audited numbers from Volgograd_78ha_Strategy.docx:
  const auditedStrategyCase = {
    totalAreaHa: 78,
    crops: [
      { name: 'Лук репчатый (яровой)', ha: 32, isAllium: true },
      { name: 'Лук репчатый (озимый)', ha: 10, isAllium: true },
      { name: 'Морковь', ha: 6 },
      { name: 'Свёкла', ha: 7 },
      { name: 'Картофель ранний', ha: 8 },
      { name: 'Кабачок', ha: 5 },
      { name: 'Горох овощной', ha: 10 },
    ],
    // Tranches: 15% field + 100% storage tranches = 115%
    tranches: [
      { name: 'Август-Сентябрь (с поля)', sharePct: 15 },
      { name: 'Ноябрь (Транш 1)', sharePct: 15 },
      { name: 'Декабрь (Транш 2)', sharePct: 25 },
      { name: 'Январь (Транш 3)', sharePct: 15 },
      { name: 'Февраль (Транш 4)', sharePct: 25 },
      { name: 'Март (Транш 5)', sharePct: 20 },
    ],
    // Mass balance: 1,760 t harvested vs 1,560 t sold in Cashflow
    massBalance: {
      harvestedTons: 1760,
      soldTons: 1560,
      lossTons: 0, // Unaccounted shrinkage in P&L Table 3
      unsoldTons: 0,
    },
    // Cashflow periods with duplicate February (Row 1 Feb-Apr vs Row 8 Feb-Mar)
    cashFlowPeriods: [
      { id: 'row1', label: 'Февраль – Апрель: Продажа остатков прошлого сезона', months: ['2026-02', '2026-03', '2026-04'], inflowRub: 19000000 },
      { id: 'row2', label: 'Май – Июнь: Затраты на посев и полив', months: ['2026-05', '2026-06'], inflowRub: 0 },
      { id: 'row8', label: 'Февраль – Март: Продажа лука Транш 3 (550 т) + морковь', months: ['2026-02', '2026-03'], inflowRub: 19170000 },
    ],
    // Revenue gap: 34.85M RUB in P&L vs 30.555M RUB in Cashflow (4.295M RUB gap)
    revenue: {
      pnlRevenueRub: 34848000,
      cashflowSalesRub: 30555000,
      pnlVolumeTons: 1760,
      cashflowVolumeTons: 1560,
    },
  };

  const validationResult = planValMod.validateFarmStrategyPlan(auditedStrategyCase);
  assert.equal(validationResult.valid, false, 'Audited Volgograd strategy numbers must fail validation');

  // 1. Tranche % mismatch (115% != 100%)
  const trancheCheck = validationResult.checks.tranches;
  assert.equal(trancheCheck.valid, false);
  assert.equal(trancheCheck.totalShare, 115);
  assert.equal(trancheCheck.code, 'TRANCHE_SUM_MISMATCH');

  // 2. Mass balance (1,760 t harvested != 1,560 t accounted, 200 t gap)
  const massCheck = validationResult.checks.massBalance;
  assert.equal(massCheck.valid, false);
  assert.equal(massCheck.discrepancyTons, 200);
  assert.equal(massCheck.code, 'MASS_BALANCE_MISMATCH');

  // 3. Cash flow period overlap (February duplicate count)
  const periodCheck = validationResult.checks.periods;
  assert.equal(periodCheck.valid, false);
  assert.ok(periodCheck.duplicateMonths.includes('2026-02'));
  assert.equal(periodCheck.code, 'PERIOD_DUPLICATION');

  // 4. Revenue reconciliation (4.293M RUB gap between Table 3 P&L and Table 4 Cashflow)
  const revCheck = validationResult.checks.revenue;
  assert.equal(revCheck.valid, false);
  assert.equal(revCheck.gapTons, 200);
  assert.ok(Math.abs(revCheck.gapRub - 4293000) < 5000);
  assert.equal(revCheck.code, 'REVENUE_GAP');

  // 5. Crop rotation violation: 42 ha of 78 ha = 53.85% onion (>25% limit, return interval 1.86 yr < 3-4 yr)
  const rotCheck = validationResult.checks.rotation;
  assert.equal(rotCheck.valid, false);
  assert.equal(rotCheck.onionHa, 42);
  assert.equal(Math.round(rotCheck.onionShare * 100), 54);
  assert.equal(rotCheck.severity, 'critical');
  assert.equal(rotCheck.code, 'CROP_ROTATION_VIOLATION');

  // 6. Valid reconciled plan passes all checks
  const reconciledValidPlan = {
    totalAreaHa: 78,
    crops: [
      { name: 'Лук репчатый', ha: 19.5, isAllium: true }, // 25.0% share
      { name: 'Морковь', ha: 19.5 },
      { name: 'Свёкла', ha: 19.5 },
      { name: 'Горох овощной', ha: 19.5 },
    ],
    tranches: [
      { name: 'Поле (Август-Сентябрь)', sharePct: 15 },
      { name: 'Транш 1 (Октябрь)', sharePct: 20 },
      { name: 'Транш 2 (Декабрь)', sharePct: 25 },
      { name: 'Транш 3 (Февраль)', sharePct: 35 },
      { name: 'Транш 4 (Апрель)', sharePct: 5 },
    ],
    massBalance: {
      harvestedTons: 1000,
      soldTons: 860,
      lossTons: 140, // 14% physical shrinkage & rot explicitly balanced
      unsoldTons: 0,
    },
    cashFlowPeriods: [
      { id: 'p1', months: ['2026-08', '2026-09'], inflowRub: 2500000 },
      { id: 'p2', months: ['2026-10', '2026-11'], inflowRub: 3500000 },
      { id: 'p3', months: ['2026-12', '2027-01'], inflowRub: 5000000 },
      { id: 'p4', months: ['2027-02', '2027-03'], inflowRub: 7000000 },
      { id: 'p5', months: ['2027-04'], inflowRub: 1200000 },
    ],
    revenue: {
      pnlRevenueRub: 19200000,
      cashflowSalesRub: 19200000,
      pnlVolumeTons: 860,
      cashflowVolumeTons: 860,
    },
  };
  const validRes = planValMod.validateFarmStrategyPlan(reconciledValidPlan);
  assert.equal(validRes.valid, true, 'Fully reconciled plan must pass all validation checks');
  assert.equal(validRes.violations.length, 0);
});






