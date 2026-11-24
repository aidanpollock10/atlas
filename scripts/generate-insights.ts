/**
 * scripts/generate-insights.ts
 *
 * Generates economic insights for every country from real data in
 * data/countries.json and writes the results to data/insights.json.
 *
 * All text is derived algorithmically from the actual numbers —
 * no generic filler. Run with: npx tsx scripts/generate-insights.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GDPPoint {
  year: number;
  value: number | null;
}

interface Country {
  code: string;
  name: string;
  region: string;
  gdp: number | null;
  gdpPerCapita: number | null;
  gdpGrowth: number | null;
  inflation: number | null;
  unemployment: number | null;
  population: number | null;
  gdpHistory: GDPPoint[];
}

export interface CountryInsight {
  overview?: string;
  strengths: string[];
  risks: string[];
  didYouKnow?: string;
}

// ── Load source data ───────────────────────────────────────────────────────────

const countries: Country[] = JSON.parse(
  fs.readFileSync(path.resolve('data/countries.json'), 'utf-8')
);

// ── Aggregate statistics ───────────────────────────────────────────────────────

function avg(vals: number[]): number | null {
  const v = vals.filter(n => isFinite(n) && !isNaN(n));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function nonNull<T>(arr: (T | null | undefined)[]): T[] {
  return arr.filter((x): x is T => x != null);
}

const worldAvgGDPPerCapita = avg(nonNull(countries.map(c => c.gdpPerCapita)));
const worldAvgUnemployment = avg(nonNull(countries.map(c => c.unemployment)));
const worldAvgGDPGrowth    = avg(nonNull(countries.map(c => c.gdpGrowth)));

const regions = [...new Set(countries.map(c => c.region).filter(Boolean))];

interface RegionalAvgs {
  gdpPerCapita: number | null;
  unemployment: number | null;
  inflation:    number | null;
  gdpGrowth:    number | null;
}

const regionalAvgs: Record<string, RegionalAvgs> = {};
for (const region of regions) {
  const cs = countries.filter(c => c.region === region);
  regionalAvgs[region] = {
    gdpPerCapita: avg(nonNull(cs.map(c => c.gdpPerCapita))),
    unemployment: avg(nonNull(cs.map(c => c.unemployment))),
    inflation:    avg(nonNull(cs.map(c => c.inflation))),
    gdpGrowth:    avg(nonNull(cs.map(c => c.gdpGrowth))),
  };
}

// World GDP rank (1 = largest)
const worldGDPRank = new Map(
  countries
    .filter(c => c.gdp != null)
    .sort((a, b) => (b.gdp ?? 0) - (a.gdp ?? 0))
    .map((c, i) => [c.code, i + 1])
);

// ── Historical helpers ─────────────────────────────────────────────────────────

function validHistory(c: Country): Array<{ year: number; value: number }> {
  return (c.gdpHistory ?? [])
    .filter((d): d is { year: number; value: number } => d.value != null && d.value > 0)
    .sort((a, b) => a.year - b.year);
}

/** How many consecutive years has GDP grown (counting backwards from latest)? */
function consecutiveGrowthYears(hist: Array<{ year: number; value: number }>): number {
  let count = 0;
  for (let i = hist.length - 1; i >= 1; i--) {
    if (hist[i].value > hist[i - 1].value) count++;
    else break;
  }
  return count;
}

/**
 * Ratio of latest GDP value vs the last data point at or before `targetYear`.
 * Returns null if no valid baseline exists.
 */
function gdpMultiplier(
  hist: Array<{ year: number; value: number }>,
  targetYear: number
): { ratio: number; fromYear: number } | null {
  if (hist.length < 2) return null;
  const latest = hist[hist.length - 1];
  const base   = [...hist].reverse().find(d => d.year <= targetYear);
  if (!base || base.value <= 0) return null;
  return { ratio: latest.value / base.value, fromYear: base.year };
}

// ── Text formatters ────────────────────────────────────────────────────────────

