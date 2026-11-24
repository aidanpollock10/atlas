/**
 * scripts/fetch-fx.ts
 * Builds data/fx.json — 10-year monthly/annual FX history keyed by currency code.
 *
 * Sources (all free, no API key):
 *   1. Frankfurter (https://api.frankfurter.app) — ECB data, 32 currencies, MONTHLY history
 *   2. open.er-api.com (https://open.er-api.com/v6/latest/USD) — 170+ currencies, CURRENT rate
 *   3. World Bank PA.NUS.FCRF — official exchange rate LCU/USD, 150+ countries, ANNUAL history
 *
 * Strategy:
 *   • Frankfurter currencies get monthly history (smooth chart, precise).
 *   • All other currencies get current rate from open.er-api.com +
 *     annual history from World Bank (annual chart, still sufficient for 1Y/5Y changes).
 *   • currency→ISO3 mapping is read from data/countries.json so World Bank
 *     country-keyed data can be matched to currency codes.
 *
 * Output schema: { [currencyCode]: { rate: number, history: [{date:"YYYY-MM", rate},...] } }
 *   rate = units of currency per 1 USD.
 */

import fs   from 'fs';
import path from 'path';

const BASE_FKFTR = 'https://api.frankfurter.app';
const BASE_WB    = 'https://api.worldbank.org/v2';
const BASE_OER   = 'https://open.er-api.com/v6/latest/USD';
const YEARS      = 10;

// ── Shared types ─────────────────────────────────────────────────────────────

interface FxEntry {
  rate: number;
  history: Array<{ date: string; rate: number }>;
}

