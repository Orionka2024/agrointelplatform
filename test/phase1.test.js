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
