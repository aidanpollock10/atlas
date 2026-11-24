'use client';

import { useState, useMemo, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
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
import NavBar from '@/components/NavBar';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCENT_COLORS: string[] = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444'];

const PRESETS = [
  { label: 'USA vs China',       codes: ['USA', 'CHN'] },
  { label: 'Germany vs Japan',   codes: ['DEU', 'JPN'] },
  { label: 'Brazil vs India',    codes: ['BRA', 'IND'] },
];

interface Metric {
  key: keyof Country;
  label: string;
  format: (c: Country) => string;
  getValue: (c: Country) => number | null;
  higherIsBetter: boolean;
}

const METRICS: Metric[] = [
  { key: 'population',   label: 'Population',    format: (c) => formatPopulation(c.population),          getValue: (c) => c.population,   higherIsBetter: true  },
  { key: 'gdp',          label: 'GDP',           format: (c) => formatGDP(c.gdp),                        getValue: (c) => c.gdp,          higherIsBetter: true  },
  { key: 'gdpPerCapita', label: 'GDP / Capita',  format: (c) => formatGDPPerCapita(c.gdpPerCapita),      getValue: (c) => c.gdpPerCapita, higherIsBetter: true  },
  { key: 'gdpGrowth',    label: 'GDP Growth',    format: (c) => formatPercentSigned(c.gdpGrowth),        getValue: (c) => c.gdpGrowth,    higherIsBetter: true  },
  { key: 'inflation',    label: 'Inflation',     format: (c) => formatPercent(c.inflation),              getValue: (c) => c.inflation,    higherIsBetter: false },
  { key: 'unemployment', label: 'Unemployment',  format: (c) => formatPercent(c.unemployment),           getValue: (c) => c.unemployment, higherIsBetter: false },
];

// ── Chart helpers ─────────────────────────────────────────────────────────────

function buildChartData(
  selected: Country[],
  normalize: boolean
): Array<Record<string, number | null>> {
  if (selected.length === 0) return [];

  const allYears = new Set<number>();
  for (const c of selected) for (const h of c.gdpHistory) allYears.add(h.year);
  const years = Array.from(allYears).sort();

  const rawMap = new Map<string, Map<number, number | null>>();
  for (const c of selected) {
    const m = new Map<number, number | null>();
    for (const h of c.gdpHistory) m.set(h.year, h.value);
    rawMap.set(c.code3, m);
  }

  if (!normalize) {
    return years.map((year) => {
      const pt: Record<string, number | null> = { year };
      for (const c of selected) pt[c.code3] = rawMap.get(c.code3)?.get(year) ?? null;
      return pt;
    });
  }

  // Find first year where ALL countries have non-null GDP
  let baseYear: number | null = null;
  for (const year of years) {
    if (selected.every((c) => (rawMap.get(c.code3)?.get(year) ?? null) !== null)) {
      baseYear = year;
      break;
    }
  }
  if (baseYear === null) return [];

  const baseVals: Record<string, number> = {};
  for (const c of selected) baseVals[c.code3] = rawMap.get(c.code3)?.get(baseYear) ?? 0;

  return years
    .filter((y) => y >= baseYear!)
    .map((year) => {
      const pt: Record<string, number | null> = { year };
      for (const c of selected) {
        const val  = rawMap.get(c.code3)?.get(year) ?? null;
        const base = baseVals[c.code3];
        pt[c.code3] = val !== null && base > 0 ? (val / base) * 100 : null;
      }
      return pt;
    });
}

function formatGDPAxis(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(0)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(0)}B`;
  return `$${n}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
      {children}
    </h2>
  );
}

