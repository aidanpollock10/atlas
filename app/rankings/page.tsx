'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  countries,
  Country,
  formatGDP,
  formatGDPPerCapita,
  formatPercent,
  formatPercentSigned,
  formatPopulation,
} from '@/lib/data';
import Footer from '@/components/Footer';

// ── Types ────────────────────────────────────────────────────────────────────

type SortKey = 'gdp' | 'gdpPerCapita' | 'gdpGrowth' | 'inflation' | 'unemployment' | 'population';
type SortDir = 'asc' | 'desc';

interface Column {
  key: SortKey;
  label: string;
  format: (c: Country) => string;
  getValue: (c: Country) => number | null;
  defaultDir: SortDir;
}

const COLUMNS: Column[] = [
  { key: 'gdp',           label: 'GDP',           format: (c) => formatGDP(c.gdp),                     getValue: (c) => c.gdp,           defaultDir: 'desc' },
  { key: 'gdpPerCapita',  label: 'GDP / Capita',  format: (c) => formatGDPPerCapita(c.gdpPerCapita),   getValue: (c) => c.gdpPerCapita,  defaultDir: 'desc' },
  { key: 'gdpGrowth',     label: 'GDP Growth',    format: (c) => formatPercentSigned(c.gdpGrowth),     getValue: (c) => c.gdpGrowth,     defaultDir: 'desc' },
  { key: 'inflation',     label: 'Inflation',     format: (c) => formatPercent(c.inflation),           getValue: (c) => c.inflation,     defaultDir: 'desc' },
  { key: 'unemployment',  label: 'Unemployment',  format: (c) => formatPercent(c.unemployment),        getValue: (c) => c.unemployment,  defaultDir: 'desc' },
  { key: 'population',    label: 'Population',    format: (c) => formatPopulation(c.population),       getValue: (c) => c.population,    defaultDir: 'desc' },
];

// Precompute per-column max for bar scaling
const COL_MAX: Record<SortKey, number> = (() => {
  const m = {} as Record<SortKey, number>;
  for (const col of COLUMNS) {
    const vals = countries
      .map(col.getValue)
      .filter((v): v is number => v !== null && v > 0);
    m[col.key] = vals.length ? Math.max(...vals) : 1;
  }
  return m;
})();

// Medal styling
const MEDAL_RING = [
  'ring-1 ring-yellow-400/40 bg-yellow-400/[0.06]',
  'ring-1 ring-gray-400/30 bg-gray-400/[0.04]',
  'ring-1 ring-amber-600/30 bg-amber-600/[0.04]',
];
const MEDAL_RANK_COLOR = ['text-yellow-400', 'text-gray-300', 'text-amber-500'];
const MEDAL_NAME_COLOR = ['text-yellow-200', 'text-gray-100', 'text-amber-400'];

// ── Component ────────────────────────────────────────────────────────────────

