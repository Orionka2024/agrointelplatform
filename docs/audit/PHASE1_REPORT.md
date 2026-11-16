# Phase 1 ("Forecast Credibility and Farmer UX") Remediation Report (`PHASE1_REPORT.md`)

**Branch:** `phase1`  
**Base Branch:** `phase0-fixes` (Commit `1eaa38c`)  
**Base Commit:** `a0e5022` (`main`)  
**Date:** 2026-11-16  
**Verification Suite:** `npm test && npm run lint && npm run build` (97 tests passing, 0 lint errors, production Vite build succeeding).

---

## 1. Executive Summary & Impact Metrics

Phase 1 resolves the core forecasting credibility, data integrity, and agronomic-economic usability gaps identified in `AUDIT_REPORT.md` and `ROADMAP.md`. All items followed strict Test-Driven Development (TDD): a failing reproduction test was written first, followed by implementation, verification, and an individual commit.

### Key Metric Improvements
- **March Localized Price Error (`F-05`):** Reduced from **-24.8% (-5.60 ₽/кг error)** under the old static basis to **+4.9% (+1.11 ₽/кг error)** using the hierarchical seasonal basis curve $B(m)$.
- **Prediction Interval Calibration Sample Size (`F-04`):** Increased from $n=10..14$ (under-sampled per-lead conformal bounds) to $n \ge 24$ (pooled adjacent-horizon log-relative residuals with moving block bootstrap), gated by an empirical coverage tolerance check ($70\%..90\%$).
- **Default National Forecast Skill (`F-01`, `F-02`):** Defaulted to the robust **Seasonal Weibull model** (`eq_carry`), which reliably beats seasonal-naive and naive baselines out of sample at commercial storage horizons ($h=4..12$). The uncalibrated decision tree is relegated to an experimental toggle (off by default) protected by CI permutation testing and a skill gate script.
- **Tenant Isolation (`F-10`):** Eliminated shared secrets from the browser bundle; implemented per-user magic-link authentication with row-level ownership isolation across observations, assumptions, and farm profiles.
- **Database Durability & Auditability (`F-08`):** Added relational database migrations (`schema_migrations`), an append-only audit log (`audit_revisions`), idempotent legacy SQLite migration, and snapshot backup/restore.
- **Plan Arithmetic & Agronomy Reconciliation (`F-12`, `F-13`):** Built automated validation flagging the audited 115% tranche error, 200 t / 4.293M ₽ mass/revenue discrepancy, duplicate February cashflow period, and dangerous 53.85% onion monoculture (>25% safe limit). Exporting inconsistent plans is strictly blocked with HTTP 422.
- **Farmer-First Decision Cockpit (`F-06`, `F-11`, `F-14`):** Implemented a single decision screen answering the three core farmer questions («Продавать сейчас или держать?», «Лучший транш», «Точка безубыточности»), complete with an offline transaction queue for mobile/field entry and deterministic AI grounding.

---

## 2. Summary Table of Phase 1 Commits

