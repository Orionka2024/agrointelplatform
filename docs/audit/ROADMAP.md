# Remediation & Product Evolution Roadmap (`ROADMAP.md`)

**Audit Date:** 2026-11-15  
**Guiding Principle:** Stop silent data corruption and misleading financial/forecast numbers first (Phase 0), establish statistical and regional forecasting credibility with a clean farmer UX second (Phase 1), and expand into a multi-farm commercial decision platform third (Phase 2).

Every item below maps to specific audit findings (`F-01`..`F-16`) and data gaps (`G-01`..`G-07`) and includes **objective, automated acceptance criteria**.

---

## Phase 0 (Weeks 1–2): Stop-the-Bleeding Fixes
*Objective: Eliminate data loss on serverless cold starts, secure write endpoints, fix broken storage/cashflow math, remove fabricated SHAP/transaction spoofing, and ensure honest model labelling.*

### P0.1 — Fix Serverless Durable State Sync & Persist Rebuilt Official Forecasts (`F-07`, `F-08`, `F-09`)
- **Scope:**
  1. In `server/store.js` and `api/market.js`, `api/import.js`, `api/assumptions.js`, `api/forecast.js`, `api/advisor.js`, ensure `await store.syncFromDurable()` runs once per cold start *before* `seedIfEmpty()` or any `read()`/`write()` call so a cold serverless instance never overwrites Vercel KV (`agro:durable:state:v1`) with blank seed data.
  2. In `server/refreshJob.js:556-569`, persist `newOfficialFc` into SQLite/KV (`store.saveOfficialForecast(newOfficialFc)`) and serve the persisted official forecast in `api/market.js` and `api/forecast.js`.
  3. Mount `'/api/refresh': './api/refresh.js'` in `vite.config.js:11-19` (`apiDevServerPlugin`).
- **Testable Acceptance Criteria:**
  - [ ] Automated test simulates a cold start (`resetStoreInstanceForTests()`), performs `POST /api/import` with 1 new observation on a second instance with mocked KV, and verifies that prior observations in KV are preserved (`total count = seed + prior + 1`).
  - [ ] Automated test in `server/refresh.test.js` advances `officialHistory` by 1 month, runs `runRefreshJob()`, and asserts that `GET /api/market` returns the newly issued `officialForecast.dataCutoff`.
  - [ ] `curl -i http://localhost:5173/api/refresh` under `npm run dev` returns HTTP `401`/`200` JSON from `api/refresh.js` instead of SPA HTML.

### P0.2 — Harden API Authentication, Frontend Auth Headers & Rate Limiting (`F-10`)
- **Scope:**
  1. Require authentication (`AGRO_API_TOKEN` or session cookie) by default on all mutating endpoints (`POST`/`DELETE /api/import`, `POST /api/assumptions`, `POST /api/forecast`) and costly endpoints (`POST /api/advisor`) whenever `VERCEL_ENV === 'production'`.
  2. Add an API key / session login modal in the React UI (`src/context/MarketContext.jsx`, `src/components/AIAdvisor.jsx`) that attaches `Authorization: Bearer <token>` on protected requests.
  3. Enable rate limiting on `/api/import` and `/api/assumptions` (`costly: true` or dedicated write limit).
- **Testable Acceptance Criteria:**
  - [ ] Unauthenticated `POST /api/import`, `DELETE /api/import`, `POST /api/assumptions`, and `POST /api/advisor` return `401 Unauthorized` when `VERCEL_ENV=production` or `AGRO_REQUIRE_AUTH=true`.
  - [ ] Authenticated requests from `MarketContext` with valid token succeed (`200 OK`).
  - [ ] Sending `> 20` write requests per minute to `/api/import` or `/api/assumptions` returns `429 Too Many Requests`.