export default function RankingsPage() {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>('gdp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      const col = COLUMNS.find((c) => c.key === key)!;
      setSortKey(key);
      setSortDir(col.defaultDir);
    }
  }

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey)!;
    return [...countries]
      .filter((c) => col.getValue(c) !== null)
      .sort((a, b) => {
        const av = col.getValue(a) ?? 0;
        const bv = col.getValue(b) ?? 0;
        return sortDir === 'desc' ? bv - av : av - bv;
      });
  }, [sortKey, sortDir]);

  const activeCol = COLUMNS.find((c) => c.key === sortKey)!;

  return (
    <div className="min-h-screen bg-[#060a14] text-white">

      {/* ── Sticky header ─────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 flex items-center gap-4 px-8 py-3"
        style={{
          background: 'rgba(6,10,20,0.96)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <Link href="/" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Globe
        </Link>

        <div className="w-px h-4 bg-gray-700 flex-shrink-0" />

        <span className="text-lg font-bold tracking-widest text-white select-none">ATLAS</span>

        <div className="w-px h-4 bg-gray-700 flex-shrink-0" />

        <h1 className="text-sm font-semibold text-gray-300">Country Rankings</h1>

        <Link
          href="/compare"
          className="text-sm text-gray-500 hover:text-white transition-colors px-2.5 py-1 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          Compare ↗
        </Link>

        <span className="ml-auto text-xs text-gray-600">
          {sorted.length} countries · sorted by {activeCol.label}{' '}
          ({sortDir === 'desc' ? 'highest first' : 'lowest first'})
        </span>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="px-8 py-6">
        <div
          className="overflow-x-auto rounded-2xl"
          style={{ border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <table className="w-full text-sm border-collapse min-w-[900px]">

            {/* Head */}
            <thead>
              <tr
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderBottom: '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-widest w-14">
                  #
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-widest">
                  Country
                </th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="text-right px-5 py-3.5 text-xs font-semibold uppercase tracking-widest"
                  >
                    <button
                      onClick={() => handleSort(col.key)}
                      className={`flex items-center gap-1.5 ml-auto transition-colors ${
                        sortKey === col.key
                          ? 'text-blue-400'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {sortKey === col.key && <SortArrow dir={sortDir} />}
                      {col.label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>

            {/* Body */}
            <tbody>
              {sorted.map((country, i) => {
                const isMedal = i < 3;
                const medalIdx = i; // 0=gold 1=silver 2=bronze

                return (
                  <tr
                    key={country.code}
                    onClick={() => router.push(`/?country=${country.code}`)}
                    className={`cursor-pointer transition-all group ${
                      isMedal ? MEDAL_RING[medalIdx] : 'hover:bg-white/[0.03]'
                    }`}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    {/* Rank */}
                    <td className="px-5 py-3.5 w-14">
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          isMedal ? MEDAL_RANK_COLOR[medalIdx] : 'text-gray-600'
                        }`}
                      >
                        {i + 1}
                      </span>
                    </td>

                    {/* Country */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="text-xl leading-none flex-shrink-0">{country.flag}</span>
                        <div>
                          <div
                            className={`font-semibold transition-colors ${
                              isMedal
                                ? MEDAL_NAME_COLOR[medalIdx]
                                : 'text-gray-200 group-hover:text-white'
                            }`}
                          >
                            {country.name}
                          </div>
                          {country.capital && (
                            <div className="text-xs text-gray-600 mt-0.5">{country.capital}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Data columns */}
                    {COLUMNS.map((col) => {
                      const val = col.getValue(country);
                      const isActive = col.key === sortKey;
                      const max = COL_MAX[col.key];
                      // Bars for positive values; for growth/inflation allow negatives (just show 0 bar)
                      const barPct =
                        val !== null && val > 0 && max > 0
                          ? Math.max(2, (val / max) * 100)
                          : 0;

                      return (
                        <td key={col.key} className="px-5 py-3.5 text-right">
                          <div className="flex flex-col items-end gap-1.5">
                            <span
                              className={`font-mono tabular-nums text-sm ${
                                val == null
                                  ? 'text-gray-700'
                                  : isActive
                                  ? 'text-white font-semibold'
                                  : 'text-gray-400'
                              }`}
                            >
                              {col.format(country)}
                            </span>
                            {/* Relative bar */}
                            <div className="w-24 h-[3px] rounded-full overflow-hidden bg-gray-800">
                              {barPct > 0 && (
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    isActive ? 'bg-blue-500' : 'bg-gray-600'
                                  }`}
                                  style={{ width: `${barPct}%` }}
                                />
                              )}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-center text-xs text-gray-600 mt-4 mb-2">
          Click any row to view on the globe
        </p>
      </div>
      <Footer />
    </div>
  );
}

function SortArrow({ dir }: { dir: SortDir }) {
  return (
    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
      {dir === 'desc' ? (
        <path d="M6 9L1 4h10L6 9z" />
      ) : (
        <path d="M6 3l5 5H1L6 3z" />
      )}
    </svg>
  );
}
