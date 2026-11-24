/**
 * scripts/fetch-data.ts
 * Builds data/countries.json and data/meta.json.
 *
 * Data sources (in priority order for each indicator):
 *   Primary:  IMF DataMapper API  https://www.imf.org/external/datamapper/api/v1/
 *             → includes current-year estimates; response covers all countries in one call
 *   Fallback: World Bank API      https://api.worldbank.org/v2/
 *             → validated actuals, lags 1-2 years behind IMF
 *
 * IMF series used:
 *   NGDPD       GDP, current prices (USD billions)
 *   NGDPDPC     GDP per capita, current prices (USD)
 *   NGDP_RPCH   Real GDP growth rate (%)
 *   PCPIPCH     Inflation, average consumer prices (% change)
 *   LUR         Unemployment rate (% of labor force)
 *   GGXWDG_NGDP Gross govt debt (% of GDP)
 *   GGXCNL_NGDP Net lending/borrowing (% of GDP)  [budget balance]
 *   BCA_NGDPD   Current-account balance (% of GDP)
 *
 * World Bank series used:
 *   NY.GDP.MKTP.CD   GDP current USD (fallback for NGDPD)
 *   NY.GDP.PCAP.CD   GDP per capita USD (fallback for NGDPDPC)
 *   NY.GDP.MKTP.KD.ZG GDP growth % (fallback for NGDP_RPCH)
 *   FP.CPI.TOTL.ZG   Inflation CPI % (fallback for PCPIPCH)
 *   SL.UEM.TOTL.ZS   Unemployment % (fallback for LUR)
 *   FR.INR.LEND      Commercial lending rate % (WB-only, no IMF equivalent)
 *   NY.GDP.MKTP.CD   Historical GDP series (1990–present)
 */

import fs   from 'fs';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RestCountryV2 {
  name: string; alpha2Code: string; alpha3Code: string; numericCode: string;
  capital: string; region: string;
  currencies: Array<{ code: string; name: string; symbol: string }>;
  flags: { svg: string; png: string }; flag: string; latlng: number[];
  population: number;
}

interface WbMeta  { page: number; pages: number; per_page: number; total: number; }
interface WbEntry { country: { id: string; value: string }; countryiso3code: string; date: string; value: number | null; }
interface ImfResponse { values: Record<string, Record<string, Record<string, number | null>>>; }

/** Per-indicator provenance stored alongside each value. */
export interface IndicatorMeta {
  year: number;
  est:  boolean;   // true when year >= currentYear (IMF estimate, not finalized)
  src:  'IMF' | 'WB';
}

interface CountryData {
  code: string; code3: string; numericCode: string; name: string;
  region: string; capital: string;
  currency: { code: string; name: string; symbol: string };
  flag: string; flagUrl: string; lat: number; lng: number; population: number;
  gdp:          number | null;
  gdpPerCapita: number | null;
  gdpGrowth:    number | null;
  inflation:    number | null;
  unemployment: number | null;
  gdpHistory:   Array<{ year: number; value: number | null }>;
  debtToGDP:     number | null;
  debtHistory:   Array<{ year: number; value: number | null }>;
  budgetBalance: number | null;
  currentAccount:number | null;
  interestRate:  number | null;
  /** Year, source, and estimate flag for each indicator. */
  meta: {
    gdp:           IndicatorMeta | null;
    gdpPerCapita:  IndicatorMeta | null;
    gdpGrowth:     IndicatorMeta | null;
    inflation:     IndicatorMeta | null;
    unemployment:  IndicatorMeta | null;
    debtToGDP:     IndicatorMeta | null;
    budgetBalance: IndicatorMeta | null;
    currentAccount:IndicatorMeta | null;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFlagEmoji(code: string): string {
  try {
    return String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0)));
  } catch { return ''; }
}

