'use client';

import { useEffect, useRef, useCallback, MutableRefObject, useState } from 'react';
import type { GlobeInstance } from 'globe.gl';
import { countries, Country, formatGDP, formatPopulation } from '@/lib/data';
import { fx1YChangeCache } from '@/lib/fx';
import { buildTradeArcs, TradeArcDatum } from '@/lib/trade';
import CountryPanel from './CountryPanel';

interface GlobeProps {
  selectedCountry: Country | null;
  onSelectCountry: (country: Country) => void;
  onClose: () => void;
  flyToRef: MutableRefObject<((country: Country) => void) | null>;
  /** When provided, globe recolors by scenario impact instead of a layer. */
  scenarioImpacts?: Record<string, number>;
  /** Hide the layer switcher (used on scenarios page). */
  scenarioMode?: boolean;
}

// ── Layer types ───────────────────────────────────────────────────────────────

export type GlobeLayer =
  | 'gdpPerCapita'
  | 'gdpGrowth'
  | 'inflation'
  | 'unemployment'
  | 'debtToGDP'
  | 'currentAccount'
  | 'fxChange';

const LAYER_LABELS: Record<GlobeLayer, string> = {
  gdpPerCapita:   'GDP/Capita',
  gdpGrowth:      'GDP Growth',
  inflation:      'Inflation',
  unemployment:   'Unemployment',
  debtToGDP:      'Debt/GDP',
  currentAccount: 'Curr. Account',
  fxChange:       'FX (1Y)',
};

// ── Country lookup ────────────────────────────────────────────────────────────

function buildNumericLookup(): Map<number, Country> {
  const map = new Map<number, Country>();
  for (const c of countries) {
    if (c.numericCode) {
      const num = parseInt(c.numericCode, 10);
      if (!isNaN(num)) map.set(num, c);
    }
  }
  return map;
}

const numericLookup = buildNumericLookup();

function getCountryFromFeature(feature: unknown): Country | undefined {
  if (!feature || typeof feature !== 'object') return undefined;
  const f = feature as { id?: string | number };
  if (f.id !== undefined) {
    const numId = typeof f.id === 'number' ? f.id : parseInt(String(f.id), 10);
    if (!isNaN(numId)) return numericLookup.get(numId);
  }
  return undefined;
}

// ── Color scales ──────────────────────────────────────────────────────────────

const NO_DATA   = 'rgba(50,80,120,0.5)';
const NO_COUNTRY = 'rgba(40,60,90,0.4)';
const HOVER     = 'rgba(100,200,255,0.85)';

function getCapColorForLayer(d: unknown, hovered: unknown, layer: GlobeLayer): string {
  if (d === hovered) return HOVER;
  const c = getCountryFromFeature(d);
  if (!c) return NO_COUNTRY;

  switch (layer) {
    case 'gdpPerCapita': {
      const g = c.gdpPerCapita;
      if (g == null) return NO_DATA;
      if (g >= 40000) return 'rgba(30,140,80,0.6)';
      if (g >= 15000) return 'rgba(60,140,160,0.6)';
      if (g >= 5000)  return 'rgba(160,140,40,0.6)';
      if (g >= 1000)  return 'rgba(160,90,30,0.6)';
      return 'rgba(140,40,40,0.6)';
    }
    case 'gdpGrowth': {
      const g = c.gdpGrowth;
      if (g == null) return NO_DATA;
      if (g < -3)  return 'rgba(160,30,30,0.75)';
      if (g < -1)  return 'rgba(160,80,40,0.65)';
      if (g <  1)  return 'rgba(100,100,80,0.6)';
      if (g <  4)  return 'rgba(50,140,80,0.65)';
      return 'rgba(20,160,60,0.75)';
    }
    case 'inflation': {
      const v = c.inflation;
      if (v == null) return NO_DATA;
      if (v < 0)   return 'rgba(100,80,180,0.6)';
      if (v <= 2)  return 'rgba(30,140,80,0.6)';
      if (v <= 5)  return 'rgba(180,160,40,0.6)';
      if (v <= 10) return 'rgba(180,100,30,0.6)';
      return 'rgba(180,30,30,0.6)';
    }
    case 'unemployment': {
      const v = c.unemployment;
      if (v == null) return NO_DATA;
      if (v < 5)   return 'rgba(30,140,80,0.6)';
      if (v <= 10) return 'rgba(180,160,40,0.6)';
      if (v <= 20) return 'rgba(180,100,30,0.6)';
      return 'rgba(180,30,30,0.6)';
    }
    case 'debtToGDP': {
      const v = c.debtToGDP ?? null;
      if (v == null) return NO_DATA;
      if (v < 30)  return 'rgba(30,140,80,0.6)';
      if (v < 60)  return 'rgba(180,160,40,0.6)';
      if (v < 90)  return 'rgba(180,100,30,0.6)';
      return 'rgba(180,30,30,0.6)';
    }
    case 'currentAccount': {
      const v = c.currentAccount ?? null;
      if (v == null) return NO_DATA;
      if (v < -5)  return 'rgba(160,30,30,0.75)';
      if (v < -2)  return 'rgba(160,80,40,0.65)';
      if (v <  2)  return 'rgba(100,100,80,0.6)';
      if (v <  5)  return 'rgba(50,120,160,0.65)';
      return 'rgba(30,80,180,0.75)';
    }
    case 'fxChange': {
      // 1-year change of local currency vs USD; positive = appreciation
      const change = fx1YChangeCache.get(c.currency.code) ?? null;
      if (change === null) return NO_DATA;
      if (change >  10) return 'rgba(20,160,60,0.75)';
      if (change >   2) return 'rgba(50,140,80,0.65)';
      if (change >  -2) return 'rgba(100,100,80,0.6)';
      if (change > -10) return 'rgba(160,80,40,0.65)';
      return 'rgba(160,30,30,0.75)';
    }
  }
}

