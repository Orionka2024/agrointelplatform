# Agro Intelligence Platform: Methodology & Mathematical Specifications

**Version:** 2.0.0 (Phase 1 Validated)  
**Date:** 2026-11-16  
**Target Commodity:** Yellow Onion (*Allium cepa* L.), OKPD2 `01.13.43.110`, HS Code `0703 10`  
**Primary Geography:** Volgograd Oblast (EXW Warehouse), with DAP Moscow Wholesale Bridge

---

## 1. National Forecast Architecture & Model Selection

### 1.1 Structural Problem with Complex Decision Trees
As documented in `AUDIT_REPORT.md` (Finding `F-01`), training unconstrained gradient boosted decision trees on 24 historical monthly price points results in severe overfitting:
- The effective degrees of freedom ($N_{\mathrm{eff}} \approx 6$ independent crop marketing years) are dwarfed by the feature space (macroeconomic FX, CBR key rate, ERA5 soil temperatures, lagged prices).
- Shuffled-target permutation tests demonstrate that tree-based feature attributions (TreeSHAP) collapse to noise, and out-of-sample skill at commercial storage horizons ($h \ge 4$ months) underperforms seasonal-naive.

### 1.2 The Production Benchmark: Seasonal Weibull Carryover Model (`eq_carry`)
To prevent overfitted projections, the default production forecast uses a structural economic model representing seasonal inventory drawdown:

$$\hat{y}_{t+h} = \mu(m_{t+h}) \cdot \left[ 1 + \lambda^h \left( \frac{y_t}{\mu(m_t)} - 1 \right) \right]$$

Where:
- $m_t \in \{1, \dots, 12\}$ is the calendar month of origin $t$.
- $m_{t+h} = (m_t + h - 1 \pmod{12}) + 1$ is the target forecast month.
- $\mu(m)$ is the historical seasonal baseline for month $m$, estimated via trimmed geometric mean across historical Rosstat agricultural producer price cycles.
- $\lambda \in [0.70, 0.85]$ is the persistence parameter governing the speed of mean reversion to seasonal equilibrium.

At long storage horizons ($h \ge 6$), $\lambda^h \to 0$, causing the forecast to converge gracefully to the structural seasonal profile rather than exploding into unconstrained extrapolation.

### 1.3 Experimental Tree Model Policy
The decision tree model is retained exclusively for experimental research:
- Relegated behind an explicit, user-activated experimental toggle in `src/components/OfficialMarket.jsx`.
- Off by default in all customer-facing views.
- Governed by `scripts/skill_gate.mjs`, which enforces that no experimental model can receive production status unless it demonstrates a statistically significant reduction in MAE versus seasonal-naive across a rolling-origin block bootstrap evaluation.

---

## 2. Calibrated Prediction Intervals & Reliability Diagram

### 2.1 Log-Relative Residuals
Standard additive conformal intervals fail on agricultural price series due to strong heteroscedasticity (price dispersion scales proportionally with price levels). Prediction errors are formulated as log-relative residuals:

$$r_{t, h} = \ln\left(\frac{y_{t+h}}{\hat{y}_{t, h}}\right)$$

### 2.2 Adjacent-Horizon Pooling
To overcome small sample sizes ($n \approx 10..14$ per individual horizon lead), residuals are pooled across adjacent lead times:

$$\mathcal{R}_h = \bigcup_{k \in \{h-1, h, h+1\}} \{ r_{t, k} \}_{t=1}^{T_k}$$

Pooling satisfies the sample size requirement $n_{\mathrm{pooled}} \ge 24$, stabilizing empirical quantile estimation.

### 2.3 Moving Block Bootstrap Resampling
Because agricultural markets exhibit serial autocorrelation across consecutive months within the same storage season, independent and identically distributed (i.i.d.) resampling is invalid. Resampling is performed via **Moving Block Bootstrap (MBB)**:
- Block length: $b = 3$ consecutive months.
- Number of bootstrap replicates: $B = 1000$.

The lower and upper $1 - \alpha$ calibrated bounds are given by:

$$\mathrm{Lo}_{1-\alpha}(t+h) = \hat{y}_{t+h} \cdot \exp\left( q_{\alpha/2}(\mathcal{R}_h) \right)$$

$$\mathrm{Hi}_{1-\alpha}(t+h) = \hat{y}_{t+h} \cdot \exp\left( q_{1 - \alpha/2}(\mathcal{R}_h) \right)$$

### 2.4 Empirical Coverage Tolerance Gate
Prediction intervals are displayed **only** if the empirical coverage on the held-out rolling backtest window satisfies the tolerance condition:

