export default function Footer() {
  return (
    <footer
      className="mt-auto px-8 py-6"
      style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <span className="text-xs font-bold tracking-[0.2em]" style={{ color: '#334155' }}>ATLAS</span>
        <span className="text-xs text-center" style={{ color: '#334155' }}>
          Data:{' '}
          <a href="https://data.worldbank.org" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-gray-400 underline underline-offset-2" style={{ color: '#475569' }}>
            World Bank
          </a>
          {' · '}
          <a href="https://restcountries.com" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-gray-400 underline underline-offset-2" style={{ color: '#475569' }}>
            REST Countries
          </a>
          {' · All figures USD · Most recent year'}
        </span>
      </div>
    </footer>
  );
}