// ── Legend config ─────────────────────────────────────────────────────────────

type LegendItem = { color: string; label: string };

const LEGENDS: Record<GlobeLayer, LegendItem[]> = {
  gdpPerCapita: [
    { color: 'rgba(30,140,80,0.8)',   label: '$40,000+' },
    { color: 'rgba(60,140,160,0.8)',  label: '$15,000–40,000' },
    { color: 'rgba(160,140,40,0.8)',  label: '$5,000–15,000' },
    { color: 'rgba(160,90,30,0.8)',   label: '$1,000–5,000' },
    { color: 'rgba(140,40,40,0.8)',   label: 'Under $1,000' },
    { color: 'rgba(50,80,120,0.8)',   label: 'No data' },
  ],
  gdpGrowth: [
    { color: 'rgba(20,160,60,0.8)',   label: '> 4%' },
    { color: 'rgba(50,140,80,0.8)',   label: '1–4%' },
    { color: 'rgba(100,100,80,0.8)',  label: '−1–1% (flat)' },
    { color: 'rgba(160,80,40,0.8)',   label: '−3–−1%' },
    { color: 'rgba(160,30,30,0.8)',   label: '< −3%' },
    { color: 'rgba(50,80,120,0.8)',   label: 'No data' },
  ],
  inflation: [
    { color: 'rgba(30,140,80,0.8)',   label: '0–2% (target)' },
    { color: 'rgba(180,160,40,0.8)',  label: '2–5%' },
    { color: 'rgba(180,100,30,0.8)',  label: '5–10%' },
    { color: 'rgba(180,30,30,0.8)',   label: '> 10%' },
    { color: 'rgba(100,80,180,0.8)',  label: 'Deflation' },
    { color: 'rgba(50,80,120,0.8)',   label: 'No data' },
  ],
  unemployment: [
    { color: 'rgba(30,140,80,0.8)',   label: '< 5%' },
    { color: 'rgba(180,160,40,0.8)',  label: '5–10%' },
    { color: 'rgba(180,100,30,0.8)',  label: '10–20%' },
    { color: 'rgba(180,30,30,0.8)',   label: '> 20%' },
    { color: 'rgba(50,80,120,0.8)',   label: 'No data' },
  ],
  debtToGDP: [
    { color: 'rgba(30,140,80,0.8)',   label: '< 30%' },
    { color: 'rgba(180,160,40,0.8)',  label: '30–60%' },
    { color: 'rgba(180,100,30,0.8)',  label: '60–90%' },
    { color: 'rgba(180,30,30,0.8)',   label: '> 90%' },
    { color: 'rgba(50,80,120,0.8)',   label: 'No data' },
  ],
  currentAccount: [
    { color: 'rgba(30,80,180,0.8)',   label: '> 5% (surplus)' },
    { color: 'rgba(50,120,160,0.8)',  label: '2–5%' },
    { color: 'rgba(100,100,80,0.8)',  label: '−2–2% (balanced)' },
    { color: 'rgba(160,80,40,0.8)',   label: '−5–−2%' },
    { color: 'rgba(160,30,30,0.8)',   label: '< −5% (deficit)' },
    { color: 'rgba(50,80,120,0.8)',   label: 'No data' },
  ],
  fxChange: [
    { color: 'rgba(20,160,60,0.8)',   label: '> 10% gain vs USD' },
    { color: 'rgba(50,140,80,0.8)',   label: '2–10% gain' },
    { color: 'rgba(100,100,80,0.8)',  label: '±2% (stable / pegged)' },
    { color: 'rgba(160,80,40,0.8)',   label: '2–10% loss' },
    { color: 'rgba(160,30,30,0.8)',   label: '> 10% loss vs USD' },
    { color: 'rgba(50,80,120,0.8)',   label: 'No data' },
  ],
};

