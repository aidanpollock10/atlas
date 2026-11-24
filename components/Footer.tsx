export default function Footer() {
  return (
    <footer
      className="mt-auto px-8 py-8 text-xs text-gray-700"
      style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <span className="text-gray-500 font-semibold tracking-widest">ATLAS</span>
        <span className="text-center">
          Economic data:{' '}
          <a
            href="https://data.worldbank.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-gray-400 underline transition-colors"
          >
            World Bank Open Data
          </a>
          {' '}·{' '}
          Country metadata:{' '}
          <a
            href="https://restcountries.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-gray-400 underline transition-colors"
          >
            REST Countries
          </a>
          {' '}· All figures in USD · Most recent available year
        </span>
      </div>
    </footer>
  );
}
