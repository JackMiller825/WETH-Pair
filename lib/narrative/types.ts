import type { LpBurnEvent, LpScan } from "@/lib/lp/monitor"
import type { PairRecord } from "@/lib/types"
import type { ConceptHit } from "@/lib/narrative/text"

export const WINDOWS = [
  { id: "5m", label: "5 minutes", ms: 5 * 60 * 1000 },
  { id: "15m", label: "15 minutes", ms: 15 * 60 * 1000 },
  { id: "30m", label: "30 minutes", ms: 30 * 60 * 1000 },
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "3h", label: "3 hours", ms: 3 * 60 * 60 * 1000 },
  { id: "6h", label: "6 hours", ms: 6 * 60 * 60 * 1000 },
  { id: "12h", label: "12 hours", ms: 12 * 60 * 60 * 1000 },
  { id: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { id: "3d", label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
] as const

export type WindowId = (typeof WINDOWS)[number]["id"]

export function windowById(id: string) {
  return WINDOWS.find((item) => item.id === id) ?? WINDOWS[3]
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
  windowId: WindowId
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
