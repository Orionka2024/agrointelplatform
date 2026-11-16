# Reproducible Backtest & Quantitative Validation Results

**Generated:** 2026-11-15  
**Model Under Test:** `rosstat-catboost-3.0.0` (`shared/officialForecast.js`, `shared/catboostModel.js`, `shared/driverModel.js`, `shared/localBasis.js`)  
**Dataset:** `data/official-history.json` (109 monthly Rosstat RF producer price rows `2017-01..2026-09`, `2021-09` missing in source; 0 Volgograd Oblast rows) & `data/macro-history.json` (119 monthly rows `2017-01..2026-11`: CBR USD/RUB, KZT/RUB, Key Rate, Open-Meteo ERA5 Volgograd).

---

## 1. Exact Reproduction Commands

All numbers in this document are 100% reproducible from the repository root without external network calls:

```bash
# 1. Inspect raw data coverage, missing calendar months, and bundled forecast diagnostics
node docs/audit/scripts/inspect_data.mjs
# Output written to: docs/audit/logs/inspect_data.json

# 2. Run expanding-window walk-forward backtest (leads 2..15), 90% block-bootstrap CIs,
#    conformal coverage, direction hit rates, driver-shift & shuffled-target permutation tests
node docs/audit/scripts/backtest.mjs
# Outputs written to: docs/audit/logs/backtest.json and docs/audit/logs/backtest_summary.txt

# 3. Run localBasis.js seasonal drift & outlier sensitivity benchmark + storage & advisor checks
node docs/audit/scripts/verify_steps_3_4_5.mjs
# Output written to: docs/audit/logs/verify_steps_3_4_5.json
```

> **Note on Horizon Indexing (`h` vs `lead`):**  
> Because `data/official-forecast.json` is issued in November (`issueDate: "2026-11-13"`) while the latest available Rosstat observation is September (`dataCutoff: "2026-09"`), forecast step `h = 1..14` in `data/official-forecast.json` (`targetMonth = 2026-10..2027-11`) corresponds to index lead `lead = 1..14` from the last observed index (`2026-09`) in `shared/officialForecast.js:90-91`. In `docs/audit/scripts/backtest.mjs`, we evaluate leads `lead = 2..15` (`h = 1..14` ahead of the publication lag).

---

## 2. Walk-Forward Backtest: 12-Month Final Holdout (`2025-10..2026-09`)

This table reproduces the exact 12-origin final holdout block (`finalStart = totalPairs - 12`, `shared/officialForecast.js:116`) used by the application to select models and report accuracy badges in the UI.

