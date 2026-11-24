'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { MutableRefObject, useRef } from 'react';
import NavBar from '@/components/NavBar';
import { Country } from '@/lib/data';
import {
  computeImpacts,
  toColorMap,
  DEFAULT_PARAMS,
  ShockParams,
  CountryImpact,
} from '@/lib/shocks';

const Globe = dynamic(() => import('@/components/Globe'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-14 h-14 rounded-full border-2 border-blue-500/20 border-t-blue-400 animate-spin" />
    </div>
  ),
});

// ── Slider config ─────────────────────────────────────────────────────────────

interface SliderConfig {
  key: keyof ShockParams;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  formatValue: (v: number) => string;
  accentColor: string;
}

const SLIDERS: SliderConfig[] = [
  {
    key: 'oil',
    label: 'Oil Price',
    min: -50, max: 100, step: 5,
    unit: '%',
    formatValue: (v) => `${v > 0 ? '+' : ''}${v}%`,
    accentColor: '#f59e0b',
  },
  {
    key: 'rates',
    label: 'US Interest Rates',
    min: -3, max: 5, step: 0.25,
    unit: 'pp',
    formatValue: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} pp`,
    accentColor: '#3a86ff',
  },
  {
    key: 'china',
    label: 'China GDP Growth',
    min: -5, max: 0, step: 0.5,
    unit: 'pp',
    formatValue: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} pp`,
    accentColor: '#ef4444',
  },
  {
    key: 'dollar',
    label: 'USD Strength',
    min: -20, max: 30, step: 2.5,
    unit: '%',
    formatValue: (v) => `${v > 0 ? '+' : ''}${v}%`,
    accentColor: '#10b981',
  },
];

// ── Methodology text ──────────────────────────────────────────────────────────

