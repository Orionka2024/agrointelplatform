# Phase 0 ("Stop the Harm") Remediation Report (`PHASE0_REPORT.md`)

**Branch:** `phase0-fixes`  
**Date:** 2026-11-15  
**Base Commit:** `a0e5022` (`main`)  
**Verification Gate (run after every item):** `npm test && npm run lint && npm run build` (85 tests passing, 0 lint errors, production Vite build succeeding).

---

## Summary Table of Phase 0 Commits

| Item | Finding ID(s) | Commit | Title | Status |
|---|---|---|---|---|
| **P0-1** | `F-06` | `9285b44` | `P0-1: Spot-calibration button writes fake verified transactions (F-06)` | Done & Verified |
| **P0-2** | `F-08` | `dc25983` | `P0-2: Durable-store overwrite on cold start (F-08)` | Done & Verified |
| **P0-3** | `F-11` | `0c97a82` | `P0-3: Storage slider freezes physical loss (F-11)` | Done & Verified |
| **P0-4** | `F-03` | `5adca67` | `P0-4: Fabricated SHAP constants (F-03)` | Done & Verified |
| **P0-5** | `F-01`, `F-02` | `c6cb2c8` | `P0-5: Stop overriding the model selector (F-01, F-02)` | Done & Verified |
| **P0-6** | `F-01`, `F-02` | `9543eb0` | `P0-6: Honest horizon labelling (F-01, F-02)` | Done & Verified |
| **P0-7** | `F-04` | `dc73f3f` | `P0-7: Intervals: show real ones or none (F-04)` | Done & Verified |
| **P0-8** | `F-10` | `38d0b93` | `P0-8: Write endpoints require auth by default (F-10)` | Done & Verified |
| **P0-9** | `F-07`, `F-09`, `F-15` | `8b25acf` | `P0-9: Cron and refresh job (F-07, F-09, F-15)` | Done & Verified |
| **P0-10** | `F-15` | `bfaaecf` | `P0-10: Verify data hashes at runtime (F-15)` | Done & Verified |
| **P0-11** | `F-09` | `f5645f3` | `P0-11: Freshness stamps (F-09)` | Done & Verified |

---

## Detailed Item Reports

### P0-1: Spot-calibration button writes fake verified transactions (`F-06`)
- **Commit:** `9285b44`
- **Failing Test Output (Before):**
  ```text
  ✖ P0-1 (F-06): Spot-calibration preview creates zero rows in observations table and cannot set verification_status=verified from a listing source (4.953241ms)
    AssertionError [ERR_ASSERTION]: Listing source (AgroRU) must never be accepted as verification_status=verified
    + actual - expected
    + 'verified'
    - 'unverified'
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P0-1 (F-06): Spot-calibration preview creates zero rows in observations table and cannot set verification_status=verified from a listing source (59.243957ms)
  ```
- **Files Changed:**
  - `shared/observations.js`
  - `shared/localBasis.js`
  - `src/context/MarketContext.jsx`
  - `src/components/Dashboard.jsx`
  - `src/components/Forecast.jsx`
  - `test/phase0.test.js`
- **Farmer-Visible Behaviour Changes:**
  - Removed the one-click import that wrote unverified AgroRU marketplace listings into SQLite as `kind: 'transaction', verification_status: 'verified', source: 'Собственная сделка пользователя'`.
  - Replaced it with a session-only preview (`spotPreview`) clearly labelled **«Предпросмотр от оферты (не сделка, только сессия)»** / **«unverified ask, session only»** that writes zero rows to SQLite and never increments the verified-transaction count.
  - Enforced server-side and shared-validator guards (`isListingSource()`) so any row originating from a marketplace listing (`AgroRU`, `Агросервер`, `ФудСтар`, `Зерно Он-Лайн`, or notes mentioning `Калибровка по споту`) is forced to `kind: 'indicative_offer'` and `verification_status: 'unverified'`. Real calibration requires user attestation via `AddActualPrice.jsx`.
