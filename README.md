# Agro Intelligence Platform

Onion market evidence, baseline forecasting, storage economics and next-crop planning. Requires Node.js 24 or later.

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

The first request initializes data/agro.sqlite (or $DATA_DIR/agro.sqlite). Existing observation, indicator and forecast JSON files are imported once and never rewritten. Old assumptions are not accepted as facts. SQLite transactions retain revision snapshots. Back up using SQLite backup facilities or while the app is stopped. Later updates use CSV import, not changes to the seed JSON files.

Old seed observations remain unverified and old-method forecasts are excluded. This intentionally produces no actual forecast until suitable evidence is supplied. Import source references, observation/publication dates, verification_status, verified_by and verified_at. Attestation means a user checked the source; it is not independent verification. An identical observation can gain an attestation without changing its historical price.

Use comparable grade, size, packaging, lot size and payment terms within each market. The current UI does not enforce a single product specification: do not pool unlike products. Separate transactions, bids and offers. Listings are not completed transactions.

## Implemented behavior

- Verified price monitoring, freshness and separate supply/demand indicators.
- Immutable weekly baseline forecasts with publication-aware rolling-origin evaluation and per-horizon performance.
- Saved forecast targets displayed without seasonal rescaling or invented confidence.
- Seasonal processes based on available evidence, not a fixed November field-selling phase.
- Manual assumptions separate from historical observations and forecast validation.
- Storage losses by duration, break-even prices and staged-sale calculations.
- Next-crop scenarios, resource constraints and annual cycle evidence. No fixed-year cycle is assumed.
- Evidence-based adviser fallback, plus optional external AI explanations.

## Remaining evidence requirements

The statistical model currently compares last-price and seasonal baselines. Driver effects and lags are not trained; rise/fall probabilities are not calibrated. Annual planning is a scenario budget, not a validated annual price forecast. Source links in the import screen are acquisition guidance, not live feeds; the CBR request is the exception.

Before operational use, collect consistent weekly transactions and publication dates; comparable stocks, dispatches, imports, quality and demand; and preferably 8–10+ annual seasons of acreage, yield, marketable production, prices and costs. Evaluate candidate driver models chronologically against the baselines, reserve untouched holdouts, and record prospective forecasts and outcomes before relying on them. See [methodology](docs/FORECASTING.md) and shared/sources.js.

## Hosting

Use a persistent Node host, backed-up storage and an authenticating reverse proxy for shared access. Set AGRO_REQUIRE_AUTH=true and a server-side AGRO_API_TOKEN. The trusted proxy must attach the Bearer token after authenticating users; never put it in frontend code. There is no browser login interface. Rate limits are per process.

Vercel ephemeral storage is unsupported. AGRO_PERSISTENT_VOLUME=true is allowed only after actually provisioning persistent storage; it does not create a volume. No production deployment is configured by this change.
