# Two separate forecast targets + local level calibration

1. **National monthly producer benchmark (`rosstat-monthly-2.0.0`)**: Built on bundled official Rosstat monthly onion producer prices (`data/official-history.json`) and official Bank of Russia monthly `USD/RUB` and key-rate series (`data/official-drivers.json`). Evaluates five candidates per horizon (`naive`, `seasonal`, `ratio`, `season_ridge`, and `drivers` combining harmonic target month-of-year, 3-month log `USD/RUB` change, key-rate level, and 3-month key-rate change) under lead-purged tuning, calibration, and untouched 12-month holdout splits. See [Official data methodology](OFFICIAL_DATA.md).
2. **Local level calibration (`shared/localBasis.js`)**: When a user enters one or more verified own transactions via «Добавить фактическую цену» (or CSV), monthly medians of user ex-VAT prices are compared against the corresponding Rosstat month (or the latest published month within 2 months, explicitly flagged `approx`) to compute a transparent median log-ratio scale factor applied to the monthly benchmark and its 80% band.
3. **Own weekly transaction series (`shared/forecast.js`)**: Described below; remains separate from national aggregates and activates as the user accumulates verified weekly transactions.

# Weekly own-transaction forecast methodology

The target is weekly onion transaction price in RUB/kg excluding VAT. EXW Volgograd and delivered wholesale Moscow are separate series. The cost bridge is a calculation, not an independent observed price. Product specifications must be comparable; the UI does not yet enforce a single specification profile.

Only user-attested source records (entered via the in-app actual price form or CSV import) are eligible for real series. Observation dates determine reference weeks; publication or retrieval dates determine historical availability. Missing publication dates use retrieval conservatively. Manual assumptions do not modify history.

Rolling-origin backtests rebuild the available series at each origin. Calibration and tuning use matured target observations. Model selection uses the tuning segment; the final segment reports performance without reselecting a winner. MAE, sample count and empirical intervals are per horizon. Historical validation does not guarantee future accuracy or interval coverage under a regime change.

Weekly own-transaction models are last-price and seasonal baselines; saved forecasts are displayed without calendar scaling. Old versions are retained but excluded from current outputs.

Harvest progress, direct field sales, temporary storage, quality losses, long-term releases, imports and new-crop arrivals are distinct processes. A month or stock level alone does not prove active field selling or forced liquidation. Missing evidence means unknown pressure. Scenario coefficients are assumptions.

Annual records retain region, crop and publication metadata; regions are not pooled. Real-margin, subsequent acreage and subsequent real-price changes describe possible feedback. Eight years is not proof of periodicity. Planning calculates farm profit, break-even, resource feasibility and market balance from explicit inputs. Future prices entered by users are assumptions.
