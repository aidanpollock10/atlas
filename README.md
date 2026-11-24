# Atlas

An interactive world-economy explorer — browse economic indicators, compare countries, and model global shocks on a live 3D globe.

**Live:** _link coming soon_

![Screenshot](docs/screenshot.png)

---

## Features

- **Interactive 3D globe** — WebGL globe with country polygons, click-to-select, auto-rotation, and a custom starfield background
- **Map layers** — switch between GDP per capita, GDP growth, inflation, unemployment, and debt-to-GDP coloring
- **Country profiles** — slide-in panel with key stats (GDP, growth, inflation, unemployment, debt/GDP, current account), 30-year GDP history chart, FX rates, and top-5 trade partners
- **Trade flows** — bilateral import/export partners with value and share breakdowns (BACI 2023 data)
- **Rankings** — sortable table of all countries by any economic indicator
- **Compare** — side-by-side comparison of up to 4 countries with overlaid line charts
- **Scenario simulator** — model four global shocks (oil price, US interest rates, China growth, USD strength), see the globe recolor live on a diverging scale, and get a top-10 hurt/helped country ranking with one-line explanations

---

## Tech stack

| Layer | Library / Tool |
|---|---|
| Framework | Next.js 15 (App Router, static export) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 (PostCSS plugin) |
| Globe | globe.gl + world-atlas TopoJSON |
| Charts | Recharts |
| Font | Geist (Vercel) |
| Data scripts | tsx (Node) |

---

## Data sources

| Data | Source |
|---|---|
| GDP, growth, inflation, unemployment, debt/GDP, current account | [IMF World Economic Outlook DataMapper](https://www.imf.org/external/datamapper/) (primary, 2026 estimates) |
| Same indicators (fallback + history) | [World Bank Open Data](https://data.worldbank.org/) |
| Country metadata (names, regions, flags, coordinates) | [REST Countries](https://restcountries.com/) |
| FX rates (10-year monthly history) | [Frankfurter / ECB](https://www.frankfurter.app/) + World Bank PA.NUS.FCRF |
| Bilateral trade flows | [OEC / BACI HS92](https://oec.world/) via OEC Tesseract API (2023) |

All sources are free and require no API key.

---

## Running locally

```bash
# Install dependencies
npm install

# Start the dev server (http://localhost:3000)
npm run dev

# Production build
npm run build
```

### Refreshing data

The JSON files in `data/` are pre-built and committed. To regenerate them:

```bash
npm run fetch-data      # IMF + World Bank indicators → data/countries.json
npm run fetch-fx        # ECB FX history → data/fx.json
npm run fetch-trade     # OEC bilateral trade → data/trade.json
npm run generate-insights  # Algorithmic insights → data/insights.json
```

Fetching takes ~2–3 minutes (rate-limited World Bank calls). No API keys required.