- **Prompt vs. Audit/Code Notes:**
  - Matches both the prompt and `AUDIT_REPORT.md` Finding `F-06` (`src/components/Dashboard.jsx:117-130`, `src/components/Forecast.jsx:235-254, 407`).

---

### P0-2: Durable-store overwrite on cold start (`F-08`)
- **Commit:** `dc25983`
- **Failing Test Output (Before):**
  ```text
  ✖ P0-2 (F-08): Cold start syncs from KV before write, rejects writes with 503 when KV sync fails, and prevents stale revision overwrite (350.794405ms)
    AssertionError [ERR_ASSERTION]: KV must still contain the original pre-existing transaction after cold-start write
    + actual - expected
    + false
    - true
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P0-2 (F-08): Cold start syncs from KV before write, rejects writes with 503 when KV sync fails, and prevents stale revision overwrite (153.572021ms)
  ```
- **Files Changed:**
  - `server/store.js`
  - `api/import.js`
  - `api/assumptions.js`
  - `api/forecast.js`
  - `api/market.js`
  - `api/advisor.js`
  - `api/macro.js`
  - `api/refresh.js`
  - `test/phase0.test.js`
- **Farmer-Visible Behaviour Changes:**
  - When a serverless instance cold-starts with an empty `/tmp/agro.sqlite`, `ensureReady({ forWrite })` now runs `syncFromDurable()` (guarded by a per-instance promise) before any read or write. Previously saved farmer transactions and assumptions in Vercel KV are hydrated before new writes are applied instead of being overwritten by repo seed data.
  - If Vercel KV is configured and the initial durable read fails, write requests fail closed with HTTP `503` (`DURABLE_SYNC_FAILED`) rather than silently falling back to seed data and wiping the durable store.
  - Added monotonic revision tracking (`durableRevision`) in `pushDurableSnapshot()` so an instance holding an older revision cannot overwrite a newer KV snapshot.
- **Prompt vs. Audit/Code Notes:**
  - Matches both the prompt and `AUDIT_REPORT.md` Finding `F-08` (`server/store.js:183-267`).

---

### P0-3: Storage slider freezes physical loss (`F-11`)
- **Commit:** `0c97a82`
- **Failing Test Output (Before):**
  ```text
  ✖ P0-3 (F-11): Storage duration slider scales physical loss monotonically (2.5% at 1m, 16.4% at 7m) and reduces 7m net proceeds by ~1.60 RUB/kg
    AssertionError [ERR_ASSERTION]: Profit.jsx must scale storage parameters by selected duration via storageAtHorizon / evaluateStorageAtHorizon
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P0-3 (F-11): Storage duration slider scales physical loss monotonically (2.5% at 1m, 16.4% at 7m) and reduces 7m net proceeds by ~1.60 RUB/kg (3.410977ms)
  ```
- **Files Changed:**
  - `shared/storageEconomics.js`
  - `src/components/Profit.jsx`
  - `test/phase0.test.js`
- **Farmer-Visible Behaviour Changes:**
  - Moving the storage duration slider (`months = 1..7`) in «Хранение vs Продажа» (`Profit.jsx`) now scales physical shrinkage, spoilage, and sprouting monotonically with duration via `evaluateStorageAtHorizon(storageBaseParams, currentParams.months)` (`2.5%` physical loss at 1 month up to `16.4%` at 7 months for default onion parameters).
  - At 7 months, net proceeds per kg stored is now accurately calculated as `13.02 RUB/kg` instead of the overstated `14.62 RUB/kg` (`-1.60 RUB/kg` correction).
  - When a farmer edits a loss percentage slider directly at horizon $m$, it is stored normalized to the 4-month reference baseline so changing duration later continues to scale monotonically.
- **Prompt vs. Audit/Code Notes:**
  - Matches both the prompt and `AUDIT_REPORT.md` Finding `F-11` (`src/components/Profit.jsx:109`, `shared/storageEconomics.js:116-127`).

