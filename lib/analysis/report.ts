import { formatBurnPercent } from "@/lib/lp/burn-logic"
import type { LpBurnEvent } from "@/lib/lp/monitor"
import { analyzeEvents, type EvidenceLevel, type TokenLink } from "@/lib/narrative/events"
import type { NewsItem, TokenAnalysis } from "@/lib/narrative/types"
import type { PairRecord } from "@/lib/types"

export type ChainFacts = {
  bytecodeBytes: number | null
  decimals: number | null
  totalSupply: string | null
  owner: string | null
}

export type TimelineItem = {
  at: string
  label: string
  kind: "fact" | "calculated" | "interpretation"
  source: string
}

export type ScoreItem = {
  name: string
  score: number
  reason: string
}

export type TokenReport = {
  token: TokenAnalysis
  record: PairRecord | null
  facts: { label: string; value: string; source: string }[]
  calculated: { label: string; value: string; source: string }[]
  interpretation: { label: string; value: string; confidence: number | null }[]
  liquidityNote: string
  deployerAddress: string | null
  deployerTokens: { symbol: string; tokenName: string; tokenAddress: string; createdAt: string; lpStatus: string }[]
  news: TokenLink[]
  rejectedNews: TokenLink[]
  related: { symbol: string; tokenName: string; tokenAddress: string; reason: string }[]
  timeline: TimelineItem[]
  scorecard: ScoreItem[]
  unavailable: string[]
  failed: string[]
  chain: ChainFacts | null
}

