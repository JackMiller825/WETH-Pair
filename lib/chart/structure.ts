export type StageId = "launch" | "discovery" | "early" | "intraday" | "mature" | "older"

export const STAGES: { id: StageId; label: string; maxMs: number }[] = [
  { id: "launch", label: "Launch", maxMs: 5 * 60 * 1000 },
  { id: "discovery", label: "Early discovery", maxMs: 15 * 60 * 1000 },
  { id: "early", label: "Early market", maxMs: 60 * 60 * 1000 },
  { id: "intraday", label: "Established intraday", maxMs: 6 * 60 * 60 * 1000 },
  { id: "mature", label: "Mature intraday", maxMs: 24 * 60 * 60 * 1000 },
  { id: "older", label: "Older than a day", maxMs: Number.POSITIVE_INFINITY },
]

export function stageOf(ageMs: number): { id: StageId; label: string } {
  const stage = STAGES.find((item) => ageMs < item.maxMs) ?? STAGES[STAGES.length - 1]
  return { id: stage.id, label: stage.label }
}

export const REVIEW_WINDOWS = [
  { id: "30s", label: "30 seconds", ms: 30 * 1000 },
  { id: "1m", label: "1 minute", ms: 60 * 1000 },
  { id: "3m", label: "3 minutes", ms: 3 * 60 * 1000 },
  { id: "5m", label: "5 minutes", ms: 5 * 60 * 1000 },
  { id: "15m", label: "15 minutes", ms: 15 * 60 * 1000 },
  { id: "30m", label: "30 minutes", ms: 30 * 60 * 1000 },
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "6h", label: "6 hours", ms: 6 * 60 * 60 * 1000 },
  { id: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { id: "since", label: "Since launch", ms: null },
] as const

export type WindowState = { id: string; label: string; ms: number | null; state: "ready" | "insufficient" }

/** A window longer than the pair's age is not analyzed. Since launch is ready once any history exists. */
export function reviewWindows(ageMs: number): WindowState[] {
  return REVIEW_WINDOWS.map((item) => ({
    id: item.id,
    label: item.label,
    ms: item.ms,
    state: item.ms == null ? (ageMs > 0 ? "ready" : "insufficient") : ageMs + 1000 >= item.ms ? "ready" : "insufficient",
  }))
}

export type PriceSample = { at: number; price: number }

export type PatternId = "healthy-uptrend" | "pump-dump" | "distribution" | "consolidation" | "failed-breakout" | "liquidity-shock" | "insufficient"

export type PatternResult = {
  id: PatternId
  label: string
  confidence: number
  evidence: string[]
  timeframeMs: number
}

const PATTERN_LABEL: Record<PatternId, string> = {
  "healthy-uptrend": "Healthy uptrend",
  "pump-dump": "Pump and dump",
  distribution: "Distribution",
  consolidation: "Consolidation",
  "failed-breakout": "Failed breakout",
  "liquidity-shock": "Liquidity shock",
  insufficient: "Insufficient history",
}

function finitePrices(samples: readonly PriceSample[]): PriceSample[] {
  return samples.filter((sample) => Number.isFinite(sample.at) && Number.isFinite(sample.price) && sample.price > 0).sort((a, b) => a.at - b.at)
}

function confidenceFor(count: number, spanMs: number): number {
  if (count < 4 || spanMs < 60_000) return 0.2
  let value = 0.45
  if (count >= 8) value += 0.15
  if (spanMs >= 5 * 60_000) value += 0.1
  if (spanMs >= 15 * 60_000) value += 0.1
  if (spanMs < 3 * 60_000) value = Math.min(value, 0.4)
  return Math.min(0.8, value)
}

