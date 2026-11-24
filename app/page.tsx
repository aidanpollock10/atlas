'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Search from '@/components/Search';
import { countries, Country } from '@/lib/data';

const Globe = dynamic(() => import('@/components/Globe'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-14 h-14 rounded-full border-2 border-blue-500/20 border-t-blue-400 animate-spin" />
    </div>
  ),
});

export default function Home() {
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const flyToRef = useRef<((country: Country) => void) | null>(null);

  const handleSelect = useCallback((country: Country) => {
    setSelectedCountry(country);
    flyToRef.current?.(country);
  }, []);

  const handleClose = useCallback(() => setSelectedCountry(null), []);

  // Handle ?country=XX navigation from the rankings / compare pages
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('country');
    if (!code) return;
    const country = countries.find(c => c.code === code || c.code3 === code);
    if (!country) return;
    const timer = setTimeout(() => handleSelect(country), 2000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="relative w-screen h-screen bg-black overflow-hidden">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 sm:px-8 pt-4 sm:pt-5">
        {/* Logo */}
        <div className="flex-shrink-0 pointer-events-none select-none">
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-widest leading-none">ATLAS</h1>
          <p className="text-gray-500 text-xs mt-0.5 hidden sm:block">World Economy Explorer</p>
        </div>

        {/* Search — centred */}
        <div className="flex-1 flex justify-center">
          <Search onSelect={handleSelect} />
        </div>

        {/* Nav links — hidden on small screens */}
        <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
          <NavLink href="/rankings">Rankings</NavLink>
          <NavLink href="/compare">Compare</NavLink>
        </div>
      </div>

      {/* ── Globe ───────────────────────────────────────────────────── */}
      <Globe
        selectedCountry={selectedCountry}
        onSelectCountry={setSelectedCountry}
        onClose={handleClose}
        flyToRef={flyToRef}
      />
    </main>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg whitespace-nowrap"
      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
    >
      {children} ↗
    </Link>
  );
}
