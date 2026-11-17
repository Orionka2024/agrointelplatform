import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateAttestedTransaction } from '../shared/offlineQueue.js';
import { buildUserPriceCsv } from '../shared/localBasis.js';
import { importPriceCSV, isVerified } from '../shared/observations.js';
import { computeMarketModel } from '../shared/marketModel.js';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agro-task0-'));
process.env.DATA_DIR = TMP_DIR;
const { store } = await import('../server/store.js');

test('Task 0.1: validateAttestedTransaction enforces 3-120 RUB/kg range, physical fields, and listing guard', () => {
  const validTx = {
    basis: 'warehouse',
    date: '2026-11-15',
    price: 16.5,
    vat: 'excl',
    region: 'Волгоградская обл.',
    deliveryBasis: 'EXW',
    sourceType: 'transaction',
    lotSizeT: 25,
    grade: '1 сорт (ГОСТ 34306-2017)',
    caliber: '5+ см',
    attested: true,
  };

  assert.equal(validateAttestedTransaction(validTx).valid, true);
  assert.equal(validateAttestedTransaction({ ...validTx, price: 3 }).valid, true);
  assert.equal(validateAttestedTransaction({ ...validTx, price: 120 }).valid, true);

  // Out of sensible 3-120 RUB/kg range
  assert.equal(validateAttestedTransaction({ ...validTx, price: 2.9 }).valid, false);
  assert.equal(validateAttestedTransaction({ ...validTx, price: 120.5 }).valid, false);
  assert.equal(validateAttestedTransaction({ ...validTx, price: -5 }).valid, false);

  // Missing required fields
  assert.equal(validateAttestedTransaction({ ...validTx, date: '' }).valid, false);
  assert.equal(validateAttestedTransaction({ ...validTx, region: '   ' }).valid, false);
  assert.equal(validateAttestedTransaction({ ...validTx, grade: '', caliber: '' }).valid, false);
  assert.equal(validateAttestedTransaction({ ...validTx, lotSizeT: 0 }).valid, false);
  assert.equal(validateAttestedTransaction({ ...validTx, vat: 'invalid' }).valid, false);
  assert.equal(validateAttestedTransaction({ ...validTx, deliveryBasis: 'FOB' }).valid, false);
  assert.equal(validateAttestedTransaction({ ...validTx, attested: false }).valid, false);

  // Listing guard: listing sourceType must never pass as a confirmed transaction
  const listingRes = validateAttestedTransaction({ ...validTx, sourceType: 'listing' });
  assert.equal(listingRes.valid, false);
  assert.ok(listingRes.errors.some((e) => e.includes('listing')));
});

test('Task 0.2: buildUserPriceCsv and importPriceCSV block listing records from verified transactions', () => {
  assert.throws(() => {
    buildUserPriceCsv([{ basis: 'warehouse', date: '2026-11-15', price: 16.5, vat: 'excl', sourceType: 'listing' }], '2026-11-15');
  });

  const csvListing = [
    'observation_date,retrieved_date,kind,market,geography,price,unit,vat,vat_rate,delivery_basis,grade,size_mm,packaging,lot_size_t,payment_terms,volume_t,source,source_ref,published_date,notes,verification_status,verified_by,verified_at',
    '2026-11-15,2026-11-15,indicative_offer,warehouse_volgograd,"Волгоградская обл.",16.5,RUB/kg,excl,0.10,EXW,"1 сорт",5+ см,"Сетка",25,"100%",25,"Агросервер","ref-1",2026-11-15,"",verified,"user",2026-11-15',
  ].join('\n');

  const report = importPriceCSV(csvListing, [], { today: '2026-11-15', importDate: '2026-11-15' });
  assert.equal(report.accepted.length, 1);
  assert.equal(isVerified(report.accepted[0]), false);
});

test('Task 0.3: Saving actual price when pricesVerified=0 increments pricesVerified and updates forecast model', async () => {
  await store.syncFromDurable();

  try {
    const userId = 'user-task0';
    const before = computeMarketModel({
      observations: store.getObservations({ userId }),
      assumptions: store.getAssumptions({ userId }),
      today: '2026-11-15',
    });
    assert.equal(before.evidence.pricesVerified, 0);
    assert.equal(before.prices.warehouse.exVat, null);

    const csv = buildUserPriceCsv([
      {
        basis: 'warehouse',
        date: '2026-11-15',
        price: 17.5,
        vat: 'excl',
        region: 'Волгоградская обл.',
        deliveryBasis: 'EXW',
        lotSizeT: 25,
        grade: '1 сорт (ГОСТ 34306-2017)',
        caliber: '5+ см',
      },
    ], '2026-11-15');

    const report = importPriceCSV(csv, store.getObservations({ userId }), { today: '2026-11-15', importDate: '2026-11-15' });
    assert.equal(report.accepted.length, 1);
    assert.equal(isVerified(report.accepted[0]), true);

    store.appendObservations(report.accepted, { userId });

    const after = computeMarketModel({
      observations: store.getObservations({ userId }),
      assumptions: store.getAssumptions({ userId }),
      today: '2026-11-15',
    });
    assert.equal(after.evidence.pricesVerified, 1);
    assert.equal(after.prices.warehouse.exVat, 17.5);
  } finally {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
});

test('Task 0.4: Save button in AddActualPrice.jsx is always visible when pricesVerified=0 and integrated in Forecast/Dashboard', () => {
  const addActualSrc = fs.readFileSync('src/components/AddActualPrice.jsx', 'utf8');
  const forecastSrc = fs.readFileSync('src/components/Forecast.jsx', 'utf8');
  const dashboardSrc = fs.readFileSync('src/components/Dashboard.jsx', 'utf8');

  assert.ok(addActualSrc.includes('Сохранить фактическую цену'));
  assert.ok(addActualSrc.includes('data-testid="save-actual-price-btn"'));
  assert.ok(!addActualSrc.includes('disabled={busy || demo || !attested}'));
  assert.ok(forecastSrc.includes('<AddActualPrice defaultOpen={(model.evidence?.pricesVerified ?? 0) === 0} />'));
  assert.ok(dashboardSrc.includes('<AddActualPrice defaultOpen={(model.evidence?.pricesVerified ?? 0) === 0} />'));
});
