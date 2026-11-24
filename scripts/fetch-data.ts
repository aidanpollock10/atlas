import fs from 'fs';
import path from 'path';

interface RestCountryV2 {
  name: string;
  alpha2Code: string;
  alpha3Code: string;
  numericCode: string;
  capital: string;
  region: string;
  currencies: Array<{ code: string; name: string; symbol: string }>;
  flags: { svg: string; png: string };
  flag: string;
  latlng: number[];
  population: number;
}

interface WorldBankMeta {
  page: number;
  pages: number;
  per_page: number;
  total: number;
}

interface WorldBankEntry {
  country: { id: string; value: string };
  countryiso3code: string;
  date: string;
  value: number | null;
}

interface CountryData {
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
  // ── Fiscal ──────────────────────────────────────────────────────────────
  // Source: IMF DataMapper API (https://www.imf.org/external/datamapper/api/v1/)
  debtToGDP: number | null;         // GGXWDG_NGDP — General govt gross debt % of GDP
  debtHistory: Array<{ year: number; value: number | null }>; // same series, historical
  budgetBalance: number | null;     // GGXCNL_NGDP — Net lending (+) / borrowing (−) % GDP
  currentAccount: number | null;    // BCA_NGDPD   — Current-account balance % GDP
  // Source: World Bank API (https://api.worldbank.org/v2/)
  interestRate: number | null;      // FR.INR.LEND — Commercial lending interest rate %
}

function getFlagEmoji(countryCode: string): string {
  try {
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map((char) => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  } catch {
    return '';
  }
}

async function fetchJSON(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status} for ${url}`);
  }
  return response.json();
}

/** Fetch all pages of a World Bank indicator. */
async function fetchWorldBankAll(indicator: string, params: string): Promise<WorldBankEntry[]> {
  const results: WorldBankEntry[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&${params}&page=${page}`;
    console.log(`  Fetching ${indicator} page ${page}/${totalPages}...`);
    const raw = await fetchJSON(url) as [WorldBankMeta, WorldBankEntry[]];
    if (Array.isArray(raw) && raw.length > 1) {
      totalPages = raw[0].pages;
      if (Array.isArray(raw[1])) {
        results.push(...raw[1]);
      }
    }
    page++;
  } while (page <= totalPages);

  return results;
}

/** Build a map: ISO3 → most recent value. */
function buildLatestMap(entries: WorldBankEntry[]): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const entry of entries) {
    if (entry.countryiso3code) {
      // entries are returned newest-first by default with mrv=1
      if (!map.has(entry.countryiso3code)) {
        map.set(entry.countryiso3code, entry.value);
      }
    }
  }
  return map;
}

/** Build a map: ISO3 → { year → value } from historical series. */
function buildHistoryMap(entries: WorldBankEntry[]): Map<string, Map<number, number | null>> {
  const map = new Map<string, Map<number, number | null>>();
  for (const entry of entries) {
    if (!entry.countryiso3code || !entry.date) continue;
    const year = parseInt(entry.date, 10);
    if (isNaN(year)) continue;
    if (!map.has(entry.countryiso3code)) {
      map.set(entry.countryiso3code, new Map());
    }
    map.get(entry.countryiso3code)!.set(year, entry.value);
  }
  return map;
}

// ── IMF DataMapper API ────────────────────────────────────────────────────────
// Base URL: https://www.imf.org/external/datamapper/api/v1/{INDICATOR}
// Returns all countries in one call. Response: { values: { IND: { ISO3: { YEAR: value } } } }

interface ImfResponse {
  values: Record<string, Record<string, Record<string, number | null>>>;
}

/** Fetch all historical data for one IMF DataMapper indicator.
 *  Returns Map<ISO3, Map<year, value>>. */