const METHODOLOGY = [
  {
    title: 'Oil Price Shock',
    color: '#f59e0b',
    body: `Each country has a "net oil exposure" in % of GDP (positive = exporter, negative = importer), based on World Bank oil rents data. Impact = exposure × price change × 0.30. The 0.30 pass-through factor reflects that oil windfalls partly flow to sovereign funds rather than directly into GDP. Saudi Arabia (oil ≈ 22% of GDP) gains ~3.3 pp from a +50% oil shock; Japan (−4% oil/GDP) loses ~0.6 pp.`,
  },
  {
    title: 'US Interest Rates',
    color: '#3a86ff',
    body: `Three sub-channels: (a) global liquidity tightening (−0.08 pp per +1 pp US rate, for all countries); (b) debt-service burden (scaled by debt/GDP × USD-debt share × 0.20, reduced for developed markets whose debt is mostly domestic-currency); (c) current-account vulnerability (larger deficits = higher capital-flight risk). Emerging markets with high USD debt and CA deficits feel the most pain.`,
  },
  {
    title: 'China Growth Slowdown',
    color: '#ef4444',
    body: `Uses 2022 bilateral trade data to compute each country's exports to China as a share of its GDP. Impact = exports-to-China/GDP × slowdown × 1.5. The 1.5 multiplier covers direct demand (1.0×), commodity price spillover — China drives ~50% of global metals demand (+0.3×), and financial/confidence effects (+0.2×). Australia, Chile, and much of sub-Saharan Africa face the largest hits.`,
  },
  {
    title: 'USD Strength',
    color: '#10b981',
    body: `Three sub-channels: (a) external debt service — USD-denominated debt becomes more expensive in local terms; (b) commodity terms-of-trade — a stronger dollar historically lowers USD-priced commodity revenues for exporters; (c) trade competitiveness — surplus countries see exports become cheaper. Note: USD-pegged economies (Gulf states, etc.) already price in USD, so their debt channel is limited.`,
  },
  {
    title: 'Important caveats',
    color: '#9ca3af',
    body: `All formulas are linear approximations. Real-world effects are non-linear, path-dependent, and interact with domestic policy. Second-round effects, monetary policy responses, and financial market dynamics are not modelled. The USD-debt share and oil-exposure figures are estimates from public sources, simplified for transparency. This tool is intended for intuition-building only.`,
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScenariosPage() {
  const [params, setParams] = useState<ShockParams>(DEFAULT_PARAMS);
  const [showMethodology, setShowMethodology] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const flyToRef = useRef<((c: Country) => void) | null>(null) as MutableRefObject<((c: Country) => void) | null>;

  const impacts = useMemo(() => computeImpacts(params), [params]);
  const colorMap = useMemo(() => toColorMap(impacts), [impacts]);

  const anyActive = params.oil !== 0 || params.rates !== 0 || params.china !== 0 || params.dollar !== 0;

  // Top 10 hurt and helped
  const sorted = useMemo(
    () => [...impacts].sort((a, b) => a.total - b.total),
    [impacts]
  );
  const hurt    = sorted.slice(0, 10);
  const helped  = sorted.slice(-10).reverse();

  function setParam(key: keyof ShockParams, value: number) {
    setParams(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div className="flex flex-col h-screen bg-[#060a14] text-white overflow-hidden">

      <NavBar />

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel */}
        <div
          className="flex-shrink-0 w-80 flex flex-col overflow-y-auto"
          style={{ borderRight: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="px-4 pt-3 pb-0">
            <div
              className="text-xs px-2.5 py-1.5 rounded-lg w-full text-center"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}
            >
              Illustrative model — not a forecast
            </div>
          </div>

          {/* Sliders */}
          <div className="p-4 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Shock Controls</h2>
              {anyActive && (
                <button
                  onClick={() => setParams(DEFAULT_PARAMS)}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-0.5 rounded"
                  style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  Reset all
                </button>
              )}
            </div>

            {SLIDERS.map(cfg => (
              <SliderRow
                key={cfg.key}
                config={cfg}
                value={params[cfg.key]}
                onChange={(v) => setParam(cfg.key, v)}
              />
            ))}
          </div>

          <div className="mx-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }} />

          {/* Methodology toggle */}
          <div className="p-4">
            <button
              onClick={() => setShowMethodology(v => !v)}
              className="w-full flex items-center justify-between text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              <span className="font-semibold uppercase tracking-wider">Methodology</span>
              <svg
                className="w-4 h-4 transition-transform"
                style={{ transform: showMethodology ? 'rotate(180deg)' : 'rotate(0deg)' }}
                viewBox="0 0 20 20" fill="currentColor"
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {showMethodology && (
              <div className="mt-3 space-y-4">
                {METHODOLOGY.map(m => (
                  <div key={m.title}>
                    <div className="text-xs font-semibold mb-1" style={{ color: m.color }}>{m.title}</div>
                    <p className="text-xs text-gray-400 leading-relaxed">{m.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rankings — only when shocks are active */}
          {anyActive && (
            <>
              <div className="mx-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }} />
              <div className="p-4 space-y-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Most Impacted</h2>

                <ImpactList title="10 Most Hurt" items={hurt} variant="hurt" />
                <ImpactList title="10 Most Helped" items={helped} variant="helped" />
              </div>
            </>
          )}

          {!anyActive && (
            <div className="p-4 pt-0">
              <p className="text-xs text-gray-600 leading-relaxed">
                Move a slider to see estimated GDP-growth impacts on the globe and rankings.
              </p>
            </div>
          )}
        </div>

        {/* Globe */}
        <div className="flex-1 relative">
          <Globe
            selectedCountry={selectedCountry}
            onSelectCountry={setSelectedCountry}
            onClose={() => setSelectedCountry(null)}
            flyToRef={flyToRef}
            scenarioImpacts={anyActive ? colorMap : undefined}
            scenarioMode={true}
          />
        </div>
      </div>
    </div>
  );
}

// ── SliderRow ─────────────────────────────────────────────────────────────────

function SliderRow({
  config,
  value,
  onChange,
}: {
  config: SliderConfig;
  value: number;
  onChange: (v: number) => void;
}) {
  const isActive = value !== 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium" style={{ color: isActive ? '#e5e7eb' : '#9ca3af' }}>
          {config.label}
        </label>
        <span
          className="text-xs font-mono px-1.5 py-0.5 rounded tabular-nums"
          style={{
            background: isActive ? `${config.accentColor}20` : 'rgba(255,255,255,0.05)',
            border: `1px solid ${isActive ? `${config.accentColor}50` : 'rgba(255,255,255,0.1)'}`,
            color: isActive ? config.accentColor : '#6b7280',
            minWidth: '70px',
            textAlign: 'right',
          }}
        >
          {config.formatValue(value)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <span>{config.formatValue(config.min)}</span>
        <input
          type="range"
          min={config.min}
          max={config.max}
          step={config.step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: isActive
              ? `linear-gradient(to right, ${config.accentColor}80, ${config.accentColor}80 ${((value - config.min) / (config.max - config.min)) * 100}%, rgba(255,255,255,0.1) ${((value - config.min) / (config.max - config.min)) * 100}%)`
              : 'rgba(255,255,255,0.1)',
            accentColor: config.accentColor,
            height: '4px',
          }}
        />
        <span>{config.formatValue(config.max)}</span>
      </div>
    </div>
  );
}

// ── ImpactList ────────────────────────────────────────────────────────────────

function ImpactList({
  title,
  items,
  variant,
}: {
  title: string;
  items: CountryImpact[];
  variant: 'hurt' | 'helped';
}) {
  const color = variant === 'hurt' ? '#ef4444' : '#22c55e';
  return (
    <div>
      <div className="text-xs font-semibold mb-2" style={{ color }}>{title}</div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={item.country.code} className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-gray-600 text-xs w-4 text-right flex-shrink-0">{i + 1}.</span>
              <span className="text-xs">{item.country.flag}</span>
              <span className="text-xs font-medium text-gray-200 flex-1 truncate">{item.country.name}</span>
              <span
                className="text-xs font-mono font-semibold flex-shrink-0"
                style={{ color: item.total >= 0 ? '#22c55e' : '#ef4444' }}
              >
                {item.total >= 0 ? '+' : ''}{item.total.toFixed(2)} pp
              </span>
            </div>
            <p className="text-xs text-gray-500 leading-snug ml-6 line-clamp-2">{item.topReason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
