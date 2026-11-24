import countriesData from '@/data/countries.json';

export interface IndicatorMeta {
  year: number;
  /** true when this is an IMF estimate for the current year (not yet finalized) */
  est:  boolean;
  src:  'IMF' | 'WB';
}

export interface Country {
  code: string;
  code3: string;
  numericCode: string;
  name: string;
  region: string;
  capital: string;
  currency: { code: string; name: string; symbol: string };
  flag: string;
  flagUrl: string;
  lat: number;
  lng: number;
  population: number;
  gdp: number | null;
  gdpPerCapita: number | null;
  gdpGrowth: number | null;
  inflation: number | null;
  unemployment: number | null;
  gdpHistory: Array<{ year: number; value: number | null }>;
  // Fiscal indicators (populated by fetch-data.ts; may be absent in older snapshots)
  debtToGDP?: number | null;         // General govt gross debt % of GDP  (IMF GGXWDG_NGDP)
  debtHistory?: Array<{ year: number; value: number | null }>; // same series, historical
  budgetBalance?: number | null;     // Net lending (+) / borrowing (−) % GDP (IMF GGXCNL_NGDP)
  currentAccount?: number | null;    // Current-account balance % GDP (IMF BCA_NGDPD)
  interestRate?: number | null;      // Commercial lending rate % (World Bank FR.INR.LEND)
  meta?: {
    gdp?:           IndicatorMeta | null;
    gdpPerCapita?:  IndicatorMeta | null;
    gdpGrowth?:     IndicatorMeta | null;
    inflation?:     IndicatorMeta | null;
    unemployment?:  IndicatorMeta | null;
    debtToGDP?:     IndicatorMeta | null;
    budgetBalance?:  IndicatorMeta | null;
    currentAccount?: IndicatorMeta | null;
  };
}

export const countries: Country[] = countriesData as Country[];

export function getCountryByCode(code: string): Country | undefined {
  return countries.find(c => c.code === code || c.code3 === code);
}

/** World average GDP per capita across all countries that have data. */
export const worldAvgGDPPerCapita: number = (() => {
  const vals = countries
    .filter(c => c.gdpPerCapita !== null && c.gdpPerCapita > 0)
    .map(c => c.gdpPerCapita as number);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
})();

// ── Formatters ────────────────────────────────────────────────────────────────

function safeNum(n: number | null | undefined): number | null {
  if (n == null || !isFinite(n) || isNaN(n)) return null;
  return n;
}

export function formatPopulation(n: number | null | undefined): string {
  const v = safeNum(n);
  if (v === null || v < 0) return 'N/A';
  if (v === 0) return '0';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toString();
}

export function formatGDP(n: number | null | undefined): string {
  const v = safeNum(n);
  if (v === null) return 'N/A';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

export function formatGDPPerCapita(n: number | null | undefined): string {
  const v = safeNum(n);
  if (v === null) return 'N/A';
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/** Unsigned percentage — for inflation and unemployment (4.0%, -2.0%). */
export function formatPercent(n: number | null | undefined): string {
  const v = safeNum(n);
  if (v === null) return 'N/A';
  return `${v.toFixed(1)}%`;
}

/** Signed percentage with explicit + — for GDP growth (+4.0%, -1.5%). */
export function formatPercentSigned(n: number | null | undefined): string {
  const v = safeNum(n);
  if (v === null) return 'N/A';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

export type IndicatorColor = 'green' | 'amber' | 'red' | null;

/** Green = positive growth, red = negative. */
export function gdpGrowthColor(n: number | null | undefined): IndicatorColor {
  const v = safeNum(n);
  if (v === null) return null;
  return v >= 0 ? 'green' : 'red';
}

/**
 * Inflation coloring:
 * - Negative (deflation) → amber (unusual)
 * - 0–2 % → green (ideal)
 * - 2–5 % → null (acceptable, neutral)
 * - > 5 % → red (high)
 */
export function inflationColor(n: number | null | undefined): IndicatorColor {
  const v = safeNum(n);
  if (v === null) return null;
  if (v < 0) return 'amber';
  if (v <= 2) return 'green';
  if (v <= 5) return null;
  return 'red';
}

/** < 5 % → green, 5–10 % → amber, > 10 % → red. */
export function unemploymentColor(n: number | null | undefined): IndicatorColor {
  const v = safeNum(n);
  if (v === null) return null;
  if (v < 5) return 'green';
  if (v <= 10) return 'amber';
  return 'red';
}

/** < 60 % → green, 60–90 % → amber, > 90 % → red. */
export function debtColor(n: number | null | undefined): IndicatorColor {
  const v = safeNum(n);
  if (v === null) return null;
  if (v < 60) return 'green';
  if (v <= 90) return 'amber';
  return 'red';
}

/** Budget balance: surplus ≥ 0 → green, −3–0 % → amber, < −3 % → red. */
export function budgetBalanceColor(n: number | null | undefined): IndicatorColor {
  const v = safeNum(n);
  if (v === null) return null;
  if (v >= 0) return 'green';
  if (v >= -3) return 'amber';
  return 'red';
}

/** Current account: > 2 % surplus → green, −2–2 % → null (neutral), < −2 % → red. */
export function currentAccountColor(n: number | null | undefined): IndicatorColor {
  const v = safeNum(n);
  if (v === null) return null;
  if (v > 2) return 'green';
  if (v < -2) return 'red';
  return null;
}
