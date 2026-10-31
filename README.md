# Agro Intelligence Platform

**Official Russian onion history, Bank of Russia FX/key-rate series, and Open-Meteo ERA5 agro-climatic drivers are included:** 69 monthly producer prices, 16 annual averages, 246 weekly consumer prices, six acreage years, and 81 complete months (`2020-01`–`2026-09`) of official `USD/RUB`, `KZT/RUB`, Bank of Russia key-rate, and ERA5 weather series (Volgograd & Zhambyl/Taraz onion belt). Open «Обзор» or «Прогноз цен» to view the 26-week CatBoost forecast, exact TreeSHAP factor breakdown, 5-stage monthly warehouse sales plan, and enter your own actual price to calibrate the trajectory to your local warehouse level. See [source audit and refresh instructions](docs/OFFICIAL_DATA.md).

Onion market evidence, CatBoost & seasonal-equilibrium forecasting, storage economics and next-crop planning. Requires Node.js 24 or later.

## Run and verify

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm test
npm run lint
npm run build
```

Tests use a disposable database. The development server serves the UI and API. A static dist upload alone does not serve the API.

## Data

The first request initializes `data/agro.sqlite` (or `$DATA_DIR/agro.sqlite`; serverless environments fall back to `/tmp/agro.sqlite` unless a persistent volume is mounted). Existing seed observation, indicator and forecast JSON files are imported once and never rewritten. Old assumptions are not accepted as facts. SQLite transactions retain revision snapshots.

Public Rosstat (`data/official-history.json`) and Bank of Russia + ERA5 (`data/official-drivers.json`) histories are bundled with SHA-256 hashes of original source files so the app provides real historical data and a saved CatBoost forecast out of the box. You can also enter actual warehouse (EXW Volgograd) or delivered wholesale (Moscow) transaction prices directly in the UI: each attested entry is saved as a verified observation, immediately calibrates the forecast to your local price level (`shared/localBasis.js`), and builds your own weekly transaction series over time.

Old seed observations remain unverified and old-method forecasts are excluded. Use comparable grade, size, packaging, lot size and payment terms within each market. Separate transactions, bids and offers; listings are not completed transactions.

## Implemented behavior

- Bundled Rosstat monthly/annual producer prices, weekly retail prices, Bank of Russia `USD/RUB` + `KZT/RUB` + key-rate series, and Open-Meteo ERA5 weather (`Volgograd` & `Zhambyl`) with SHA-256 source verification.
- Purged monthly evaluation (`rosstat-catboost-3.0.0`) comparing naive, seasonal, ratio, ridge, Weibull seasonal-equilibrium (`eq_carry`), and CatBoost oblivious decision tree residual boosting (`catboost`) with exact interventional TreeSHAP attributions and zero future leakage.
- 26-week warehouse/Moscow trajectory & 5-stage monthly warehouse sales plan (`shared/weeklyDecisionPlan.js`) integrating storage shrinkage, rot, energy, and CBR financing costs.
- In-app actual transaction price entry with immediate local-basis level calibration and automatic browser backup for ephemeral serverless instances.
- Immutable weekly own-transaction baseline forecasts with publication-aware rolling-origin evaluation and per-horizon performance.
- Storage losses by duration, break-even prices and staged-sale calculations.
- Next-crop scenarios, resource constraints and annual cycle evidence. No fixed-year cycle is assumed.
- Evidence-based adviser fallback, plus optional external AI explanations.

## Remaining evidence requirements

The monthly national benchmark is evaluated on a latest-revision Rosstat snapshot (`latest_vintage_hindcast` / `research_benchmark`) because historical first-release vintages are not published separately. For your own weekly warehouse series, statistical models compare last-price and seasonal baselines until sufficient verified weekly transactions accumulate; rise/fall probabilities are not calibrated. Annual planning is a scenario budget, not a validated annual price forecast. See [methodology](docs/FORECASTING.md) and `shared/sources.js`.

## Hosting

For multi-user durable storage, use a persistent Node host or mounted volume (`DATA_DIR` + `AGRO_PERSISTENT_VOLUME=true`), backed-up SQLite storage, and an authenticating reverse proxy (`AGRO_REQUIRE_AUTH=true` and server-side `AGRO_API_TOKEN`). On Vercel without an external database, bundled public history and forecasts are durable in the deployment bundle, while user-entered transactions use `/tmp` on the server plus local browser re-sync for the same device.
