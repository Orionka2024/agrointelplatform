# Changelog

All notable changes to the **Agro Intelligence Platform** are documented in this file.

## [Phase 0 — "Stop the Harm" Remediation] — 2026-11-15 (`phase0-fixes`)

### Security & Data Integrity
- **P0-1 (`F-06`)**: Replaced the one-click "Калибровать от спота" transaction import with a session-only, unverified ask preview (`spotPreview`). Enforced server-side and shared validation (`isListingSource()`) so marketplace listings (`AgroRU`, `Агросервер`, `ФудСтар`, `Зерно Он-Лайн`) can never be stored with `verification_status: 'verified'` or `kind: 'transaction'`.
- **P0-2 (`F-08`)**: Fixed cold-start durable storage overwrite in `server/store.js`. Every endpoint now calls `ensureReady({ forWrite })` to hydrate from Vercel KV once per instance before reading or writing, rejects writes with HTTP `503` (`DURABLE_SYNC_FAILED`) if KV sync fails, and enforces monotonic revision numbers (`durableRevision`).
- **P0-8 (`F-10`)**: Required `Authorization: Bearer <AGRO_API_TOKEN>` by default on all write and privileged endpoints (`POST`/`DELETE /api/import`, `POST`/`DELETE /api/assumptions`, `POST /api/forecast`, `POST /api/advisor`). Added `AGRO_ALLOW_ANON_WRITES=true` opt-in for local development only (with a startup warning).
- **P0-9 (`F-07`, `F-09`, `F-15`)**: Registered `/api/refresh` in `vite.config.js`, enforced `Bearer $CRON_SECRET` authentication on refresh triggers, persisted rebuilt official forecasts to SQLite/KV, added idempotent state hashing and HTTP `500` step-failure reporting in `server/refreshJob.js`, prevented `scripts/send_telegram_digest.mjs` from mutating tracked repo files, removed CI auto-push to `main` from `.github/workflows/daily_briefing.yml`, and added `.github/workflows/update_official_data.yml` for monthly PR-based Rosstat updates.
- **P0-10 (`F-15`)**: Added `data/official-hashes.json` and runtime SHA-256 verification (`verifyOfficialDataHashes` in `shared/officialData.js`), failing closed with `DATA_HASH_MISMATCH` if bundled official data files are corrupted or modified.

### Forecasting, Attribution & Storage Economics
- **P0-3 (`F-11`)**: Fixed the storage duration slider in `src/components/Profit.jsx` to scale physical shrinkage, spoilage, and sprouting monotonically with storage months via `evaluateStorageAtHorizon()` (`2.5%` at 1 month to `16.4%` at 7 months, reducing 7-month net proceeds by `1.60 RUB/kg` to the accurate `13.02 RUB/kg`).
- **P0-4 (`F-03`)**: Removed hardcoded additive SHAP padding constants (`+0.04`, `+0.032`, `+0.02`, `+0.018`, `+0.014`), synthetic `storage_tier` cards, and `5%` floor/remainder manipulation from `buildCatBoostShapCards` in `shared/weeklyDecisionPlan.js`.
- **P0-5 (`F-01`, `F-02`)**: Removed the `lead <= 3` override in `buildCatboostKnots` and `Forecast.jsx` so all horizons $h = 1\dots 14$ strictly follow `validation.selected`. Replaced user-facing `"CatBoost"` labels with honest model names («Сезонная модель (Weibull)» and «Дерево решений (экспериментальная)»).
- **P0-6 (`F-01`, `F-02`)**: Added dynamic horizon confidence evaluation (`evaluateHorizonConfidence` in `shared/officialForecast.js`), labelling leads 2–3 as `low_confidence` (anchored to last known Rosstat price), leads 4–12 as `validated` (beats seasonal-naive), and leads 13–15 as `seasonal_guide` (no better than seasonal average).
- **P0-7 (`F-04`)**: Removed invented 95% intervals (`relBand80 * 1.55`) and fallback 80% bands when calibration quantiles are `null`. Displays «Интервал недоступен: недостаточно данных для калибровки» and omits chart band series whenever interval bounds are `null`.
- **P0-11 (`F-09`)**: Added `computeForecastFreshness()` and rendered compact freshness stamps (`inputCutoff`, `modelVersion`, `lastBacktestDate`, `issueDate`) and a conditional `> 90`-day yellow warning banner across `Dashboard.jsx`, `Forecast.jsx`, and `OfficialMarket.jsx`.