async function fetchIMF(indicator: string): Promise<Map<string, Map<number, number | null>>> {
  const url = `https://www.imf.org/external/datamapper/api/v1/${indicator}`;
  console.log(`  Fetching IMF DataMapper: ${indicator}...`);
  let raw: ImfResponse;
  try {
    raw = await fetchJSON(url) as ImfResponse;
  } catch (err) {
    console.error(`  !! IMF fetch FAILED for ${indicator}: ${err}`);
    return new Map();
  }
  const map = new Map<string, Map<number, number | null>>();
  const countryData = raw?.values?.[indicator];
  if (!countryData) {
    console.error(`  !! IMF response for ${indicator} missing values key. Keys present: ${Object.keys(raw ?? {}).join(', ')}`);
    return map;
  }
  let countryCount = 0;
  for (const [iso3, yearObj] of Object.entries(countryData)) {
    if (!yearObj || typeof yearObj !== 'object') continue;
    const yearMap = new Map<number, number | null>();
    for (const [yr, val] of Object.entries(yearObj)) {
      const y = parseInt(yr, 10);
      if (!isNaN(y)) yearMap.set(y, val as number | null);
    }
    map.set(iso3, yearMap);
    countryCount++;
  }
  console.log(`  IMF ${indicator}: ${countryCount} countries`);
  return map;
}

/** Extract the most-recent non-null value from an IMF country year-map. */
function imfLatest(yearMap: Map<number, number | null> | undefined): number | null {
  if (!yearMap) return null;
  let bestYear = -1;
  let bestVal: number | null = null;
  for (const [yr, val] of yearMap.entries()) {
    if (val !== null && yr > bestYear) { bestYear = yr; bestVal = val; }
  }
  return bestVal;
}