// ── Scenario color helper ─────────────────────────────────────────────────────

function scenarioImpactColor(pp: number): string {
  if (pp >  3.0) return 'rgba(20,180,80,0.85)';
  if (pp >  1.5) return 'rgba(40,160,70,0.75)';
  if (pp >  0.5) return 'rgba(60,150,80,0.65)';
  if (pp >  0.1) return 'rgba(80,130,80,0.55)';
  if (pp > -0.1) return 'rgba(90,90,90,0.50)';
  if (pp > -0.5) return 'rgba(140,80,60,0.55)';
  if (pp > -1.5) return 'rgba(180,55,40,0.65)';
  if (pp > -3.0) return 'rgba(205,35,25,0.75)';
  return 'rgba(220,15,15,0.85)';
}

function getPolygonCapColor(
  d: unknown,
  hovered: unknown,
  layer: GlobeLayer,
  scenarioImpacts: Record<string, number> | null
): string {
  if (d === hovered) return HOVER;
  if (scenarioImpacts) {
    const c = getCountryFromFeature(d);
    if (!c) return NO_COUNTRY;
    const pp = scenarioImpacts[c.code];
    if (pp === undefined) return NO_DATA;
    return scenarioImpactColor(pp);
  }
  return getCapColorForLayer(d, hovered, layer);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GlobeComponent({
  selectedCountry,
  onSelectCountry,
  onClose,
  flyToRef,
  scenarioImpacts,
  scenarioMode = false,
}: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef     = useRef<GlobeInstance | null>(null);
  const hoveredRef   = useRef<unknown>(null);
  const tooltipRef   = useRef<HTMLDivElement>(null);

  // ── Loading / error state ────────────────────────────────────────────────
  const [globeReady, setGlobeReady] = useState(false);
  const [globeError, setGlobeError] = useState(false);

  // ── Layer state ──────────────────────────────────────────────────────────
  const [layer, setLayer] = useState<GlobeLayer>('gdpPerCapita');
  const layerRef = useRef<GlobeLayer>('gdpPerCapita');
  const scenarioImpactsRef = useRef<Record<string, number> | null>(null);

  // ── Rotation state ──────────────────────────────────────────────────────
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(true);
  const autoRotateEnabledRef = useRef(true);
  const selectedCountryRef   = useRef(selectedCountry);
  const resumeTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { autoRotateEnabledRef.current = autoRotateEnabled; }, [autoRotateEnabled]);
  useEffect(() => { selectedCountryRef.current = selectedCountry; }, [selectedCountry]);

  // Update layer ref + redraw globe colors when layer or scenario changes
  useEffect(() => {
    layerRef.current = layer;
    const globe = globeRef.current;
    if (!globe) return;
    globe.polygonCapColor((d) => getPolygonCapColor(d, hoveredRef.current, layerRef.current, scenarioImpactsRef.current));
  }, [layer]);

  // Re-color globe whenever scenarioImpacts updates (live slider feedback)
  useEffect(() => {
    scenarioImpactsRef.current = scenarioImpacts ?? null;
    const globe = globeRef.current;
    if (!globe) return;
    globe.polygonCapColor((d) => getPolygonCapColor(d, hoveredRef.current, layerRef.current, scenarioImpactsRef.current));
  }, [scenarioImpacts]);

  // Update trade arcs when selected country changes
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !globeReady) return;

    if (!selectedCountry) {
      globe.arcsData([]);
      return;
    }

    const arcs = buildTradeArcs(selectedCountry);
    if (arcs.length === 0) {
      globe.arcsData([]);
      return;
    }

    const maxVal = Math.max(...arcs.map(a => a.value), 1);

    globe
      .arcsData(arcs)
      .arcStartLat((d: unknown) => (d as TradeArcDatum).startLat)
      .arcStartLng((d: unknown) => (d as TradeArcDatum).startLng)
      .arcEndLat((d: unknown)   => (d as TradeArcDatum).endLat)
      .arcEndLng((d: unknown)   => (d as TradeArcDatum).endLng)
      .arcColor((d: unknown) => {
        const a = d as TradeArcDatum;
        return a.type === 'export'
          ? ['rgba(16,185,129,0.1)', 'rgba(16,185,129,0.9)']
          : ['rgba(245,158,11,0.1)',  'rgba(245,158,11,0.9)'];
      })
      .arcStroke((d: unknown) => 0.4 + ((d as TradeArcDatum).value / maxVal) * 1.6)
      .arcDashLength(0.4)
      .arcDashGap(0.6)
      .arcDashAnimateTime(1500)
      .arcAltitudeAutoScale(0.4)
      .arcsTransitionDuration(400);
  }, [selectedCountry, globeReady]);

  // Schedule resume (used by interaction-end callbacks)
  const scheduleResume = useCallback(() => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      if (autoRotateEnabledRef.current && !selectedCountryRef.current) {
        const ctrl = globeRef.current?.controls();
        if (ctrl) ctrl.autoRotate = true;
      }
    }, 3000);
  }, []);

  // React to selectedCountry + toggle changes
  useEffect(() => {
    const ctrl = globeRef.current?.controls();
    if (!ctrl) return;
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);

    if (!autoRotateEnabled) {
      ctrl.autoRotate = false;
      return;
    }
    if (selectedCountry) {
      ctrl.autoRotate = false;
    } else {
      const t = setTimeout(() => {
        if (autoRotateEnabledRef.current && !selectedCountryRef.current) {
          ctrl.autoRotate = true;
        }
      }, 2000);
      resumeTimerRef.current = t;
      return () => clearTimeout(t);
    }
  }, [selectedCountry, autoRotateEnabled]);

  // ── Globe init ───────────────────────────────────────────────────────────
  const updateTooltip = useCallback(
    (x: number, y: number, country: Country | null, visible: boolean) => {
      const el = tooltipRef.current;
      if (!el) return;
      if (!visible || !country) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.left = `${x + 16}px`;
      el.style.top  = `${y - 10}px`;
      const q = (sel: string) => el.querySelector(sel);
      const n = q('[data-name]'); if (n) n.textContent = country.name;
      const p = q('[data-pop]');  if (p) p.textContent = `Pop: ${formatPopulation(country.population)}`;
      const g = q('[data-gdp]');  if (g) g.textContent = `GDP: ${formatGDP(country.gdp)}`;
      const f = q('[data-flag]'); if (f) f.textContent = country.flag;
    },
    []
  );

  useEffect(() => {
    if (!containerRef.current) return;
    let mounted = true;

    async function initGlobe() {
      if (!mounted || !containerRef.current) return;

      try {
      const GlobeLib = (await import('globe.gl')).default;
      const topojson  = await import('topojson-client');
      const topoMod   = await import('world-atlas/countries-110m.json');
      if (!mounted || !containerRef.current) return;

      const topology = topoMod.default as unknown as {
        type: string; arcs: number[][][];
        objects: {
          countries: Parameters<typeof topojson.feature>[1];
          land:      Parameters<typeof topojson.feature>[1];
        };
      };

      const geoData  = topojson.feature(
        topology as unknown as Parameters<typeof topojson.feature>[0],
        topology.objects.countries
      );
      const features = 'features' in geoData ? geoData.features : [];
      if (!mounted || !containerRef.current) return;

      const { clientWidth: w, clientHeight: h } = containerRef.current;
      // Generate a subtle sparse star field (fewer, dimmer stars than the default night-sky.png)
      const starfieldUrl = (() => {
        const c = document.createElement('canvas');
        c.width = 1024; c.height = 512;
        const ctx2 = c.getContext('2d')!;
        ctx2.fillStyle = '#07090f';
        ctx2.fillRect(0, 0, 1024, 512);
        for (let i = 0; i < 280; i++) {
          const sx = Math.random() * 1024;
          const sy = Math.random() * 512;
          const sr = Math.random() * 0.55 + 0.1;
          const sa = Math.random() * 0.22 + 0.04;
          ctx2.beginPath();
          ctx2.arc(sx, sy, sr, 0, Math.PI * 2);
          ctx2.fillStyle = `rgba(200,215,255,${sa.toFixed(3)})`;
          ctx2.fill();
        }
        return c.toDataURL();
      })();
      const globe = new GlobeLib(containerRef.current);

      globe
        .width(w).height(h)
        .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
        .backgroundImageUrl(starfieldUrl)
        .atmosphereColor('#3a86ff')
        .atmosphereAltitude(0.12)
        .polygonsData(features)
        .polygonAltitude((d) => (d === hoveredRef.current ? 0.06 : 0.01))
        .polygonCapColor((d) => getPolygonCapColor(d, hoveredRef.current, layerRef.current, scenarioImpactsRef.current))
        .polygonSideColor(() => 'rgba(0,80,180,0.15)')
        .polygonStrokeColor(() => '#1a2a3a')
        .polygonLabel(() => '')
        .onPolygonHover((d) => {
          hoveredRef.current = d;
          globe
            .polygonAltitude((p) => (p === hoveredRef.current ? 0.06 : 0.01))
            .polygonCapColor((p) => getPolygonCapColor(p, hoveredRef.current, layerRef.current, scenarioImpactsRef.current));
        })
        .onPolygonClick((d) => {
          const country = getCountryFromFeature(d);
          if (country) {
            onSelectCountry(country);
            globe.pointOfView({ lat: country.lat, lng: country.lng, altitude: 1.5 }, 1000);
          }
        });

      globeRef.current = globe;

      flyToRef.current = (country: Country) => {
        globe.pointOfView({ lat: country.lat, lng: country.lng, altitude: 1.5 }, 1000);
      };

      // ── OrbitControls interaction detection ─────────────────────────────
      const ctrl = globe.controls();
      ctrl.autoRotate      = true;
      ctrl.autoRotateSpeed = 0.4;

      const onStart = () => {
        if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
        ctrl.autoRotate = false;
      };
      const onEnd = () => scheduleResume();

      ctrl.addEventListener('start', onStart);
      ctrl.addEventListener('end',   onEnd);

      const onWheel = () => {
        if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
        ctrl.autoRotate = false;
        if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
        wheelTimerRef.current = setTimeout(scheduleResume, 400);
      };
      containerRef.current.addEventListener('wheel', onWheel, { passive: true });

      // ── Resize ─────────────────────────────────────────────────────────
      const ro = new ResizeObserver(() => {
        if (containerRef.current) {
          globe.width(containerRef.current.clientWidth).height(containerRef.current.clientHeight);
        }
      });
      ro.observe(containerRef.current);

      if (mounted) setGlobeReady(true);

      return () => {
        flyToRef.current = null;
        ctrl.removeEventListener('start', onStart);
        ctrl.removeEventListener('end',   onEnd);
        containerRef.current?.removeEventListener('wheel', onWheel);
        ro.disconnect();
        globe._destructor();
      };
      } catch (err) {
        console.error('[Atlas] Globe init failed:', err);
        if (mounted) setGlobeError(true);
      }
    }

    const cleanup = initGlobe();
    return () => {
      mounted = false;
      cleanup.then((fn) => fn?.());
    };
  }, [flyToRef, onSelectCountry, scheduleResume]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const c = hoveredRef.current ? getCountryFromFeature(hoveredRef.current) : null;
      updateTooltip(x, y, c ?? null, !!c);
    },
    [updateTooltip]
  );
  const handleMouseLeave = useCallback(() => updateTooltip(0, 0, null, false), [updateTooltip]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full">
      {/* Loading overlay */}
      {!globeReady && !globeError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
          <div className="w-14 h-14 rounded-full border-2 border-blue-500/20 border-t-blue-400 animate-spin" />
          <p className="text-gray-500 text-sm mt-5 tracking-wider">Initializing globe…</p>
        </div>
      )}
      {/* Error state */}
      {globeError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <p className="text-gray-400 text-sm">Globe failed to load.</p>
          <p className="text-gray-600 text-xs mt-1">Try refreshing the page.</p>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: 'grab' }}
      />

      {/* Tooltip */}
      <div ref={tooltipRef} className="absolute pointer-events-none z-10 select-none" style={{ display: 'none' }}>
        <div
          className="rounded-lg px-3 py-2 text-sm text-white shadow-lg"
          style={{ background: 'rgba(10,20,40,0.92)', border: '1px solid rgba(100,200,255,0.25)', backdropFilter: 'blur(8px)', minWidth: '160px' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span data-flag className="text-xl" />
            <span data-name className="font-semibold" />
          </div>
          <div className="text-gray-400 text-xs space-y-0.5">
            <div data-pop /><div data-gdp />
          </div>
        </div>
      </div>

      {/* Country detail panel */}
      <CountryPanel country={selectedCountry} onClose={onClose} />

      {/* Layer switcher — top-left, below nav */}
      {!scenarioMode && (
        <div
          className="absolute left-4 z-10 rounded-xl p-3"
          style={{ top: '60px', background: 'rgba(7,9,15,0.9)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)' }}
        >
          <div className="text-xs font-semibold uppercase tracking-widest mb-2.5" style={{ color: '#475569', letterSpacing: '0.12em' }}>Layer</div>
          <div className="grid grid-cols-2 gap-1">
            {(Object.keys(LAYER_LABELS) as GlobeLayer[]).map((l) => (
              <button
                key={l}
                onClick={() => setLayer(l)}
                className="text-xs px-2 py-1.5 rounded-md transition-all duration-150 text-left whitespace-nowrap"
                style={{
                  background: layer === l ? 'rgba(58,134,255,0.18)' : 'rgba(255,255,255,0.03)',
                  border:     `1px solid ${layer === l ? 'rgba(58,134,255,0.45)' : 'rgba(255,255,255,0.06)'}`,
                  color:      layer === l ? '#93c5fd' : '#64748b',
                  fontWeight: layer === l ? 500 : 400,
                }}
              >
                {LAYER_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom-left: legend */}
      <div
        className="absolute bottom-5 left-4 z-10 rounded-xl p-3 text-xs"
        style={{ background: 'rgba(7,9,15,0.9)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', maxWidth: 200 }}
      >
        {scenarioMode ? (
          <>
            <div className="font-semibold uppercase tracking-widest mb-2.5" style={{ color: '#475569', letterSpacing: '0.12em', fontSize: 10 }}>GDP Impact</div>
            <div className="space-y-1.5">
              {[
                { color: 'rgba(20,180,80,0.85)',  label: '> +3 pp' },
                { color: 'rgba(60,150,80,0.65)',  label: '+0.5–3 pp' },
                { color: 'rgba(90,90,90,0.50)',   label: '±0.1 pp' },
                { color: 'rgba(180,55,40,0.65)',  label: '−0.5–3 pp' },
                { color: 'rgba(220,15,15,0.85)',  label: '< −3 pp' },
                { color: 'rgba(50,80,120,0.80)',  label: 'No data' },
              ].map(item => <LegendRow key={item.label} color={item.color} label={item.label} />)}
            </div>
          </>
        ) : (
          <>
            <div className="font-semibold uppercase tracking-widest mb-2.5" style={{ color: '#475569', letterSpacing: '0.12em', fontSize: 10 }}>
              {LAYER_LABELS[layer]}
            </div>
            <div className="space-y-1.5">
              {LEGENDS[layer].map((item) => (
                <LegendRow key={item.label} color={item.color} label={item.label} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Bottom-right: controls group */}
      <div
        className="absolute bottom-5 right-4 z-10 rounded-xl px-3 py-2.5 flex flex-col items-end gap-2.5"
        style={{ background: 'rgba(7,9,15,0.9)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)' }}
      >
        <button
          onClick={() => setAutoRotateEnabled((v) => !v)}
          title={autoRotateEnabled ? 'Pause auto-rotation' : 'Enable auto-rotation'}
          className="flex items-center gap-2 text-xs transition-colors duration-150 select-none"
          style={{ color: autoRotateEnabled ? '#93c5fd' : '#475569' }}
        >
          {autoRotateEnabled ? <PauseIcon /> : <PlayIcon />}
          <span>{autoRotateEnabled ? 'Rotating' : 'Paused'}</span>
        </button>
        <div className="text-xs text-right leading-relaxed" style={{ color: '#334155' }}>
          <div>Click · select country</div>
          <div>Drag · rotate  ·  Scroll · zoom</div>
        </div>
      </div>
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: color }} />
      <span className="text-gray-300">{label}</span>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
      <path d="M2 2.5l8 3.5-8 3.5V2.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
      <rect x="2" y="2" width="3" height="8" rx="0.5" />
      <rect x="7" y="2" width="3" height="8" rx="0.5" />
    </svg>
  );
}