### P0.3 — Remove 1-Click Spot-to-Verified-Transaction Spoofing (`F-06`)
- **Scope:**
  1. Remove or refactor `handleApplySpotConsensus` in `src/components/Dashboard.jsx:117-130, 567` and `src/components/Forecast.jsx:407` (`"⚡ Калибровать от спота (15.0 ₽)"`).
  2. Never pass unverified marketplace offers (`signals.analytics.impliedDealSpotExVat`) into `importCsv()` with `verification_status=verified` and `kind=transaction`. If the user wants to preview a spot anchor, store it as an explicit scenario parameter (`assumptions.spotAnchorOverrideRubKg`) clearly labelled `Условная калибровка по офертам (не сделка)`.
- **Testable Acceptance Criteria:**
  - [ ] Clicking the spot calibration control in `Dashboard` or `Forecast` adds **0 rows** with `kind === 'transaction'` or `verification_status === 'verified'` to `observations`.
  - [ ] Server-side validation in `api/import.js` rejects any row claiming `verification_status === 'verified'` unless accompanied by a non-empty `counterparty_doc_ref` or explicit user confirmation checkbox in `AddActualPrice.jsx`.

### P0.4 — Fix Storage Slider Loss Scaling Bug & Reconcile Strategy Arithmetic (`F-11`, `F-12`, `F-13`)
- **Scope:**
  1. In `src/components/Profit.jsx:109`, pass `storageAtHorizon({ ...baseStorageParams, ...currentParams, months: baseStorageParams.months }, currentParams.months)` to `evaluateStorage()` when the user adjusts `months`, or display a toggle between `"Потери за весь срок"` vs `"Масштабировать потери по месяцам"`.
  2. Fix overlapping Russian stage titles in `shared/weeklyDecisionPlan.js:876-892` (e.g., Stage 3: `"3. Середина января – середина февраля"`, Stage 4: `"4. Конец февраля – март"`).
  3. Add an automated agronomic rotation check in `shared/planning.js` that emits a high-severity phytopathological warning whenever Allium (`onion`) share exceeds **25%–30%** of total farm area (`return interval < 3.3 years`).
  4. Update `Volgograd_78ha_Strategy.docx` (or add an automated reconciliation test suite `shared/strategyReconciliation.test.js`) so that:
     - Gross harvest (`1,760 t` onion, `420 t` beet, `360 t` carrot) minus explicit storage shrinkage/rot (`200 t` onion = `11.36%`, `40 t` beet, `40 t` carrot) equals cashflow sales (`1,560 t` onion, `380 t` beet, `320 t` carrot);
     - Storage tranches sum to `100.0%` of gross harvest (`15%` field + `85%` warehouse broken down as `17% + 25.5% + 31.3% + 11.2% = 100%`);
     - Table 4 Cashflow spans exactly 12 calendar months without double-counting February.
- **Testable Acceptance Criteria:**
  - [ ] Unit test verifies that calling `Profit.jsx` storage evaluation at `months = 1` vs `months = 7` scales total physical loss from `2.5%` to `16.4%` (`netProceeds = 13.02 RUB/kg` at 7 months for default onion params).
  - [ ] Unit test verifies `evaluateFarmPlan` flags `rotationWarning: true` when `onion ha / total ha > 0.30` (such as `42 ha / 78 ha = 53.8%`).
  - [ ] All stage share percentages in `weeklyDecisionPlan.js` sum to `100%` and have non-overlapping calendar month labels.

### P0.5 — Honest Model Selection & Removal of Fabricated SHAP Constants (`F-01`, `F-02`, `F-03`)
- **Scope:**
  1. In `shared/weeklyDecisionPlan.js:512-517` (`buildCatboostKnots`) and `src/components/Forecast.jsx:251, 1057`, respect `r.validation.selected` (`r.point`) instead of forcing `wCb = 1` at `lead <= 3`.
  2. In `shared/weeklyDecisionPlan.js:958-1088` (`buildCatBoostShapCards`), remove all hardcoded additive weights (`+0.04`, `+0.032`, `+0.02`, `+0.018`, `+0.014`), remove the synthetic `storage_tier` card from model SHAP, and remove the `5%` floor + `rawPcts[0]` remainder dump.
  3. Rename UI badges from `"CatBoost 3.0 + Exact TreeSHAP"` to honest descriptions: `"Сезонно-равновесная модель Вейбулла (eq_carry) + деревья остатков"` and report the **24-month rolling MAE (`4.3–5.4 ₽/кг`)** alongside the 12-month holdout MAE.
