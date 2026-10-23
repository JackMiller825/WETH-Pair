export const VERDICTS = ["strong", "mixed", "weakening", "manipulation", "liquidity", "insufficient"] as const
export type VerdictId = (typeof VERDICTS)[number]

export const VERDICT_LABEL: Record<VerdictId, string> = {
  strong: "Strong structure",
  mixed: "Mixed / consolidating",
  weakening: "Weakening",
  manipulation: "Manipulation risk",
  liquidity: "Liquidity risk",
  insufficient: "Insufficient evidence",
}

export type ReviewOutcome = {
  horizon: "15m" | "1h" | "6h" | "24h"
  priceChange: number | null
  reserveChange: number | null
  recordedAt: number
}

/** The verdict and notes are fixed at submission. Later outcomes are appended. */
export type ChartReview = {
  id: string
  pair: string
  submittedAt: number
  cutoff: number
  verdict: VerdictId
  confidence: number
  notes: string
  engineVerdict: VerdictId
  engineConfidence: number
  outcomes: ReviewOutcome[]
}

export function submitReview(existing: readonly ChartReview[], review: ChartReview): ChartReview[] {
  if (existing.some((item) => item.id === review.id)) return [...existing]
  return [...existing, { ...review, outcomes: [...review.outcomes] }]
}

export function appendOutcome(reviews: readonly ChartReview[], id: string, outcome: ReviewOutcome): ChartReview[] {
  return reviews.map((review) => {
    if (review.id !== id) return review
    if (review.outcomes.some((item) => item.horizon === outcome.horizon)) return review
    return { ...review, verdict: review.verdict, notes: review.notes, confidence: review.confidence, outcomes: [...review.outcomes, outcome] }
  })
}

export type Calibration = { label: "Overconfident" | "Well calibrated" | "Unknown"; samples: number; hitRate: number | null }

/** Compares the user's verdict with the engine verdict stored at submission. Needs eight settled reviews. */
export function calibration(reviews: readonly ChartReview[]): Calibration {
  const settled = reviews.filter((review) => review.outcomes.length > 0 && review.confidence >= 90)
  if (settled.length < 8) return { label: "Unknown", samples: settled.length, hitRate: null }
  const hits = settled.filter((review) => review.verdict === review.engineVerdict).length
  const hitRate = hits / settled.length
  if (hitRate < 0.7) return { label: "Overconfident", samples: settled.length, hitRate }
  if (hitRate >= 0.75) return { label: "Well calibrated", samples: settled.length, hitRate }
  return { label: "Unknown", samples: settled.length, hitRate }
}

export function commonMistake(reviews: readonly ChartReview[]): string | null {
  const misses = reviews.filter((review) => review.outcomes.length > 0 && review.verdict !== review.engineVerdict)
  if (misses.length < 3) return null
  const counts = new Map<string, number>()
  for (const review of misses) {
    const key = `${review.verdict}->${review.engineVerdict}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best: { key: string; count: number } | null = null
  for (const [key, count] of counts) if (!best || count > best.count) best = { key, count }
  if (!best) return null
  const [user, engine] = best.key.split("->") as [VerdictId, VerdictId]
  return `You often marked ${VERDICT_LABEL[user]} when the stored evidence read ${VERDICT_LABEL[engine]}.`
}

function hash(value: string): number {
  let total = 0
  for (let index = 0; index < value.length; index += 1) total = (total * 33 + value.charCodeAt(index)) >>> 0
  return total
}

/** Ten pairs for one calendar day. The same day returns the same set. */
export function drillPairs(pairs: readonly { address: string }[], day: string, count = 10): string[] {
  return [...pairs]
    .map((pair) => pair.address.toLowerCase())
    .filter((address, index, list) => list.indexOf(address) === index)
    .sort((a, b) => hash(`${day}:${a}`) - hash(`${day}:${b}`))
    .slice(0, count)
}