async function fetchJSON(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

async function fetchWorldBankAll(indicator: string, params: string): Promise<WbEntry[]> {
  const results: WbEntry[] = [];
  let page = 1, totalPages = 1;
  do {
    const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&${params}&page=${page}`;
    console.log(`  WB ${indicator} p${page}/${totalPages}…`);
    const raw = await fetchJSON(url) as [WbMeta, WbEntry[]];
    if (Array.isArray(raw) && raw.length > 1) {
      totalPages = raw[0].pages;
      if (Array.isArray(raw[1])) results.push(...raw[1]);
    }
    page++;
  } while (page <= totalPages);
  return results;
}

/** Returns Map<ISO3, { value, year }> — the most-recent non-null entry per country. */
function wbLatestMap(entries: WbEntry[]): Map<string, { value: number | null; year: number }> {
  const map = new Map<string, { value: number | null; year: number }>();
  for (const e of entries) {
    if (!e.countryiso3code || !e.date) continue;
    if (!map.has(e.countryiso3code)) {
      map.set(e.countryiso3code, { value: e.value, year: parseInt(e.date, 10) });
    }
  }
  return map;
}

function wbHistoryMap(entries: WbEntry[]): Map<string, Map<number, number | null>> {
  const map = new Map<string, Map<number, number | null>>();
  for (const e of entries) {
    if (!e.countryiso3code || !e.date) continue;
    const y = parseInt(e.date, 10);
    if (isNaN(y)) continue;
    if (!map.has(e.countryiso3code)) map.set(e.countryiso3code, new Map());
    map.get(e.countryiso3code)!.set(y, e.value);
  }
  return map;
}

async function fetchIMF(indicator: string): Promise<Map<string, Map<number, number | null>>> {
  const url = `https://www.imf.org/external/datamapper/api/v1/${indicator}`;
  console.log(`  IMF ${indicator}…`);
  let raw: ImfResponse;
  try {
    raw = await fetchJSON(url) as ImfResponse;
  } catch (err) {
    console.error(`  !! IMF ${indicator} failed: ${err}`);
    return new Map();
  }
  const map = new Map<string, Map<number, number | null>>();
  const data = raw?.values?.[indicator];
  if (!data) { console.error(`  !! IMF ${indicator}: no values key`); return map; }
  for (const [iso3, yearObj] of Object.entries(data)) {
    if (!yearObj || typeof yearObj !== 'object') continue;
    const ym = new Map<number, number | null>();
    for (const [yr, val] of Object.entries(yearObj)) {
      const y = parseInt(yr, 10);
      if (!isNaN(y)) ym.set(y, (typeof val === 'number' && isFinite(val)) ? val : null);
    }
    map.set(iso3, ym);
  }
  console.log(`  IMF ${indicator}: ${map.size} countries`);
  return map;
}

/**
 * Get the most-recent non-null IMF value up to maxYear (inclusive).
 * Returns { value, year } or { value: null, year: null }.
 */
function imfLatest(
  ym: Map<number, number | null> | undefined,
  maxYear: number
): { value: number | null; year: number | null } {
  if (!ym) return { value: null, year: null };
  let bestY = -1, bestV: number | null = null;
  for (const [y, v] of ym) {
    if (v !== null && y <= maxYear && y > bestY) { bestY = y; bestV = v; }
  }
  return bestV !== null ? { value: bestV, year: bestY } : { value: null, year: null };
}

/**
 * Choose the better of two candidate values (IMF preferred; WB as fallback).
 * "Better" = non-null AND most recent year.
 * IMF wins ties (same year → prefer IMF).
 */
function pickBest(
  imf: { value: number | null; year: number | null },
  wb:  { value: number | null; year: number | null },
  currentYear: number,
  imfScale = 1   // multiply IMF value (e.g. 1e9 to convert billions → dollars)
): { value: number | null; year: number | null; src: 'IMF' | 'WB' | null; est: boolean } {
  const iv = imf.value !== null ? imf.value * imfScale : null;
  const iy = imf.year;
  const wv = wb.value;
  const wy = wb.year;

  // IMF wins if it has a value and year >= WB year (or WB has nothing)
  if (iv !== null && iy !== null) {
    if (wv === null || wy === null || iy >= wy) {
      return { value: iv, year: iy, src: 'IMF', est: iy >= currentYear };
    }
  }
  // WB wins
  if (wv !== null && wy !== null) {
    return { value: wv, year: wy, src: 'WB', est: false };
  }
  // IMF as last resort (even if older than WB year that had null)
  if (iv !== null && iy !== null) {
    return { value: iv, year: iy, src: 'IMF', est: iy >= currentYear };
  }
  return { value: null, year: null, src: null, est: false };
}

function makeMeta(r: ReturnType<typeof pickBest>): IndicatorMeta | null {
  if (r.value === null || r.year === null || r.src === null) return null;
  return { year: r.year, est: r.est, src: r.src };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const NOW       = new Date();
  const NOW_YEAR  = NOW.getFullYear();
  const TODAY_STR = NOW.toISOString().split('T')[0];
  const HIST_END  = NOW_YEAR;   // include current year in history fetch

  console.log(`=== fetch-data  ${TODAY_STR}  (currentYear=${NOW_YEAR}) ===\n`);

  // ── 1. Country metadata ──────────────────────────────────────────────────
  console.log('Fetching country list…');
  const countriesRaw = await fetchJSON(
    'https://gitlab.com/amatos/rest-countries/-/raw/master/src/main/resources/countriesV2.json'
  ) as RestCountryV2[];
  console.log(`Got ${countriesRaw.length} countries`);

  // ── 2. IMF DataMapper (primary source) ──────────────────────────────────
  console.log('\n── IMF DataMapper ──────────────────────────────────────────────');
  const [imfGDP, imfGDPcap, imfGDPgrowth, imfInfl, imfUnemp,
         imfDebt, imfBudget, imfCurrAcc] = await Promise.all([
    fetchIMF('NGDPD'),
    fetchIMF('NGDPDPC'),
    fetchIMF('NGDP_RPCH'),
    fetchIMF('PCPIPCH'),
    fetchIMF('LUR'),
    fetchIMF('GGXWDG_NGDP'),
    fetchIMF('GGXCNL_NGDP'),
    fetchIMF('BCA_NGDPD'),
  ]);

  // ── 3. World Bank (fallback + history) ──────────────────────────────────
  console.log('\n── World Bank ──────────────────────────────────────────────────');
  const [wbGDPe, wbGDPcape, wbGrowthe, wbInfle, wbUnempe, wbIntrste] = await Promise.all([
    fetchWorldBankAll('NY.GDP.MKTP.CD',    'per_page=5000&mrv=1'),
    fetchWorldBankAll('NY.GDP.PCAP.CD',    'per_page=5000&mrv=1'),
    fetchWorldBankAll('NY.GDP.MKTP.KD.ZG', 'per_page=5000&mrv=1'),
    fetchWorldBankAll('FP.CPI.TOTL.ZG',    'per_page=5000&mrv=1'),
    fetchWorldBankAll('SL.UEM.TOTL.ZS',    'per_page=5000&mrv=1'),
    fetchWorldBankAll('FR.INR.LEND',        'per_page=5000&mrv=1'),
  ]);

  const wbGDP      = wbLatestMap(wbGDPe);
  const wbGDPcap   = wbLatestMap(wbGDPcape);
  const wbGrowth   = wbLatestMap(wbGrowthe);
  const wbInfl     = wbLatestMap(wbInfle);
  const wbUnemp    = wbLatestMap(wbUnempe);
  const wbIntRate  = wbLatestMap(wbIntrste);

  // GDP history (World Bank, 1990–current year)
  console.log(`\nFetching WB GDP history 1990–${HIST_END}…`);
  const histEntries = await fetchWorldBankAll(
    'NY.GDP.MKTP.CD',
    `per_page=10000&date=1990:${HIST_END}`
  );
  const gdpHistMap = wbHistoryMap(histEntries);

  // Debt history (IMF)
  // imfDebt already fetched above

  console.log(`\nSummary:`);
  console.log(`  IMF GDP: ${imfGDP.size}, GDPcap: ${imfGDPcap.size}, Growth: ${imfGDPgrowth.size}`);
  console.log(`  IMF Infl: ${imfInfl.size}, Unemp: ${imfUnemp.size}`);
  console.log(`  IMF Debt: ${imfDebt.size}, Budget: ${imfBudget.size}, CurrAcc: ${imfCurrAcc.size}`);
  console.log(`  WB GDP: ${wbGDP.size}, GDPcap: ${wbGDPcap.size}, Growth: ${wbGrowth.size}`);
  console.log(`  WB Infl: ${wbInfl.size}, Unemp: ${wbUnemp.size}, IntRate: ${wbIntRate.size}`);
  console.log(`  WB GDP history: ${gdpHistMap.size} countries`);

  // ── 4. Merge ─────────────────────────────────────────────────────────────
  const histYears: number[] = [];
  for (let y = 1990; y <= HIST_END; y++) histYears.push(y);

  const merged: CountryData[] = [];

  for (const c of countriesRaw) {
    if (!c.alpha2Code || !c.latlng || c.latlng.length < 2) continue;
    const code2 = c.alpha2Code;
    const code3 = c.alpha3Code || '';

    // Build GDP history
    const ym = gdpHistMap.get(code3);
    const gdpHistory: Array<{ year: number; value: number | null }> = [];
    if (ym) {
      for (const y of histYears) gdpHistory.push({ year: y, value: ym.get(y) ?? null });
      while (gdpHistory.length > 0 && gdpHistory[0].value === null) gdpHistory.shift();
    }

    // Build debt history (from IMF)
    const dym = imfDebt.get(code3);
    const debtHistory: Array<{ year: number; value: number | null }> = [];
    if (dym) {
      for (const y of histYears) {
        debtHistory.push({ year: y, value: dym.has(y) ? (dym.get(y) ?? null) : null });
      }
      while (debtHistory.length > 0 && debtHistory[0].value === null) debtHistory.shift();
    }

    // ── Indicator resolution (IMF primary, WB fallback) ────────────────
    // GDP: IMF gives billions USD → multiply by 1e9; WB gives USD
    const rGDP = pickBest(
      imfLatest(imfGDP.get(code3), NOW_YEAR),
      { value: wbGDP.get(code3)?.value ?? null, year: wbGDP.get(code3)?.year ?? null },
      NOW_YEAR, 1e9
    );
    const rGDPcap = pickBest(
      imfLatest(imfGDPcap.get(code3), NOW_YEAR),
      { value: wbGDPcap.get(code3)?.value ?? null, year: wbGDPcap.get(code3)?.year ?? null },
      NOW_YEAR
    );
    const rGrowth = pickBest(
      imfLatest(imfGDPgrowth.get(code3), NOW_YEAR),
      { value: wbGrowth.get(code3)?.value ?? null, year: wbGrowth.get(code3)?.year ?? null },
      NOW_YEAR
    );
    const rInfl = pickBest(
      imfLatest(imfInfl.get(code3), NOW_YEAR),
      { value: wbInfl.get(code3)?.value ?? null, year: wbInfl.get(code3)?.year ?? null },
      NOW_YEAR
    );
    const rUnemp = pickBest(
      imfLatest(imfUnemp.get(code3), NOW_YEAR),
      { value: wbUnemp.get(code3)?.value ?? null, year: wbUnemp.get(code3)?.year ?? null },
      NOW_YEAR
    );
    const rDebt = pickBest(
      imfLatest(imfDebt.get(code3), NOW_YEAR),
      { value: null, year: null },   // no WB fallback for debt
      NOW_YEAR
    );
    const rBudget = pickBest(
      imfLatest(imfBudget.get(code3), NOW_YEAR),
      { value: null, year: null },
      NOW_YEAR
    );
    const rCurrAcc = pickBest(
      imfLatest(imfCurrAcc.get(code3), NOW_YEAR),
      { value: null, year: null },
      NOW_YEAR
    );

    // Interest rate is WB-only
    const wbIR = wbIntRate.get(code3);

    let currency = { code: '', name: '', symbol: '' };
    if (c.currencies?.length) {
      const cr = c.currencies[0];
      currency = { code: cr.code || '', name: cr.name || '', symbol: cr.symbol || '' };
    }

    merged.push({
      code: code2, code3,
      numericCode: c.numericCode || '',
      name: c.name,
      region: c.region || '',
      capital: c.capital || '',
      currency,
      flag: getFlagEmoji(code2),
      flagUrl: c.flags?.png || c.flags?.svg || c.flag || '',
      lat: c.latlng[0], lng: c.latlng[1],
      population: c.population || 0,
      gdp:          rGDP.value,
      gdpPerCapita: rGDPcap.value,
      gdpGrowth:    rGrowth.value,
      inflation:    rInfl.value,
      unemployment: rUnemp.value,
      gdpHistory,
      debtToGDP:     rDebt.value,
      debtHistory,
      budgetBalance: rBudget.value,
      currentAccount:rCurrAcc.value,
      interestRate:  wbIR?.value ?? null,
      meta: {
        gdp:           makeMeta(rGDP),
        gdpPerCapita:  makeMeta(rGDPcap),
        gdpGrowth:     makeMeta(rGrowth),
        inflation:     makeMeta(rInfl),
        unemployment:  makeMeta(rUnemp),
        debtToGDP:     makeMeta(rDebt),
        budgetBalance: makeMeta(rBudget),
        currentAccount:makeMeta(rCurrAcc),
      },
    });
  }

  console.log(`\nMerged ${merged.length} countries`);

  // ── 5. Write countries.json ───────────────────────────────────────────────
  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'countries.json'), JSON.stringify(merged, null, 2));
  console.log('Wrote data/countries.json');

  // ── 6. Write meta.json ───────────────────────────────────────────────────
  const metaOut = {
    fetchedAt: TODAY_STR,
    gdpHistoryThrough: HIST_END,
    sources: {
      primary:  'IMF World Economic Outlook DataMapper API',
      fallback: 'World Bank Open Data',
      trade:    'OEC / BACI',
      fx:       'Frankfurter (ECB) + open.er-api.com + World Bank PA.NUS.FCRF',
    },
  };
  fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify(metaOut, null, 2));
  console.log('Wrote data/meta.json');

  // ── 7. Stats + sample ────────────────────────────────────────────────────
  const withGDP    = merged.filter(c => c.gdp            !== null).length;
  const withGrowth = merged.filter(c => c.gdpGrowth      !== null).length;
  const withInfl   = merged.filter(c => c.inflation      !== null).length;
  const withUnemp  = merged.filter(c => c.unemployment   !== null).length;
  const withDebt   = merged.filter(c => c.debtToGDP      !== null).length;
  console.log(`\nCoverage: GDP ${withGDP}, growth ${withGrowth}, infl ${withInfl}, unemp ${withUnemp}, debt ${withDebt}`);

  for (const code2 of ['US', 'DE', 'CN', 'BR']) {
    const c = merged.find(x => x.code === code2);
    if (!c) continue;
    console.log(`\n${code2} (${c.name}):`);
    console.log(`  gdp:          ${c.gdp?.toExponential(3)} | ${c.meta.gdp?.year} ${c.meta.gdp?.est ? 'est' : 'act'} [${c.meta.gdp?.src}]`);
    console.log(`  gdpGrowth:    ${c.gdpGrowth?.toFixed(2)}% | ${c.meta.gdpGrowth?.year} ${c.meta.gdpGrowth?.est ? 'est' : 'act'} [${c.meta.gdpGrowth?.src}]`);
    console.log(`  inflation:    ${c.inflation?.toFixed(2)}% | ${c.meta.inflation?.year} ${c.meta.inflation?.est ? 'est' : 'act'} [${c.meta.inflation?.src}]`);
    console.log(`  unemployment: ${c.unemployment?.toFixed(2)}% | ${c.meta.unemployment?.year} ${c.meta.unemployment?.est ? 'est' : 'act'} [${c.meta.unemployment?.src}]`);
    console.log(`  debtToGDP:    ${c.debtToGDP?.toFixed(1)}% | ${c.meta.debtToGDP?.year} ${c.meta.debtToGDP?.est ? 'est' : 'act'} [${c.meta.debtToGDP?.src}]`);
    console.log(`  budgetBal:    ${c.budgetBalance?.toFixed(1)}% | ${c.meta.budgetBalance?.year} ${c.meta.budgetBalance?.est ? 'est' : 'act'} [${c.meta.budgetBalance?.src}]`);
    console.log(`  currAccount:  ${c.currentAccount?.toFixed(1)}% | ${c.meta.currentAccount?.year} ${c.meta.currentAccount?.est ? 'est' : 'act'} [${c.meta.currentAccount?.src}]`);
  }
}

main().catch(console.error);
