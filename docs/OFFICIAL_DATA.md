# Russian onion historical data & macro drivers: acquired 29 October 2026

The app ships actual, source-traceable public Rosstat onion observations and Bank of Russia macroeconomic series. No user CSV is required to view these data or the saved monthly benchmark forecast. Entering your own actual transaction price in the UI calibrates the national benchmark to your local warehouse or wholesale level.

## Coverage

| Series | Coverage | Count | Definition |
| --- | --- | ---: | --- |
| Producer monthly | Jan 2021–Sep 2026 | 69 | National agricultural organisations; end-of-period RUB/tonne, normalized to RUB/kg; VAT, transport, forwarding, loading and unloading excluded |
| Producer annual | 2010–2025 | 16 | National annual average, same population and basis; not December price |
| Consumer weekly | Jan 2022–26 Oct 2026 | 246 | Published national consumer price, RUB/kg; kept separate from producers |
| Regional producer cells | 2025–2026 | 106 | Available numeric cells only; confidential/missing values omitted; not pooled into national history |
| Onion sown acreage | 2015, 2020–2024 | 6 | All farm categories; table rounded to thousands of hectares; converted to hectares |
| Bank of Russia `USD/RUB` | Jan 2020–Sep 2026 | 81 | Monthly mean of official daily quotes (`XML_dynamic.asp` `R01235`); complete months only; `availableDate` set to day after month end |
| Bank of Russia Key Rate | Jan 2020–Sep 2026 | 81 | Official key rate (`DailyInfo.asmx` `KeyRate`) at last quoted day of month; complete months only; `availableDate` set to day after month end |

Sources:

- [Rosstat price index and download listing](https://rosstat.gov.ru/statistics/price).
- [Producer price workbook, September 2026](https://rosstat.gov.ru/storage/mediabank/cena_sx_09-2026.xlsx): commodity code 01.13.43.110; sheets 2–5, 6.1, 7.1 for monthly prices; 1.1 for annual averages. Publication date on listing: 23 October 2026.
- [Weekly consumer-price workbook](https://rosstat.gov.ru/storage/mediabank/nedel_sred_cen.xlsx): onion row on each year sheet. Listing publication: 28 October 2026.
- [Agriculture in Russia 2025](https://rosstat.gov.ru/folder/210/document/13226): original RAR, R-03.docx, table 3.3.
- [Bank of Russia XML & SOAP services](https://www.cbr.ru/development/SXML/): raw responses retained under `data/sources/cbr` with SHA-256 verification in `data/official-drivers.json`.

Original files are retained under `data/sources/rosstat` and `data/sources/cbr`. Producers are divided by 1,000 exactly; no interpolation or retail-to-warehouse multiplier is used.

## How to refresh

```sh
python3 scripts/collect_rosstat.py --download
python3 scripts/check_rosstat.py
npm run data:drivers
npm run data:forecast
npm test
npm run build
```

## Forecast & driver training (`rosstat-monthly-2.0.0`)

At each forecast horizon `h = 1..14`, `shared/officialForecast.js` and `shared/driverModel.js` evaluate five candidate models strictly without look-ahead:
- `naive`: last observed monthly price;
- `seasonal`: same calendar month of the previous available year;
- `ratio`: trailing mean log seasonal ratio (up to 3 prior years);
- `season_ridge`: standardized L2 ridge regression (`lambda = 5`) on harmonic target month-of-year (`sin`/`cos`);
- `drivers`: standardized L2 ridge regression (`lambda = 5`) on harmonic target month-of-year + 3-month log `USD/RUB` change + CBR key-rate level + 3-month key-rate change known at the origin month.

Training at any historical origin `t` uses only `(origin', target')` pairs with `target' <= t`. Model selection uses the early tuning split (retaining `naive` unless a candidate reduces tuning MAE by at least 5%), empirical 80%/95% error quantiles are calibrated on a purged middle block, and the final 12 target months report out-of-sample MAE for both the selected candidate and all other candidates (`finalAll`), including `drivers`.

Because Rosstat's workbook is a latest-revision snapshot without archived historical first releases, evaluation remains labelled `latest_vintage_hindcast` / `research_benchmark`. Fitted driver weights are predictive, not causal claims.

## Local price entry & calibration (`shared/localBasis.js`)

Users can record actual EXW Volgograd or delivered Moscow transactions directly in the app («Добавить фактическую цену»). Each attested price is saved as a verified own transaction (`verification_status=verified`) and:
1. Calibrates the monthly national forecast to the user's local price level via the median log-ratio across matched months (comparing an unpublished current month to the latest Rosstat month within 2 months and flagging `approx`);
2. Accumulates the user's own weekly transaction series for weekly baseline forecasting and storage break-even analysis.