// Country search picker (multi-select)
function CountryPicker({
  selected,
  onAdd,
  onRemove,
}: {
  selected: { country: Country; color: string }[];
  onAdd: (c: Country) => void;
  onRemove: (code3: string) => void;
}) {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<Country[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [open, setOpen]         = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedCodes = new Set(selected.map((s) => s.country.code3));
  const atMax = selected.length >= 4;

  function runSearch(q: string): Country[] {
    const lq = q.toLowerCase().trim();
    if (!lq) return [];
    return countries
      .filter((c) => !selectedCodes.has(c.code3))
      .map((c) => {
        const name = c.name.toLowerCase();
        if (name === lq)                                return { c, s: 0 };
        if (name.startsWith(lq))                       return { c, s: 1 };
        if (name.split(/\s+/).some((w) => w.startsWith(lq))) return { c, s: 2 };
        if (name.includes(lq))                         return { c, s: 3 };
        return null;
      })
      .filter((x): x is { c: Country; s: number } => x !== null)
      .sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name))
      .slice(0, 8)
      .map((x) => x.c);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    const res = runSearch(val);
    setResults(res);
    setActiveIdx(-1);
    setOpen(res.length > 0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = results[activeIdx >= 0 ? activeIdx : 0]; if (c) select(c); }
    else if (e.key === 'Escape') dismiss();
  }

  const select = useCallback((c: Country) => {
    onAdd(c);
    setQuery('');
    setResults([]);
    setOpen(false);
    setActiveIdx(-1);
    inputRef.current?.focus();
  }, [onAdd]);

  function dismiss() { setOpen(false); setActiveIdx(-1); }

  return (
    <div>
      {/* Chips */}
      <div className="flex flex-wrap gap-2 mb-3 min-h-[2rem]">
        {selected.map(({ country, color }) => (
          <div
            key={country.code3}
            className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full text-sm font-medium"
            style={{ background: `${color}20`, border: `1px solid ${color}60`, color }}
          >
            <span>{country.flag}</span>
            <span>{country.name}</span>
            <button
              onClick={() => onRemove(country.code3)}
              className="ml-0.5 rounded-full hover:bg-white/10 p-0.5 transition-colors"
              style={{ color }}
            >
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              </svg>
            </button>
          </div>
        ))}
        {selected.length === 0 && (
          <span className="text-sm text-gray-600 self-center">No countries selected yet</span>
        )}
      </div>

      {/* Search input */}
      <div className="relative">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(dismiss, 150)}
            placeholder={atMax ? 'Maximum 4 countries selected' : 'Add a country…'}
            disabled={atMax}
            className="w-full max-w-sm rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
          />
        </div>

        {open && results.length > 0 && (
          <div
            className="absolute top-full mt-1.5 w-full max-w-sm rounded-xl overflow-hidden z-50 shadow-2xl"
            style={{ background: 'rgba(8,14,28,0.98)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            {results.map((country, i) => (
              <button
                key={country.code3}
                onMouseDown={() => select(country)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === activeIdx ? 'bg-blue-600/25 text-white' : 'text-gray-300 hover:bg-white/[0.05]'
                }`}
              >
                <span className="text-xl leading-none">{country.flag}</span>
                <span className="flex-1 font-medium">{country.name}</span>
                {country.region && <span className="text-xs text-gray-600">{country.region}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-gray-600 mt-2">Select 2–4 countries to compare</p>
    </div>
  );
}

// Stats comparison grid
function StatsGrid({ selected }: { selected: { country: Country; color: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
      <table className="w-full text-sm border-collapse" style={{ minWidth: `${200 + selected.length * 180}px` }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-widest w-36">
              Metric
            </th>
            {selected.map(({ country, color }) => (
              <th key={country.code3} className="text-right px-5 py-3.5 text-xs font-semibold uppercase tracking-widest" style={{ color }}>
                <div className="flex items-center justify-end gap-2">
                  <span>{country.flag}</span>
                  <span>{country.name}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((metric) => {
            const vals = selected.map(({ country }) => metric.getValue(country));
            const nonNull = vals.filter((v): v is number => v !== null);
            const best =
              nonNull.length > 0
                ? metric.higherIsBetter
                  ? Math.max(...nonNull)
                  : Math.min(...nonNull.filter((v) => v > 0))
                : null;
            const maxAbs = nonNull.length > 0 ? Math.max(...nonNull.map(Math.abs)) : 1;

            return (
              <tr
                key={metric.key as string}
                style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
              >
                <td className="px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {metric.label}
                </td>
                {selected.map(({ country, color }) => {
                  const val = metric.getValue(country);
                  const isBest = val !== null && val === best && nonNull.length > 1;
                  const barPct = val !== null && val > 0 && maxAbs > 0 ? Math.max(2, (Math.abs(val) / maxAbs) * 100) : 0;

                  return (
                    <td key={country.code3} className="px-5 py-4 text-right">
                      <div
                        className="flex flex-col items-end gap-1.5 rounded-lg px-2 py-1 -mx-2"
                        style={isBest ? { background: `${color}12`, border: `1px solid ${color}30` } : {}}
                      >
                        <div className="flex items-center gap-2">
                          {isBest && (
                            <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill={color}>
                              <path d="M6 1l1.5 3 3.5.5-2.5 2.5.5 3.5L6 9l-3 1.5.5-3.5L1 4.5l3.5-.5z"/>
                            </svg>
                          )}
                          <span
                            className="font-mono tabular-nums font-semibold text-sm"
                            style={{ color: val === null ? '#374151' : isBest ? color : '#d1d5db' }}
                          >
                            {metric.format(country)}
                          </span>
                        </div>
                        {barPct > 0 && (
                          <div className="w-full h-[3px] rounded-full bg-gray-800">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${barPct}%`, background: color }}
                            />
                          </div>
                        )}
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
  );
}

