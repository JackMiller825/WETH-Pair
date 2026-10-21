import { baselineBefore, firstReliable, maxBaselineGap, pumpOf, MIN_RELIABLE_WETH, type Confidence, type PricePoint } from "@/lib/pump/price"

export type RankMode = "window" | "launch"
export type Movement = "all" | "rising" | "retracing"
export type SortKey = "multiple" | "percent" | "peak" | "volume" | "liquidity" | "weth" | "tx" | "holders"

/** Tie-break after the chosen sort: more WETH in the pool, then more volume, then the pair address. */
export const TIE_BREAK = "pooled WETH, then volume, then pair address"

export type TokenCandidate = {
  pair: string
  token: string
  name: string
  symbol: string
  createdAt: number
  url: string
  points: readonly PricePoint[]
  pooledWeth: number | null
  liquidityUsd: number | null
  volumeUsd: number | null
  totalTx: number | null
  holders: number | null
  lpBurnPercent: number | null
}

export type RankOptions = {
  start: number
  end: number
  mode: RankMode
  limit: number
  pumpsOnly: boolean
  hideLowConfidence: boolean
  minLiquidityUsd: number | null
  minWeth: number | null
  minTx: number | null
  minHolders: number | null
  minAgeMs: number | null
  movement: Movement
  sort: SortKey
  /** Oldest indexed price in the whole book, for the coverage banner. Null when nothing has been indexed. */
  coverageOldest: number | null
}

export type PumpRow = {
  rank: number
  pair: string
  token: string
  name: string
  symbol: string
  url: string
  createdAt: number
  multiple: number
  percent: number
  /** True when the reference is the first reliable trade, because the token is younger than the window. */
  sinceLaunch: boolean
  referencePriceUsd: number
  referenceAt: number
  currentPriceUsd: number
  currentAt: number
  peakMultiple: number | null
  retracementPercent: number | null
  sparkline: number[]
  pooledWeth: number | null
  liquidityUsd: number | null
  volumeUsd: number | null
  totalTx: number | null
  holders: number | null
  lpBurnPercent: number | null
  confidence: Confidence
  confidenceReason: string | null
  recent: "rising" | "retracing" | "flat"
}

export type RankResult = {
  items: PumpRow[]
  hiddenLowConfidence: PumpRow[]
  analyzed: number
  excludedYoung: number
  excludedInsufficient: number
  excludedFlat: number
  excludedFiltered: number
  coverage: { requestedMs: number; availableMs: number | null; complete: boolean }
}

type Scored = Omit<PumpRow, "rank">

/** Downsample to real observations. Points are not interpolated, so the line cannot invent a curve. */
export function sparklineOf(prices: readonly number[], max = 16): number[] {
  const values = prices.filter((price) => price > 0 && Number.isFinite(price))
  if (values.length <= max) return values
  const step = (values.length - 1) / (max - 1)
  const out: number[] = []
  for (let index = 0; index < max; index += 1) out.push(values[Math.round(index * step)])
  return out
}

function confidenceFor(reference: PricePoint, observations: number, totalTx: number | null, gapMs: number): { confidence: Confidence; reason: string | null } {
  if (!(reference.reserveWeth >= MIN_RELIABLE_WETH)) {
    return { confidence: "low", reason: `Initial liquidity was only ${reference.reserveWeth.toFixed(4)} WETH.` }
  }
  if (totalTx != null && totalTx < 3) return { confidence: "low", reason: `Only ${totalTx} transactions are recorded.` }
  if (observations < 2) return { confidence: "low", reason: "Only one price observation is indexed." }
  if (reference.reserveWeth >= 1 && observations >= 3 && gapMs <= MIN_RELIABLE_GAP && (totalTx == null || totalTx >= 10)) {
    return { confidence: "high", reason: null }
  }
  return { confidence: "medium", reason: null }
}

const MIN_RELIABLE_GAP = 2 * 60 * 1000

function recentMove(current: number, previous: number | null, peak: number): "rising" | "retracing" | "flat" {
  if (previous == null) return "flat"
  if (current > previous * 1.005) return "rising"
  if (peak > 0 && current < peak * 0.95 && current < previous) return "retracing"
  return "flat"
}

