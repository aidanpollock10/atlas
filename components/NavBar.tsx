'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/',          label: 'Globe'      },
  { href: '/rankings',  label: 'Rankings'   },
  { href: '/compare',   label: 'Compare'    },
  { href: '/scenarios', label: 'Scenarios'  },
] as const;

export default function NavBar({ className = '' }: { className?: string }) {
  const pathname = usePathname();

  return (
    <header
      className={`flex items-center gap-5 px-6 h-12 flex-shrink-0 ${className}`}
      style={{
        background:    'rgba(7,9,15,0.96)',
        borderBottom:  '1px solid rgba(255,255,255,0.07)',
        backdropFilter:'blur(12px)',
      }}
    >
      {/* Wordmark */}
      <Link href="/" className="select-none flex-shrink-0 group">
        <span className="text-sm font-bold tracking-[0.2em] text-white group-hover:text-blue-300 transition-colors">
          ATLAS
        </span>
      </Link>

      <div className="w-px h-4 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />

      {/* Nav links */}
      <nav className="flex items-center gap-0.5">
        {LINKS.map(({ href, label }) => {
          const isActive = href === '/' ? pathname === '/' : pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className="px-3 py-1.5 rounded-md text-sm transition-all duration-150"
              style={{
                color:      isActive ? '#f1f5f9' : '#64748b',
                background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                fontWeight: isActive ? 500 : 400,
              }}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
