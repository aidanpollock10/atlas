/**
 * lib/fx.ts
 * Exchange-rate helpers built on data/fx.json (produced by scripts/fetch-fx.ts).
 *
 * Rate convention throughout: `rate` = units of currency per 1 USD.
 *   EUR: 0.92  → 1 USD = 0.92 EUR
 *   JPY: 150   → 1 USD = 150 JPY
 *
 * % change sign convention: positive = currency APPRECIATED vs USD (got stronger).
 */

import fxRaw from '@/data/fx.json';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FxEntry {
  rate: number;
  history: Array<{ date: string; rate: number }>; // sorted oldest→newest, monthly "YYYY-MM"
}

export interface PegInfo {
  pegCurrency: 'USD' | 'EUR';
  /** Units of this currency per 1 peg currency. */
  rate: number;
  label: string;
}

export interface FxResult {
  entry: FxEntry;
  peg?: PegInfo;
  /** True when the currency IS USD or is hard-pegged 1:1 to USD. */
  isUsd?: boolean;
}

// ── Raw data ──────────────────────────────────────────────────────────────────

type RawFxMap = Record<string, FxEntry>;
const fxData = fxRaw as unknown as RawFxMap;

// ── Peg table ─────────────────────────────────────────────────────────────────
// Currencies not covered by Frankfurter (ECB set) but with known hard pegs.
// rate = units of this currency per 1 peg currency (not per 1 USD).

export const CURRENCY_PEGS: Record<string, PegInfo> = {
  // ── USD pegs ─────────────────────────────────────────────────────────────
  SAR: { pegCurrency: 'USD', rate: 3.75,      label: 'Pegged to USD' },          // Saudi Riyal
  AED: { pegCurrency: 'USD', rate: 3.6725,    label: 'Pegged to USD' },          // UAE Dirham
  QAR: { pegCurrency: 'USD', rate: 3.64,      label: 'Pegged to USD' },          // Qatar Riyal
  BHD: { pegCurrency: 'USD', rate: 0.376,     label: 'Pegged to USD' },          // Bahrain Dinar
  KWD: { pegCurrency: 'USD', rate: 0.307,     label: 'Quasi-pegged to USD' },    // Kuwait Dinar (basket)
  JOD: { pegCurrency: 'USD', rate: 0.709,     label: 'Pegged to USD' },          // Jordan Dinar
  OMR: { pegCurrency: 'USD', rate: 0.38497,   label: 'Pegged to USD' },          // Oman Riyal
  XCD: { pegCurrency: 'USD', rate: 2.70,      label: 'Pegged to USD' },          // Eastern Caribbean Dollar
  BBD: { pegCurrency: 'USD', rate: 2.0,       label: 'Pegged to USD (2:1)' },    // Barbadian Dollar
  BZD: { pegCurrency: 'USD', rate: 2.0,       label: 'Pegged to USD (2:1)' },    // Belize Dollar
  BSD: { pegCurrency: 'USD', rate: 1.0,       label: 'Pegged to USD (1:1)' },    // Bahamian Dollar
  PAB: { pegCurrency: 'USD', rate: 1.0,       label: 'Pegged to USD (1:1)' },    // Panamanian Balboa
  KYD: { pegCurrency: 'USD', rate: 0.82,      label: 'Pegged to USD' },          // Cayman Islands Dollar
  AWG: { pegCurrency: 'USD', rate: 1.79,      label: 'Pegged to USD' },          // Aruban Florin
  ANG: { pegCurrency: 'USD', rate: 1.79,      label: 'Pegged to USD' },          // Netherlands Antillean Guilder
  // ── EUR pegs ─────────────────────────────────────────────────────────────
  XAF: { pegCurrency: 'EUR', rate: 655.957,   label: 'Pegged to EUR (CFA franc)' }, // Central African CFA
  XOF: { pegCurrency: 'EUR', rate: 655.957,   label: 'Pegged to EUR (CFA franc)' }, // West African CFA
  XPF: { pegCurrency: 'EUR', rate: 119.3317,  label: 'Pegged to EUR (CFP franc)' }, // Pacific CFP franc
  CVE: { pegCurrency: 'EUR', rate: 110.265,   label: 'Pegged to EUR' },          // Cape Verde Escudo
  KMF: { pegCurrency: 'EUR', rate: 491.968,   label: 'Pegged to EUR' },          // Comorian Franc
  STN: { pegCurrency: 'EUR', rate: 24.5,      label: 'Pegged to EUR' },          // São Tomé Dobra
};

