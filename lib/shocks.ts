/**
 * lib/shocks.ts — Scenario Shock Model
 *
 * Computes illustrative GDP-growth impacts (percentage points) for four global shocks.
 * All formulas are simple linear approximations, fully documented below.
 *
 * ⚠ Results are ILLUSTRATIVE ONLY — not economic forecasts.
 */

import { countries, Country } from './data';
import tradeRaw from '../data/trade.json';

// ── Trade data types ──────────────────────────────────────────────────────────
interface TradePartner  { code: string; name: string; value: number; share: number; }
interface TradeEntry    { year: number; exports: number | null; imports: number | null; exportPartners: TradePartner[]; importPartners: TradePartner[]; }
const tradeData = tradeRaw as Record<string, TradeEntry>;

// ── Public types ──────────────────────────────────────────────────────────────

export interface ShockParams {
  /** % change in oil price. Range −50 to +100. 0 = no shock. */
  oil: number;
  /** Percentage-point change in US federal-funds rate. Range −3 to +5. */
  rates: number;
  /** Percentage-point change in China real GDP growth (≤ 0). Range −5 to 0. */
  china: number;
  /** % appreciation of the USD vs all trading partners. Range −20 to +30. */
  dollar: number;
}

export const DEFAULT_PARAMS: ShockParams = { oil: 0, rates: 0, china: 0, dollar: 0 };

export interface CountryImpact {
  country: Country;
  total: number;        // total estimated change in GDP growth (pp)
  oilImpact: number;
  ratesImpact: number;
  chinaImpact: number;
  dollarImpact: number;
  /** One-line explanation of the dominant channel (for ranking list). */
  topReason: string;
}

// ── Static exposure tables ────────────────────────────────────────────────────

/**
 * Net oil exports as % of GDP (positive = net exporter, negative = net importer).
 * Source: World Bank oil rents + BP Statistical Review, simplified.
 * Countries not listed: 0 (neutral exposure).
 */
const OIL_EXPOSURE: Record<string, number> = {
  // Major exporters
  SA: 22, KW: 28, AE: 16, IQ: 38, NG:  9, RU: 11, NO: 14, LY: 28,
  AZ: 17, KZ: 12, QA: 22, DZ: 11, EC:  6, CO:  4, TT:  9, GQ: 18,
  GA: 13, AO: 28, CG: 22, BH: 11, OM: 17, VE: 16, SS: 28, TM: 20,
  YE: 10, SD:  5, MR:  5, CM:  3, CD:  2, GH:  3, DK:  2, VN:  2,
  ID:  1, MY:  4, AU:  2, UZ:  5,
  // Major importers
  JP: -4, KR: -4, TW: -4, TH: -3, PK: -3, TR: -3, GR: -2, ES: -2,
  PT: -2, IT: -2, DE: -2, FR: -2, BD: -2, PH: -2, SG: -2, LK: -3,
  IN: -2, CN: -1, NZ: -2, ZA: -1, NL: -1, BE: -1, AT: -1, CH: -1,
  SE: -1, FI: -1, PL: -1, HU: -1, CZ: -1, RO: -1, HK: -1,
};

/**
 * Approximate share of a country's external debt denominated in USD (0–1).
 * Source: BIS / IMF estimates, simplified.
 * Defaults: developed-market countries → 0.28, emerging-market → 0.55.
 */