---

### P0-4: Fabricated SHAP constants (`F-03`)
- **Commit:** `5adca67`
- **Failing Test Output (Before):**
  ```text
  ✖ P0-4 (F-03): No hardcoded SHAP padding constants or synthetic storage_tier remain; attribution is derived strictly from model output or is null
    AssertionError [ERR_ASSERTION]: buildCatBoostShapCards must not contain hardcoded SHAP padding constants or synthetic storage_tier factor
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P0-4 (F-03): No hardcoded SHAP padding constants or synthetic storage_tier remain; attribution is derived strictly from model output or is null (8.342503ms)
  ```
- **Files Changed:**
  - `shared/weeklyDecisionPlan.js`
  - `src/components/Forecast.jsx`
  - `test/phase0.test.js`
- **Farmer-Visible Behaviour Changes:**
  - Removed all hardcoded additive padding constants (`+ 0.04`, `+ 0.032`, `+ 0.02`, `+ 0.018`, `+ 0.014`), removed the synthetic `storage_tier` card that was never a feature of the monthly model, and removed the `Math.max(5, ...)` floor and `rawPcts[0] += diff` remainder manipulation in `buildCatBoostShapCards`.
  - Factor shares are now computed strictly as $\text{pct}_i = |\phi_i| / \sum_j |\phi_j| \times 100$ from real `catboostShap` values on horizons where the residual tree model is active (`selected === 'catboost'`).
  - When the selected model has no active trees (`totalAbs === 0`), `buildCatBoostShapCards` returns `hasAttribution: false` and the UI displays an explicit notice that tree-residual factor attribution is not used on those horizons.
- **Prompt vs. Audit/Code Notes:**
  - Matches both the prompt and `AUDIT_REPORT.md` Finding `F-03` (`shared/weeklyDecisionPlan.js:958-1088`).

---

### P0-5: Stop overriding the model selector (`F-01`, `F-02`)
- **Commit:** `c6cb2c8`
- **Failing Test Output (Before):**
  ```text
  ✖ P0-5 (F-01, F-02): Stop overriding the model selector across h=1..14, follow flipped validation.selected in stubbed forecast, and remove user-facing "CatBoost" labels (4.451789ms)
    AssertionError [ERR_ASSERTION]: shared/weeklyDecisionPlan.js must export resolveSelectedHorizonPoint
    + actual - expected
    + 'undefined'
    - 'function'
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P0-5 (F-01, F-02): Stop overriding the model selector across h=1..14, follow flipped validation.selected in stubbed forecast, and remove user-facing "CatBoost" labels (16.665004ms)
  ```
- **Files Changed:**
  - `shared/officialForecast.js`
  - `shared/weeklyDecisionPlan.js`
  - `shared/sources.js`
  - `src/components/Dashboard.jsx`
  - `src/components/Deficit.jsx`
  - `src/components/Forecast.jsx`
  - `src/components/MonthlySalesPlanTable.jsx`
  - `src/components/OfficialMarket.jsx`
  - `README.md`
  - `test/phase0.test.js`
- **Farmer-Visible Behaviour Changes:**
  - Removed the `lead <= 3 ? 1 : ...` override in `buildCatboostKnots` (`shared/weeklyDecisionPlan.js`) and `Forecast.jsx`. Every horizon $h = 1\dots 14$ now strictly uses the model chosen by `validation.selected` via `resolveSelectedHorizonPoint(r)` and `resolveSelectedHorizonMetrics(r)`.
  - Replaced all user-facing `"CatBoost"` / `"CatBoost 3.0"` labels across the UI with honest model names: **«Сезонная модель (Weibull)»** for `eq_carry` and **«Дерево решений (экспериментальная)»** for the custom JS oblivious-tree residual model.