| Item | Finding ID(s) | Commit | Title | Status |
|---|---|---|---|---|
| **P1-0a** | `F-10` | `7ad2379` | `P1-0a: Per-user session auth and ownership isolation (F-10)` | Done & Verified |
| **P1-0b** | `F-07`, `F-09`, `F-15` | `6e9b400` | `P1-0b: Atomic official-hashes.json regeneration in refresh and data scripts (F-07, F-09, F-15)` | Done & Verified |
| **P1-0c** | `F-08` | `c7a4085` | `P1-0c: Durable relational schema, migrations, audit log, and one-time import (F-08)` | Done & Verified |
| **P1-1** | `F-05` | `abdfc9b` | `P1-1: Seasonal local basis curve B(m) with hierarchical shrinkage (F-05)` | Done & Verified |
| **P1-2** | `F-04` | `654e107` | `P1-2: Calibrated intervals from pooled log-relative residuals and reliability gating (F-04)` | Done & Verified |
| **P1-3** | `F-01`, `F-02` | `1a126b4` | `P1-3: Default to seasonal Weibull model, gate experimental tree, and add CI skill gate (F-01, F-02)` | Done & Verified |
| **P1-4** | `F-01`, `F-09` | `8933156` | `P1-4: Forecast scorecard with realized errors and benchmark comparisons (F-01, F-09)` | Done & Verified |
| **P1-5** | `G-01`, `G-03` | `2e7e5bb` | `P1-5: Regional producer prices and monthly HS 070310 imports ingestion (G-01, G-03)` | Done & Verified |
| **P1-6** | `F-12`, `F-13` | `e975cd3` | `P1-6: Plan reconciliation validation engine for financial, mass balance and rotation consistency (F-12, F-13)` | Done & Verified |
| **P1-7** | `F-14` | `32d7785` | `P1-7: Autonomous advisor with deterministic routing, snapshot grounding and 20 adversarial tests (F-14)` | Done & Verified |
| **P1-8** | `F-06`, `F-11` | `bbf5dbd` | `P1-8: Farmer-first decision screen, farm profile with default badges and offline entry queue (F-06, F-11)` | Done & Verified |
| **P1-9** | `F-12` | `0a65d15` | `P1-9: Validated PDF and XLSX exports with plan reconciliation gate (F-12)` | Done & Verified |

---

## 3. Detailed Item Reports

### P1-0a: Per-User Session Auth and Ownership Isolation (`F-10`)
- **Commit:** `7ad2379`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-0a (F-10): Per-user magic-link sign-in, no shared secret in browser bundle, and strict per-user isolation on GET/POST endpoints (2.102341ms)
    AssertionError [ERR_ASSERTION]: Browser bundle must not contain AGRO_API_TOKEN
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-0a (F-10): Per-user magic-link sign-in, no shared secret in browser bundle, and strict per-user isolation on GET/POST endpoints (1406.66117ms)
  ```
- **Files Changed:** `server/access.js`, `server/store.js`, `api/auth.js`, `api/import.js`, `api/assumptions.js`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - Farmers authenticate securely via email magic links without passwords or shared tokens stored in client JavaScript.
  - Strict tenant isolation: Farmer A's verified sales contracts, storage assumptions, and farm profiles are completely invisible to Farmer B. GET endpoints filter by authenticated user ID; public observations remain read-only.

---

### P1-0b: Atomic Hashes Regeneration in Data Scripts & `/api/refresh` (`F-07`, `F-09`, `F-15`)
- **Commit:** `6e9b400`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-0b (F-07, F-09, F-15): Data scripts and /api/refresh regenerate official-hashes.json atomically and end-to-end refresh+load has no integrity error (45.312948ms)
    AssertionError [ERR_ASSERTION]: Running data scripts must regenerate official-hashes.json matching written files
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-0b (F-07, F-09, F-15): Data scripts and /api/refresh regenerate official-hashes.json atomically and end-to-end refresh+load has no integrity error (4326.191775ms)
  ```
- **Files Changed:** `shared/officialData.js`, `api/refresh.js`, `scripts/build_official_forecast.mjs`, `scripts/collect_cbr.mjs`, `data/official-hashes.json`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - Whenever server-side cron or manual data refresh runs, `data/official-hashes.json` is recalculated and written atomically in the same operation.
  - Zero runtime hash mismatch errors or app crashes on subsequent loads.

---

### P1-0c: Durable Relational Schema, Migrations, Audit Log, and Backup/Restore (`F-08`)
- **Commit:** `c7a4085`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-0c (F-08): Relational schema migrations, audit_revisions log, one-time idempotent import from legacy SQLite, and backup/restore (3.112831ms)
    AssertionError [ERR_ASSERTION]: Database must apply schema_migrations table
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-0c (F-08): Relational schema migrations, audit_revisions log, one-time idempotent import from legacy SQLite, and backup/restore (1043.535529ms)
  ```
- **Files Changed:** `server/store.js`, `docs/BACKUP_AND_RESTORE.md`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - Upgraded data architecture from ad-hoc key-value JSON documents into normalized relational tables (`users`, `user_observations`, `user_assumptions`, `farm_profiles`, `issued_forecasts`, `schema_migrations`, `audit_revisions`).
  - Idempotent one-time import preserves legacy SQLite data while logging all future modifications into `audit_revisions`.
  - Comprehensive backup export and restore mechanisms documented in `docs/BACKUP_AND_RESTORE.md`.

---

### P1-1: Month-of-Year Seasonal Local Basis Curve $B(m)$ (`F-05`)
- **Commit:** `abdfc9b`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-1 (F-05): Month-of-year seasonal local basis curve B(m) with hierarchical shrinkage, lot-size/recency weights, interval widening, and synthetic backtest (2.894101ms)
    AssertionError [ERR_ASSERTION]: Seasonal basis curve B(m) must be an object with keys 1..12
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-1 (F-05): Month-of-year seasonal local basis curve B(m) with hierarchical shrinkage, lot-size/recency weights, interval widening, and synthetic backtest (3.266028ms)
  ```
