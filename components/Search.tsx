'use client';

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import { countries, Country } from '@/lib/data';

function runSearch(query: string): Country[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return countries
    .map((c) => {
      const name = c.name.toLowerCase();
      if (name === q) return { c, s: 0 };
      if (name.startsWith(q)) return { c, s: 1 };
      if (name.split(/\s+/).some((w) => w.startsWith(q))) return { c, s: 2 };
      if (name.includes(q)) return { c, s: 3 };
      return null;
    })
    .filter((x): x is { c: Country; s: number } => x !== null)
    .sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name))
    .slice(0, 8)
    .map((x) => x.c);
}

export default function Search({ onSelect }: { onSelect: (country: Country) => void }) {
  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState<Country[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [open,      setOpen]      = useState(false);
  const [focused,   setFocused]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K / Cmd+K to focus
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    const res = runSearch(val);
    setResults(res);
    setActiveIdx(-1);
    setOpen(res.length > 0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown')  { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter')     { e.preventDefault(); const idx = activeIdx >= 0 ? activeIdx : 0; if (results[idx]) select(results[idx]); }
    else if (e.key === 'Escape')    { dismiss(); }
  }

  const select = useCallback((country: Country) => {
    onSelect(country);
    setQuery('');
    setResults([]);
    setOpen(false);
    setActiveIdx(-1);
    inputRef.current?.blur();
  }, [onSelect]);

  function dismiss() { setOpen(false); setActiveIdx(-1); }

  // Detect OS for key hint
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  const keyHint = isMac ? '⌘K' : 'Ctrl K';

  return (
    <div className="relative w-full max-w-xs sm:max-w-sm">
      <div className="relative">
        {/* Search icon */}
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none w-3.5 h-3.5"
          style={{ color: focused ? '#94a3b8' : '#475569' }}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { setFocused(true); results.length > 0 && setOpen(true); }}
          onBlur={() => { setFocused(false); setTimeout(dismiss, 150); }}
          placeholder="Search countries"
          className="w-full rounded-lg pl-8 pr-14 py-1.5 text-sm text-white placeholder-[#475569] outline-none transition-all"
          style={{
            background: focused ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${focused ? 'rgba(58,134,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
          }}
        />

        {/* Key hint badge */}
        {!focused && !query && (
          <kbd
            className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-xs px-1.5 py-0.5 rounded select-none"
            style={{
              color: '#475569',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              fontFamily: 'var(--font-geist-mono)',
            }}
          >
            {keyHint}
          </kbd>
        )}
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div
          className="absolute top-full mt-1.5 w-full rounded-xl overflow-hidden z-50 shadow-2xl"
          style={{
            background:    'rgba(8,12,24,0.98)',
            border:        '1px solid rgba(255,255,255,0.1)',
            backdropFilter:'blur(16px)',
          }}
        >
          {results.map((country, i) => (
            <button
              key={country.code}
              onMouseDown={() => select(country)}
              onMouseEnter={() => setActiveIdx(i)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors"
              style={{
                background: i === activeIdx ? 'rgba(58,134,255,0.15)' : 'transparent',
                color:      i === activeIdx ? '#f1f5f9' : '#94a3b8',
                borderBottom: i < results.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              }}
            >
              <span className="text-lg leading-none flex-shrink-0">{country.flag}</span>
              <span className="flex-1 truncate font-medium" style={{ color: '#f1f5f9' }}>{country.name}</span>
              {country.capital && (
                <span className="text-xs flex-shrink-0 truncate max-w-[80px]" style={{ color: '#475569' }}>
                  {country.capital}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