interface FrankfurterLatest {
  amount: number; base: string; date: string;
  rates: Record<string, number>;
}
interface FrankfurterSeries {
  amount: number; base: string; start_date: string; end_date: string;
  rates: Record<string, Record<string, number>>;
}
interface OerResponse {
  result: string; base_code: string; time_last_update_utc: string;
  rates: Record<string, number>;
}
interface WbMeta  { page: number; pages: number; per_page: number; total: number; }
interface WbEntry { country: { id: string; value: string }; countryiso3code: string; date: string; value: number | null; }

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function isoYM(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function fetchWbAll(indicator: string, dateRange: string): Promise<WbEntry[]> {
  const results: WbEntry[] = [];
  let page = 1, totalPages = 1;
  do {
    const url = `${BASE_WB}/country/all/indicator/${indicator}?format=json&date=${dateRange}&per_page=5000&page=${page}`;
    console.log(`  WB ${indicator} p${page}/${totalPages}...`);
    const raw = await fetchJSON(url) as [WbMeta, WbEntry[]];
    if (Array.isArray(raw) && raw[1]) {
      totalPages = raw[0].pages;
      results.push(...raw[1].filter(e => e.value !== null));
    }
    page++;
  } while (page <= totalPages);
  return results;
}

// ── Build currency → ISO3 map from countries.json ────────────────────────────

function buildCurrencyToISO3(): Map<string, string> {
  const countriesPath = path.join(process.cwd(), 'data', 'countries.json');
  const raw = JSON.parse(fs.readFileSync(countriesPath, 'utf-8')) as
    Array<{ code3: string; currency: { code: string } }>;
  const map = new Map<string, string>();
  for (const c of raw) {
    if (c.currency?.code && c.code3 && !map.has(c.currency.code)) {
      map.set(c.currency.code, c.code3);
    }
  }
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const now       = new Date();
  const startYear = now.getFullYear() - YEARS;
  const todayStr  = now.toISOString().split('T')[0];

  console.log(`=== fetch-fx  (${todayStr},  ${YEARS} years back to ${startYear}) ===\n`);

  const out: Record<string, FxEntry> = {};

  // ════════════════════════════════════════════════════════════════════════════
  // 1. FRANKFURTER — 32 ECB currencies, monthly history
  // ════════════════════════════════════════════════════════════════════════════
  console.log('── Frankfurter (ECB) ──────────────────────────────────────────');

  let frankfurterCodes: string[] = [];
  const monthlyRates: Record<string, Record<string, number>> = {};

  try {
    const latest = await fetchJSON(`${BASE_FKFTR}/latest?from=USD`) as FrankfurterLatest;
    frankfurterCodes = Object.keys(latest.rates);
    console.log(`  Currencies: ${frankfurterCodes.join(', ')}`);

    // Store current rates immediately
    for (const [code, rate] of Object.entries(latest.rates)) {
      out[code] = { rate, history: [] };
    }

    // Monthly history — one request per year
    for (let y = startYear; y <= now.getFullYear(); y++) {
      const start = `${y}-01-01`;
      const end   = y === now.getFullYear() ? todayStr : `${y}-12-31`;
      try {
        const series = await fetchJSON(`${BASE_FKFTR}/${start}..${end}?from=USD`) as FrankfurterSeries;
        for (const [dateStr, rates] of Object.entries(series.rates).sort()) {
          const [yr, mo] = dateStr.split('-');
          const key = `${yr}-${mo}`;
          if (!monthlyRates[key]) monthlyRates[key] = rates;
        }
      } catch (e) { console.warn(`  Frankfurter ${y} failed: ${e}`); }
      if (y < now.getFullYear()) await sleep(250);
    }

    const months = Object.keys(monthlyRates).sort();
    console.log(`  Monthly samples: ${months.length}`);

    for (const code of frankfurterCodes) {
      const history: FxEntry['history'] = [];
      for (const m of months) {
        const r = monthlyRates[m]?.[code];
        if (r != null && r > 0) history.push({ date: m, rate: r });
      }
      out[code] = { rate: out[code]?.rate ?? history[history.length - 1]?.rate ?? 0, history };
    }
    console.log(`  ✓ ${frankfurterCodes.length} currencies with monthly history`);
  } catch (e) { console.error('  Frankfurter failed:', e); }

  // ════════════════════════════════════════════════════════════════════════════
  // 2. OPEN.ER-API — current rates for 170+ currencies (fallback / supplement)
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n── open.er-api.com (current rates) ───────────────────────────');

  const oerRates: Record<string, number> = {};
  try {
    const oer = await fetchJSON(BASE_OER) as OerResponse;
    if (oer.result === 'success') {
      Object.assign(oerRates, oer.rates);
      // Fill in any Frankfurter gaps / add non-Frankfurter currencies
      for (const [code, rate] of Object.entries(oer.rates)) {
        if (!out[code] && rate > 0) {
          out[code] = { rate, history: [] };
        }
      }
      console.log(`  ✓ ${Object.keys(oer.rates).length} current rates (${Object.keys(out).length} total so far)`);
    }
  } catch (e) { console.error('  open.er-api failed:', e); }

  // ════════════════════════════════════════════════════════════════════════════
  // 3. WORLD BANK PA.NUS.FCRF — annual history keyed by country ISO3
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n── World Bank PA.NUS.FCRF (annual history) ───────────────────');

  try {
    const currToISO3 = buildCurrencyToISO3();
    console.log(`  Currency→ISO3 map: ${currToISO3.size} entries`);

    // Build reverse: ISO3 → currency code
    const iso3ToCurr = new Map<string, string>();
    for (const [curr, iso3] of currToISO3) iso3ToCurr.set(iso3, curr);

    const wbEntries = await fetchWbAll('PA.NUS.FCRF', `${startYear}:${now.getFullYear()}`);
    console.log(`  Raw entries: ${wbEntries.length}`);

    // Group: currency code → year → rate
    const wbAnnual = new Map<string, Map<number, number>>();
    let mapped = 0, skipped = 0;

    for (const entry of wbEntries) {
      const iso3 = entry.countryiso3code;
      const curr = iso3ToCurr.get(iso3);
      if (!curr || entry.value === null || entry.value <= 0) { skipped++; continue; }
      const year = parseInt(entry.date, 10);
      if (isNaN(year)) continue;
      if (!wbAnnual.has(curr)) wbAnnual.set(curr, new Map());
      // Keep the most recent entry (entries come newest-first from WB)
      if (!wbAnnual.get(curr)!.has(year)) {
        wbAnnual.get(curr)!.set(year, entry.value);
        mapped++;
      }
    }
    console.log(`  Mapped ${mapped} entries to ${wbAnnual.size} currency codes (skipped ${skipped})`);

    // Merge annual history into out[] for currencies that need it
    let newHistories = 0;
    for (const [curr, yearMap] of wbAnnual) {
      if (frankfurterCodes.includes(curr)) continue; // already have monthly data

      const history: FxEntry['history'] = [];
      for (const year of Array.from(yearMap.keys()).sort((a, b) => a - b)) {
        const r = yearMap.get(year)!;
        if (r > 0) history.push({ date: `${year}-01`, rate: r });
      }

      if (!out[curr]) {
        // No current rate yet — use most recent WB value
        const latestRate = oerRates[curr] ?? history[history.length - 1]?.rate;
        if (latestRate) out[curr] = { rate: latestRate, history };
      } else {
        // Update history (keep current rate from OER)
        out[curr].history = history;
      }
      if (history.length > 0) newHistories++;
    }
    console.log(`  ✓ Added annual history to ${newHistories} non-Frankfurter currencies`);
  } catch (e) { console.error('  World Bank failed:', e); }

  // ════════════════════════════════════════════════════════════════════════════
  // 4. Write output
  // ════════════════════════════════════════════════════════════════════════════
  const outPath = path.join(process.cwd(), 'data', 'fx.json');
  fs.writeFileSync(outPath, JSON.stringify(out));

  const withHistory = Object.values(out).filter(e => e.history.length > 0).length;
  const withCurrent = Object.values(out).filter(e => e.rate > 0).length;
  console.log(`\n════════════════════════════════════════`);
  console.log(`Total currencies in fx.json  : ${Object.keys(out).length}`);
  console.log(`  with current rate          : ${withCurrent}`);
  console.log(`  with history (≥1 point)    : ${withHistory}`);
  console.log(`  Frankfurter (monthly)      : ${frankfurterCodes.length}`);

  // Sample check
  for (const code of ['EUR', 'JPY', 'SAR', 'XOF', 'NGN']) {
    const e = out[code];
    if (e) console.log(`  ${code}: rate=${e.rate.toFixed(4)}, history=${e.history.length}pts`);
    else   console.log(`  ${code}: MISSING`);
  }
  console.log(`Wrote ${outPath}`);
}

main().catch(console.error);