const USD_DEBT_SHARE: Record<string, number> = {
  AR: 0.75, TR: 0.60, PK: 0.65, NG: 0.72, GH: 0.75, ZM: 0.80,
  KE: 0.72, TZ: 0.70, UG: 0.65, ET: 0.72, EG: 0.70, TN: 0.60,
  MA: 0.55, LK: 0.70, BD: 0.65, MM: 0.65, KH: 0.65, LA: 0.70,
  MN: 0.70, AZ: 0.65, UZ: 0.60, GE: 0.65, AM: 0.60, VE: 0.80,
  EC: 0.70, BO: 0.65, PY: 0.60, PG: 0.65, SD: 0.75, SS: 0.80,
  BR: 0.45, MX: 0.50, ID: 0.55, PH: 0.60, TH: 0.50, MY: 0.45,
  VN: 0.60, CO: 0.55, PE: 0.60, CL: 0.50, ZA: 0.50, KZ: 0.55,
  UA: 0.60, RS: 0.55, HU: 0.50, RO: 0.45, BG: 0.45, HR: 0.45,
  IN: 0.55, CN: 0.35, KR: 0.35, SG: 0.35, HK: 0.35, TW: 0.30,
  JP: 0.20, DE: 0.25, FR: 0.25, GB: 0.30, AU: 0.30, CA: 0.25,
  IT: 0.25, ES: 0.25, NL: 0.25, CH: 0.20, SE: 0.25, NO: 0.20,
  DK: 0.25, FI: 0.25, AT: 0.25, BE: 0.25, PT: 0.30, GR: 0.30,
  PL: 0.35, CZ: 0.30, NZ: 0.30, IL: 0.40, AE: 0.50, SA: 0.50,
  US: 0.95,
};

// Developed-market codes — used to scale down domestic-debt exposure in rate/dollar shocks.
const DM = new Set([
  'US','CA','GB','DE','FR','IT','ES','NL','BE','AT','CH','SE','NO','DK','FI',
  'PT','GR','IE','LU','IS','JP','KR','AU','NZ','SG','HK','TW','IL','CZ','SK',
  'HU','PL','SI','HR','LV','LT','EE','MT','CY',
]);

function usdDebtShare(c: Country): number {
  if (USD_DEBT_SHARE[c.code] !== undefined) return USD_DEBT_SHARE[c.code];
  return DM.has(c.code) ? 0.28 : 0.55;
}

// ── Shock formulas ────────────────────────────────────────────────────────────

/**
 * OIL PRICE SHOCK → impact on GDP growth (pp).
 *
 *   impact = oilExposure_pp × (oilChangePct / 100) × 0.30
 *
 * oilExposure_pp: net oil exports as % of GDP (+ve = exporter, −ve = importer).
 * The 0.30 pass-through factor reflects that windfalls partly flow to sovereign
 * wealth funds / buffer funds rather than directly into domestic growth.
 *
 * Example: Saudi Arabia (exposure = +22%), oil price +50% →
 *   22 × 0.50 × 0.30 = +3.3 pp GDP growth boost.
 * Example: Japan (exposure = −4%), oil price +50% →
 *   −4 × 0.50 × 0.30 = −0.6 pp hit.
 */
function oilShock(c: Country, oilChangePct: number): number {
  if (oilChangePct === 0) return 0;
  const exp = OIL_EXPOSURE[c.code] ?? 0;
  return exp * (oilChangePct / 100) * 0.30;
}

/**
 * US INTEREST RATE SHOCK → impact on GDP growth (pp).
 *
 * Three channels:
 *
 * (a) Global liquidity tightening — hits every economy:
 *       impact_a = −rateChange × 0.08
 *     Empirical estimate: each +1 pp in US rates reduces global growth ~0.08 pp.
 *
 * (b) Debt-service burden — high-debt, USD-exposed countries:
 *       impact_b = −(debtToGDP/100) × usdDebtShare × rateChange × 0.20 × dmAdj
 *     dmAdj = 0.25 for developed markets (most debt is domestic-currency),
 *             1.00 for emerging markets.
 *
 * (c) Capital-flow / sudden-stop vulnerability:
 *       impact_c = −(currentAccountDeficit/100) × rateChange × 0.15
 *     Countries running large CA deficits face greater risk of capital outflows
 *     when US rates rise, forcing them to tighten domestic conditions.
 */
function ratesShock(c: Country, rateChange: number): number {
  if (rateChange === 0) return 0;
  const a = -rateChange * 0.08;
  const debt    = c.debtToGDP ?? 50;
  const udShare = usdDebtShare(c);
  const dmAdj   = DM.has(c.code) ? 0.25 : 1.0;
  const b = -(debt / 100) * udShare * rateChange * 0.20 * dmAdj;
  const ca      = c.currentAccount ?? 0;
  const deficit = Math.max(0, -ca);
  const c_ = -(deficit / 100) * rateChange * 0.15;
  return a + b + c_;
}