- **Prompt vs. Audit/Code Notes:**
  - Matches both the prompt and `AUDIT_REPORT.md` Findings `F-01` and `F-02`. Internal JSON keys (`catboostPoint`, `catboostMae`) were preserved for schema compatibility while all user-facing strings were updated.

---

### P0-6: Honest horizon labelling (`F-01`, `F-02`)
- **Commit:** `9543eb0`
- **Failing Test Output (Before):**
  ```text
  ✖ P0-6 (F-01, F-02): Honest horizon labelling derived dynamically from validation fields (leads 2-3 last price, 4-12 beats seasonal-naive, 13-15 no better than seasonal) (1.375302ms)
    AssertionError [ERR_ASSERTION]: shared/officialForecast.js must export evaluateHorizonConfidence
    + actual - expected
    + 'undefined'
    - 'function'
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P0-6 (F-01, F-02): Honest horizon labelling derived dynamically from validation fields (leads 2-3 last price, 4-12 beats seasonal-naive, 13-15 no better than seasonal) (2.316165ms)
  ```
- **Files Changed:**
  - `shared/officialForecast.js`
  - `shared/weeklyDecisionPlan.js`
  - `src/components/Forecast.jsx`
  - `src/components/OfficialMarket.jsx`
  - `test/phase0.test.js`
- **Farmer-Visible Behaviour Changes:**
  - Added `evaluateHorizonConfidence(row, lastValue)` in `shared/officialForecast.js`, derived dynamically from each horizon's walk-forward validation metrics (`row.lead`, `row.validation.final.mae`, `row.validation.naiveFinal.mae`, `row.validation.finalAll`):
    - **Leads 2–3 (`h = 1..2`):** Marked `low_confidence` (`isLastPriceAnchor: true`), displaying `lastValue` (`18.12 ₽/кг`) as the primary reference (**«Ориентир: последняя цена Росстата»**) and showing the model prediction as secondary (**«Прогноз не превосходит последнюю известную цену (MAE модели 2.88–3.27 ₽/кг против 2.52–2.91 ₽/кг у наивной модели)»**).
    - **Leads 4–12 (`h = 3..11`):** Marked `validated` (`beatsNaive: true, beatsSeasonal: true`) with badge **«Подтверждено бэктестом (превосходит сезонно-наивную модель)»**.
    - **Leads 13–15 (`h = 12..14`):** Marked `seasonal_guide` (`beatsSeasonal: false`), displaying **«Ориентир по сезонности (модель не точнее сезонного среднего: MAE 3.22 ₽/кг против 2.65–2.79 ₽/кг у сезонно-наивной)»**.
- **Prompt vs. Audit/Code Notes:**
  - `data/official-forecast.json` already stores `r.lead` (`2..15`), `r.validation.final.mae`, `r.validation.naiveFinal.mae`, and `r.validation.finalAll` (including `seasonal`, `eq_carry`, `catboost`) for every horizon, and `test/official.test.js:59` asserts `assert.deepEqual(issueOfficialForecast(...), stored)` against `data/official-forecast.json`. Computing `evaluateHorizonConfidence(row, lastValue)` dynamically from those stored validation fields satisfies all dynamic-derivation requirements while keeping `data/official-forecast.json` untouched and `test/official.test.js` green.

---

### P0-7: Intervals: show real ones or none (`F-04`)
- **Commit:** `dc73f3f`
- **Failing Test Output (Before):**
  ```text
  ✖ P0-7 (F-04): Intervals with null bounds are never invented or plotted and display "Интервал недоступен: недостаточно данных для калибровки" (1.526155ms)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    + actual - expected
    + undefined
    - 'Интервал недоступен: недостаточно данных для калибровки'
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P0-7 (F-04): Intervals with null bounds are never invented or plotted and display "Интервал недоступен: недостаточно данных для калибровки" (3.439374ms)
  ```
- **Files Changed:**
  - `shared/weeklyDecisionPlan.js`
  - `src/components/OfficialMarket.jsx`
  - `src/components/Forecast.jsx`
  - `src/components/Dashboard.jsx`
  - `src/components/VolgogradOnionIntelPanel.jsx`
  - `test/phase0.test.js`
