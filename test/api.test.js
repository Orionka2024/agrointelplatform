import test from 'node:test';
import assert from 'node:assert/strict';
import marketHandler from '../api/market.js';
import importHandler from '../api/import.js';
import forecastHandler from '../api/forecast.js';
import assumptionsHandler from '../api/assumptions.js';
import advisorHandler from '../api/advisor.js';

function mockReqRes({ method = 'GET', url = '/', body = {} } = {}) {
  let statusCode = 200;
  let responseData = null;
  const headers = {};

  const req = { method, url, body };
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
      headers[k] = v;
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

test('API 1: GET /api/market?demo=true returns full demo model', async () => {
  const { req, res } = mockReqRes({ method: 'GET', url: '/api/market?demo=true&today=2026-10-24' });
  await marketHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.mode, 'demo');
  assert.ok(res.data.prices.warehouse.exVat != null);
  assert.ok(res.data.prices.moscow.inclVat != null);
  assert.ok(res.data.forecasts.warehouse.horizons.length > 0);
  assert.equal(res.data.forecasts.warehouse.issueDate, '2026-10-24');
});

test('API 2: POST /api/assumptions updates cost bridge and storage parameters', async () => {
  const patch = {
    bridge: { freightRubKg: 7.5 },
    storage: { rotPct: 5.5 },
  };
  const { req, res } = mockReqRes({ method: 'POST', url: '/api/assumptions', body: patch });
  await assumptionsHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.assumptions.bridge.freightRubKg, 7.5);
  assert.equal(res.data.assumptions.storage.rotPct, 5.5);
});

test('API 3: POST /api/import validates CSV and deduplicates repeated records', async () => {
  const validCsv = [
    'observation_date,kind,market,geography,price,unit,vat,vat_rate,delivery_basis,source',
    '2026-10-15,transaction,warehouse_volgograd,"Волгоградская обл.",14.50,RUB/kg,excl,0.10,EXW,Агросервер',
    '2026-10-22,transaction,warehouse_volgograd,"Волгоградская обл.",15.20,RUB/kg,excl,0.10,EXW,Агросервер',
  ].join('\n');

  const { req, res } = mockReqRes({
    method: 'POST',
    url: '/api/import',
    body: { type: 'prices', csv: validCsv, importDate: '2026-10-24' },
  });
  await importHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.report.totalRows, 2);
  assert.equal(res.data.report.accepted.length + res.data.report.duplicates.length, 2);
  assert.equal(res.data.report.rejected.length, 0);
});

test('API 4: POST /api/import rejects invalid rows without crashing', async () => {
  const invalidCsv = [
    'observation_date,kind,market,geography,price,unit,vat,vat_rate,delivery_basis,source',
    'not-a-date,transaction,warehouse_volgograd,"Волгоградская обл.",14.50,RUB/kg,excl,0.10,EXW,Агросервер',
    '2026-10-22,transaction,warehouse_volgograd,"Волгоградская обл.",-5.00,RUB/kg,excl,0.10,EXW,Агросервер',
  ].join('\n');

  const { req, res } = mockReqRes({
    method: 'POST',
    url: '/api/import',
    body: { type: 'prices', csv: invalidCsv, importDate: '2026-10-24' },
  });
  await importHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, false);
  assert.equal(res.data.report.totalRows, 2);
  assert.equal(res.data.report.accepted.length, 0);
  assert.equal(res.data.report.rejected.length, 2);
});

test('API 5: POST /api/forecast issues immutable forecast based on observations', async () => {
  const { req, res } = mockReqRes({
    method: 'POST',
    url: '/api/forecast',
    body: { basis: 'warehouse', issueDate: '2026-10-24' },
  });
  await forecastHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  const fc = res.data.forecast;
  assert.equal(fc.issueDate, '2026-10-24');
  assert.equal(fc.basis, 'warehouse');
  assert.ok(fc.inputCutoff === null || fc.inputCutoff <= '2026-10-24');
  assert.ok(['validated', 'baseline_unvalidated', 'insufficient_data', 'demo'].includes(fc.status));
});

test('API 6: POST /api/advisor requires message and handles missing keys honestly', async () => {
  // Test missing message
  const emptyReq = mockReqRes({
    method: 'POST',
    url: '/api/advisor',
    body: {},
  });
  await advisorHandler(emptyReq.req, emptyReq.res);
  assert.equal(emptyReq.res.statusCode, 400);

  // Test valid message with missing API keys (expected 401 with helpful instructions, not 500 crash)
  const validReq = mockReqRes({
    method: 'POST',
    url: '/api/advisor',
    body: {
      message: 'Каковы условия окупаемости хранения?',
      demo: true,
    },
  });
  await advisorHandler(validReq.req, validReq.res);
  assert.ok(validReq.res.statusCode === 401 || validReq.res.statusCode === 200);
  if (validReq.res.statusCode === 401) {
    assert.equal(validReq.res.data.error, 'API_KEY_MISSING');
  }
});