/**
 * CHINA GROWTH SLOWDOWN → impact on GDP growth (pp).
 *
 *   exportsToChina_pctGDP = (chinaPartnerShare/100 × totalExports) / gdp
 *   impact = exportsToChina_pctGDP × chinaSlowdown_pp × 1.5
 *
 * Data: 2022 bilateral export partners from data/trade.json.
 * The 1.5 multiplier covers direct demand (1.0×), commodity-price spillover
 * (China ≈ 50% of global metals demand, +0.3×), and confidence effects (+0.2×).
 * chinaSlowdown is ≤ 0, so the result is ≤ 0 for China trade partners.
 */
function chinaShock(c: Country, chinaSlowdown: number): number {
  if (chinaSlowdown === 0) return 0;
  const gdp = c.gdp;
  if (!gdp) return 0;
  const trade = tradeData[c.code3];
  if (!trade?.exports) return 0;
  const partner = trade.exportPartners.find(p => p.code === 'CHN');
  if (!partner) return 0;
  const exportsToChina = (partner.share / 100) * trade.exports;
  return (exportsToChina / gdp) * chinaSlowdown * 1.5;
}

/**
 * USD STRENGTH → impact on GDP growth (pp).
 *
 * Three channels:
 *
 * (a) External debt service — USD debt costlier in local-currency terms:
 *       impact_a = −(debtToGDP/100) × usdDebtShare × (dollarChange/100) × 5 × dmAdj
 *     dmAdj same as above (developed markets' debt is mostly in domestic currency).
 *
 * (b) Commodity terms-of-trade — stronger USD typically lowers USD commodity prices:
 *       impact_b = −oilExposure_pp × (dollarChange/100) × 0.15
 *     Commodity exporters are hurt (their USD revenues fall in real terms).
 *     Commodity importers get a small offset.
 *
 * (c) Trade competitiveness:
 *       impact_c = (currentAccount/100) × (dollarChange/100) × 5
 *     Surplus countries see their exports become cheaper in USD → marginal boost.
 *     Deficit countries face a mild headwind.
 */
function dollarShock(c: Country, dollarChange: number): number {
  if (dollarChange === 0) return 0;
  const debt    = c.debtToGDP ?? 50;
  const udShare = usdDebtShare(c);
  const dmAdj   = DM.has(c.code) ? 0.25 : 1.0;
  const a = -(debt / 100) * udShare * (dollarChange / 100) * 5 * dmAdj;
  const oilExp = OIL_EXPOSURE[c.code] ?? 0;
  const b = -oilExp * (dollarChange / 100) * 0.15;
  const ca = c.currentAccount ?? 0;
  const cv = (ca / 100) * (dollarChange / 100) * 5;
  return a + b + cv;
}

// ── Reason generation ─────────────────────────────────────────────────────────

function oilReason(c: Country, oilChangePct: number, impact: number): string | null {
  if (Math.abs(impact) < 0.05) return null;
  const exp = OIL_EXPOSURE[c.code] ?? 0;
  if (exp > 0) return `Net oil exporter (oil ≈ ${exp}% of GDP); ${oilChangePct > 0 ? 'rising' : 'falling'} oil prices boost revenues`;
  if (exp < 0) return `Net oil importer (oil costs ≈ ${Math.abs(exp)}% of GDP); ${oilChangePct > 0 ? 'rising' : 'falling'} oil prices raise energy costs`;
  return null;
}

function ratesReason(c: Country, rateChange: number, impact: number): string | null {
  if (Math.abs(impact) < 0.05) return null;
  const debt    = c.debtToGDP ?? 50;
  const udShare = usdDebtShare(c);
  const ca      = c.currentAccount ?? 0;
  if (ca < -4) return `Large current-account deficit (${ca.toFixed(1)}% of GDP) raises capital-outflow risk as US rates ${rateChange > 0 ? 'rise' : 'fall'}`;
  if (debt > 70 && udShare > 0.5) return `High debt (${debt.toFixed(0)}% of GDP, ~${Math.round(udShare * 100)}% in USD) makes refinancing expensive`;
  return `Global liquidity tightening from US rate ${rateChange > 0 ? 'rise' : 'cut'} weighs on domestic growth`;
}

