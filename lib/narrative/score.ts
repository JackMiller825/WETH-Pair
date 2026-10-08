import type { Direction, Lifecycle, ScoreParts } from "@/lib/narrative/types"

/** Weights are renormalized when discussion data was not collected. */
export const TREND_SCORE_WEIGHTS = {
  launchVelocity: 0.34,
  newsRelevance: 0.22,
  tokenActivity: 0.22,
  liquidityActivity: 0.16,
  discussion: 0.06,
} as const

export const SCORE_NOTES = [
  "Launch velocity compares the number of unique tokens in the selected window with the previous window of the same length, plus launches per hour.",
  "News relevance is 0 when no fetched headline shares the name, 42 for a possible keyword connection, 78 for a specific match published before the launches, and 95 only when a token description or social link points at that same story.",
  "Token activity grows with the log of the launch count and the sum of DEXTools 24h makers. Missing maker counts do not add points.",
  "Liquidity activity is the log of summed pool liquidity. Missing liquidity does not add points.",
  "Discussion uses matching Reddit posts from the feeds collected at publish time. If those feeds were unavailable, this component is left out and the other weights are scaled to 100%.",
  "Early Trend Score ignores absolute popularity. It rises when a name was absent in the previous 24 hours and then appears several times in the last 20 minutes.",
  "Saturation requires a large share of launches plus flat or falling velocity and lower average liquidity on newer launches than on earlier ones in the same window.",
]

export function velocityScore(current: number, previous: number, perHour: number): number {
  const ratio = previous === 0 ? (current > 0 ? 3 : 0) : current / previous
  const ratioScore = clamp((ratio - 0.4) * 35)
  const rateScore = clamp(perHour * 20)
  return Math.round(ratioScore * 0.65 + rateScore * 0.35)
}

export function tokenActivityScore(count: number, makers: number | null): number {
  const makerScore = makers === null ? 0 : Math.min(40, makers / 8)
  return clamp(Math.log2(count + 1) * 16 + makerScore)
}

export function liquidityScore(liquidity: number | null): number {
  if (liquidity === null || liquidity <= 0) return 0
  return clamp(Math.log10(liquidity) * 16)
}

export function discussionScore(matches: number): number {
  return clamp(matches * 25)
}

export function combineScore(parts: ScoreParts, discussionAvailable: boolean): number {
  const weights: Record<keyof typeof TREND_SCORE_WEIGHTS, number> = { ...TREND_SCORE_WEIGHTS }
  if (!discussionAvailable || parts.discussion === null) {
    const rest = 1 - weights.discussion
    weights.launchVelocity /= rest
    weights.newsRelevance /= rest
    weights.tokenActivity /= rest
    weights.liquidityActivity /= rest
    weights.discussion = 0
  }
  const discussion = parts.discussion ?? 0
  return clamp(
    parts.launchVelocity * weights.launchVelocity +
      parts.newsRelevance * weights.newsRelevance +
      parts.tokenActivity * weights.tokenActivity +
      parts.liquidityActivity * weights.liquidityActivity +
      discussion * weights.discussion,
  )
}

export function directionOf(current: number, previous: number): Direction {
  if (current === 0 && previous === 0) return "stable"
  if (previous === 0 && current >= 3) return "surging"
  if (previous === 0 && current > 0) return "rising"
  const ratio = current / previous
  if (ratio >= 2.5 && current >= 3) return "surging"
  if (ratio >= 1.35) return "rising"
  if (ratio >= 0.75) return "stable"
  if (ratio >= 0.4) return "declining"
  return "cooling"
}

export function earlyScore(recent: number, baseline: number): number {
  let score = 0
  if (baseline === 0 && recent > 0) score += 45
  if (baseline <= 1 && recent >= 2) score += 20
  if (baseline === 0) score += Math.min(30, recent * 8)
  else score += clamp(((recent - baseline) / baseline) * 20)
  if (recent > 15) score -= 20
  if (recent > 40) score -= 25
  return clamp(score)
}

export function lifecycleOf(input: {
  current: number
  previous: number
  share: number
  direction: Direction
  score: number
  early: number
  liquidityFading: boolean
}): Lifecycle {
  if (input.current === 0 && input.previous > 0) return "dead"
  if (input.current === 0) return "dead"
  const crowded = input.current >= 20 && input.share >= 0.12
  const fading = input.direction === "declining" || input.direction === "cooling" || input.direction === "stable"
  if (crowded && fading && input.liquidityFading) return "saturated"
  if (input.early >= 65 && input.current <= 10 && input.previous <= 1) return "emerging"
  if (input.direction === "surging" && input.score >= 80) return "exploding"
  if (input.score >= 70) return "hot"
  if (input.direction === "rising") return "growing"
  if (input.direction === "declining" || input.direction === "cooling") return "cooling"
  return "stable"
}

export function statusLabel(score: number, lifecycle: Lifecycle): string {
  if (score >= 90) return "🔥 Extremely Hot"
  if (lifecycle === "emerging") return "⚡ Emerging Narrative"
  if (lifecycle === "saturated") return "⚠ Highly Saturated"
  if (lifecycle === "exploding") return "🚀 Exploding"
  if (lifecycle === "hot") return "🔥 Hot"
  if (lifecycle === "dead") return "💀 Dead"
  if (lifecycle === "cooling") return "↓ Cooling"
  if (lifecycle === "growing") return "↑ Growing"
  return "→ Stable"
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}
