# Phase 2 Implementation Report: Onion Market Intelligence & Commercial Decision Support

**Status:** Completed & Validated  
**Branch:** `phase2`  
**Commits:**
1. `ef317ee` — `P2-M1: 5-Tier Market Index, Supply Pressure Index, and Quality-Adjusted Deficit (Module 1)`
2. `314c90e` — `P2-M2: Central Asian Import Corridor and Flow Redistribution Engine (Module 2)`
3. `e09b60f` — `P2-M3: 3-Tier Quality Sales Strategy and Allocation Optimizer (Module 3)`
4. `88b7253` — `P2-M4: Pre-Planting Acreage Economics and Next-Crop Planning (Module 4)`

---

## 1. Executive Summary

Phase 2 transforms the platform from a theoretical price projection tool into an actionable, professional commercial decision system for onion growers in the Volgograd region. Grounded in the agronomic and market intelligence framework provided by Yulia K, the system now delivers mathematical answers to the four fundamental commercial questions faced by vegetable producers:

1. **What is the onion actually worth today?** (Module 1)
2. **When and how hard will Central Asian imports hit my price?** (Module 2)
3. **Which lots must be dumped immediately vs. stored until spring?** (Module 3)
4. **How many hectares should I sow next season without risking bankruptcy?** (Module 4)

---

## 2. Module Specifications & Verification

### Module 1: 5-Tier Market Index, Supply Pressure Index & Quality Deficit
- **5-Tier Source Hierarchy**:
  - `CLOSED_DEAL` (Tier 1): Volume-weighted average price (VWAP) across verified local transactions.
  - `BUYER_BID` (Tier 2): Executable buyer bids and market spread calculation (Lowest Ask − Highest Bid).
  - `VERIFIED_ASK` (Tier 3): Inspected warehouse physical offerings.
  - `MARKETPLACE_ASK` (Tier 4): Public bulletin board listings; strictly flagged as indicative (`priceRubKg: null`), preventing fake transaction prices.
  - `OFFICIAL_INDEX` (Tier 5): Regional EMISS/Rosstat reference benchmarks.
- **Regional Netback Arithmetic**:
  - Calculates farmgate netback for 5 destinations: DAP Moscow (freight 5.50 ₽/kg, transit loss 0.5%), DAP SPb (8.20 ₽/kg), DAP Krasnodar (3.80 ₽/kg), DAP Ekaterinburg (9.40 ₽/kg), and Export Parity (4.20 ₽/kg).
- **Supply Pressure Index ($I_{\mathrm{sp}}$)**:
  $$I_{\mathrm{sp}} = \left(\frac{\text{Available Tonnage}}{\text{Weekly Sales Velocity}}\right) \times \left(1 + \frac{\Delta \text{Listings}}{\text{Base Listings}}\right)$$
  Generates an automated **Early Price Drop Warning** (`earlyWarningSignal: true`) when offerings surge while velocity stalls.
- **Quality-Adjusted Deficit Index ($Q_{\mathrm{товарный}}$)**:
  $$Q_{\mathrm{товарный}}(t) = Q_{\mathrm{остаток}}(t) \times (1 - \text{losses}(t)) \times \text{marketable\_grade\_share}(t)$$
  Quantifies the growing divergence between physical warehouse tonnage and premium first-grade supply by March.
- **Verification**: `test/module1_market_index.test.js` (3/3 tests pass).

### Module 2: Central Asian Trade Corridors & Flow Redistribution
- **Multi-Stage Evidence Gating**:
  - Models the transmission chain: $\text{Iraq Tender} \to \text{Uzbek Export Reaction} \to \text{Kazakh Transit Diversion} \to \text{Russian Inflow Reduction}$.
  - Blocks speculative price impulses (`effectivePriceImpulseRubKg = 0.0`) unless all 4 stages are corroborated by documentation.
- **Delivered Parity & Competitiveness**:
  - Computes complete delivered prices for Kazakhstan (Taraz) and Uzbekistan (Tashkent) including currency conversion, transit loss, customs, phytosanitary clearance, freight, and importer margin.
  - Classifies market regimes: `domestic_advantage` ($\Delta P > +1.50$ ₽/kg), `parity_zone` ($-1.50 \le \Delta P \le +1.50$ ₽/kg), and `import_pressure_glut` ($\Delta P < -1.50$ ₽/kg).