function chinaReason(c: Country, impact: number): string | null {
  if (Math.abs(impact) < 0.05) return null;
  const gdp = c.gdp; if (!gdp) return null;
  const trade = tradeData[c.code3]; if (!trade?.exports) return null;
  const partner = trade.exportPartners.find(p => p.code === 'CHN'); if (!partner) return null;
  const pct = ((partner.share / 100) * trade.exports / gdp * 100).toFixed(1);
  return `Exports to China = ${pct}% of GDP; slower Chinese demand reduces revenues`;
}

function dollarReason(c: Country, dollarChange: number, impact: number): string | null {
  if (Math.abs(impact) < 0.05) return null;
  const debt    = c.debtToGDP ?? 50;
  const udShare = usdDebtShare(c);
  const usdDebtPct = (debt * udShare).toFixed(0);
  const oilExp  = OIL_EXPOSURE[c.code] ?? 0;
  if (parseFloat(usdDebtPct) > 25 && dollarChange > 0)
    return `USD-denominated debt ≈ ${usdDebtPct}% of GDP becomes costlier as the dollar strengthens`;
  if (parseFloat(usdDebtPct) > 25 && dollarChange < 0)
    return `USD-denominated debt ≈ ${usdDebtPct}% of GDP eases as the dollar weakens`;
  if (oilExp > 5 && dollarChange > 0)
    return `Commodity exporter: rising dollar typically depresses USD-priced export revenues`;
  if (oilExp < -2 && dollarChange > 0)
    return `Cheaper commodities as dollar strengthens reduce import costs`;
  return `${dollarChange > 0 ? 'Stronger' : 'Weaker'} dollar affects trade competitiveness and cross-border capital flows`;
}

// ── Main computation ──────────────────────────────────────────────────────────

export function computeImpacts(params: ShockParams): CountryImpact[] {
  return countries
    .filter(c => c.gdp != null)
    .map(c => {
      const oilImpact    = oilShock(c, params.oil);
      const ratesImpact  = ratesShock(c, params.rates);
      const chinaImpact  = chinaShock(c, params.china);
      const dollarImpact = dollarShock(c, params.dollar);
      const total = oilImpact + ratesImpact + chinaImpact + dollarImpact;

      // Find the channel with the largest absolute contribution for one-line reason
      const channels = [
        { impact: oilImpact,    reason: oilReason(c, params.oil, oilImpact) },
        { impact: ratesImpact,  reason: ratesReason(c, params.rates, ratesImpact) },
        { impact: chinaImpact,  reason: chinaReason(c, chinaImpact) },
        { impact: dollarImpact, reason: dollarReason(c, params.dollar, dollarImpact) },
      ].filter(x => x.reason !== null);

      channels.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
      const topReason = channels[0]?.reason ?? 'Combined effect of active shocks';

      return { country: c, total, oilImpact, ratesImpact, chinaImpact, dollarImpact, topReason };
    });
}

/** Map country.code → impact pp, consumed by Globe for polygon coloring. */
export function toColorMap(impacts: CountryImpact[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const item of impacts) m[item.country.code] = item.total;
  return m;
}

/**
 * Diverging color scale for scenario globe.
 * Green = positive impact (helped), Red = negative (hurt), Grey = neutral.
 */
export function scenarioColor(pp: number): string {
  if (pp >  3.0) return 'rgba(20,180,80,0.85)';
  if (pp >  1.5) return 'rgba(40,160,70,0.75)';
  if (pp >  0.5) return 'rgba(60,150,80,0.65)';
  if (pp >  0.1) return 'rgba(80,130,80,0.55)';
  if (pp > -0.1) return 'rgba(90,90,90,0.50)';
  if (pp > -0.5) return 'rgba(140,80,60,0.55)';
  if (pp > -1.5) return 'rgba(180,55,40,0.65)';
  if (pp > -3.0) return 'rgba(205,35,25,0.75)';
  return 'rgba(220,15,15,0.85)';
}