- **Testable Acceptance Criteria:**
  - [ ] When all tree weights in `catboostModel` are `0` (`bestCount === 0`), `buildCatBoostShapCards` returns `0.0 ₽/кг` driver adjustments rather than synthetic `5%–35%` bars.
  - [ ] For every horizon `h = 1..14`, the monthly anchor used by `buildWeeklyDecisionPlan` matches `officialForecast.horizons[h-1].point` within `< 0.01 RUB/kg`.

---

## Phase 1 (Months 1–2): Forecast Credibility & Farmer UX

### P1.1 — Seasonal Local-Basis Curve $B(m)$ for Volgograd / Southern Russia (`F-05`, `G-01`)
- **Scope:**
  1. Ingest monthly producer prices for **Southern Federal District (ЮФО), Astrakhan, Rostov, and Volgograd** from EMISS (`fedstat.ru/indicator/31448`) into `data/official-history.json`.
  2. Replace the static scalar ratio in `shared/localBasis.js` with a **month-of-year seasonal basis curve** $B(m) = \text{median}_y(P_{\text{South}}(y, m) / P_{\text{RF}}(y, m))$ combined with exponentially decayed local transaction residuals (requiring $n \ge 3$ verified observations and Winsorized bounds `[0.65, 1.15]`).
- **Testable Acceptance Criteria:**
  - [ ] On the synthetic/historical Volgograd seasonal test (`verify_steps_3_4_5.mjs`), calibrating in October (`12.56–13.05 RUB/kg`) predicts March Volgograd EXW within **$\pm 1.50\text{ RUB/kg}$ (`< 7%` error)** of true spring parity (`22.61 RUB/kg`), down from `-5.62 RUB/kg (-24.8%)`.
  - [ ] A single distressed entry (`n = 1` at `9.50 RUB/kg`) cannot shift the 6-month forecast by more than `10%`.

### P1.2 — Validated Log-Relative Conformal Intervals (`calN >= 24`) (`F-04`)
- **Scope:**
  1. Increase the split-conformal calibration window in `shared/officialForecast.js:117-118` from `calN = 8` to `calN = 24` (or full out-of-sample walk-forward residuals `n >= 24`) so that `Math.ceil((n + 1) * 0.95) <= n` holds on every horizon.
  2. Compute multiplicative/log-relative conformal quantiles (`|log(actual) - log(pred)|`) rather than raw additive extremes from the 2023/24 price spike, and remove the uncalibrated `relBand80 * 1.55` multiplier in `weeklyDecisionPlan.js:625`.
- **Testable Acceptance Criteria:**
  - [ ] `data/official-forecast.json` has non-null `lo95`, `hi95`, and `coverage95` across all horizons `h = 1..14`.
  - [ ] Out-of-sample rolling backtest (`backtest.mjs`) achieves empirical 80% coverage between **75% and 88%** with mean 80% interval width `< 14 RUB/kg` at leads `2..6` (down from `26–33 RUB/kg`).

### P1.3 — Complete AI Adviser Context & Deterministic Offline Routing (`F-14`)
- **Scope:**
  1. Expand `buildSnapshot(model)` in `shared/snapshot.js` to include `officialForecast` (`horizons`, `dataCutoff`, `selectedModel`), `marketSignals` (`kzImportParity`, `spotConsensus`, `qualityIndex`), and `weeklyDecisionPlan` (`stages`, `recommendation`, `storageTier`).
  2. Upgrade `generateAutonomousAnalysis(query, snapshot)` in `shared/autonomousAdvisor.js` to classify user intent (current price/sell now, storage duration/credit rate, Kazakhstan import parity, crop rotation, or out-of-scope crop/year) and compute deterministic answers using `evaluateStorage()` and `importParity()`.