/** Descriptive structure from observed prices. A short series stays low confidence. */
export function classifyStructure(samples: readonly PriceSample[], reserveDrop: number | null): PatternResult {
  const prices = finitePrices(samples)
  const span = prices.length < 2 ? 0 : prices[prices.length - 1].at - prices[0].at
  if (prices.length < 4 || span < 60_000) {
    return { id: "insufficient", label: PATTERN_LABEL.insufficient, confidence: prices.length === 0 ? 0 : 0.15, evidence: ["Fewer than four priced observations, or less than a minute of range."], timeframeMs: span }
  }
  const first = prices[0].price
  const last = prices[prices.length - 1].price
  let peak = prices[0]
  let trough = prices[0]
  for (const sample of prices) {
    if (sample.price > peak.price) peak = sample
    if (sample.price < trough.price) trough = sample
  }
  const drawdown = peak.price > 0 ? (peak.price - last) / peak.price : 0
  const rise = first > 0 ? (peak.price - first) / first : 0
  const range = trough.price > 0 ? (peak.price - trough.price) / trough.price : 0
  const early = prices.slice(0, Math.ceil(prices.length * 0.6))
  let earlyHigh = early[0].price
  for (const sample of early) if (sample.price > earlyHigh) earlyHigh = sample.price
  const broke = peak.price > earlyHigh * 1.03 && peak.at > early[early.length - 1].at - 1
  const backInside = last < earlyHigh
  const evidence: string[] = []
  evidence.push(`Price ${last >= first ? "rose" : "fell"} ${Math.abs((last - first) / first * 100).toFixed(0)}% across this window.`)
  evidence.push(`Drawdown from the high is ${(drawdown * 100).toFixed(0)}%.`)
  if (reserveDrop != null && reserveDrop <= -0.35) {
    evidence.push(`Pooled WETH changed ${(reserveDrop * 100).toFixed(0)}%.`)
    return { id: "liquidity-shock", label: PATTERN_LABEL["liquidity-shock"], confidence: Math.min(0.75, confidenceFor(prices.length, span) + 0.1), evidence, timeframeMs: span }
  }
  if (rise >= 0.5 && drawdown >= 0.4 && peak.at < prices[prices.length - 1].at) {
    evidence.push("The high was early and most of that rise was given back.")
    return { id: "pump-dump", label: PATTERN_LABEL["pump-dump"], confidence: confidenceFor(prices.length, span), evidence, timeframeMs: span }
  }
  if (broke && backInside) {
    evidence.push("Price printed above the earlier high and the latest price is back inside that range.")
    return { id: "failed-breakout", label: PATTERN_LABEL["failed-breakout"], confidence: confidenceFor(prices.length, span), evidence, timeframeMs: span }
  }
  const third = Math.max(1, Math.floor(prices.length / 3))
  const lows = [0, 1, 2].map((part) => {
    const slice = prices.slice(part * third, part === 2 ? prices.length : (part + 1) * third)
    let low = slice[0]?.price ?? first
    for (const sample of slice) if (sample.price < low) low = sample.price
    return low
  })
  const higherLows = lows[1] >= lows[0] * 0.97 && lows[2] >= lows[1] * 0.97
  if (last > first * 1.05 && higherLows && drawdown < 0.35) {
    evidence.push("Later lows held above earlier lows, and the pullback from the high stayed under 35%.")
    return { id: "healthy-uptrend", label: PATTERN_LABEL["healthy-uptrend"], confidence: confidenceFor(prices.length, span), evidence, timeframeMs: span }
  }
  if (range <= 0.12 && Math.abs(last - first) / first <= 0.08) {
    evidence.push("The high-to-low range stayed inside 12%.")
    return { id: "consolidation", label: PATTERN_LABEL.consolidation, confidence: confidenceFor(prices.length, span), evidence, timeframeMs: span }
  }
  if (drawdown >= 0.25 && last <= first * 1.1) {
    evidence.push("The latest price is near where it started after a larger high.")
    return { id: "distribution", label: PATTERN_LABEL.distribution, confidence: Math.min(0.55, confidenceFor(prices.length, span)), evidence, timeframeMs: span }
  }
  return { id: "insufficient", label: "No dominant structure", confidence: Math.min(0.35, confidenceFor(prices.length, span)), evidence: [...evidence, "The observations do not match a single structure strongly enough."], timeframeMs: span }
}
