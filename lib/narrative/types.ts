import type { BackfillState } from "@/lib/history/plan"
import type { ChainCheckpoint } from "@/lib/lp/burn-logic"
import type { LpBurnEvent, LpScan } from "@/lib/lp/monitor"
import type { PairRecord } from "@/lib/types"
import type { ConceptHit } from "@/lib/narrative/text"
import { RANGES, rangeById } from "@/lib/time-range"

export const WINDOWS = RANGES

export type WindowId = (typeof WINDOWS)[number]["id"]

export function windowById(id: string) {
  return rangeById(id)
}

export type OriginLabel = "Confirmed Origin" | "Highly Likely" | "Possible Connection" | "Unknown"

export type Direction = "surging" | "rising" | "stable" | "declining" | "cooling"

export type Lifecycle = "emerging" | "growing" | "hot" | "exploding" | "saturated" | "stable" | "cooling" | "dead"

export type NewsItem = {
  id: string
  title: string
  url: string
  source: string
  kind: "news" | "reddit"
  publishedAt: string
}

export type NarrativeTotals = {
  launches1h: number
  liquidity24h: number
  volume24h: number
  makers24h: number
  deployers24h: number
}

export type HistoryPoint = {
  at: string
  narratives: Record<string, NarrativeTotals>
}

export type SnapshotFile = {
  generatedAt: string
  hours: number
  scanned: number
  rows: PairRecord[]
  news?: NewsItem[]
  history?: HistoryPoint[]
  lpBurns?: LpBurnEvent[]
  lpScan?: LpScan
  chain?: ChainCheckpoint
  backfill?: BackfillState
}

export type TokenRef = {
  address: string
  tokenAddress: string
  symbol: string
  tokenName: string
  createdAt: string
  liquidity: number | null
  marketCap: number | null
  volume24h: number | null
  makers24h: number | null
  url: string
}

export type TokenAnalysis = TokenRef & {
  concepts: ConceptHit[]
  primaryIds: string[]
  tickerPatterns: string[]
  words: string[]
  deployer: string | null
  description: string | null
  website: string | null
  twitter: string | null
  telegram: string | null
  tokenCreatedAt: string | null
  buys24h: number | null
}

export type ScoreParts = {
  launchVelocity: number
  newsRelevance: number
  tokenActivity: number
  liquidityActivity: number
  discussion: number | null
}

export type Origin = {
  label: OriginLabel
  summary: string
  confidence: number
  evidence: string[]
  sources: NewsItem[]
}

export type TrendKind = "concept" | "word" | "ticker" | "combination" | "cluster" | "family"

export type Trend = {
  id: string
  slug: string
  name: string
  kind: TrendKind
  count: number
  previousCount: number
  share: number
  firstAt: string | null
  lastAt: string | null
  perHour: number
  growth: number | null
  direction: Direction
  lifecycle: Lifecycle
  score: number
  earlyScore: number
  parts: ScoreParts
  tickers: { ticker: string; count: number }[]
  tokens: TokenRef[]
  origin: Origin
  keywords: string[]
  liquidity: number | null
  volume24h: number | null
  makers24h: number | null
  marketCapAvg: number | null
  best: TokenRef | null
  deployers: number
  tokensWithDeployer: number
  narrative: string
}

export type NewsCorrelation = {
  news: NewsItem
  tokens: TokenRef[]
  firstTokenAt: string | null
  minutesToFirst: number | null
  deployers: number
  liquidity: number | null
  volume24h: number | null
  best: TokenRef | null
  origin: Origin
  concepts: string[]
}

export type Bucket = { at: string; launches: number }

export type Intelligence = {
  generatedAt: string
  windowId: string
  windowLabel: string
  total: number
  previousTotal: number
  tokens: TokenAnalysis[]
  concepts: Trend[]
  words: Trend[]
  tickers: Trend[]
  combinations: Trend[]
  clusters: Trend[]
  families: Trend[]
  emerging: Trend[]
  hot: Trend[]
  cooling: Trend[]
  newsLinks: NewsCorrelation[]
  discussionAvailable: boolean
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  surging: "🔥 Surging",
  rising: "↑ Rising",
  stable: "→ Stable",
  declining: "↓ Declining",
  cooling: "❄ Cooling",
}

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  emerging: "⚡ Emerging",
  growing: "↑ Growing",
  hot: "🔥 Hot",
  exploding: "🚀 Exploding",
  saturated: "⚠ Highly Saturated",
  stable: "→ Stable",
  cooling: "↓ Cooling",
  dead: "💀 Dead",
}
