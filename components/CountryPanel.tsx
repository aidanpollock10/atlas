'use client';

import { useEffect } from 'react';
import insightsData from '@/data/insights.json';
import type { CountryInsight } from '@/scripts/generate-insights';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  getFxEntry,
  getFxChanges,
  formatFxRate,
  formatUsdPerUnit,
} from '@/lib/fx';
import { getCountryTrade } from '@/lib/trade';
import {
  countries,
  Country,
  IndicatorColor,
  formatGDP,
  formatGDPPerCapita,
  formatPercent,
  formatPercentSigned,
  formatPopulation,
  gdpGrowthColor,
  inflationColor,
  unemploymentColor,
  debtColor,
  budgetBalanceColor,
  currentAccountColor,
  worldAvgGDPPerCapita,
} from '@/lib/data';

interface CountryPanelProps {
  country: Country | null;
  onClose: () => void;
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function formatGDPAxis(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(0)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(0)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n}`;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: readonly any[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value as number | null | undefined;
  return (
    <div
      className="rounded px-3 py-2 text-xs text-white"
      style={{ background: 'rgba(10,20,40,0.95)', border: '1px solid rgba(58,134,255,0.4)' }}
    >
      <div className="text-gray-400 mb-0.5">{label}</div>
      <div className="font-semibold">{val != null ? formatGDP(val) : 'No data'}</div>
    </div>
  );
}

// ── GDP per capita comparison ─────────────────────────────────────────────────

function GDPComparison({ country }: { country: Country }) {
  const countryVal = country.gdpPerCapita;
  const worldAvg   = worldAvgGDPPerCapita;

  if (countryVal == null || worldAvg === 0) {
    return <p className="text-gray-500 text-sm">No comparison data available.</p>;
  }

  const max        = Math.max(countryVal, worldAvg) * 1.1;
  const countryPct = (countryVal / max) * 100;
  const worldPct   = (worldAvg   / max) * 100;
  const ratio      = countryVal  / worldAvg;

  return (
    <div className="space-y-3">
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-300 flex items-center gap-1.5">
            <span>{country.flag}</span>{country.name}
          </span>
          <span className="text-white font-semibold">{formatGDPPerCapita(countryVal)}</span>
        </div>
        <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${countryPct}%`, background: 'linear-gradient(90deg,#1e88e5,#3a86ff)' }}
          />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-400">🌍 World average</span>
          <span className="text-gray-400">{formatGDPPerCapita(worldAvg)}</span>
        </div>
        <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${worldPct}%`, background: 'rgba(255,255,255,0.2)' }} />
        </div>
      </div>
      <p className="text-xs text-gray-500 pt-0.5">
        {ratio >= 1
          ? `${ratio.toFixed(1)}× above world average`
          : `${(ratio * 100).toFixed(0)}% of world average`}
      </p>
    </div>
  );
}

// ── Currency ──────────────────────────────────────────────────────────────────

function ChangeChip({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null;
  const color =
    value > 2  ? 'text-emerald-400'
    : value < -2 ? 'text-red-400'
    : 'text-gray-400';
  const sign = value >= 0 ? '+' : '';
  return (
    <div className="flex items-center justify-between py-1.5"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm font-semibold ${color}`}>
        {sign}{value.toFixed(1)}%
      </span>
    </div>
  );
}