function score(token: TokenCandidate, options: RankOptions): Scored | "young" | "insufficient" | "flat" | "filtered" {
  const age = options.end - token.createdAt
  if (options.minAgeMs != null && !(age >= options.minAgeMs)) return "filtered"
  if (options.minWeth != null && !(token.pooledWeth != null && token.pooledWeth >= options.minWeth)) return "filtered"
  if (options.minLiquidityUsd != null && !(token.liquidityUsd != null && token.liquidityUsd >= options.minLiquidityUsd)) return "filtered"
  if (options.minTx != null && !(token.totalTx != null && token.totalTx >= options.minTx)) return "filtered"
  if (options.minHolders != null && !(token.holders != null && token.holders >= options.minHolders)) return "filtered"
  const current = [...token.points].reverse().find((point) => point.at <= options.end && point.priceUsd > 0)
  if (!current) return "insufficient"
  const launchedInWindow = token.createdAt >= options.start && token.createdAt <= options.end
  if (options.mode === "window" && token.createdAt > options.start) return "young"
  if (options.mode === "launch" && !launchedInWindow) return "filtered"

  const gap = maxBaselineGap(options.end - options.start)
  const reference = options.mode === "launch" ? firstReliable(token.points.filter((point) => point.at >= token.createdAt && point.at <= options.end)) : baselineBefore(token.points, options.start, gap)
  if (!reference) return options.mode === "window" && token.createdAt > options.start ? "young" : "insufficient"
  const change = pumpOf(reference.priceUsd, current.priceUsd)
  if (!change) return "insufficient"
  if (options.pumpsOnly && change.multiple <= 1) return "flat"

  const span = token.points.filter((point) => point.at >= reference.at && point.at <= options.end && point.priceUsd > 0)
  const peakPrice = span.reduce((peak, point) => Math.max(peak, point.priceUsd), current.priceUsd)
  const peak = pumpOf(reference.priceUsd, peakPrice)
  const previous = span.length >= 2 ? span[span.length - 2].priceUsd : null
  const recent = recentMove(current.priceUsd, previous, peakPrice)
  if (options.movement === "rising" && recent !== "rising") return "filtered"
  if (options.movement === "retracing" && recent !== "retracing") return "filtered"
  const judged = confidenceFor(reference, span.length, token.totalTx, options.mode === "launch" ? 0 : options.start - reference.at)
  return {
    pair: token.pair,
    token: token.token,
    name: token.name,
    symbol: token.symbol,
    url: token.url,
    createdAt: token.createdAt,
    multiple: change.multiple,
    percent: change.percent,
    sinceLaunch: options.mode === "launch",
    referencePriceUsd: reference.priceUsd,
    referenceAt: reference.at,
    currentPriceUsd: current.priceUsd,
    currentAt: current.at,
    peakMultiple: peak?.multiple ?? null,
    retracementPercent: peakPrice > 0 ? (current.priceUsd / peakPrice - 1) * 100 : null,
    sparkline: sparklineOf(span.map((point) => point.priceUsd)),
    pooledWeth: token.pooledWeth,
    liquidityUsd: token.liquidityUsd,
    volumeUsd: token.volumeUsd,
    totalTx: token.totalTx,
    holders: token.holders,
    lpBurnPercent: token.lpBurnPercent,
    confidence: judged.confidence,
    confidenceReason: judged.reason,
    recent,
  }
}

function valueOf(row: Scored, sort: SortKey): number {
  if (sort === "multiple" || sort === "percent") return row.multiple
  if (sort === "peak") return row.peakMultiple ?? -1
  if (sort === "volume") return row.volumeUsd ?? -1
  if (sort === "liquidity") return row.liquidityUsd ?? -1
  if (sort === "weth") return row.pooledWeth ?? -1
  if (sort === "tx") return row.totalTx ?? -1
  return row.holders ?? -1
}

function ordered(rows: Scored[], sort: SortKey): Scored[] {
  return [...rows].sort((a, b) => valueOf(b, sort) - valueOf(a, sort) || (b.pooledWeth ?? 0) - (a.pooledWeth ?? 0) || (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0) || a.pair.localeCompare(b.pair))
}

export function rankPumpers(tokens: readonly TokenCandidate[], options: RankOptions): RankResult {
  const requestedMs = Math.max(0, options.end - options.start)
  const availableMs = options.coverageOldest == null ? null : Math.max(0, options.end - options.coverageOldest)
  const coverage = { requestedMs, availableMs, complete: options.coverageOldest != null && options.coverageOldest <= options.start }
  let excludedYoung = 0
  let excludedInsufficient = 0
  let excludedFlat = 0
  let excludedFiltered = 0
  const ranked: Scored[] = []
  const low: Scored[] = []
  for (const token of tokens) {
    const result = score(token, options)
    if (result === "young") excludedYoung += 1
    else if (result === "insufficient") excludedInsufficient += 1
    else if (result === "flat") excludedFlat += 1
    else if (result === "filtered") excludedFiltered += 1
    else if (result.confidence === "low" && options.hideLowConfidence) low.push(result)
    else ranked.push(result)
  }
  const items = ordered(ranked, options.sort).slice(0, Math.max(0, options.limit)).map((row, index) => ({ ...row, rank: index + 1 }))
  const hiddenLowConfidence = ordered(low, options.sort).map((row, index) => ({ ...row, rank: index + 1 }))
  return { items, hiddenLowConfidence, analyzed: tokens.length, excludedYoung, excludedInsufficient, excludedFlat, excludedFiltered, coverage }
}

/** Same inputs and the same book version reuse the computed ranking. The range is part of the key, so 24h and 3d never share a result. */
export class RankCache {
  private key = ""
  private version = -1
  private result: RankResult | null = null

  get(key: string, version: number, compute: () => RankResult): RankResult {
    if (this.result && this.key === key && this.version === version) return this.result
    this.key = key
    this.version = version
    this.result = compute()
    return this.result
  }
}

export function rankCacheKey(options: RankOptions): string {
  return [options.start, options.end, options.mode, options.limit, options.pumpsOnly, options.hideLowConfidence, options.minLiquidityUsd, options.minWeth, options.minTx, options.minHolders, options.minAgeMs, options.movement, options.sort].join("|")
}