| Lead (months) | $N$ | `naive` ($y_t$) MAE | `seasonal` ($y_{t-12}$) MAE | `season_ridge` MAE | `drivers` MAE | `eq_carry` (Weibull) MAE | `catboost` MAE | `catboost` MAPE (%) | `catboost` sMAPE (%) | $\Delta\text{MAE}$ (`eq_carry - seasonal`) [90% CI] | $\Delta\text{MAE}$ (`catboost - seasonal`) [90% CI] | $\Delta\text{MAE}$ (`catboost - naive`) [90% CI] | Winner (`eq_carry` vs `catboost`) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **2** | 12 | **2.52** | 6.52 | 3.28 | 3.08 | 2.88 | 3.03 | 14.6% | 13.3% | -3.64 `[-7.64, -3.64]` | -3.49 `[-7.16, -3.49]` | +0.51 `[-0.25, +1.87]` | `naive` (`eq_carry` > `catboost`) |
| **3** | 12 | **2.91** | 6.52 | 3.89 | 3.59 | 3.09 | 3.27 | 15.8% | 14.2% | -3.43 `[-6.98, -3.43]` | -3.25 `[-6.65, -3.25]` | +0.36 `[-1.01, +2.12]` | `naive` (`eq_carry` > `catboost`) |
| **4** | 12 | 5.03 | 6.52 | 5.09 | 4.64 | **3.40** | 3.54 | 17.3% | 15.6% | -3.12 `[-6.93, -3.12]` | -2.98 `[-6.66, -2.98]` | -1.48 `[-2.98, +1.59]` | **`eq_carry`** |
| **5** | 12 | 6.17 | 6.52 | 5.67 | 5.55 | **3.14** | 3.33 | 16.3% | 14.8% | -3.38 `[-7.19, -3.38]` | -3.20 `[-6.93, -3.20]` | -2.84 `[-5.63, +0.97]` | **`eq_carry`** |
| **6** | 12 | 6.60 | 6.52 | 5.72 | 6.05 | **2.81** | 3.04 | 14.9% | 13.7% | -3.71 `[-7.51, -3.71]` | -3.48 `[-7.33, -3.48]` | -3.56 `[-6.85, +0.49]` | **`eq_carry`** |
| **7** | 12 | 6.97 | 6.52 | 6.48 | 6.92 | **2.68** | 2.84 | 13.8% | 12.9% | -3.84 `[-7.75, -3.84]` | -3.68 `[-7.63, -3.68]` | -4.13 `[-7.59, +0.31]` | **`eq_carry`** |
| **8** | 12 | 7.35 | 6.52 | 7.63 | 8.91 | **2.67** | 2.92 | 14.2% | 13.1% | -3.85 `[-7.73, -3.85]` | -3.61 `[-7.43, -3.61]` | -4.43 `[-8.46, +0.54]` | **`eq_carry`** |
| **9** | 12 | 7.60 | 6.52 | 8.69 | 11.81 | 2.63 | **2.57** | 12.5% | 11.4% | -3.89 `[-7.58, -3.89]` | -3.95 `[-7.53, -3.95]` | -5.03 `[-9.72, -0.57]` | `catboost` (by 0.06) |
| **10** | 12 | 7.40 | 6.52 | 9.73 | 13.87 | 2.53 | **2.51** | 12.3% | 11.0% | -4.00 `[-7.59, -4.00]` | -4.01 `[-7.45, -4.01]` | -4.89 `[-9.42, -1.84]` | `catboost` (by 0.02) |
| **11** | 12 | 7.68 | 6.52 | 10.81 | 16.72 | 2.56 | **2.54** | 12.5% | 11.0% | -3.97 `[-7.57, -3.97]` | -3.99 `[-7.37, -3.94]` | -5.14 `[-8.53, -4.28]` | `catboost` (by 0.02) |
| **12** | 12 | 6.52 | 6.52 | 10.19 | 16.41 | **2.54** | 2.80 | 13.6% | 12.3% | -3.99 `[-7.69, -3.99]` | -3.72 `[-7.31, -3.72]` | -3.72 `[-7.31, -3.72]` | **`eq_carry`** |
| **13** | 12 | 6.87 | 3.22 | 10.47 | 15.39 | **2.65** | 2.82 | 13.4% | 13.0% | -0.58 `[-1.81, +1.21]` | -0.40 `[-2.04, +1.76]` | -4.05 `[-7.92, -2.49]` | **`eq_carry`** (ties `seasonal`) |
| **14** | 12 | 7.68 | 3.22 | 11.27 | 11.92 | **2.76** | 2.96 | 13.9% | 13.7% | -0.47 `[-1.65, +1.16]` | -0.26 `[-1.59, +1.63]` | -4.71 `[-8.83, -1.13]` | **`eq_carry`** (ties `seasonal`) |
| **15** | 12 | 8.26 | 3.22 | 11.35 | 9.68 | **2.79** | 2.93 | 13.8% | 13.6% | -0.43 `[-1.46, +1.16]` | -0.29 `[-1.41, +1.35]` | -5.33 `[-8.45, -0.86]` | **`eq_carry`** (ties `seasonal`) |

### Key Takeaways from the 12-Month Holdout
1. **`eq_carry` beats `catboost` on 11 out of 14 leads** (`leads 2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15`), and on the remaining 3 leads (`9, 10, 11`) the difference is `0.02–0.06 RUB/kg` (statistically zero).
2. **At short horizons (`leads 2–3`), simple `naive` ($y_t$) beats both `eq_carry` and `catboost`** (`2.52` and `2.91 RUB/kg` vs `3.03` and `3.27 RUB/kg`).
3. **Linear ridge models (`season_ridge` and `drivers`) blow up at leads $\ge 7$** (`MAE = 8.91 to 16.72 RUB/kg`) due to collinearity and overfitting on small $N$.