// Shared tooltip for the GDP chart
function ChartTooltip({
  active,
  payload,
  label,
  normalize,
  selected,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: readonly any[];
  label?: string | number;
  normalize: boolean;
  selected: { country: Country; color: string }[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-4 py-3 text-sm shadow-xl min-w-[180px]"
      style={{ background: 'rgba(8,14,28,0.97)', border: '1px solid rgba(255,255,255,0.12)' }}
    >
      <div className="text-gray-400 text-xs mb-2 font-semibold">{label}</div>
      {payload.map((p) => {
        const entry = selected.find((s) => s.country.code3 === p.dataKey);
        if (!entry || p.value == null) return null;
        return (
          <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
            <span className="text-gray-300 flex-1">{entry.country.flag} {entry.country.name}</span>
            <span className="font-mono font-semibold" style={{ color: p.color }}>
              {normalize ? `${p.value.toFixed(1)}` : formatGDP(p.value)}
            </span>
          </div>
        );
      })}
      {normalize && <div className="text-xs text-gray-600 mt-2 border-t border-gray-800 pt-2">Index: 100 = first common year</div>}
    </div>
  );
}

// GDP history chart
function GDPChart({
  selected,
  normalize,
  onToggleNormalize,
}: {
  selected: { country: Country; color: string }[];
  normalize: boolean;
  onToggleNormalize: () => void;
}) {
  const chartData = useMemo(
    () => buildChartData(selected.map((s) => s.country), normalize),
    [selected, normalize]
  );

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-600 text-sm">
        {normalize ? 'No common base year found for selected countries.' : 'No GDP history available.'}
      </div>
    );
  }

  return (
    <div>
      {/* Chart header */}
      <div className="flex items-center justify-between mb-4">
        <SectionLabel>GDP Over Time</SectionLabel>
        <button
          onClick={onToggleNormalize}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
          style={{
            background: normalize ? 'rgba(58,134,255,0.15)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${normalize ? 'rgba(58,134,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
            color: normalize ? '#93c5fd' : '#9ca3af',
          }}
        >
          {normalize ? '⊘ Indexed (100 = base)' : '⊕ Normalize'}
        </button>
      </div>

      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="year"
              tick={{ fill: '#6b7280', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              interval="preserveStartEnd"
              tickCount={8}
            />
            <YAxis
              tick={{ fill: '#6b7280', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={normalize ? (v: number) => v.toFixed(0) : formatGDPAxis}
              width={normalize ? 40 : 56}
              label={
                normalize
                  ? { value: 'Index', angle: -90, position: 'insideLeft', fill: '#4b5563', fontSize: 10, dx: 12 }
                  : undefined
              }
            />
            <Tooltip
              content={(props) => (
                <ChartTooltip {...props} normalize={normalize} selected={selected} />
              )}
              cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
            />
            {normalize && (
              <ReferenceLine y={100} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
            )}
            <Legend
              wrapperStyle={{ paddingTop: 16 }}
              formatter={(value: string) => {
                const entry = selected.find((s) => s.country.code3 === value);
                return entry
                  ? <span style={{ color: '#d1d5db', fontSize: 12 }}>{entry.country.flag} {entry.country.name}</span>
                  : value;
              }}
            />
            {selected.map(({ country, color }) => (
              <Line
                key={country.code3}
                type="monotone"
                dataKey={country.code3}
                stroke={color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: '#fff', strokeWidth: 1, fill: color }}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Empty state with preset suggestions
function EmptyState({ onPreset }: { onPreset: (codes: string[]) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-5xl mb-4">🌍</div>
      <h2 className="text-xl font-semibold text-white mb-2">Compare economies side by side</h2>
      <p className="text-gray-500 text-sm mb-10 max-w-sm">
        Select 2–4 countries above to see their stats, GDP history, and how they stack up.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <p className="text-xs text-gray-600 uppercase tracking-widest mb-1">Quick comparisons</p>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => onPreset(preset.codes)}
            className="w-full px-5 py-3 rounded-xl text-sm font-medium text-gray-300 hover:text-white transition-all hover:scale-[1.02] active:scale-[0.99]"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ComparePage() {
  const router = useRouter();
  const [codes, setCodes]         = useState<string[]>([]);
  const [normalize, setNormalize] = useState(false);

  // Read URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('c');
    if (c) setCodes(c.split(',').filter(Boolean).slice(0, 4));
  }, []);

  // Sync URL when codes change
  useEffect(() => {
    const url = codes.length > 0 ? `/compare?c=${codes.join(',')}` : '/compare';
    router.replace(url, { scroll: false });
  }, [codes, router]);

  // Build selected list: country + assigned accent color
  const selected = useMemo(() => {
    return codes
      .map((code, i) => {
        const country = countries.find((c) => c.code3 === code || c.code === code);
        return country ? { country, color: ACCENT_COLORS[i % ACCENT_COLORS.length] } : null;
      })
      .filter((x): x is { country: Country; color: string } => x !== null);
  }, [codes]);

  const handleAdd = useCallback((c: Country) => {
    setCodes((prev) => prev.includes(c.code3) ? prev : [...prev, c.code3].slice(0, 4));
  }, []);

  const handleRemove = useCallback((code3: string) => {
    setCodes((prev) => prev.filter((c) => c !== code3));
  }, []);

  const handlePreset = useCallback((presetCodes: string[]) => {
    setCodes(presetCodes);
  }, []);

  const hasEnough = selected.length >= 2;

  return (
    <div className="min-h-screen bg-[#060a14] text-white">

      <NavBar />

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="px-8 py-8 max-w-6xl mx-auto">

        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Compare Countries</h1>
          <p className="text-sm mt-1" style={{ color: '#64748b' }}>Side-by-side comparison of up to 4 economies</p>
        </div>

        {/* Country picker */}
        <section className="mb-10">
          <SectionLabel>Select Countries</SectionLabel>
          <CountryPicker selected={selected} onAdd={handleAdd} onRemove={handleRemove} />
        </section>

        {/* Empty state */}
        {!hasEnough && (
          <EmptyState onPreset={handlePreset} />
        )}

        {/* Comparison content */}
        {hasEnough && (
          <div className="space-y-12">

            {/* Stats grid */}
            <section>
              <SectionLabel>Key Statistics</SectionLabel>
              <StatsGrid selected={selected} />
            </section>

            {/* GDP chart */}
            <section>
              <GDPChart
                selected={selected}
                normalize={normalize}
                onToggleNormalize={() => setNormalize((v) => !v)}
              />
            </section>

          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