- **Farmer-Visible Behaviour Changes:**
  - Removed the invented 95% interval multiplier (`relBand95 = Math.min(0.65, relBand80 * 1.55)`) in `evaluateVolgogradOnionTargetForecast` (`shared/weeklyDecisionPlan.js`) and removed the fallback `0.14` / `2.6` 80%-band fabrication in `buildCatboostKnots` when `q80` is `null`.
  - Wherever `lo80`/`hi80` or `lo95`/`hi95` (`interval80`/`interval95`) are `null` (`calN = 8 < 19` for 95% split-conformal coverage), the UI now displays **«Интервал недоступен: недостаточно данных для калибровки»** (`INTERVAL_UNAVAILABLE_MESSAGE`) and `buildForecastChartBandDatasets` omits the band series instead of plotting `0`, `NaN`, or invented widths.
- **Prompt vs. Audit/Code Notes:**
  - Matches both the prompt and `AUDIT_REPORT.md` Finding `F-04`. Note that in `data/official-forecast.json`, `interval95` is `null` on all 14 horizons, while `evaluateVolgogradOnionTargetForecast` in `weeklyDecisionPlan.js` had been fabricating a 95% interval via `relBand80 * 1.55`; that fabrication is now eliminated.

---

### P0-8: Write endpoints require auth by default (`F-10`)
- **Commit:** `38d0b93`
- **Failing Test Output (Before):**
  ```text
  ✖ P0-8 (F-10): Write endpoints require auth by default (401 without token, 401 with wrong token, 200 with valid token, 200 without token only when AGRO_ALLOW_ANON_WRITES=true) (297.197443ms)
    AssertionError [ERR_ASSERTION]: POST /api/import must return 401 without token by default
    + actual - expected
    + 200
    - 401
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P0-8 (F-10): Write endpoints require auth by default (401 without token, 401 with wrong token, 200 with valid token, 200 without token only when AGRO_ALLOW_ANON_WRITES=true) (680.890366ms)
  ```
- **Files Changed:**
  - `server/access.js`
  - `test/api.test.js`
  - `test/official.test.js`
  - `test/reliability.test.js`
  - `test/phase0.test.js`
  - `.env.example`
  - `README.md`
- **Farmer-Visible Behaviour Changes:**
  - All write and privileged endpoints (`POST`/`DELETE /api/import`, `POST`/`DELETE /api/assumptions`, `POST /api/forecast`, `POST /api/advisor`) now require `Authorization: Bearer <AGRO_API_TOKEN>` by default, returning `401 Unauthorized` when missing or invalid.
  - Read-only `GET` endpoints (`GET /api/market`, `GET /api/macro`, `GET /api/signals`, `GET /api/assumptions`, `GET /api/forecast`, `GET /api/refresh`) remain publicly readable unless `AGRO_REQUIRE_AUTH=true` is set.
  - Unauthenticated local-development writes are allowed only when `AGRO_ALLOW_ANON_WRITES=true` is explicitly set, which emits a startup security warning (`[SECURITY WARNING] AGRO_ALLOW_ANON_WRITES=true...`).
- **Prompt vs. Audit/Code Notes:**
  - In `ROADMAP.md` (`P0.2`), auth was proposed when `VERCEL_ENV === 'production'`, whereas the prompt specified requiring `AGRO_API_TOKEN` on write endpoints by default unless `AGRO_ALLOW_ANON_WRITES=true` is explicitly set. We implemented the stricter prompt requirement (default-on across all environments unless `AGRO_ALLOW_ANON_WRITES=true`), which is a strict superset of `ROADMAP.md` `P0.2`.

---

