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
