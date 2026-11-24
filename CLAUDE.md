# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev              # Start dev server (Next.js with Turbopack) at http://localhost:3000
npm run build            # Production build
npm run lint             # ESLint
npm run generate-insights  # Run scripts/generate-insights.ts → writes data/insights.json
npm run fetch-fx           # Run scripts/fetch-fx.ts → writes data/fx.json (10yr monthly FX rates)
npm run fetch-trade        # Run scripts/fetch-trade.ts → writes data/trade.json (bilateral trade top-5 partners)
```

There are no tests.

## Architecture

Atlas is a static-data Next.js app (no backend, no API routes). All country data lives in `data/countries.json` and is imported at build time.

### Data flow

```
data/countries.json  ──import──▶  lib/data.ts  ──re-export──▶  components & pages
data/insights.json   ──import──▶  wherever insights are consumed (UI not yet wired up)
```

- `lib/data.ts` is the single source of truth for types (`Country`, `IndicatorColor`), computed aggregates (`worldAvgGDPPerCapita`), formatters (`formatGDP`, `formatPercent`, etc.), and color helpers (`gdpGrowthColor`, `inflationColor`, `unemploymentColor`).
- `data/insights.json` is **generated, not hand-edited** — run `npm run generate-insights` to (re)create it from `scripts/generate-insights.ts`. The script exports `CountryInsight` (overview, strengths, risks, didYouKnow). The file does not exist yet.

### Pages

| Route | File | Notes |
|---|---|---|
| `/` | `app/page.tsx` | Globe homepage. Handles `?country=XX` deep-link (auto-selects after 2s). |
| `/rankings` | `app/rankings/page.tsx` | Sortable table of all countries by any economic indicator. |
| `/compare` | `app/compare/page.tsx` | Side-by-side comparison of up to 4 countries with overlaid line charts. |

### Key components

- **`Globe.tsx`** — dynamically imported (SSR disabled). Uses `globe.gl` with `world-atlas` TopoJSON. Countries are colored by GDP per capita tier. Clicking a polygon triggers `onSelectCountry`. Country lookup from polygon features uses ISO numeric codes.
- **`CountryPanel.tsx`** — slide-in panel (right drawer on desktop, bottom sheet on mobile). Shows stats grid, details, a 30-year GDP history `LineChart` (Recharts), and a GDP-per-capita vs world average bar comparison. **Insights section not yet implemented.**
- **`Search.tsx`** — country search input.
- **`Footer.tsx`** — shared footer used by rankings and compare pages.

### Styling

Tailwind CSS v4 (PostCSS plugin, no config file). Dark theme throughout — backgrounds are raw `rgba()` values in `style={}` props rather than Tailwind classes for the translucent glass effect. Accent blue: `#3a86ff`.

### Cross-page navigation

Rankings and Compare pages link back to the globe via `/?country=XX` (ISO alpha-2 or alpha-3 code). The homepage `useEffect` picks this up and calls `handleSelect` after a 2-second delay to let the globe initialise.

## In-progress work: AI Insights

`scripts/generate-insights.ts` is complete. It reads `data/countries.json`, computes algorithmic insights (no LLM), and writes `data/insights.json` keyed by ISO alpha-2 code. The UI integration in `CountryPanel.tsx` has not been started — the next step is to load `data/insights.json` and render an "Insights" section in the panel.
