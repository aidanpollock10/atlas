'use client';

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import { countries, Country } from '@/lib/data';

function runSearch(query: string): Country[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const scored = countries
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
    .slice(0, 8);
  return scored.map((x) => x.c);
}

export default function Search({ onSelect }: { onSelect: (country: Country) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Country[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [open, setOpen] = useState(false);
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
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = activeIdx >= 0 ? activeIdx : 0;
      if (results[idx]) select(results[idx]);
    } else if (e.key === 'Escape') {
      dismiss();
    }
  }

  const select = useCallback(
    (country: Country) => {
      onSelect(country);
      setQuery('');
      setResults([]);
      setOpen(false);
      setActiveIdx(-1);
      inputRef.current?.blur();
    },
    [onSelect]
  );

  function dismiss() {
    setOpen(false);
    setActiveIdx(-1);
  }

  return (
    <div className="relative w-full max-w-sm">
      {/* Input */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4 pointer-events-none"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
            clipRule="evenodd"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(dismiss, 150)}
          placeholder="Search countries… (Ctrl+K)"
          className="w-full rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500/50 transition-all"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        />
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div
          className="absolute top-full mt-1.5 w-full rounded-xl overflow-hidden z-50 shadow-2xl"
          style={{
            background: 'rgba(8,14,28,0.98)',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(16px)',
          }}
        >
          {results.map((country, i) => (
            <button
              key={country.code}
              onMouseDown={() => select(country)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                i === activeIdx
                  ? 'bg-blue-600/25 text-white'
                  : 'text-gray-300 hover:bg-white/[0.05]'
              }`}
            >
              <span className="text-xl leading-none flex-shrink-0">{country.flag}</span>
              <span className="flex-1 truncate font-medium">{country.name}</span>
              {country.capital && (
                <span className="text-xs text-gray-600 flex-shrink-0 truncate max-w-[80px]">
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