export function buildTokenReport(input: {
  token: TokenAnalysis
  rows: PairRecord[]
  burns: LpBurnEvent[]
  news: NewsItem[]
  tokens: TokenAnalysis[]
  chain?: ChainFacts | { error: string } | null
}): TokenReport {
  const record = input.rows.find((row) => row.tokenAddress.toLowerCase() === input.token.tokenAddress.toLowerCase()) ?? null
  const burn = input.burns.find((event) => event.tokenAddress.toLowerCase() === input.token.tokenAddress.toLowerCase() && event.burnAt)
  const analyses = analyzeEvents(input.news, input.tokens)
  const news = analyses.flatMap((analysis) => analysis.causedBy.filter((link) => link.token.tokenAddress === input.token.tokenAddress))
    .sort((a, b) => b.score - a.score)
  const rejectedNews = analyses.flatMap((analysis) => analysis.afterLaunch.filter((link) => link.token.tokenAddress === input.token.tokenAddress))
  const deployer = input.token.deployer?.toLowerCase() ?? null
  const deployerTokens = input.rows
    .filter((row) => deployer && row.deployer?.toLowerCase() === deployer && row.tokenAddress.toLowerCase() !== input.token.tokenAddress.toLowerCase())
    .map((row) => ({
      symbol: row.symbol || row.name,
      tokenName: row.tokenName || row.name,
      tokenAddress: row.tokenAddress,
      createdAt: row.created_at,
      lpStatus: row.lpStatus,
    }))
  const specific = new Set(input.token.concepts.filter((hit) => !hit.generic).map((hit) => hit.id))
  const related = input.tokens
    .filter((token) => token.tokenAddress !== input.token.tokenAddress && token.concepts.some((hit) => specific.has(hit.id)))
    .slice(0, 12)
    .map((token) => ({
      symbol: token.symbol,
      tokenName: token.tokenName,
      tokenAddress: token.tokenAddress,
      reason: "Shares a specific name entity. This is a possible naming family, not proof of copying.",
    }))

  const failed: string[] = []
  let chain: ChainFacts | null = null
  if (input.chain && "error" in input.chain) failed.push(`Contract read failed: ${input.chain.error}`)
  else chain = input.chain ?? null

  const unavailable = [
    "Holder lists and top-holder percentages are not in the published pair record.",
    "Buys and sells are not stored for 5m, 15m, 1h, or 6h. Only the DEXTools 24h buy-swap and maker fields are available, when the pair record includes them.",
    "Verified source, taxes, and admin control-flow are not available without a verified-source API.",
    "Website pages, follower counts, and social post text are not fetched. Only links stored on the pair record are shown.",
    "No neural embedding model is running. Name matching uses the project lexicon and phrase overlap.",
  ]

  const facts = [
    { label: "Token", value: `${input.token.tokenName} ($${input.token.symbol})`, source: "DEXTools pair record" },
    { label: "Contract", value: input.token.tokenAddress, source: "DEXTools pair record" },
    { label: "Pair", value: input.token.address, source: "DEXTools pair record" },
    { label: "Pair created", value: input.token.createdAt, source: "DEXTools listing, stored as UTC" },
    { label: "Deployer", value: input.token.deployer || "Not in the pair record", source: "DEXTools pair record" },
    { label: "LP burned", value: record ? formatBurnPercent(record.lpBurntPercent, record.lpStatus === "burnt" || record.lpBurntPercent > 0) : "Not in the pair record", source: record?.lpSource === "ethereum-transfer" ? "Ethereum Transfer balances" : "DEXTools pair record" },
    { label: "LP burned at", value: burn?.burnAt ?? record?.lpBurnAt ?? "Not recorded", source: burn?.source === "ethereum-transfer" ? "Ethereum block timestamp" : "Pair record" },
  ]
  if (chain?.decimals != null) facts.push({ label: "Decimals", value: String(chain.decimals), source: "Ethereum eth_call" })
  if (chain?.owner) facts.push({ label: "owner()", value: chain.owner, source: "Ethereum eth_call" })

  const gap = burn?.burnAt ? Date.parse(burn.burnAt) - Date.parse(input.token.createdAt) : null
  const calculated = [
    { label: "Deployer launches in this 7-day list", value: String(deployerTokens.length), source: "Counted from stored WETH pairs with the same deployer" },
    { label: "Time from pair creation to recorded LP burn", value: gap != null && gap >= 0 ? `${Math.round(gap / 1000)} seconds` : "Burn time was not recorded", source: "Pair creation timestamp and burn timestamp" },
  ]

  const bestNews = news[0]
  const interpretation = bestNews
    ? [{ label: "Narrative connection", value: `${bestNews.level}. ${bestNews.reasons[0] ?? ""}`, confidence: bestNews.score }]
    : [{ label: "Narrative origin", value: "Unknown. No reliable external event in the fetched headlines explains this name.", confidence: 0 }]

  const timeline: TimelineItem[] = [
    { at: input.token.createdAt, label: "Pair created", kind: "fact", source: "DEXTools listing" },
  ]
  if (input.token.tokenCreatedAt && input.token.tokenCreatedAt !== input.token.createdAt) {
    timeline.push({ at: input.token.tokenCreatedAt, label: "Token contract creation time on the pair record", kind: "fact", source: "DEXTools pair record" })
  }
  if (burn?.burnAt) timeline.push({ at: burn.burnAt, label: `LP burn recorded at ${formatBurnPercent(burn.lpBurntPercent, burn.percentKnown !== false)}`, kind: "fact", source: burn.source === "ethereum-transfer" ? "Ethereum Transfer" : "Pair record" })
  for (const link of news.slice(0, 3)) {
    timeline.push({ at: link.token.createdAt, label: `News connection: ${link.level}`, kind: "interpretation", source: "Headline lexicon match" })
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at))

  const scorecard: ScoreItem[] = []
  if (record && record.lpBurntPercent > 0) {
    scorecard.push({ name: "Liquidity structure", score: Math.max(0, Math.min(100, Math.round(record.lpBurntPercent))), reason: "Score follows the recorded LP burned percentage. It is not a safety rating." })
  }
  if (bestNews) scorecard.push({ name: "News relevance", score: bestNews.score, reason: bestNews.reasons.join(" ") })
  if (input.token.concepts.some((hit) => !hit.generic)) {
    scorecard.push({ name: "Narrative specificity", score: 70, reason: "The name matches a specific lexicon entity rather than only a generic word." })
  }

  return {
    token: input.token,
    record,
    facts,
    calculated,
    interpretation,
    liquidityNote: record?.lpStatus === "locked" ? "Locked liquidity is not counted as burned." : "Missing market cap or holder data does not remove the pair or burn facts above.",
    deployerAddress: input.token.deployer,
    deployerTokens,
    news,
    rejectedNews,
    related,
    timeline,
    scorecard,
    unavailable,
    failed,
    chain,
  }
}

export function evidenceRank(level: EvidenceLevel): number {
  if (level === "Confirmed") return 5
  if (level === "Highly Likely") return 4
  if (level === "Likely") return 3
  if (level === "Possible") return 2
  if (level === "Weak Connection") return 1
  return 0
}