- **Critical FX Trigger**:
  - Identifies the exact KZT/RUB and USD/RUB break-even exchange rates where imported onion undercuts the Volgograd warehouse price.
- **Spring Arrival Window**:
  - Identifies March 20 as the hard deadline when early winter-sown Central Asian onions begin arriving, closing the safe domestic storage window.
- **Verification**: `test/module2_central_asia_corridor.test.js` (4/4 tests pass).

### Module 3: 3-Tier Quality Sales Strategy & Allocation Optimizer
- **Lot Segmentation**:
  - *Risky*: thick/wet neck, softness, botrytis/neck rot symptoms. Strategy: **Sell First Immediately (Oct–Nov)**.
  - *Standard*: 40–50 mm, dry, medium density. Strategy: **Flexible sales matching retail demand (Nov–Jan)**.
  - *Premium Keeping*: 50+ mm, dry closed neck, hard density. Strategy: **Store for seasonal peak (Feb–March 20)**.
- **The 3 Daily Farmer Questions**:
  1. *Cash today?* ($P_{\mathrm{now}}$)
  2. *Cost of holding for 30/60/90 days?* (Storage opex + 19% financing + loss of mass). Demonstrates that holding risky onion brings a net loss of $-2.45$ ₽/kg.
  3. *Required break-even future price?* Solves $P_{\mathrm{be}} = \frac{P_{\mathrm{now}} + \text{Costs}}{\text{SaleableYield}}$.
- **Allocation Optimizer**:
  - Optimizes harvest distribution (e.g. 1500 t: 20% risky, 40% standard, 40% premium).
  - Compared to naive "hold all to spring", the quality-segmented strategy saves **62 tons from rot** and adds **+864,000 ₽ (+0.58 ₽/kg)** in net profit.
- **Verification**: `test/module3_quality_tier_strategy.test.js` (3/3 tests pass).

### Module 4: Pre-Planting Acreage Economics & Next-Crop Planning
- **Hectare Profitability Formula**:
  $$\text{Profit/ha} = \sum_i (Y_i \times P_i \times S_i) - C_{\mathrm{total}}$$
  Evaluates 55 t/ha gross yield (46.75 t/ha marketable) at weighted 20.80 ₽/kg vs. 680,000 ₽/ha full costs $\to$ **+292,400 ₽/ha expected profit** (+30.1% margin).
- **Break-Even Gross Yield**:
  $$\text{Break-Even Yield} = \frac{C_{\mathrm{total}}}{\bar{P} \times 1000 \times \text{MarketableShare}} = 38.46 \text{ t/ha}$$
  Provides a +43% agronomic safety buffer.
- **3 Pre-Planting Scenarios**:
  - *Cautious* (13.5 ₽/kg): recommends contracting to 20–25 ha under firm contracts.
  - *Base* (18.0 ₽/kg): maintains rotation-limited 33 ha.
  - *Optimistic* (24.5 ₽/kg): strictly caps onion acreage at 33 ha (33% of arable land), preventing fusarium buildup and overproduction traps.
- **Diversification Portfolio Shield**:
  - Allocates 100 ha between onion (30 ha), carrot (30 ha), watermelon (20 ha), and fallow (20 ha).
  - Generates 18.96M ₽ in profit while lowering volatility risk from 0.65 to 0.44.
- **Verification**: `test/module4_pre_planting_economics.test.js` (3/3 tests pass).

---

## 3. Test Suite & Verification Matrix

| Test Suite | Tests | Result |
|---|---|---|
| `test/module1_market_index.test.js` | 3 | Pass |
| `test/module2_central_asia_corridor.test.js` | 4 | Pass |
| `test/module3_quality_tier_strategy.test.js` | 3 | Pass |
| `test/module4_pre_planting_economics.test.js` | 3 | Pass |
| `test/api.test.js` (Endpoints verification) | 9 | Pass |
| `test/phase0.test.js` + `test/phase1.test.js` + Suite | 88 | Pass |
| **Total Test Suite** | **110** | **110/110 Pass (100%)** |
| **ESLint (`npm run lint`)** | — | **0 Errors, 0 Warnings** |
| **Vite Build (`npm run build`)** | — | **Success (407ms)** |