---

## 3. Walk-Forward Backtest: 24-Month Rolling Window (`2024-10..2026-09`)

Evaluating across two full marketing seasons (`2024/25` high-price spike and `2025/26` normalization) provides a much more representative out-of-sample test than a single 12-month slice:

| Lead (months) | $N$ | `naive` MAE | `seasonal` MAE | `season_ridge` MAE | `drivers` MAE | `eq_carry` MAE | `catboost` MAE | `catboost` MAPE (%) | `catboost` sMAPE (%) | $\Delta\text{MAE}$ (`eq_carry - seasonal`) [90% CI] | $\Delta\text{MAE}$ (`catboost - seasonal`) [90% CI] | Direction Hit Rate (`eq_carry` / `catboost`) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **2** | 24 | 4.66 | 7.79 | 4.48 | 4.47 | 4.37 | **4.33** | 17.7% | 17.3% | -3.42 `[-5.81, -1.47]` | -3.46 `[-5.85, -1.65]` | 54% / 63% |
| **3** | 24 | 5.68 | 7.79 | 5.41 | 5.37 | 4.94 | **4.88** | 19.2% | 19.5% | -2.85 `[-4.97, -1.06]` | -2.90 `[-4.93, -1.36]` | 54% / 58% |
| **4** | 24 | 6.77 | 7.79 | 5.84 | 6.04 | **5.27** | 5.28 | 20.3% | 21.1% | -2.52 `[-4.56, -0.97]` | -2.51 `[-4.47, -1.09]` | 63% / 67% |
| **5** | 24 | 7.78 | 7.79 | 6.57 | 7.14 | **5.38** | 5.40 | 20.4% | 21.5% | -2.41 `[-4.66, -0.68]` | -2.38 `[-4.43, -0.89]` | 67% / 71% |
| **6** | 24 | 8.53 | 7.79 | 6.91 | 7.69 | **5.38** | 5.42 | 20.1% | 21.6% | -2.41 `[-4.91, -0.59]` | -2.36 `[-4.76, -0.63]` | 75% / 75% |
| **7** | 24 | 8.76 | 7.79 | 8.11 | 9.12 | 5.30 | **5.28** | 19.3% | 20.9% | -2.49 `[-4.90, -0.57]` | -2.51 `[-4.73, -0.57]` | 83% / 88% |
| **8** | 24 | 8.56 | 7.79 | 8.82 | 9.80 | **5.20** | 5.26 | 19.3% | 20.7% | -2.59 `[-4.90, -0.54]` | -2.53 `[-4.81, -0.59]` | 88% / 88% |
| **9** | 24 | 8.26 | 7.79 | 9.09 | 10.43 | 5.08 | **4.79** | 17.2% | 18.6% | -2.71 `[-5.05, -0.75]` | -3.00 `[-4.98, -1.17]` | 79% / 75% |
| **10** | 24 | 7.90 | 7.79 | 9.41 | 11.43 | 5.04 | **4.71** | 17.0% | 18.2% | -2.75 `[-4.93, -0.77]` | -3.08 `[-5.12, -1.28]` | 67% / 79% |
| **11** | 24 | 8.42 | 7.79 | 9.59 | 12.62 | 5.04 | **4.70** | 17.2% | 18.1% | -2.75 `[-4.90, -0.92]` | -3.09 `[-5.20, -1.43]` | 79% / 83% |
| **12** | 22 | 7.94 | 7.94 | 8.84 | 12.72 | 5.33 | **4.98** | 18.1% | 19.2% | -2.61 `[-5.34, -0.89]` | -2.96 `[-5.31, -1.56]` | 83% / 88% |
| **13** | 20 | 8.48 | 4.50 | 8.72 | 12.20 | 4.72 | **4.25** | 16.5% | 16.9% | +0.23 `[-2.76, +1.44]` | -0.25 `[-2.92, +0.87]` | 92% / 92% |
| **14** | 18 | 8.08 | 4.24 | 8.52 | 9.82 | 3.93 | **3.60** | 14.9% | 14.9% | -0.31 `[-3.30, +0.42]` | -0.63 `[-3.43, +0.70]` | 92% / 92% |
| **15** | 16 | 7.53 | 4.59 | 9.46 | 8.37 | 3.41 | **3.37** | 14.9% | 14.6% | -1.18 `[-3.64, +0.60]` | -1.22 `[-3.52, +0.83]` | 83% / 83% |

