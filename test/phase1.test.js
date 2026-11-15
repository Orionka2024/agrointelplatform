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




