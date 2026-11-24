/**
 * scripts/fetch-trade.ts
 * Builds data/trade.json — top-5 bilateral trade partners per country.
 *
 * Source: OEC (Observatory of Economic Complexity) Tesseract API
 *   https://api.oec.world/tesseract/
 *   Data: BACI (CEPII) HS92 trade dataset, 1995–2024, values in current USD.
 *   Free, no API key required.
 *
 * Strategy:
 *   • Fetch all 32k bilateral trade flows for a single year in paginated chunks.
 *   • OEC country ID format: "{2-char region prefix}{3-char lowercase ISO3}"
 *     e.g., "nausa" → ISO3 "USA", "eudeu" → "DEU", "aschn" → "CHN"
 *   • Aggregate in-memory: total exports/imports per country + top-5 partners.
 *
 * Output schema:
 *   { [iso3]: { year, exports, imports, exportPartners[5], importPartners[5] } }
 */

import fs   from 'fs';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TradePartner {
  code:  string;
  name:  string;
  value: number;   // USD
  share: number;   // 0–100
}

interface CountryTrade {
  year:           number;
  exports:        number | null;
  imports:        number | null;
  exportPartners: TradePartner[];
  importPartners: TradePartner[];
}

type TradeOutput = Record<string, CountryTrade>;

interface OecRow {
  'Exporter Country ID': string;
  'Exporter Country':    string;
  'Importer Country ID': string;
  'Importer Country':    string;
  'Trade Value':         number;
}

interface OecResponse {
  page?: { limit: number; offset: number; total: number };
  data?: OecRow[];
}

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_OEC  = 'https://api.oec.world/tesseract/data.jsonrecords';
const CUBE      = 'trade_i_baci_a_92';
const YEAR      = 2023;   // try 2023; script falls back to 2022 if no rows returned
const YEAR_FB   = 2022;   // fallback year
const LIMIT     = 50_000; // larger than the ~32k total — fetches everything in one call
const TOP_N     = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