- **Testable Acceptance Criteria:**
  - [ ] Running the 10-question benchmark in `verify_steps_3_4_5.mjs` in autonomous mode produces distinct, question-specific numerical answers for **Q1, Q2, Q3, Q5, Q6** while continuing to pass **Q4, Q7, Q8, Q9, Q10** (10/10 Pass).

### P1.4 — Streamlined 3-Screen Farmer UX & Live Forecast Scorecard (`Step 6`)
- **Scope:**
  1. Consolidate the 8 navigation tabs in `src/components/Topbar.jsx` into **3 task-oriented workspaces**:
     - **1. Продажи и Рынок (Sales & Market Today):** Verified EXW vs Indicative Offers, KZ Import Parity, and 6-Week Action Plan.
     - **2. Хранение и Транши (Storage & Monthly Tranches):** Unified Storage Calculator + Monthly Tranche Schedule + Cost Bridge to Moscow.
     - **3. План Сезона и База (Crop Rotation, P&L & Data Archive):** Multi-crop rotation with phytopathological checks, live Forecast Scorecard (past issued forecasts vs realized prices), and Data Import.
  2. Replace all ML jargon (`Exact TreeSHAP`, `Split-Conformal`, `Huber`, `Holdout MAE`) with plain Russian agronomic-economic language, and split the Vite bundle via `React.lazy()` (`< 350 kB` initial JS).
- **Testable Acceptance Criteria:**
  - [ ] `npm run build` produces an entry JS chunk `< 350 kB` minified with 0 chunk-size warnings.
  - [ ] Forecast Scorecard table displays every historical forecast issue stored in `forecasts` alongside realized outcomes and actual error in `₽/кг`.

---

## Phase 2 (Quarter 1): Professional Commercial Features

### P2.1 — Automated Import Volume, Export Ban & Input Cost Feeds (`G-03`, `G-04`, `G-06`, `G-07`)
- **Scope:**
  1. Add scheduled collectors for **HS `070310` monthly imports** (UN Comtrade / BNS RK / EEC), **Rosselkhoznadzor / MCX RK export restriction alerts**, **district-level ERA5 curing weather** (Gorodishche, Sredneakhtubinsk, Bykovo), and **EMISS Volgograd diesel/electricity/fertilizer indices**.
- **Testable Acceptance Criteria:**
  - [ ] `source_status` table tracks freshness, lag, and SHA-256 provenance for all 4 new feeds, and `kzExportRestriction` automatically updates scenario probabilities/bounds when an official restriction is active.

### P2.2 — Multi-Farm Accounts, Lot-Level Warehouse Inventory & Actionable Telegram Alerts
- **Scope:**
  1. Migrate from single-tenant SQLite `/tmp` snapshot to multi-tenant PostgreSQL / Turso (`farms`, `storage_lots`, `sales_contracts`, `users`).
  2. Allow a farmer to log specific warehouse cells/lots (e.g., *Cell #1: 400 t Manas, harvested Sep 18, curing rain 12 mm; Cell #2: 350 t Halcedon, harvested Oct 2*) and receive automated Telegram alerts when:
     - Spot buyer bid exceeds the lot's dynamic storage break-even (`breakEvenFuturePrice`),
     - Kazakhstan landed parity drops below Volgograd EXW + `1.5 ₽/кг`, or
     - Sub-zero transport frost windows (`<-10°C`) raise reefer freight costs on the Volgograd–Moscow route.
  3. Add 1-click **PDF / XLSX Bank & Agronomist Export** (reconciled P&L, 12-month Cashflow, and Crop Rotation table ready for Rosselkhozbank / Sberbank seasonal loan underwriting).
- **Testable Acceptance Criteria:**
  - [ ] Multi-tenant isolation test verifies Farm A cannot read or mutate Farm B's lots, transactions, or assumptions.
  - [ ] Exported XLSX/PDF passes automated arithmetic reconciliation (`Gross Harvest - Storage Losses == Total Cashflow Sales Tonnage`; `Sum of Tranche Shares == 100.0%`).