$$\mathrm{Coverage}_{80\%} \in [0.70, 0.90]$$

If empirical coverage falls outside this window, the band is suppressed and replaced with an explicit transparency label:  
*«Интервал недоступен: n=X, наблюдаемое покрытие Y% вне допуска 70%–90%»*.

---

## 3. Seasonal Local Basis Engine ($B(m)$)

### 3.1 The Flaw of Static Ratio Basis
A single static multiplier $B = P_{\mathrm{Volgograd}} / P_{\mathrm{RF}}$ misrepresents agricultural reality:
- In autumn (harvest glut, August–October), regional farm-gate prices trade at a steep discount to national averages ($B \approx 0.65..0.72$) due to lack of local storage infrastructure.
- In spring (March–May), local prices catch up to national levels ($B \approx 0.90..0.96$) as storage costs compound and unconditioned field lots leave the market.
- Applying an autumn-calibrated ratio to spring forecasts produces a catastrophic negative bias (-24.8% error, ~-5.60 ₽/kg).

### 3.2 Hierarchical Empirical Bayes Shrinkage Curve
The local basis is modeled as a 12-month vector $B(m)$ for $m \in \{1, \dots, 12\}$.

#### Prior Curve $B_0(m)$
Constructed from the long-term regional EMISS price series for Volgograd Oblast relative to Rosstat national producer prices:

$$B_0(m) = \frac{\bar{P}_{\mathrm{Volgograd}}(m)}{\bar{P}_{\mathrm{Rosstat}}(m)}$$

#### User-Observed Basis
For each verified farmer transaction $i \in \{1, \dots, K\}$ occurring in month $m(i)$ with price $p_i$ and national benchmark price $P_{\mathrm{national}}(i)$:

$$b_i = \frac{p_i}{P_{\mathrm{national}}(i)}$$

Each observation is assigned an analytical weight:

$$w_i = \sqrt{V_i} \cdot \exp\left( -\frac{\Delta t_i}{\tau} \right)$$

Where:
- $V_i$ is the physical lot volume in metric tons.
- $\Delta t_i$ is the age of the transaction in days.
- $\tau = 60$ days is the recency half-life parameter.

#### Posterior Shrinkage
For each calendar month $m$, the updated basis is computed via Empirical Bayes shrinkage:

$$B(m) = \frac{W_m \cdot \bar{b}_m + \kappa \cdot B_0(m)}{W_m + \kappa}$$

Where:
- $W_m = \sum_{i: m(i)=m} w_i$ is the effective observation weight for month $m$.
- $\bar{b}_m = \frac{1}{W_m} \sum_{i: m(i)=m} w_i b_i$ is the weighted sample basis.
- $\kappa = 10.0$ is the prior shrinkage strength parameter.

With zero observations for a month, $B(m) = B_0(m)$. With substantial farmer transaction volume, $B(m) \to \bar{b}_m$.

### 3.3 Variance Propagation into Localized Intervals
When projecting localized prediction intervals, basis uncertainty is explicitly added to national forecast variance:

$$\mathrm{Var}\left(\hat{y}_{\mathrm{local}}\right) = B(m)^2 \cdot \mathrm{Var}\left(\hat{y}_{\mathrm{national}}\right) + \hat{y}_{\mathrm{national}}^2 \cdot \mathrm{Var}\left(B(m)\right)$$

This guarantees that sparse local data properly widens localized confidence intervals.

---

## 4. Plan Reconciliation & Agronomic Consistency Engine

To prevent misleading loan submissions and agronomic failures (Audited Strategy Finding `F-12`, `F-13`), all production plans must satisfy five invariant conservation laws before export.

### 4.1 Tranche Share Constraint
$$\sum_{j=1}^J s_j = 100.0\%$$
Where $s_j$ is the percentage share of harvested volume allocated to sales tranche $j$.

### 4.2 Physical Mass Balance
$$M_{\mathrm{harvested}} = M_{\mathrm{sold}} + M_{\mathrm{loss}} + M_{\mathrm{unsold}}$$
Where:
- $M_{\mathrm{harvested}} = \sum_c A_c \cdot Y_c$ is total gross yield ($A_c$: area in ha; $Y_c$: yield in t/ha).
- $M_{\mathrm{loss}}$ accounts for technological curing loss, sorting discard, and cumulative storage shrinkage.
- Any unexplained tonnage ($\Delta M \ne 0$) triggers a mass balance violation.