/** OEC country ID → ISO3: last 3 chars uppercased.  "nausa" → "USA" */
function oecToISO3(oecId: string): string {
  return oecId.slice(-3).toUpperCase();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Load known ISO3 codes from countries.json ────────────────────────────
  const countriesPath = path.join(process.cwd(), 'data', 'countries.json');
  const countriesRaw  = JSON.parse(fs.readFileSync(countriesPath, 'utf-8')) as
    Array<{ code3: string; name: string }>;
  const validISO3  = new Set(countriesRaw.map(c => c.code3).filter(Boolean));
  const nameByISO3 = new Map(countriesRaw.map(c => [c.code3, c.name]));

  console.log(`=== fetch-trade  (BACI ${YEAR}/${YEAR_FB} via OEC Tesseract API) ===\n`);
  console.log(`Known countries: ${validISO3.size}`);

  // ── Fetch all bilateral trade pairs (single request) ─────────────────────
  // The OEC Tesseract API offset parameter does not advance on this cube;
  // using limit > total retrieves everything in one call (~700 ms).
  console.log('\nFetching all bilateral pairs...');
  // Try YEAR first; fall back to YEAR_FB if no rows come back
  let usedYear = YEAR;
  let url = `${BASE_OEC}?cube=${CUBE}&drilldowns=Exporter+Country%2CImporter+Country&measures=Trade+Value&Year=${YEAR}&limit=${LIMIT}`;
  let rawResp = await fetchJSON(url) as OecResponse;
  let allRows = rawResp.data ?? [];
  if (allRows.length === 0) {
    console.log(`No data for ${YEAR}, falling back to ${YEAR_FB}…`);
    usedYear = YEAR_FB;
    url = `${BASE_OEC}?cube=${CUBE}&drilldowns=Exporter+Country%2CImporter+Country&measures=Trade+Value&Year=${YEAR_FB}&limit=${LIMIT}`;
    rawResp = await fetchJSON(url) as OecResponse;
    allRows = rawResp.data ?? [];
  }
  const total = rawResp.page?.total ?? allRows.length;

  console.log(`Fetched ${allRows.length} rows (API total: ${total})`);

  // ── Aggregate: build maps for exports, imports, partner lists ─────────────
  // exportTo[iso3Exporter][iso3Importer] = { value, importerName }
  const exportTo  = new Map<string, Map<string, { value: number; name: string }>>();
  const importFrom = new Map<string, Map<string, { value: number; name: string }>>();

  let rowsUsed = 0, rowsSkipped = 0;

  for (const row of allRows) {
    const expISO3 = oecToISO3(row['Exporter Country ID']);
    const impISO3 = oecToISO3(row['Importer Country ID']);
    const value   = row['Trade Value'];

    if (!validISO3.has(expISO3) || !validISO3.has(impISO3) || value <= 0) {
      rowsSkipped++;
      continue;
    }

    // Export: exporter country → importer (partner)
    if (!exportTo.has(expISO3)) exportTo.set(expISO3, new Map());
    exportTo.get(expISO3)!.set(impISO3, {
      value,
      name: row['Importer Country'],
    });

    // Import: importer country → exporter (partner)
    if (!importFrom.has(impISO3)) importFrom.set(impISO3, new Map());
    importFrom.get(impISO3)!.set(expISO3, {
      value,
      name: row['Exporter Country'],
    });

    rowsUsed++;
  }

  console.log(`Rows used: ${rowsUsed}, skipped: ${rowsSkipped}`);
  console.log(`Countries with export data: ${exportTo.size}`);
  console.log(`Countries with import data: ${importFrom.size}`);

  // ── Build output ─────────────────────────────────────────────────────────
  const output: TradeOutput = {};

  for (const iso3 of validISO3) {
    const expMap = exportTo.get(iso3);
    const impMap = importFrom.get(iso3);
    if (!expMap && !impMap) continue;

    function topN(
      map: Map<string, { value: number; name: string }> | undefined
    ): { total: number | null; partners: TradePartner[] } {
      if (!map || map.size === 0) return { total: null, partners: [] };

      const sorted = Array.from(map.entries())
        .sort(([, a], [, b]) => b.value - a.value);

      const totalVal = sorted.reduce((s, [, v]) => s + v.value, 0);

      const partners: TradePartner[] = sorted.slice(0, TOP_N).map(([code, entry]) => ({
        code,
        // Prefer name from countries.json, fall back to OEC name
        name:  nameByISO3.get(code) ?? entry.name,
        value: entry.value,
        share: totalVal > 0 ? (entry.value / totalVal) * 100 : 0,
      }));

      return { total: totalVal > 0 ? totalVal : null, partners };
    }

    const { total: exports_, partners: exportPartners } = topN(expMap);
    const { total: imports_, partners: importPartners } = topN(impMap);

    output[iso3] = {
      year: usedYear,
      exports: exports_,
      imports: imports_,
      exportPartners,
      importPartners,
    };
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const withExports = Object.values(output).filter(c => c.exports != null).length;
  const withImports = Object.values(output).filter(c => c.imports != null).length;

  console.log(`\n════════════════════════════════════════`);
  console.log(`Countries in output  : ${Object.keys(output).length}`);
  console.log(`  with export data   : ${withExports}`);
  console.log(`  with import data   : ${withImports}`);

  for (const iso3 of ['USA', 'DEU', 'CHN', 'BRA', 'NGA', 'JPN']) {
    const e = output[iso3];
    if (e) {
      const topExp = e.exportPartners[0]?.code ?? '—';
      const topImp = e.importPartners[0]?.code ?? '—';
      const expBn  = e.exports != null ? `$${(e.exports / 1e9).toFixed(0)}B` : 'N/A';
      const impBn  = e.imports != null ? `$${(e.imports / 1e9).toFixed(0)}B` : 'N/A';
      console.log(`  ${iso3}: exp=${expBn} (top→${topExp}), imp=${impBn} (top←${topImp})`);
    } else {
      console.log(`  ${iso3}: NO DATA`);
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  const outPath = path.join(process.cwd(), 'data', 'trade.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch(console.error);
