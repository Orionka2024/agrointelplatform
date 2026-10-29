# Forecast methodology

The target is weekly onion transaction price in RUB/kg excluding VAT. EXW Volgograd and delivered wholesale Moscow are separate series. The cost bridge is a calculation, not an independent observed price. Product specifications must be comparable; the UI does not yet enforce a single specification profile.

Only user-attested source records are eligible for real series. Observation dates determine reference weeks; publication or retrieval dates determine historical availability. Missing publication dates use retrieval conservatively. Manual prices do not modify history.

Rolling-origin backtests rebuild the available series at each origin. Calibration and tuning use matured target observations. Model selection uses the tuning segment; the final segment reports performance without reselecting a winner. MAE, sample count and empirical intervals are per horizon. Historical validation does not guarantee future accuracy or interval coverage under a regime change.

Current models are last-price and seasonal baselines. No learned driver model or calibrated direction classifier is included. Saved forecasts are displayed without calendar scaling. Old versions are retained but excluded from current outputs.

Harvest progress, direct field sales, temporary storage, quality losses, long-term releases, imports and new-crop arrivals are distinct processes. A month or stock level alone does not prove active field selling or forced liquidation. Missing evidence means unknown pressure. Scenario coefficients are assumptions.

Annual records retain region, crop and publication metadata; regions are not pooled. Real-margin, subsequent acreage and subsequent real-price changes describe possible feedback. Eight years is not proof of periodicity. Planning calculates farm profit, break-even, resource feasibility and market balance from explicit inputs. Future prices entered by users are assumptions.

Next research: establish consistent target specifications and revision-aware panels; add stock-to-use, import parity, weather, harvest and demand features with known availability dates. Select lags and models chronologically and evaluate on untouched later periods. Calibrate rise/fall probabilities against a declared economically meaningful threshold. Test annual predictions by leaving future years out. Report failures as well as successes and preserve prospective forecasts with actual outcomes.
