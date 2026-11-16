# Open Questions for the Product Owner & Farm Principal (`QUESTIONS.md`)

**Audit Date:** 2026-11-15  
**Status:** All items below are **UNVERIFIED** from the repository code and documentation alone and require owner clarification before finalizing Phase 1–2 architecture and agronomic constraints.

---

## 1. Target Users, Deployment Mode & Tenancy (`UNVERIFIED`)

1. **Single-Farm Internal Tool vs. Multi-Farm Commercial SaaS:**
   - Is `Agro Intelligence Platform` built exclusively for **one specific 78-hectare farm in Volgograd Oblast** (as described in `Volgograd_78ha_Strategy.docx` and `scripts/com.agro.telegram.digest.plist`), or is it intended to serve **multiple independent growers** across Southern Russia?
   - *Why it matters:* Currently, `/api/import` and `/api/assumptions` mutate a single global SQLite state (`server/store.js`). If two farmers use the deployed Vercel URL simultaneously, Farmer B's storage assumptions and price entries overwrite Farmer A's numbers.
2. **Expected Number of Farms, Users & Concurrent Devices:**
   - How many users (e.g., 1 owner + 1 agronomist + 1 sales manager, or 50+ separate KFH/SKhO farms) need access over the next 6–12 months?
   - Do field staff access the tool primarily from mobile phones (Telegram / mobile Safari over 3G/LTE in Gorodishche / Bykovo) or desktop browsers in the office?

---

## 2. Real-World Farm Assets & Agronomic Constraints (`78 ha` Strategy) (`UNVERIFIED`)

3. **Available Rotation Land Beyond the 78 Hectares:**
   - In `Volgograd_78ha_Strategy.docx`, **42 ha out of 78 ha (53.8%)** are planted with onion (`32 ha` spring + `10 ha` winter). Does the farm control or swap additional adjacent/leased fields (e.g., cereal/fallow/melon land) to achieve a 3–4 year phytopathological break, or is `78 ha` the strict total irrigated land bank?
   - *Why it matters:* If `78 ha` is fixed with no external land swap, planting `42 ha` of onion annually guarantees a 1–1.85 year return interval and severe soil infection (*Fusarium* basal rot, pink root, stem nematode).
4. **Actual On-Farm Warehouse Infrastructure & Tonnage Capacity:**
   - Which storage tier (`STORAGE_TIERS` in `shared/storageEconomics.js:70-106`) does the farm actually own or rent today, and for what tonnage (`1,500 t` capacity)?
     - `ambient` (uninsulated/natural draft hangar),
     - `ventilated` (active forced-air ventilation with automated damper/heater control, bulk pile 3.5–4.0 m or box pallets), or
     - `cold` (refrigerated $+0.5\text{ to }+2^\circ\text{C}$ chamber)?
   - Are the **200 missing tonnes** of spring onion (`1,760 t` in Table 3 P&L vs `1,560 t` in Table 4 Cashflow of `Volgograd_78ha_Strategy.docx`) intended to represent physical shrinkage/rot (`11.36%`), seed/cull waste, or an unscheduled April tranche?
5. **Subsidized vs. Commercial Credit Rate (`Льготный кредит МСХ РФ` vs. Commercial Loan):**
   - Does the farm have an approved preferential short-term loan under Ministry of Agriculture RF Decree № 1528 (`ставка ~6.8%–10.0% годовых`), or does it finance working capital at commercial rates tied to the CBR Key Rate (`14% + 3%..5% = 17%–19% APR`, or `19%` as seeded in `data/assumptions.json:9`)?

---

## 3. Verified Local Price Feeds & Counterparty Partnerships (`UNVERIFIED`)

6. **Access to Verified Closed Transactions (`УПД / ТТН`) or Retail DC Price Sheets:**
   - Because all 16 Volgograd warehouse records in `data/observations.json` were reclassified as unverified `indicative_offer` listings, the local weekly model (`shared/forecast.js`) currently has **$N = 0$ verified transactions** and cannot issue a local statistical forecast.
   - Can the owner provide:
     - Historical closed sales invoices (`УПД / реестр отгрузок`) from the farm's own 2023–2026 shipments (`date, price ex-VAT, caliber, tonnage, packaging`)?
     - Weekly procurement bid sheets (`закупочные котировки РЦ`) from regional retail distribution centers (X5 Group, Magnit, Lenta in Volgograd/Rostov/Voronezh) or wholesale traders?
     - Or a small co-op pool of 3–5 trusted Volgograd/Astrakhan growers willing to log weekly realized EXW prices?
7. **Target Sales Geographies & Delivery Bases:**
   - Beyond **EXW Volgograd Oblast** and **Wholesale Moscow (Food City / retail DCs)**, does the farm sell into St. Petersburg, Ekaterinburg, Kazan, or Krasnodar? Should those freight bridges be added to `shared/bridge.js`?

---

## 4. Commercial Model, Legal Liability & Advisory Boundaries (`UNVERIFIED`)

8. **Commercialization & Pricing Model (if externalized):**
   - If offered to external growers or traders, what is the business model (e.g., B2B subscription per farm, commission on brokered truckloads, input/seed supplier value-add, or strictly private proprietary software)?
9. **Legal Liability & Financial Disclaimers for `ПРОДАВАТЬ / ДЕРЖАТЬ` Recommendations:**
   - The UI (`src/components/Forecast.jsx`, `VolgogradOnionIntelPanel.jsx`) and Telegram digest (`scripts/send_telegram_digest.mjs`) issue explicit commercial directives (`ДЕРЖАТЬ`, `ПРОДАВАТЬ ЧАСТЯМИ`, `ПРОДАВАТЬ СЕЙЧАС`).
   - If external farmers rely on these signals to hold 1,000+ tonnes of perishable inventory or take working-capital loans, what contractual disclaimers (`Отказ от ответственности за финансовый результат`), risk limits, and human-in-the-loop sign-offs are required under Russian law?