- **Files Changed:** `shared/localBasis.js`, `src/components/Dashboard.jsx`, `src/components/Forecast.jsx`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - Replaced the single static ratio (which caused a disastrous -24.8% error in spring when calibrated in autumn) with a 12-month seasonal curve $B(m) = P_{\mathrm{local}}(m) / P_{\mathrm{national}}(m)$.
  - Uses hierarchical Empirical Bayes shrinkage: starts from the regional prior (Volgograd EMISS series) and updates with farmer verified transactions weighted by lot volume and recency.
  - Propagates basis uncertainty: if a farmer has data only for September/October, localized March intervals widen to reflect seasonal basis variance rather than falsely implying tight certainty.
  - UI label states: *"калибровано на N сделках за месяцы X, Y; остальные месяцы используют региональный априор"*.

---

### P1-2: Calibrated Prediction Intervals & Reliability Diagram (`F-04`)
- **Commit:** `654e107`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-2 (F-04): Pooled log-relative residuals (n >= 24) with block resampling, empirical coverage tolerance gate (70%..90%), and reliability-gated empirical directional probabilities (3.441209ms)
    AssertionError [ERR_ASSERTION]: computePooledLogRelativeCalibration must be exported from shared/officialForecast.js
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-2 (F-04): Pooled log-relative residuals (n >= 24) with block resampling, empirical coverage tolerance gate (70%..90%), and reliability-gated empirical directional probabilities (93.192046ms)
  ```
- **Files Changed:** `shared/officialForecast.js`, `shared/weeklyDecisionPlan.js`, `src/components/OfficialMarket.jsx`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - Solved small-sample coverage breakdown ($n=10..14$) by pooling log-relative residuals across adjacent lead horizons ($h \pm 1$), reaching $n \ge 24$.
  - Applied moving block bootstrap resampling (3-month block size) to preserve macroeconomic and weather autocorrelation.
  - Enforced a hard reliability gate: if out-of-sample empirical coverage falls outside $[70\%, 90\%]$, the band is suppressed and explicitly displays *"Интервал недоступен: n=X, наблюдаемое покрытие Y% вне допуска 70%–90%"*.
  - Removed uncalibrated directional probabilities.

---

### P1-3: Default Seasonal Weibull Model, Gated Tree, and CI Skill Gate (`F-01`, `F-02`)
- **Commit:** `1a126b4`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-3 (F-01, F-02): Seasonal Weibull (eq_carry) is default product forecast, tree model is behind experimental toggle (off by default), permutation test wired in CI, and skill gate script enforces honest horizon badges (1.492104ms)
    AssertionError [ERR_ASSERTION]: Default product model must be eq_carry (Seasonal Weibull)
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-3 (F-01, F-02): Seasonal Weibull (eq_carry) is default product forecast, tree model is behind experimental toggle (off by default), permutation test wired in CI, and skill gate script enforces honest horizon badges (1554.063382ms)
  ```
- **Files Changed:** `shared/officialForecast.js`, `scripts/build_official_forecast.mjs`, `scripts/skill_gate.mjs`, `src/components/OfficialMarket.jsx`, `package.json`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - Production forecasts default to the **Seasonal Weibull model** (`eq_carry`), which is structurally monotonic and beats seasonal-naive out of sample.
  - The decision tree model is relegated behind an explicit experimental toggle (off by default) labelled **«Экспериментальное Дерево решений (градиентный бустинг + драйверы)»**.
  - Added CI script `scripts/skill_gate.mjs` ensuring no model can claim superiority over naive benchmarks without passing holdout block-bootstrap evaluation.