### P0-9: Cron and refresh job (`F-07`, `F-09`, `F-15`)
- **Commit:** `8b25acf`
- **Failing Test Output (Before):**
  ```text
  ✖ P0-9 (F-07, F-09, F-15): Cron and refresh job registration, strict CRON_SECRET auth, idempotency, step failure 500, and clean git status in send_telegram_digest.mjs (2.767979ms)
    AssertionError [ERR_ASSERTION]: vite.config.js must register /api/refresh
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P0-9 (F-07, F-09, F-15): Cron and refresh job registration, strict CRON_SECRET auth, idempotency, step failure 500, and clean git status in send_telegram_digest.mjs (455.595984ms)
  ```
- **Files Changed:**
  - `vite.config.js`
  - `api/refresh.js`
  - `server/refreshJob.js`
  - `scripts/send_telegram_digest.mjs`
  - `.github/workflows/daily_briefing.yml`
  - `.github/workflows/update_official_data.yml`
  - `test/phase0.test.js`
- **Farmer-Visible Behaviour Changes:**
  - Registered `'/api/refresh': './api/refresh.js'` in `vite.config.js` so local dev matches production routing (`vercel.json`).
  - Hardened `isAuthorizedRefreshRequest(req)` in `api/refresh.js` so triggering a refresh requires `Authorization: Bearer $CRON_SECRET` by default even outside Vercel.
  - `runRefreshJob` in `server/refreshJob.js` now persists rebuilt official forecasts to SQLite/KV (`store.saveOfficialForecast`), computes deterministic content hashes (`summary.changed`, `summary.rowCounts`, `summary.hashes`, `durationMs`) so running twice with identical inputs is idempotent (`changed: false`), returns HTTP `500` identifying `failedStep` when a source fetch fails, and explicitly documents that Rosstat XLS download is an offline script/CI step.
  - Updated `scripts/send_telegram_digest.mjs` to write runtime state to `$DATA_DIR` instead of mutating tracked `data/spot-history.json` and `data/press-review.json`, removed direct `git commit && git push` to `main` from `.github/workflows/daily_briefing.yml`, and added `.github/workflows/update_official_data.yml` to run Rosstat updates on a monthly schedule via Pull Request.
- **Prompt vs. Audit/Code Notes:**
  - Combines findings `F-07`, `F-09`, and `F-15` from `AUDIT_REPORT.md`.

---

### P0-10: Verify data hashes at runtime (`F-15`)
- **Commit:** `bfaaecf`
- **Failing Test Output (Before):**
  ```text
  ✖ P0-10 (F-15): Verify data hashes at runtime against data/official-hashes.json and fail closed with DATA_HASH_MISMATCH on 1-byte tampered fixture (1.428139ms)
    AssertionError [ERR_ASSERTION]: shared/officialData.js must export verifyOfficialDataHashes
    + actual - expected
    + 'undefined'
    - 'function'
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P0-10 (F-15): Verify data hashes at runtime against data/official-hashes.json and fail closed with DATA_HASH_MISMATCH on 1-byte tampered fixture (48.121834ms)
  ```
- **Files Changed:**
  - `data/official-hashes.json`
  - `scripts/build_official_forecast.mjs`
  - `shared/officialData.js`
  - `src/components/Dashboard.jsx`
  - `src/components/Forecast.jsx`
  - `test/phase0.test.js`
- **Farmer-Visible Behaviour Changes:**
  - Created `data/official-hashes.json` (generated by `scripts/build_official_forecast.mjs`) storing SHA-256 digests of `data/official-history.json`, `data/official-drivers.json`, and all embedded source files.
  - Added `verifyOfficialDataHashes()` in `shared/officialData.js`. If any bundled official data file is corrupted or tampered with (even by 1 byte), `officialSnapshot()` fails closed with `error: 'DATA_HASH_MISMATCH'`, `forecast: null`, and the UI renders an explicit integrity error alert instead of serving a forecast from corrupted data.