async function main() {
  console.log('Fetching countries data from GitLab mirror...');
  const countriesRaw = await fetchJSON(
    'https://gitlab.com/amatos/rest-countries/-/raw/master/src/main/resources/countriesV2.json'
  ) as RestCountryV2[];

  if (!Array.isArray(countriesRaw)) {
    throw new Error('Expected array of countries');
  }
  console.log(`Got ${countriesRaw.length} countries`);

  // ── World Bank: current snapshots ────────────────────────────────────────
  console.log('\nFetching World Bank current indicators...');

  // per_page=5000 avoids multi-page pagination that can silently drop countries
  const gdpEntries = await fetchWorldBankAll('NY.GDP.MKTP.CD', 'per_page=5000&mrv=1');
  const gdpPerCapitaEntries = await fetchWorldBankAll('NY.GDP.PCAP.CD', 'per_page=5000&mrv=1');
  const gdpGrowthEntries = await fetchWorldBankAll('NY.GDP.MKTP.KD.ZG', 'per_page=5000&mrv=1');
  const inflationEntries = await fetchWorldBankAll('FP.CPI.TOTL.ZG', 'per_page=5000&mrv=1');
  const unemploymentEntries = await fetchWorldBankAll('SL.UEM.TOTL.ZS', 'per_page=5000&mrv=1');
  // Interest rate: World Bank FR.INR.LEND (commercial lending rate)
  const interestEntries = await fetchWorldBankAll('FR.INR.LEND', 'per_page=5000&mrv=1');

  const gdpMap = buildLatestMap(gdpEntries);
  const gdpPerCapitaMap = buildLatestMap(gdpPerCapitaEntries);
  const gdpGrowthMap = buildLatestMap(gdpGrowthEntries);
  const inflationMap = buildLatestMap(inflationEntries);
  const unemploymentMap = buildLatestMap(unemploymentEntries);
  const interestMap = buildLatestMap(interestEntries);

  // ── World Bank: historical GDP series (1990–present) ────────────────────
  console.log('\nFetching World Bank historical GDP series (1990–2024)...');
  const historyEntries = await fetchWorldBankAll(
    'NY.GDP.MKTP.CD',
    'per_page=10000&date=1990:2024'
  );
  const gdpHistoryMap = buildHistoryMap(historyEntries);

  // ── IMF DataMapper: fiscal indicators ───────────────────────────────────
  // GGXWDG_NGDP = General govt gross debt % of GDP
  // GGXCNL_NGDP = Net lending (+) / borrowing (−) % of GDP  (budget balance)
  // BCA_NGDPD   = Current-account balance % of GDP
  console.log('\nFetching IMF DataMapper fiscal indicators...');
  const imfDebtMap    = await fetchIMF('GGXWDG_NGDP');
  const imfBudgetMap  = await fetchIMF('GGXCNL_NGDP');
  const imfCurrAccMap = await fetchIMF('BCA_NGDPD');

  console.log(`\nGDP map: ${gdpMap.size}, GDP/cap: ${gdpPerCapitaMap.size}`);
  console.log(`GDP growth: ${gdpGrowthMap.size}, Inflation: ${inflationMap.size}, Unemployment: ${unemploymentMap.size}`);
  console.log(`Interest rate: ${interestMap.size}`);
  console.log(`GDP history countries: ${gdpHistoryMap.size}`);
  console.log(`IMF debt: ${imfDebtMap.size}, budget: ${imfBudgetMap.size}, curr-acc: ${imfCurrAccMap.size}`);

  // ── Merge ────────────────────────────────────────────────────────────────
  const merged: CountryData[] = [];
  const histYears: number[] = [];
  for (let y = 1990; y <= 2024; y++) histYears.push(y);

  for (const country of countriesRaw) {
    if (!country.alpha2Code || !country.latlng || country.latlng.length < 2) continue;

    const code2 = country.alpha2Code;
    const code3 = country.alpha3Code || '';
    const numericCode = country.numericCode || '';

    let currency = { code: '', name: '', symbol: '' };
    if (country.currencies && country.currencies.length > 0) {
      const curr = country.currencies[0];
      currency = { code: curr.code || '', name: curr.name || '', symbol: curr.symbol || '' };
    }

    const flagEmoji = getFlagEmoji(code2);
    const flagUrl = country.flags?.png || country.flags?.svg || country.flag || '';

    // Build history array (only include years with data; skip trailing nulls)
    const yearMap = gdpHistoryMap.get(code3);
    const gdpHistory: Array<{ year: number; value: number | null }> = [];
    if (yearMap) {
      for (const year of histYears) {
        const val = yearMap.has(year) ? yearMap.get(year)! : null;
        gdpHistory.push({ year, value: val ?? null });
      }
      // Trim leading nulls
      while (gdpHistory.length > 0 && gdpHistory[0].value === null) gdpHistory.shift();
    }

    // IMF uses ISO3 codes matching World Bank; build debt history array
    const debtYearMap = imfDebtMap.get(code3);
    const debtHistory: Array<{ year: number; value: number | null }> = [];
    if (debtYearMap) {
      for (const year of histYears) {
        debtHistory.push({ year, value: debtYearMap.has(year) ? (debtYearMap.get(year) ?? null) : null });
      }
      while (debtHistory.length > 0 && debtHistory[0].value === null) debtHistory.shift();
    }

    merged.push({
      code: code2,
      code3,
      numericCode,
      name: country.name,
      region: country.region || '',
      capital: country.capital || '',
      currency,
      flag: flagEmoji,
      flagUrl,
      lat: country.latlng[0],
      lng: country.latlng[1],
      population: country.population || 0,
      gdp: gdpMap.get(code3) ?? null,
      gdpPerCapita: gdpPerCapitaMap.get(code3) ?? null,
      gdpGrowth: gdpGrowthMap.get(code3) ?? null,
      inflation: inflationMap.get(code3) ?? null,
      unemployment: unemploymentMap.get(code3) ?? null,
      gdpHistory,
      debtToGDP: imfLatest(imfDebtMap.get(code3)),
      debtHistory,
      budgetBalance: imfLatest(imfBudgetMap.get(code3)),
      currentAccount: imfLatest(imfCurrAccMap.get(code3)),
      interestRate: interestMap.get(code3) ?? null,
    });
  }

  console.log(`\nMerged ${merged.length} countries`);

  const outputPath = path.join(process.cwd(), 'data', 'countries.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2));
  console.log(`Saved to ${outputPath}`);

  const withGDP = merged.filter(c => c.gdp !== null).length;
  const withHistory = merged.filter(c => c.gdpHistory.length > 0).length;
  const withDebt = merged.filter(c => c.debtToGDP !== null).length;
  const withBudget = merged.filter(c => c.budgetBalance !== null).length;
  const withCurrAcc = merged.filter(c => c.currentAccount !== null).length;
  console.log(`Countries with GDP: ${withGDP}/${merged.length}`);
  console.log(`Countries with GDP history: ${withHistory}/${merged.length}`);
  console.log(`Countries with debt/GDP: ${withDebt}/${merged.length}`);
  console.log(`Countries with budget balance: ${withBudget}/${merged.length}`);
  console.log(`Countries with current account: ${withCurrAcc}/${merged.length}`);

  const usa = merged.find(c => c.code === 'US');
  if (usa) {
    const sample = { ...usa, gdpHistory: `[${usa.gdpHistory.length} entries]` };
    console.log('\nSample (USA):', JSON.stringify(sample, null, 2));
  }
}

main().catch(console.error);
