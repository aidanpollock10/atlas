'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Search from '@/components/Search';
import { countries, Country } from '@/lib/data';
import { usePathname } from 'next/navigation';

const Globe = dynamic(() => import('@/components/Globe'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-12 h-12 rounded-full border-2 border-blue-500/20 border-t-blue-400 animate-spin" />
    </div>
  ),
});

const NAV_LINKS = [
  { href: '/rankings',  label: 'Rankings'  },
  { href: '/compare',   label: 'Compare'   },
  { href: '/scenarios', label: 'Scenarios' },
] as const;

export default function Home() {
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const flyToRef = useRef<((country: Country) => void) | null>(null);
  const pathname = usePathname();

  const handleSelect = useCallback((country: Country) => {
    setSelectedCountry(country);
    flyToRef.current?.(country);
  }, []);

  const handleClose = useCallback(() => setSelectedCountry(null), []);

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
    <main className="relative w-screen h-screen overflow-hidden" style={{ background: '#07090f' }}>
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div
        className="absolute top-0 left-0 right-0 z-10 flex items-center gap-4 px-5 sm:px-7 h-12"
        style={{
          background:    'rgba(7,9,15,0.9)',
          borderBottom:  '1px solid rgba(255,255,255,0.07)',
          backdropFilter:'blur(12px)',
        }}
      >
        {/* Wordmark */}
        <div className="flex-shrink-0 select-none">
          <span className="text-sm font-bold tracking-[0.2em] text-white">ATLAS</span>
        </div>

        {/* Search — centred */}
        <div className="flex-1 flex justify-center">
          <Search onSelect={handleSelect} />
        </div>

        {/* Nav links */}
        <nav className="hidden sm:flex items-center gap-0.5 flex-shrink-0">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="px-3 py-1.5 rounded-md text-sm transition-colors"
              style={{ color: pathname === href ? '#f1f5f9' : '#64748b' }}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {/* ── Globe ──────────────────────────────────────────────────── */}
      <Globe
        selectedCountry={selectedCountry}
        onSelectCountry={setSelectedCountry}
        onClose={handleClose}
        flyToRef={flyToRef}
      />
    </main>
  );
}