function fmtGDP(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)} trillion`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(0)} billion`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)} million`;
  return `$${n.toFixed(0)}`;
}

function fmtPC(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ── Main generator ─────────────────────────────────────────────────────────────

function generateInsight(c: Country): CountryInsight | null {
  const hasData =
    c.gdp != null || c.gdpPerCapita != null ||
    c.gdpGrowth != null || c.inflation != null || c.unemployment != null;
  if (!hasData) return null;

  const hist     = validHistory(c);
  const region   = c.region || '';
  const regAvgs  = region ? (regionalAvgs[region] ?? null) : null;
  const worldRank = worldGDPRank.get(c.code);
  const consec   = consecutiveGrowthYears(hist);
  const curYear  = new Date().getFullYear();

  // ── Overview (2-3 sentences) ───────────────────────────────────────────────
  const sentences: string[] = [];

  // S1: Economy size + global rank
  if (c.gdp != null) {
    const rankNote =
      worldRank && worldRank <= 5  ? `, the #${worldRank} largest economy in the world` :
      worldRank && worldRank <= 15 ? `, ranked #${worldRank} globally by GDP` :
      worldRank && worldRank <= 30 ? `, ranked #${worldRank} globally` : '';
    sentences.push(`${c.name} has a ${fmtGDP(c.gdp)} economy${rankNote}.`);
  }

  // S2: Per-capita income vs world average
  if (c.gdpPerCapita != null && worldAvgGDPPerCapita != null) {
    const ratio = c.gdpPerCapita / worldAvgGDPPerCapita;
    const pcStr = fmtPC(c.gdpPerCapita);
    if (c.gdp == null) {
      // GDP not yet introduced — use it as the lead
      if (ratio >= 2)
        sentences.push(`${c.name} has a per-capita income of ${pcStr}, which is ${ratio.toFixed(1)}× the world average.`);
      else if (ratio < 0.25)
        sentences.push(`${c.name} has a per-capita income of ${pcStr}, well below the world average.`);
      else
        sentences.push(`${c.name} has a per-capita income of ${pcStr}.`);
    } else {
      if (ratio >= 3)
        sentences.push(`Per-capita income of ${pcStr} is ${ratio.toFixed(1)}× the world average, placing it among the wealthiest nations.`);
      else if (ratio >= 1.5)
        sentences.push(`With a per-capita income of ${pcStr}, it sits above the world average.`);
      else if (ratio < 0.25)
        sentences.push(`Despite its total output, per-capita income of ${pcStr} remains far below the world average.`);
      else {
        const rel = ratio >= 1 ? 'above' : 'below';
        sentences.push(`Its per-capita income of ${pcStr} is ${rel} the world average.`);
      }
    }
  }

  // S3: Current growth trajectory
  if (c.gdpGrowth != null) {
    const sign = c.gdpGrowth >= 0 ? '+' : '';
    const adj =
      c.gdpGrowth >= 6  ? 'expanding rapidly' :
      c.gdpGrowth >= 3  ? 'growing solidly' :
      c.gdpGrowth >= 1  ? 'growing steadily' :
      c.gdpGrowth >= 0  ? 'growing modestly' :
      c.gdpGrowth >= -2 ? 'contracting slightly' :
      'in recession';
    sentences.push(`The economy is currently ${adj}, with GDP growth of ${sign}${c.gdpGrowth.toFixed(1)}%.`);
  } else if (hist.length >= 5 && sentences.length < 3) {
    const tail = hist.slice(-5);
    const growYears = tail.filter((d, i) => i > 0 && d.value > tail[i - 1].value).length;
    if (growYears >= 4)
      sentences.push(`Historical GDP data shows consistent growth in recent years.`);
  }

  const overview = sentences.length >= 2 ? sentences.slice(0, 3).join(' ') : undefined;

  // ── Strengths (up to 3) ───────────────────────────────────────────────────
  const strengths: string[] = [];

  // GDP growth strength
  if (c.gdpGrowth != null) {
    const wg = worldAvgGDPGrowth ?? 2.5;
    if (c.gdpGrowth >= 7)
      strengths.push(`Exceptional GDP growth of +${c.gdpGrowth.toFixed(1)}%`);
    else if (c.gdpGrowth >= 4)
      strengths.push(`Strong GDP growth at +${c.gdpGrowth.toFixed(1)}%`);
    else if (c.gdpGrowth >= 2 && c.gdpGrowth >= wg)
      strengths.push(`Above-average GDP growth of +${c.gdpGrowth.toFixed(1)}%`);
  }

  // Low unemployment
  if (c.unemployment != null) {
    if (c.unemployment < 3)
      strengths.push(`Near-full employment — unemployment at just ${c.unemployment.toFixed(1)}%`);
    else if (c.unemployment < 5)
      strengths.push(`Low unemployment rate of ${c.unemployment.toFixed(1)}%`);
  }

  // Stable prices
  if (c.inflation != null && c.inflation >= 0 && c.inflation <= 2)
    strengths.push(`Price stability with inflation at ${c.inflation.toFixed(1)}%`);

  // High per-capita income
  if (c.gdpPerCapita != null && worldAvgGDPPerCapita != null) {
    const r = c.gdpPerCapita / worldAvgGDPPerCapita;
    if (r >= 3)
      strengths.push(`Very high per-capita income — ${r.toFixed(1)}× the world average`);
    else if (r >= 1.5)
      strengths.push(`Above-average per-capita income of ${fmtPC(c.gdpPerCapita)}`);
  }

  // Sustained historical growth
  if (consec >= 15)
    strengths.push(`Uninterrupted GDP growth for ${consec} consecutive years`);
  else if (consec >= 7)
    strengths.push(`${consec} straight years of GDP growth`);

  // Global GDP leadership
  if (worldRank && worldRank <= 5)
    strengths.push(`One of the five largest economies in the world`);

  // ── Risks (up to 3) ───────────────────────────────────────────────────────
  const risks: string[] = [];

  // Inflation risk
  if (c.inflation != null) {
    if (c.inflation > 100)
      risks.push(`Hyperinflation at ${c.inflation.toFixed(0)}% — prices roughly double within a year`);
    else if (c.inflation > 50)
      risks.push(`Severe hyperinflation at ${c.inflation.toFixed(0)}%`);
    else if (c.inflation > 20)
      risks.push(`Very high inflation of ${c.inflation.toFixed(1)}%, sharply eroding purchasing power`);
    else if (c.inflation > 10)
      risks.push(`High inflation of ${c.inflation.toFixed(1)}%, well above healthy levels`);
    else if (c.inflation > 5)
      risks.push(`Elevated inflation at ${c.inflation.toFixed(1)}%`);
    else if (c.inflation < -0.5)
      risks.push(`Deflation risk — prices are falling at ${Math.abs(c.inflation).toFixed(1)}% per year`);
  }

  // GDP contraction
  if (c.gdpGrowth != null) {
    if (c.gdpGrowth < -4)
      risks.push(`Economy in deep recession — GDP contracting at ${c.gdpGrowth.toFixed(1)}%`);
    else if (c.gdpGrowth < 0)
      risks.push(`GDP growth is negative at ${c.gdpGrowth.toFixed(1)}%`);
  }

  // High unemployment
  if (c.unemployment != null) {
    const wu = worldAvgUnemployment ?? 6;
    if (c.unemployment > 25)
      risks.push(`Unemployment crisis — ${c.unemployment.toFixed(1)}% of the labour force is out of work`);
    else if (c.unemployment > 15)
      risks.push(`Very high unemployment rate of ${c.unemployment.toFixed(1)}%`);
    else if (c.unemployment > 10 && c.unemployment > wu * 1.5)
      risks.push(`High unemployment at ${c.unemployment.toFixed(1)}%, above the world average`);
  }

  // Very low per-capita income
  if (c.gdpPerCapita != null && worldAvgGDPPerCapita != null) {
    const r = c.gdpPerCapita / worldAvgGDPPerCapita;
    if (r < 0.08)
      risks.push(`Per-capita income is only ${(r * 100).toFixed(0)}% of the world average`);
    else if (r < 0.2)
      risks.push(`Very low per-capita income — ${(r * 100).toFixed(0)}% of the world average`);
  }

  // GDP well below recent peak
  if (hist.length >= 5) {
    const recentPeak = Math.max(...hist.slice(-10).map(d => d.value));
    const latest = hist[hist.length - 1].value;
    if (latest < recentPeak * 0.75)
      risks.push(`GDP is ~${((1 - latest / recentPeak) * 100).toFixed(0)}% below its recent peak`);
  }

  // ── Did You Know (best single fact) ───────────────────────────────────────
  const candidates: Array<{ text: string; score: number }> = [];

  // GDP long-run growth multiplier
  const mult30 = gdpMultiplier(hist, curYear - 30);
  if (mult30 && mult30.ratio >= 5)
    candidates.push({ text: `GDP has grown ${mult30.ratio.toFixed(0)}× since ${mult30.fromYear}`, score: mult30.ratio * 1.1 });

  const mult20 = gdpMultiplier(hist, curYear - 20);
  if (mult20 && mult20.ratio >= 4)
    candidates.push({ text: `GDP has grown ${mult20.ratio.toFixed(1)}× since ${mult20.fromYear}`, score: mult20.ratio });
  else if (mult20 && mult20.ratio >= 2)
    candidates.push({ text: `GDP has more than doubled since ${mult20.fromYear}`, score: mult20.ratio * 0.9 });

  const mult10 = gdpMultiplier(hist, curYear - 10);
  if (mult10 && mult10.ratio >= 3)
    candidates.push({ text: `GDP has tripled over the past decade`, score: mult10.ratio * 0.8 });
  else if (mult10 && mult10.ratio >= 2)
    candidates.push({ text: `GDP has more than doubled in the past decade`, score: mult10.ratio * 0.7 });

  // Per capita vs world
  if (c.gdpPerCapita != null && worldAvgGDPPerCapita != null) {
    const r = c.gdpPerCapita / worldAvgGDPPerCapita;
    if (r >= 6)
      candidates.push({ text: `Per-capita income is ${r.toFixed(1)}× the world average`, score: r * 0.9 });
    else if (r <= 0.05)
      candidates.push({ text: `Per-capita income is less than 5% of the world average`, score: 16 });
    else if (r <= 0.1)
      candidates.push({ text: `Per-capita income is just ${(r * 100).toFixed(0)}% of the world average`, score: 11 });
  }

  // Unemployment vs regional
  if (c.unemployment != null && regAvgs?.unemployment != null) {
    const regU = regAvgs.unemployment;
    const r = c.unemployment / regU;
    if (r >= 3)
      candidates.push({ text: `Unemployment is ${r.toFixed(1)}× the ${region} regional average`, score: r * 1.5 });
    else if (r >= 2)
      candidates.push({ text: `Unemployment is more than double the ${region} regional average`, score: r });
    else if (c.unemployment < 2.5 && regU > 6)
      candidates.push({ text: `An unemployment rate of ${c.unemployment.toFixed(1)}% is among the lowest in ${region}`, score: (regU / Math.max(c.unemployment, 0.5)) * 0.65 });
  }

  // GDP growth vs regional
  if (c.gdpGrowth != null && regAvgs?.gdpGrowth != null) {
    const diff = c.gdpGrowth - regAvgs.gdpGrowth;
    if (diff >= 6)
      candidates.push({ text: `GDP growth outpaces the ${region} regional average by ${diff.toFixed(1)} percentage points`, score: diff * 0.8 });
    else if (diff <= -8)
      candidates.push({ text: `GDP growth lags the ${region} regional average by ${Math.abs(diff).toFixed(1)} percentage points`, score: Math.abs(diff) * 0.6 });
  }

  // Consecutive growth streak
  if (consec >= 20)
    candidates.push({ text: `GDP has grown every year for the past ${consec} years without interruption`, score: consec * 0.55 });
  else if (consec >= 12)
    candidates.push({ text: `GDP has expanded for ${consec} consecutive years`, score: consec * 0.4 });

  // World GDP rank
  if (worldRank && worldRank <= 3)
    candidates.push({ text: `One of the world's three largest economies`, score: 22 });
  else if (worldRank && worldRank <= 10)
    candidates.push({ text: `One of the world's 10 largest economies by GDP`, score: 13 });

  // Hyperinflation highlight
  if (c.inflation != null && c.inflation > 100)
    candidates.push({ text: `Inflation exceeds ${Math.round(c.inflation)}% — prices roughly double in under a year`, score: 30 });

  candidates.sort((a, b) => b.score - a.score);
  const didYouKnow = candidates[0]?.text;

  // Require at least overview or one strength/risk to emit
  if (!overview && strengths.length === 0 && risks.length === 0 && !didYouKnow) return null;

  return {
    overview,
    strengths: strengths.slice(0, 3),
    risks: risks.slice(0, 3),
    didYouKnow,
  };
}

// ── Run ────────────────────────────────────────────────────────────────────────

const insights: Record<string, CountryInsight> = {};
let generated = 0;
let skipped = 0;

for (const country of countries) {
  const insight = generateInsight(country);
  if (insight) {
    insights[country.code] = insight;
    generated++;
  } else {
    skipped++;
  }
}

const outPath = path.resolve('data/insights.json');
fs.writeFileSync(outPath, JSON.stringify(insights, null, 2), 'utf-8');

console.log(`✓ Generated insights for ${generated} countries (${skipped} skipped — no data)`);
console.log(`✓ Written to ${outPath}`);