*(Note: In the 36-month window `2023-10..2026-09` logged in `docs/audit/logs/backtest_summary.txt:37-52`, `eq_carry` beats `catboost` across all leads `2..8` with MAE `4.08–4.94 RUB/kg` vs `4.17–5.20 RUB/kg`.)*

---

## 4. Conformal Interval Calibration & Coverage Audit

In `shared/officialForecast.js:117-118`, the calibration slice is hardcoded to `calibrationStart = Math.max(0, calibrationEnd - 7)`, yielding `calN = 8` residuals.

| Lead (`h` in `official-forecast.json`) | Selected Model | Bundled `calN` | Bundled `coverage80` | Bundled `coverage95` | Bundled `lo95 / hi95` | Bundled 80% Full Width (`hi80 - lo80`, RUB/kg) | Rolling Out-of-Sample `coverage80` ($N=21..47$) | Rolling Out-of-Sample Mean 80% Width (RUB/kg) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1** (`2026-10`) | `eq_carry` | 8 | 1.00 | **`null`** | **`null / null`** | 21.37 | 83.0% ($N=47$) | 26.01 |
| **2** (`2026-11`) | `catboost` | 8 | 1.00 | **`null`** | **`null / null`** | 24.71 | 85.1% ($N=47$) | 26.54 |
| **3** (`2026-12`) | `catboost` | 8 | 1.00 | **`null`** | **`null / null`** | 25.00 | 91.1% ($N=45$) | 29.47 |
| **4** (`2027-01`) | `catboost` | 8 | 1.00 | **`null`** | **`null / null`** | 25.43 | 79.1% ($N=43$) | 29.91 |
| **5** (`2027-02`) | `eq_carry` | 8 | 1.00 | **`null`** | **`null / null`** | 27.67 | 78.0% ($N=41$) | 31.62 |
| **6** (`2027-03`) | `eq_carry` | 8 | 1.00 | **`null`** | **`null / null`** | 29.11 | 82.1% ($N=39$) | 32.51 |
| **7** (`2027-04`) | `eq_carry` | 8 | 1.00 | **`null`** | **`null / null`** | 26.54 | 81.1% ($N=37$) | 33.43 |
| **8** (`2027-05`) | `eq_carry` | 8 | 1.00 | **`null`** | **`null / null`** | 26.64 | 80.0% ($N=35$) | 34.89 |
| **9** (`2027-06`) | `eq_carry` | 8 | 1.00 | **`null`** | **`null / null`** | 28.18 | 81.8% ($N=33$) | 35.18 |
| **10** (`2027-07`) | `catboost` | 8 | 1.00 | **`null`** | **`null / null`** | 26.32 | 87.1% ($N=31$) | 36.59 |
| **11** (`2027-08`) | `eq_carry` | 8 | 1.00 | **`null`** | **`null / null`** | 27.95 | 79.3% ($N=29$) | 34.51 |
| **12** (`2027-09`) | `eq_carry` | 8 | 1.00 | **`null`** | **`null / null`** | 26.75 | 81.5% ($N=27$) | 33.06 |
| **13** (`2027-10`) | `eq_carry` | 8 | 1.00 | **`null`** | **`null / null`** | 25.73 | 84.0% ($N=25$) | 31.63 |
| **14** (`2027-11`) | `eq_carry` | 8 | 1.00 | **`null`** | **`null / null`** | 25.13 | 95.7% ($N=23$) | 30.24 |

**Why `coverage95` is `null` everywhere:** `conformalQuantile(errors, 0.95)` (`shared/models.js:97-103`) computes `idx = Math.ceil((8 + 1) * 0.95) - 1 = 8`, which triggers `if (idx >= sorted.length) return null` (`8 >= 8`). A split-conformal 95% quantile mathematically requires $n \ge 19$ calibration residuals so that $\lceil(19+1)\times 0.95\rceil = 19 \le n$.