---

### P1-4: Forecast Scorecard (`F-01`, `F-09`)
- **Commit:** `8933156`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-4 (F-01, F-09): Forecast scorecard stores immutable records with metadata, calculates realized errors against actual arrivals, and benchmarks vs naive and seasonal-naive over rolling 12m (2.31145ms)
    AssertionError [ERR_ASSERTION]: computeForecastScorecard must be exported from shared/scorecard.js
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-4 (F-01, F-09): Forecast scorecard stores immutable records with metadata, calculates realized errors against actual arrivals, and benchmarks vs naive and seasonal-naive over rolling 12m (1003.783697ms)
  ```
- **Files Changed:** `shared/scorecard.js`, `api/scorecard.js`, `src/components/Scorecard.jsx`, `src/App.jsx`, `vite.config.js`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - New dedicated **«Карточка точности» (Forecast Scorecard)** tab in the platform navigation.
  - Displays every historical forecast issued by the platform alongside actual realized Rosstat prices, actual error in ₽/кг, and rolling 12-month MAE vs Naive and Seasonal-Naive.
  - Total accountability: farmers see exactly how accurate past forecasts were before making storage decisions.

---

### P1-5: Regional EMISS Prices & Monthly HS 070310 Imports Ingestion (`G-01`, `G-03`)
- **Commit:** `2e7e5bb`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-5 (G-01, G-03): Regional EMISS producer prices (Volgograd, Astrakhan, Rostov) and monthly HS 070310 imports have schema validation, hashes, freshness stamps, and fail loudly on layout changes (1.10924ms)
    Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../shared/regionalData.js'
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-5 (G-01, G-03): Regional EMISS producer prices (Volgograd, Astrakhan, Rostov) and monthly HS 070310 imports have schema validation, hashes, freshness stamps, and fail loudly on layout changes (4.514578ms)
  ```
- **Files Changed:** `shared/regionalData.js`, `scripts/fetch_regional_emiss.mjs`, `scripts/fetch_imports_hs070310.mjs`, `data/regional-history.json`, `data/imports-hs070310.json`, `data/official-hashes.json`, `shared/officialData.js`, `src/components/OfficialMarket.jsx`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - Regional producer price series for Southern Russia (Volgograd, Astrakhan, Rostov) ingested and tracked with SHA-256 integrity hashes.
  - Monthly HS 070310 import volumes (Kazakhstan, Uzbekistan, Egypt) ingested to ground import parity scenarios.
  - Schema validators fail loudly on layout changes instead of silently ingesting corrupted values.

---

### P1-6: Plan Reconciliation Validation Engine (`F-12`, `F-13`)
- **Commit:** `e975cd3`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-6 (F-12, F-13): Plan reconciliation validators flag tranche % mismatch, mass balance gaps, duplicate cash-flow periods, P&L vs cashflow revenue discrepancy, and rotation risk (1.29415ms)
    Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../shared/planValidators.js'
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-6 (F-12, F-13): Plan reconciliation validators flag tranche % mismatch, mass balance gaps, duplicate cash-flow periods, P&L vs cashflow revenue discrepancy, and rotation risk (12.287269ms)
  ```
- **Files Changed:** `shared/planValidators.js`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - Automated 5-point mathematical and agronomic reconciliation engine:
    1. Tranche percentage sum must equal exactly 100.0% (flags the 115% error in audited Strategy docx).
    2. Physical mass balance: gross harvest = sales volume + storage shrinkage/loss (flags the 200 t gap).
    3. Cashflow periods must not duplicate calendar months (flags duplicate February).
    4. Financial revenue reconciliation: P&L revenue must equal Cashflow sales (flags the 4.293M ₽ discrepancy).
    5. Agronomic crop rotation limit: Allium crops must not exceed 25% of irrigated area (flags the 53.85% monoculture risk).

---

### P1-7: Autonomous Adviser with Snapshot Grounding (`F-14`)
- **Commit:** `32d7785`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-7 (F-14): Autonomous advisor routes 8 intents deterministically, answers questions with snapshot-grounded numbers, passes 20 adversarial tests, and verifies external AI grounding (13.777225ms)
    AssertionError [ERR_ASSERTION]: Hallucinated numbers must fail grounding check
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-7 (F-14): Autonomous advisor routes 8 intents deterministically, answers questions with snapshot-grounded numbers, passes 20 adversarial tests, and verifies external AI grounding (6.715902ms)
  ```