- **Prompt vs. Audit/Code Notes:**
  - The prompt mentioned `data/macro-history.json` (which was referenced in `README.md:23` but does not exist in `data/`; the actual macro/weather file in the repo is `data/official-drivers.json` as documented in `AUDIT_REPORT.md` Section 1.5). We hashed `data/official-history.json` and `data/official-drivers.json` (plus their source hashes) and updated `README.md:23` to reference `data/official-drivers.json`.

---

### P0-11: Freshness stamps (`F-09`)
- **Commit:** `f5645f3`
- **Failing Test Output (Before):**
  ```text
  ✖ P0-11 (F-09): Freshness stamps and >90-day stale warning boundary test (89d, 90d, 91d) (1.272804ms)
    AssertionError [ERR_ASSERTION]: shared/officialData.js must export computeForecastFreshness
    + actual - expected
    + 'undefined'
    - 'function'
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P0-11 (F-09): Freshness stamps and >90-day stale warning boundary test (89d, 90d, 91d) (1.38436ms)
  ```
- **Files Changed:**
  - `shared/officialData.js`
  - `src/components/Dashboard.jsx`
  - `src/components/Forecast.jsx`
  - `src/components/OfficialMarket.jsx`
  - `test/phase0.test.js`
- **Farmer-Visible Behaviour Changes:**
  - Every forecast screen (`Dashboard.jsx`, `Forecast.jsx`, `OfficialMarket.jsx`) now displays a compact freshness stamp (`computeForecastFreshness`):
    `Данные Росстата по: 2026-09 · Модель: rosstat-catboost-3.0.0 · Бэктест: 2026-09 · Сформировано: 2026-10-30` along with the exact age in days since the end of `inputCutoff` (`2026-09-30`).
  - Whenever `today` is strictly more than 90 days (`ageDays > 90`) after `cutoffEndDate`, a yellow warning banner (`freshness.staleWarning`) is rendered warning the farmer that the forecast is based on Rosstat data older than 3 months (`> 90 дней`).
- **Prompt vs. Audit/Code Notes:**
  - Boundary-tested at `89` days (`2026-12-28`, `isStale: false`), `90` days (`2026-12-29`, `isStale: false`), and `91` days (`2026-12-30`, `isStale: true`).

---

## Out of Scope for Phase 0 — Deferred to Phase 1 / Phase 2 Candidates

In accordance with the Phase 0 scope boundaries, the following items were not modified in Phase 0 and remain scheduled for Phase 1 / Phase 2 (`docs/audit/ROADMAP.md`):

1. **Seasonal Local-Basis Curve in `shared/localBasis.js` (`F-05`, `G-01` — Phase 1 `P1.1`):**
   - Replacing the constant scalar multiplier (`factor = median(user / official)`) with a month-of-year seasonal basis curve $B(m)$ calibrated to Southern Federal District / Volgograd seasonal compression (`0.68x` in Sep–Oct vs `0.92x` in Feb–Apr).
2. **Real Calibrated 95% & Log-Relative Prediction Intervals (`F-04` — Phase 1 `P1.2`):**
   - Expanding the split-conformal calibration window from `calN = 8` to `calN >= 24` with log-relative residuals so valid 95% intervals (`calN >= 19`) and narrower 80% bands can be computed and calibrated.
3. **Offline Deterministic AI Adviser Question Routing (`F-14` — Phase 1 `P1.3`):**
   - Expanding `buildSnapshot()` in `shared/snapshot.js` and intent routing in `shared/autonomousAdvisor.js` so offline mode answers specific storage break-even, KZ import parity, and crop-rotation queries without an external LLM key.
4. **Regional Price Data Feeds, Multi-Farm Accounts, Lot-Level Alerts, and Bank PDF/XLSX Exports (Phase 1 `P1.4` & Phase 2 `P2.1`–`P2.2`):**
   - Ingesting oblast-level EMISS series (`31448`), HS `070310` import volumes, multi-tenant PostgreSQL/Turso storage, automated Telegram lot alerts, and bank-ready P&L/Cashflow exports.