---

## 5. Permutation Tests: Do External Drivers Add Real Skill?

### 5.1 Driver-Shift Permutation Test (`docs/audit/logs/backtest_summary.txt:72`)
We shifted all external macro and weather histories (`usdRub`, `kztRub`, `keyRate`, `weatherVolgograd`) backward in time by **12, 24, and 36 months** (destroying any true contemporaneous or lagged relationship with that year's onion harvest, exchange rate shock, or interest rate regime) and re-ran the full walk-forward evaluation (`24-month` window `2024-10..2026-09`):

| Driver Alignment | Lead 3 `catboost` MAE | Lead 3 `drivers` MAE | Lead 6 `catboost` MAE | Lead 6 `drivers` MAE | Lead 9 `catboost` MAE | Lead 9 `drivers` MAE |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **True Unshifted Drivers** | **4.88** | 5.37 | 5.42 | 7.69 | **4.79** | 10.43 |
| **Shifted by 12 Months (Wrong Year)** | 5.01 (+0.13) | 6.12 (+0.75) | **5.26 (-0.16)** | 7.72 (+0.03) | 5.19 (+0.40) | 10.67 (+0.24) |
| **Shifted by 24 Months (2 Years Off)** | 4.97 (+0.09) | 6.17 (+0.80) | 5.43 (+0.01) | 9.32 (+1.63) | 4.93 (+0.14) | 14.69 (+4.26) |
| **Shifted by 36 Months (3 Years Off)** | **4.83 (-0.05)** | 6.30 (+0.93) | 5.54 (+0.12) | 9.59 (+1.90) | 5.06 (+0.27) | 13.67 (+3.24) |

**Conclusion:** Feeding `catboost` macro/weather data from 1, 2, or 3 years in the past produces virtually identical MAE (and at Lead 3 with a 36-month shift or Lead 6 with a 12-month shift, *lower* MAE than true drivers!). This proves that `catboost` is heavily regularized back onto its Weibull baseline (`eq_carry`) and extracts **zero reliable signal** from the macro/weather features.

### 5.2 Shuffled-Season Target Permutation Test (`docs/audit/logs/backtest_summary.txt:74-85`)
Across 10 random permutations of the annual seasonal blocks (preserving month-of-year seasonality while destroying multi-year order), `eq_carry` achieved a mean Lead 6 MAE of **5.75 RUB/kg** vs `catboost` **5.78 RUB/kg** (`eq_carry` outperformed or tied `catboost` in **8 out of 10 random permutations**).

---

## 6. `localBasis.js` Seasonal Basis Drift & Outlier Sensitivity Benchmark

Executed via `node docs/audit/scripts/verify_steps_3_4_5.mjs` (`docs/audit/logs/verify_steps_3_4_5.json`):

| Test Case | User Inputs (`warehouse` EXW Volgograd) | Matched RF Official Reference (`data/official-history.json`) | Computed `cal.factor` (`localBasis.js`) | RF March Forecast (RUB/kg) | True Spring Volgograd EXW (`0.94 × RF`) | `applyLocalBasis` Predicted March EXW | Error (RUB/kg & %) |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **1. Realistic Autumn Calibration (`2` harvest months)** | `2026-09`: `12.56 ₽/кг`<br>`2026-10`: `13.05 ₽/кг` | `2026-09`: `18.12 ₽/кг`<br>`2026-09` (`approx`): `18.12 ₽/кг` | **`0.7066`** (`strength: "anchor"`) | `24.05 ₽/кг` | **`22.61 ₽/кг`** | **`16.99 ₽/кг`** | **`-5.62 ₽/кг` (`-24.8%`)** |
| **2. Single Distressed Autumn Lot (`1` entry)** | `2026-09`: `9.50 ₽/кг` | `2026-09`: `18.12 ₽/кг` | **`0.5243`** (`strength: "weak"`) | `24.05 ₽/кг` | **`22.61 ₽/кг`** | **`12.61 ₽/кг`** | **`-10.00 ₽/кг` (`-44.2%`)** |