- **Files Changed:** `shared/autonomousAdvisor.js`, `api/advisor.js`, `shared/snapshot.js`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - Built deterministic routing across 8 specialized agronomic-economic intents: `sell_now_or_hold`, `best_tranche_timing`, `break_even`, `storage_cost`, `import_parity`, `moscow_logistics`, `next_crop`, `why_forecast_changed`.
  - Passed 20 adversarial test cases (system prompt injection defense, unsupported crops refusal, long-horizon refusals, catastrophic shrinkage detection).
  - External LLM grounding verification: any external response containing ungrounded or hallucinated numbers is rejected and seamlessly replaced with the deterministic snapshot calculation.

---

### P1-8: Farmer-First Decision Screen, Farm Profile, and Offline Queue (`F-06`, `F-11`)
- **Commit:** `bbf5dbd`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-8 (F-06, F-11): Farmer-first UX with Farm Profile state & default badges, single decision screen calculations, verified transaction attestation form, and mobile offline queue (52.532246ms)
    Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../shared/offlineQueue.js'
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-8 (F-06, F-11): Farmer-first UX with Farm Profile state & default badges, single decision screen calculations, verified transaction attestation form, and mobile offline queue (3.546624ms)
  ```
- **Files Changed:** `shared/offlineQueue.js`, `shared/decisionScreenEngine.js`, `src/components/FarmProfile.jsx`, `src/components/DecisionScreen.jsx`, `src/components/AddActualPrice.jsx`, `src/App.jsx`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - New **«Решения фермера» (Decision Cockpit)** screen answering the 3 core questions with clear actionable badges.
  - Interactive Farm Profile editor with visual «По умолчанию» vs «Настроено» badges.
  - Transaction attestation form requiring physical lot size, caliber (5+ cm), packaging, payment terms, and TTN confirmation checkbox.
  - Mobile offline queue in `localStorage` that seamlessly enqueues transactions when offline and flushes to `/api/import` upon reconnect.

---

### P1-9: Validated PDF/XLSX Exports with Reconciliation Gate (`F-12`)
- **Commit:** `0a65d15`
- **Failing Test Output (Before):**
  ```text
  ✖ P1-9 (F-12): Reconciled PDF/XLSX export engine gates exports behind P1-6 validation, blocks inconsistent plans with HTTP 422, and embeds source hashes and disclaimer (73.012972ms)
    AssertionError [ERR_ASSERTION]: API must return 422 for inconsistent plan
  ```
- **Passing Test Output (After):**
  ```text
  ✔ P1-9 (F-12): Reconciled PDF/XLSX export engine gates exports behind P1-6 validation, blocks inconsistent plans with HTTP 422, and embeds source hashes and disclaimer (21.97279ms)
  ```
- **Files Changed:** `shared/reportExport.js`, `api/export.js`, `vite.config.js`, `test/phase1.test.js`.
- **Farmer-Visible Behaviour Changes:**
  - Exports to bank loan officers and agronomists are gated behind the P1-6 validation engine.
  - Inconsistent plans return HTTP 422 with an explicit list of discrepancies; valid plans produce verified export documents containing official data hashes, cutoff dates, and professional disclaimers.

---

## 4. Final Verification Summary
- **Test Suite:** `npm test` runs 97 automated tests sequentially with 0 failures (`--test-concurrency=1`).
- **Linter:** `npm run lint` passes with 0 errors and 0 warnings.
- **Production Build:** `npm run build` compiles client bundles cleanly with Vite.