// Currencies that are USD (or legally equivalent)
const USD_EQUIVALENTS = new Set(['USD']);

// ── Core lookup ────────────────────────────────────────────────────────────────

export function getFxEntry(currencyCode: string): FxResult | null {
  if (!currencyCode) return null;
  const code = currencyCode.toUpperCase();

  // USD itself
  if (USD_EQUIVALENTS.has(code)) {
    return { entry: { rate: 1, history: [] }, isUsd: true };
  }

  // Direct Frankfurter data (EUR, GBP, JPY, etc.)
  const direct = fxData[code];
  if (direct) return { entry: direct };

  // Peg resolution
  const peg = CURRENCY_PEGS[code];
  if (!peg) return null;

  if (peg.pegCurrency === 'USD') {
    // Hard USD peg: synthetic flat entry, 0% change
    return { entry: { rate: peg.rate, history: [] }, peg, isUsd: true };
  }

  // EUR peg: scale EUR history
  // peg.rate = units of this currency per 1 EUR
  // 1 USD = eurData.rate EUR = eurData.rate × peg.rate units of this currency
  const eurData = fxData['EUR'];
  if (!eurData) return null;

  return {
    entry: {
      rate: eurData.rate * peg.rate,
      history: eurData.history.map(h => ({
        date: h.date,
        rate: h.rate * peg.rate,
      })),
    },
    peg,
  };
}

// ── Change calculation ────────────────────────────────────────────────────────

/**
 * % change of the currency vs USD.
 * Positive = appreciated (fewer units needed per USD = stronger).
 * Negative = depreciated.
 */
export function fxChangePercent(currentRate: number, pastRate: number): number {
  if (!pastRate || pastRate === 0) return 0;
  return ((pastRate - currentRate) / pastRate) * 100;
}

/** Last history entry with date ≤ targetYearMonth ("YYYY-MM"). History must be sorted oldest→newest. */
function rateAtMonth(history: FxEntry['history'], targetYearMonth: string): number | null {
  let found: number | null = null;
  for (const h of history) {
    if (h.date > targetYearMonth) break;
    found = h.rate;
  }
  return found;
}

export interface FxChanges {
  change1Y: number | null;
  change5Y: number | null;
}

export function getFxChanges(result: FxResult): FxChanges {
  // USD-pegged: always flat
  if (result.isUsd) return { change1Y: 0, change5Y: 0 };

  const { entry } = result;
  if (!entry.history.length) return { change1Y: null, change5Y: null };

  const now = new Date();
  const fmtYM = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  const y1  = new Date(now); y1.setFullYear(y1.getFullYear() - 1);
  const y5  = new Date(now); y5.setFullYear(y5.getFullYear() - 5);

  const current = entry.rate;
  const r1 = rateAtMonth(entry.history, fmtYM(y1));
  const r5 = rateAtMonth(entry.history, fmtYM(y5));

  return {
    change1Y: r1 !== null ? fxChangePercent(current, r1) : null,
    change5Y: r5 !== null ? fxChangePercent(current, r5) : null,
  };
}

// ── Precomputed 1Y-change cache for globe coloring ────────────────────────────
// Built once at module load so getCapColorForLayer stays O(1).

export const fx1YChangeCache = new Map<string, number | null>();

for (const code of Object.keys(fxData)) {
  const result = getFxEntry(code);
  if (result) fx1YChangeCache.set(code, getFxChanges(result).change1Y);
}
for (const code of Object.keys(CURRENCY_PEGS)) {
  if (!fx1YChangeCache.has(code)) {
    const result = getFxEntry(code);
    if (result) fx1YChangeCache.set(code, getFxChanges(result).change1Y);
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

/** "1 USD = 0.9234 EUR" */
export function formatFxRate(currencyCode: string, rate: number): string {
  if (currencyCode === 'USD' || rate === 1) return '1 USD = 1 USD';
  let formatted: string;
  if (rate >= 10000) formatted = Math.round(rate).toLocaleString('en-US');
  else if (rate >= 100) formatted = rate.toFixed(2);
  else if (rate >= 1)   formatted = rate.toFixed(4);
  else                  formatted = rate.toFixed(5);
  return `1 USD = ${formatted} ${currencyCode}`;
}

/** Y-axis label for the "USD per 1 CURRENCY" chart (inverted rate). */
export function formatUsdPerUnit(v: number): string {
  if (v >= 10)    return `$${v.toFixed(2)}`;
  if (v >= 1)     return `$${v.toFixed(3)}`;
  if (v >= 0.001) return `$${v.toFixed(4)}`;
  return `$${v.toExponential(2)}`;
}