### 4.3 Cashflow Period Non-Overlap
Let $T_k \subset \{1, \dots, 12\}$ be the set of calendar months spanned by cashflow row $k$. For any two cashflow rows $k \ne l$:

$$T_k \cap T_l = \emptyset \quad \text{(for operational sales inflow periods)}$$

Overlapping intervals (such as counting February twice in both Row 1 and Row 8) are flagged as period duplications.

### 4.4 Financial Revenue Reconciliation
$$\Delta_{\mathrm{rev}} = \left| R_{\mathrm{P\&L}} - R_{\mathrm{Cashflow}} \right| = 0$$
Where:
- $R_{\mathrm{P\&L}}$ is net operating revenue reported in the accrual Profit & Loss statement.
- $R_{\mathrm{Cashflow}}$ is total gross cash inflows from commodity sales in the Cashflow budget.

### 4.5 Phytopathological Crop Rotation Rule
To prevent soil-borne inoculum accumulation of onion basal rot (*Fusarium oxysporum* f. sp. *cepae*) and stem/bulb nematode (*Ditylenchus dipsaci*), the maximum annual Allium acreage share on irrigated land is constrained:

$$\text{Share}_{\mathrm{Allium}} = \frac{\sum_{c \in \text{Allium}} A_c}{A_{\mathrm{total}}} \le 25.0\%$$

The implied return interval is:

$$T_{\mathrm{return}} = \frac{1}{\text{Share}_{\mathrm{Allium}}} \ge 4.0 \text{ years}$$

Any farm plan with Allium share $> 25\%$ (e.g., 42 ha out of 78 ha = 53.85%) is flagged as a high-risk agronomic violation.

---

## 5. Storage Economics & Break-Even Modeling

### 5.1 Physical Shrinkage Function
Physical mass shrinkage increases non-linearly over time:

$$L(w) = L_0 + \gamma_1 \cdot w + \gamma_2 \cdot w^2$$

For standard active ventilation in Volgograd:
- Month 1 ($w=4$ weeks): $L \approx 2.5\%..3.5\%$ (initial curing and respiratory drying).
- Month 3 ($w=13$ weeks): $L \approx 6.0\%..7.5\%$.
- Month 5 ($w=20$ weeks): $L \approx 10.0\%..12.5\%$.
- Month 7 ($w=28$ weeks): $L \approx 15.0\%..17.5\%$.

### 5.2 Dynamic Break-Even Price
The minimum future selling price required to break even compared to immediate sale at current price $P_0$ is:

$$P_{\mathrm{be}}(w) = \frac{P_0 + C_{\mathrm{handling}} + w \cdot \left( C_{\mathrm{electricity}} + C_{\mathrm{finance}} \right)}{1 - L(w)}$$

Where:
- $C_{\mathrm{electricity}}$ is calculated from actual kWh consumption of ventilation fans multiplied by regional energy tariff ($T \approx 6.50$ ₽/kWh).
- $C_{\mathrm{finance}} = \frac{P_0 \cdot r_{\mathrm{loan}}}{52}$ is weekly interest on operating credit tied up in inventory ($r_{\mathrm{loan}} \approx 19.0\%$).
- $1 - L(w)$ adjusts for the reduced saleable tonnage resulting from shrinkage.

---

## 6. Software Architecture & Evidence Boundaries

| Layer | Implementation | Integrity & Security Guarantee |
|---|---|---|
| **Data Ingestion** | `scripts/collect_rosstat.py`, `scripts/collect_cbr.mjs`, `scripts/fetch_regional_emiss.mjs` | Automated schema validation, runtime SHA-256 hash checking against `data/official-hashes.json`. |
| **Storage & Durability** | `server/store.js` (`better-sqlite3` / PostgreSQL / Turso) | Monotonic schema migrations, append-only `audit_revisions`, multi-tenant user isolation. |
| **Authentication** | `server/access.js`, `api/auth.js` | Passwordless magic links, HttpOnly cookies, zero secrets in client bundles. |
| **Forecasting Engine** | `shared/officialForecast.js`, `shared/localBasis.js` | Structural Weibull baseline, pooled log-relative residuals with MBB resampling, seasonal basis shrinkage. |
| **Decision Support** | `shared/decisionScreenEngine.js`, `shared/planValidators.js` | 5-point mathematical plan reconciliation, 422 pre-export gating, 20-rule adversarial grounding. |
| **Client UI** | React 19, Vite, Chart.js, `shared/offlineQueue.js` | Mobile-first decision screen, offline transaction queue with automatic sync. |