function FxChartTooltip({
  active, payload, label, currencyCode,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: readonly any[];
  label?: string | number;
  currencyCode?: string;
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value as number | null | undefined;
  return (
    <div
      className="rounded px-3 py-2 text-xs text-white"
      style={{ background: 'rgba(10,20,40,0.95)', border: '1px solid rgba(58,134,255,0.4)' }}
    >
      <div className="text-gray-400 mb-0.5">{label}</div>
      <div className="font-semibold">
        {val != null
          ? `1 ${currencyCode} = ${formatUsdPerUnit(val)}`
          : 'No data'}
      </div>
    </div>
  );
}

function CurrencySection({ country }: { country: Country }) {
  const { currency } = country;
  if (!currency.code) return null;

  const fxResult = getFxEntry(currency.code);

  // Header: name + symbol + code — always shown
  const header = [
    currency.name,
    currency.symbol ? `(${currency.symbol})` : null,
    `· ${currency.code}`,
  ].filter(Boolean).join(' ');

  // If no FX data at all, just show the currency name (don't duplicate Details row)
  if (!fxResult) return null;

  const { entry, peg, isUsd } = fxResult;
  const { change1Y, change5Y } = getFxChanges(fxResult);

  // Chart data: inverted rate = "1 CURRENCY = X USD" — rising line = appreciation
  const fxChartData = entry.history
    .map(h => ({ date: h.date, usd: h.rate > 0 ? 1 / h.rate : null }));
  const hasChart = fxChartData.some(d => d.usd != null) && !isUsd;

  return (
    <section className="space-y-3">
      <SectionLabel>Currency</SectionLabel>

      {/* Name row */}
      <p className="text-sm text-gray-200 font-medium">{header}</p>

      {/* Rate or peg badge */}
      {peg ? (
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
          style={{ background: 'rgba(58,134,255,0.12)', border: '1px solid rgba(58,134,255,0.3)', color: '#93c5fd' }}
        >
          <span>⚓</span>
          <span>{peg.label}</span>
          {!isUsd && <span>· 1 USD ≈ {entry.rate >= 1000
            ? Math.round(entry.rate).toLocaleString()
            : entry.rate.toFixed(entry.rate >= 10 ? 2 : 4)} {currency.code}</span>}
        </div>
      ) : (
        <p className="text-sm font-mono text-gray-300">{formatFxRate(currency.code, entry.rate)}</p>
      )}

      {/* Change rows */}
      {(change1Y !== null || change5Y !== null) && (
        <div
          className="rounded-lg px-3 py-1"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="text-xs text-gray-600 pt-1.5 pb-1 uppercase tracking-wider">vs USD</div>
          <ChangeChip value={change1Y} label="1-Year change" />
          <ChangeChip value={change5Y} label="5-Year change" />
          {isUsd && peg?.pegCurrency === 'USD' && (
            <p className="text-xs text-gray-600 py-1">Currency pegged to USD — no fluctuation.</p>
          )}
        </div>
      )}

      {/* Rate history chart */}
      {hasChart && (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            1 {currency.code} in USD — 10-year history
          </p>
          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={fxChartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  interval="preserveStartEnd"
                  tickCount={6}
                  tickFormatter={(d: string) => d.slice(0, 4)}
                />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatUsdPerUnit}
                  width={56}
                />
                <Tooltip
                  content={<FxChartTooltip currencyCode={currency.code} />}
                  cursor={{ stroke: 'rgba(58,134,255,0.3)', strokeWidth: 1 }}
                />
                <Line
                  type="monotone"
                  dataKey="usd"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#34d399', stroke: '#fff', strokeWidth: 1 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-600 mt-1">Rising = {currency.code} appreciated vs USD</p>
        </div>
      )}
    </section>
  );
}

// ── Fiscal ────────────────────────────────────────────────────────────────────

function PercentTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: readonly any[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value as number | null | undefined;
  return (
    <div
      className="rounded px-3 py-2 text-xs text-white"
      style={{ background: 'rgba(10,20,40,0.95)', border: '1px solid rgba(58,134,255,0.4)' }}
    >
      <div className="text-gray-400 mb-0.5">{label}</div>
      <div className="font-semibold">{val != null ? `${val.toFixed(1)}%` : 'No data'}</div>
    </div>
  );
}

function FiscalSection({ country }: { country: Country }) {
  const debt         = country.debtToGDP   ?? null;
  const budget       = country.budgetBalance ?? null;
  const currAcc      = country.currentAccount ?? null;
  const interest     = country.interestRate ?? null;

  const hasDebtHistory = (country.debtHistory ?? []).length > 0;
  const hasAny = debt !== null || budget !== null || currAcc !== null || interest !== null;
  if (!hasAny) return null;

  const debtChartData = hasDebtHistory
    ? (country.debtHistory ?? [])
        .filter(d => d.year >= new Date().getFullYear() - 30)
        .map(d => ({ year: d.year, value: d.value }))
    : [];

  return (
    <section className="space-y-4">
      <SectionLabel>Fiscal</SectionLabel>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2.5">
        {debt !== null && (
          <StatCard label="Debt / GDP" value={formatPercent(debt)} color={debtColor(debt)} />
        )}
        {budget !== null && (
          <StatCard
            label="Budget Balance"
            value={formatPercentSigned(budget)}
            color={budgetBalanceColor(budget)}
          />
        )}
        {currAcc !== null && (
          <StatCard
            label="Current Account"
            value={formatPercentSigned(currAcc)}
            color={currentAccountColor(currAcc)}
          />
        )}
        {interest !== null && (
          <StatCard label="Lending Rate" value={formatPercent(interest)} />
        )}
      </div>

      {/* Debt history chart */}
      {hasDebtHistory && debtChartData.some(d => d.value != null) && (
        <div>
          <p className="text-xs text-gray-500 mb-2">Govt Debt % of GDP — historical</p>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={debtChartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="year"
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  interval="preserveStartEnd"
                  tickCount={7}
                />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                  width={40}
                />
                <Tooltip
                  content={<PercentTooltip />}
                  cursor={{ stroke: 'rgba(58,134,255,0.3)', strokeWidth: 1 }}
                />
                <ReferenceLine y={60} stroke="rgba(255,160,30,0.3)" strokeDasharray="3 3" />
                <ReferenceLine y={90} stroke="rgba(255,80,80,0.3)"  strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#f59e0b', stroke: '#fff', strokeWidth: 1 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-600 mt-1">Dashed lines: 60% and 90% thresholds</p>
        </div>
      )}
    </section>
  );
}

// ── Trade ─────────────────────────────────────────────────────────────────────

function TradePartnerBar({
  rank, name, flag, value, share, maxValue,
}: {
  rank: number; name: string; flag: string; value: number; share: number; maxValue: number;
}) {
  const barPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="flex items-center gap-2 py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span className="text-xs text-gray-600 w-4 flex-shrink-0">{rank}</span>
      <span className="text-base leading-none flex-shrink-0">{flag}</span>
      <span className="text-sm text-gray-200 flex-1 truncate min-w-0">{name}</span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className="w-16 h-1.5 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${barPct}%`, background: 'rgba(58,134,255,0.6)' }}
          />
        </div>
        <span className="text-xs text-gray-500 w-8 text-right">{share.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function TradeSection({ country }: { country: Country }) {
  const trade = getCountryTrade(country.code3);
  if (!trade) return null;

  const { exports: exp, imports: imp, exportPartners, importPartners, year } = trade;
  const hasPartners = exportPartners.length > 0 || importPartners.length > 0;
  if (!hasPartners && exp == null && imp == null) return null;

  const balance    = exp != null && imp != null ? exp - imp : null;
  const balancePos = balance != null && balance >= 0;

  // Country lookup for flags
  const countryMap = new Map(countries.map(c => [c.code3, c]));
  const flag = (iso3: string) => countryMap.get(iso3)?.flag ?? '🏳';
  const name = (iso3: string, fallback: string) => countryMap.get(iso3)?.name ?? fallback;

  const maxExpVal = exportPartners.length > 0 ? exportPartners[0].value : 1;
  const maxImpVal = importPartners.length > 0 ? importPartners[0].value : 1;

  return (
    <section className="space-y-4">
      <SectionLabel>Trade {year ? `(${year})` : ''}</SectionLabel>

      {/* Totals row */}
      {(exp != null || imp != null) && (
        <div className="grid grid-cols-2 gap-2.5">
          {exp != null && <StatCard label="Exports" value={formatGDP(exp)} />}
          {imp != null && <StatCard label="Imports" value={formatGDP(imp)} />}
        </div>
      )}

      {/* Balance */}
      {balance != null && (
        <div
          className="flex items-center justify-between rounded-lg px-3.5 py-2.5"
          style={{ background: balancePos ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)',
                   border: `1px solid ${balancePos ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}` }}
        >
          <span className="text-xs text-gray-400">Trade Balance</span>
          <span className={`text-sm font-semibold ${balancePos ? 'text-emerald-400' : 'text-red-400'}`}>
            {balance >= 0 ? '+' : ''}{formatGDP(balance)}
            <span className="ml-1.5 text-xs font-normal">{balancePos ? 'surplus' : 'deficit'}</span>
          </span>
        </div>
      )}

      {/* Export partners */}
      {exportPartners.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: 'rgba(16,185,129,0.8)' }}
            />
            Top Export Partners
          </p>
          <div>
            {exportPartners.map((p, i) => (
              <TradePartnerBar
                key={p.code}
                rank={i + 1}
                name={name(p.code, p.name)}
                flag={flag(p.code)}
                value={p.value}
                share={p.share}
                maxValue={maxExpVal}
              />
            ))}
          </div>
        </div>
      )}

      {/* Import partners */}
      {importPartners.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: 'rgba(245,158,11,0.8)' }}
            />
            Top Import Partners
          </p>
          <div>
            {importPartners.map((p, i) => (
              <TradePartnerBar
                key={p.code}
                rank={i + 1}
                name={name(p.code, p.name)}
                flag={flag(p.code)}
                value={p.value}
                share={p.share}
                maxValue={maxImpVal}
              />
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-600">Source: World Bank WITS</p>
    </section>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string; color?: IndicatorColor }) {
  const cls =
    color === 'green' ? 'text-emerald-400'
    : color === 'amber' ? 'text-amber-400'
    : color === 'red'   ? 'text-red-400'
    : 'text-white';

  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-1"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <span className="text-xs text-gray-500 uppercase tracking-wider leading-none">{label}</span>
      <span className={`text-base font-bold ${cls} leading-tight`}>{value}</span>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function CountryPanel({ country, onClose }: CountryPanelProps) {
  const isOpen = country !== null;

  // Escape key to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const chartData =
    country?.gdpHistory
      .filter(d => d.year >= new Date().getFullYear() - 30)
      .map(d => ({ year: d.year, gdp: d.value })) ?? [];

  const hasChart = chartData.some(d => d.gdp != null);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-10 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'rgba(0,0,0,0.3)' }}
        onClick={onClose}
      />

      {/*
        Panel — mobile: bottom sheet (slides up from bottom, full width)
                desktop (sm+): right panel (slides in from right, 420 px wide)
      */}
      <div
        className={[
          // overflow-hidden intentionally omitted — it would block wheel/touch scroll
          'fixed z-20 flex flex-col',
          'transition-transform duration-300 ease-out',
          // Mobile positioning & shape
          'bottom-0 left-0 right-0 max-h-[85vh] rounded-t-2xl',
          // Desktop overrides — explicit h-screen so flex height chain is definite
          'sm:top-0 sm:bottom-auto sm:left-auto sm:right-0 sm:w-[420px] sm:h-screen sm:max-h-none sm:rounded-none',
          // Animation: mobile slides vertically, desktop horizontally
          isOpen
            ? 'translate-y-0 sm:translate-x-0'
            : 'translate-y-full sm:translate-y-0 sm:translate-x-full',
        ].join(' ')}
        style={{
          background: 'rgba(8,14,28,0.97)',
          backdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(58,134,255,0.2)',
          borderLeft: '1px solid rgba(58,134,255,0.1)',
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        {country && (
          <>
            {/* ── Header — pinned ────────────────────────────────────── */}
            <div
              className="flex items-start gap-4 p-5 flex-shrink-0"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
            >
              {country.flagUrl && (
                <div className="flex-shrink-0 rounded overflow-hidden shadow-lg" style={{ width: 72, height: 48 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={country.flagUrl} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-2xl leading-none">{country.flag}</span>
                  <h2 className="text-lg font-bold text-white leading-tight truncate">{country.name}</h2>
                </div>
                <p className="text-gray-400 text-sm truncate">
                  {[country.capital, country.region].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close panel (Esc)"
                className="flex-shrink-0 text-gray-500 hover:text-white transition-colors p-1 rounded mt-0.5"
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
                </svg>
              </button>
            </div>

            {/* ── Scrollable content ──────────────────────────────────── */}
            {/* min-h-0 is required: without it flex-1 won't constrain height in a flex column */}
            <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6">

              {/* Key stats grid */}
              <section>
                <SectionLabel>Key Statistics</SectionLabel>
                <div className="grid grid-cols-2 gap-2.5">
                  <StatCard label="Population"    value={formatPopulation(country.population)} />
                  <StatCard label="GDP (Total)"   value={formatGDP(country.gdp)} />
                  <StatCard label="GDP / Capita"  value={formatGDPPerCapita(country.gdpPerCapita)} />
                  <StatCard
                    label="GDP Growth"
                    value={formatPercentSigned(country.gdpGrowth)}
                    color={gdpGrowthColor(country.gdpGrowth)}
                  />
                  <StatCard
                    label="Inflation"
                    value={formatPercent(country.inflation)}
                    color={inflationColor(country.inflation)}
                  />
                  <StatCard
                    label="Unemployment"
                    value={formatPercent(country.unemployment)}
                    color={unemploymentColor(country.unemployment)}
                  />
                </div>
              </section>

              {/* Details */}
              <section>
                <SectionLabel>Details</SectionLabel>
                <div className="space-y-2.5">
                  {country.capital && <InfoRow label="Capital"  value={country.capital} />}
                  <InfoRow label="ISO Codes" value={`${country.code} / ${country.code3}`} />
                  {country.region && <InfoRow label="Region" value={country.region} />}
                </div>
              </section>

              {/* Currency & FX */}
              <CurrencySection country={country} />

              {/* GDP over time chart */}
              {hasChart && (
                <section>
                  <SectionLabel>GDP Over Time</SectionLabel>
                  <div style={{ height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <XAxis
                          dataKey="year"
                          tick={{ fill: '#6b7280', fontSize: 10 }}
                          tickLine={false}
                          axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                          interval="preserveStartEnd"
                          tickCount={7}
                        />
                        <YAxis
                          tick={{ fill: '#6b7280', fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={formatGDPAxis}
                          width={52}
                        />
                        <Tooltip
                          content={<ChartTooltip />}
                          cursor={{ stroke: 'rgba(58,134,255,0.3)', strokeWidth: 1 }}
                        />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                        <Line
                          type="monotone"
                          dataKey="gdp"
                          stroke="#3a86ff"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, fill: '#3a86ff', stroke: '#fff', strokeWidth: 1 }}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {/* GDP per capita comparison */}
              <section>
                <SectionLabel>GDP per Capita vs World Average</SectionLabel>
                <GDPComparison country={country} />
              </section>

              {/* Fiscal */}
              <FiscalSection country={country} />

              {/* Trade flows */}
              <TradeSection country={country} />

              {/* Insights */}
              <InsightsSection countryCode={country.code} />

            </div>
          </>
        )}
      </div>
    </>
  );
}

// ── Insights ──────────────────────────────────────────────────────────────────

const insights = insightsData as Record<string, CountryInsight>;

function InsightsSection({ countryCode }: { countryCode: string }) {
  const insight = insights[countryCode];
  if (!insight) return null;

  const hasStrengths = insight.strengths.length > 0;
  const hasRisks     = insight.risks.length > 0;
  const hasAny = insight.overview || hasStrengths || hasRisks || insight.didYouKnow;
  if (!hasAny) return null;

  return (
    <section className="space-y-3">
      <SectionLabel>Insights</SectionLabel>

      {/* Overview */}
      {insight.overview && (
        <div
          className="rounded-lg p-3.5 text-sm text-gray-300 leading-relaxed"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          {insight.overview}
        </div>
      )}

      {/* Strengths */}
      {hasStrengths && (
        <div
          className="rounded-lg p-3.5 space-y-2"
          style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)' }}
        >
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Strengths</p>
          <ul className="space-y-1.5">
            {insight.strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="text-emerald-400 mt-0.5 flex-shrink-0">↑</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Risks */}
      {hasRisks && (
        <div
          className="rounded-lg p-3.5 space-y-2"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">Risks</p>
          <ul className="space-y-1.5">
            {insight.risks.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="text-red-400 mt-0.5 flex-shrink-0">↓</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Did You Know */}
      {insight.didYouKnow && (
        <div
          className="rounded-lg p-3.5 flex gap-3 items-start"
          style={{ background: 'rgba(58,134,255,0.07)', border: '1px solid rgba(58,134,255,0.2)' }}
        >
          <span className="text-lg leading-none flex-shrink-0">💡</span>
          <p className="text-sm text-gray-300 leading-relaxed">{insight.didYouKnow}</p>
        </div>
      )}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
      {children}
    </h3>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-xs text-gray-500 w-20 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-200 flex-1 break-words">{value}</span>
    </div>
  );
}
