import { cadencePace, flowBuckets, intervalStats, splitActivity, summarizeFlow, tradeSizePace, traderCount, type ChartTrade, type FlowBucket } from "@/lib/chart/flow"
import { classifyStructure, reviewWindows, stageOf, type PatternResult, type WindowState } from "@/lib/chart/structure"
import { VERDICT_LABEL, type VerdictId } from "@/lib/chart/training"

export type ChartSample = { at: number; price: number; reserveWeth: number | null }

export type ChartBurn = { at: number; percent: number | null }

export type ChartInput = {
  createdAt: number
  now: number
  /** When set, observations after this instant are ignored. Replay depends on this. */
  cutoff?: number | null
  samples: readonly ChartSample[]
  trades: readonly ChartTrade[]
  burns: readonly ChartBurn[]
  lpStatus: string | null
  lpBurnPercent: number | null
  buys24h: number | null
  makers24h: number | null
  holders: number | null
  holdersObservedAt: number | null
  liquidityUsd: number | null
  deployer: string | null
  flowRead: "decoded" | "none"
}

export type ScorePart = {
  id: string
  label: string
  weight: number
  points: number | null
  positives: string[]
  negatives: string[]
}

export type ChartReport = {
  ageMs: number
  stage: string
  windows: WindowState[]
  pattern: PatternResult
  flow: {
    known: boolean
    reason: string
    buyWeth: number | null
    sellWeth: number | null
    netWeth: number | null
    buyCount: number | null
    sellCount: number | null
    medianBuy: number | null
    medianSell: number | null
    buckets: FlowBucket[]
    buyerPace: string
    sellerPace: string
    buySizePace: string
    sellSizePace: string
    buyerMedianMs: number | null
    sellerMedianMs: number | null
  }
  buyers: { known: false; reason: string; makers24h: number | null; buys24h: number | null }
  liquidity: {
    known: boolean
    startWeth: number | null
    endWeth: number | null
    change: number | null
  divergence: string | null
  impacts: string[]
}
  wallets: { known: false; reason: string; deployer: string | null }
  execution: { known: boolean; raw: number; repetitive: number; independent: number | null; note: string }
  parts: ScorePart[]
  total: number | null
  scoredWeight: number
  confidence: number
  confidenceReasons: string[]
  verdict: VerdictId
  verdictLabel: string
  evidence: string[]
  strengths: string[]
  concerns: string[]
  warnings: string[]
  changed: string[]
  quality: { label: string; state: string }[]
  safety: { label: string; value: string }[]
}

const WEIGHTS = [
  { id: "structure", label: "Chart structure", weight: 20 },
  { id: "flow", label: "Trade flow", weight: 20 },
  { id: "buyers", label: "Buyer quality", weight: 15 },
  { id: "liquidity", label: "Liquidity and reserves", weight: 15 },
  { id: "wallets", label: "Wallets", weight: 15 },
  { id: "execution", label: "Execution quality", weight: 10 },
  { id: "data", label: "Data quality", weight: 5 },
] as const

function until(input: ChartInput): number {
  return input.cutoff != null && input.cutoff < input.now ? input.cutoff : input.now
}

function visibleSamples(input: ChartInput, end: number): ChartSample[] {
  return input.samples.filter((sample) => sample.at >= input.createdAt && sample.at <= end && sample.price > 0).sort((a, b) => a.at - b.at)
}

function visibleTrades(input: ChartInput, end: number): ChartTrade[] {
  return input.trades.filter((trade) => trade.at >= input.createdAt && trade.at <= end)
}

function reserveChange(samples: readonly ChartSample[]): { start: number | null; end: number | null; change: number | null } {
  const reserves = samples.filter((sample) => sample.reserveWeth != null && sample.reserveWeth > 0)
  if (reserves.length < 2) return { start: reserves[0]?.reserveWeth ?? null, end: reserves[0]?.reserveWeth ?? null, change: null }
  const start = reserves[0].reserveWeth as number
  const end = reserves[reserves.length - 1].reserveWeth as number
  return { start, end, change: start > 0 ? (end - start) / start : null }
}

function chunkMedians(trades: readonly ChartTrade[], side: "buy" | "sell", start: number, end: number, parts: number): number[] {
  if (!(end > start) || parts < 2) return []
  const width = (end - start) / parts
  const medians: number[] = []
  for (let index = 0; index < parts; index += 1) {
    const from = start + index * width
    const to = index === parts - 1 ? end + 1 : start + (index + 1) * width
    const values = trades.filter((trade) => trade.side === side && trade.at >= from && trade.at < to).map((trade) => trade.weth)
    const { median } = requireMedian(values)
    if (median != null) medians.push(median)
  }
  return medians
}

function requireMedian(values: number[]): { median: number | null } {
  if (values.length === 0) return { median: null }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return { median: sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 }
}

function chunkIntervalMedians(trades: readonly ChartTrade[], side: "buy" | "sell", start: number, end: number): number[] {
  const width = (end - start) / 3
  const medians: number[] = []
  for (let index = 0; index < 3; index += 1) {
    const from = start + index * width
    const to = index === 2 ? end + 1 : start + (index + 1) * width
    const stats = intervalStats(trades.filter((trade) => trade.side === side && trade.at >= from && trade.at < to).map((trade) => trade.at))
    if (stats) medians.push(stats.medianMs)
  }
  return medians
}

function tradeImpacts(trades: readonly ChartTrade[], samples: readonly ChartSample[]): string[] {
  const lines: string[] = []
  for (const trade of trades) {
    let reserve: number | null = null
    let before: number | null = null
    for (const sample of samples) {
      if (sample.at > trade.at) break
      if (sample.reserveWeth != null && sample.reserveWeth > 0) reserve = sample.reserveWeth
      if (sample.price > 0) before = sample.price
    }
    if (reserve == null || before == null || trade.weth / reserve < 0.2) continue
    const after = samples.find((sample) => sample.at > trade.at && sample.price > 0)
    const impact = after ? (after.price - before) / before : null
    const when = new Date(trade.at).toISOString().slice(11, 19)
    lines.push(`${when} ${trade.side} ${trade.weth.toFixed(2)} WETH, ${Math.round((trade.weth / reserve) * 100)}% of the pooled WETH then.${impact == null ? " No later price was observed inside this window." : ` Next observed price ${impact >= 0 ? "+" : ""}${Math.round(impact * 100)}%.`}`)
    if (lines.length >= 3) break
  }
  return lines
}

function flowPaceLabel(net: number[]): string {
  if (net.length < 2) return "unknown"
  const first = net[0]
  const last = net[net.length - 1]
  if (last < first - 0.5 && last < first * 0.5) return "deteriorating"
  if (last > first + 0.5 && (first <= 0 || last > first * 1.25)) return "improving"
  return "stable"
}

export function analyze(input: ChartInput): ChartReport {
  const end = until(input)
  const ageMs = Math.max(0, end - input.createdAt)
  const samples = visibleSamples(input, end)
  const trades = input.flowRead === "decoded" ? visibleTrades(input, end) : []
  const reserves = reserveChange(samples)
  const pattern = classifyStructure(samples.map((sample) => ({ at: sample.at, price: sample.price })), reserves.change)
  const flowKnown = input.flowRead === "decoded"
  const totals = summarizeFlow(trades)
  const bucketMs = ageMs >= 30 * 60_000 ? 5 * 60_000 : ageMs >= 5 * 60_000 ? 60_000 : 30_000
  const buckets = flowKnown ? flowBuckets(trades, input.createdAt, end, bucketMs) : []
  const buyerIntervals = flowKnown ? intervalStats(trades.filter((trade) => trade.side === "buy").map((trade) => trade.at)) : null
  const sellerIntervals = flowKnown ? intervalStats(trades.filter((trade) => trade.side === "sell").map((trade) => trade.at)) : null
  const buyerMedians = flowKnown ? chunkIntervalMedians(trades, "buy", input.createdAt, end) : []
  const sellerMedians = flowKnown ? chunkIntervalMedians(trades, "sell", input.createdAt, end) : []
  const buySizes = flowKnown ? chunkMedians(trades, "buy", input.createdAt, end, 3) : []
  const sellSizes = flowKnown ? chunkMedians(trades, "sell", input.createdAt, end, 3) : []
  const buyerPace = cadencePace(buyerMedians)
  const sellerPace = cadencePace(sellerMedians)
  const buySizePace = tradeSizePace(buySizes)
  const sellSizePace = tradeSizePace(sellSizes)
  const split = splitActivity(trades)
  const traders = traderCount(trades)
  const priceChange = samples.length >= 2 ? (samples[samples.length - 1].price - samples[0].price) / samples[0].price : null

  const strengths: string[] = []
  const concerns: string[] = []
  const warnings: string[] = []
  const changed: string[] = []
  const evidence: string[] = [...pattern.evidence]

  if (flowKnown) {
    evidence.push(`Executed buys ${totals.buyWeth.toFixed(2)} WETH, sells ${totals.sellWeth.toFixed(2)} WETH, net ${totals.netWeth.toFixed(2)} WETH.`)
    if (totals.netWeth > 0.5) strengths.push(`Net flow ${totals.netWeth.toFixed(2)} WETH`)
    if (totals.netWeth < -0.5) concerns.push(`Net flow ${totals.netWeth.toFixed(2)} WETH`)
    if (buyerPace === "slowing") {
      warnings.push("Independent-looking buy intervals are lengthening")
      changed.push("Buyer cadence slowed across this window")
    }
    if (buyerPace === "accelerating") strengths.push("Buy intervals are getting shorter")
    if (buySizePace === "declining") concerns.push("Median buy size is declining")
    if (buySizePace === "increasing") strengths.push("Median buy size is rising")
    if (sellSizePace === "increasing" && sellerPace === "accelerating") warnings.push("Sells are larger and more frequent")
    const nets = buckets.map((bucket) => bucket.netWeth)
    const pace = flowPaceLabel(nets)
    if (pace === "deteriorating") {
      changed.push("Net flow deteriorated from the earlier buckets to the later ones")
      warnings.push("Net flow is deteriorating")
    }
  }

  if (reserves.change != null) {
    evidence.push(`Pooled WETH ${reserves.change >= 0 ? "rose" : "fell"} ${Math.abs(reserves.change * 100).toFixed(0)}%.`)
    if (reserves.change <= -0.25) concerns.push(`Pooled WETH ${Math.round(reserves.change * 100)}%`)
    if (reserves.change >= 0.15) strengths.push(`Pooled WETH +${Math.round(reserves.change * 100)}%`)
  }
  if (priceChange != null && reserves.change != null && priceChange > 0.4 && reserves.change < -0.15) {
    concerns.push("Price rose while pooled WETH fell")
    changed.push("Price and WETH reserves diverged")
  }
  if (pattern.id === "healthy-uptrend") strengths.push(pattern.label)
  if (pattern.id === "pump-dump" || pattern.id === "failed-breakout" || pattern.id === "distribution") concerns.push(pattern.label)
  if (pattern.id === "liquidity-shock") warnings.push("Pooled WETH dropped sharply")

  const quality: { label: string; state: string }[] = [
    { label: "Price", state: samples.length >= 2 ? "Observed" : "Unknown" },
    { label: "Swaps", state: flowKnown ? "Decoded for this window" : "Unknown" },
    { label: "Reserves", state: reserves.change != null ? "Observed" : reserves.start != null ? "One observation" : "Unknown" },
    { label: "Wallets", state: traders.count == null ? "Unknown" : "Origins read" },
    { label: "Holders", state: input.holders == null ? "Unknown" : input.holdersObservedAt == null ? "Count only" : "Count with a timestamp" },
    { label: "Bot / MEV", state: "Heuristic only, and only from trade size when enough swaps exist" },
  ]

  const knownFacts = quality.filter((row) => row.state === "Observed" || row.state === "Decoded for this window" || row.state === "Origins read").length
  const dataPoints = Math.round((knownFacts / 4) * 5)

  const parts: ScorePart[] = WEIGHTS.map((part) => {
    if (part.id === "structure") {
      if (pattern.id === "insufficient") return { ...part, points: null, positives: [], negatives: ["Not enough price history to score structure."] }
      const points = pattern.id === "healthy-uptrend" ? 16 : pattern.id === "consolidation" ? 11 : pattern.id === "failed-breakout" || pattern.id === "distribution" ? 7 : pattern.id === "pump-dump" || pattern.id === "liquidity-shock" ? 4 : null
      return { ...part, points, positives: pattern.id === "healthy-uptrend" ? pattern.evidence.slice(0, 2) : [], negatives: points != null && points < 12 ? pattern.evidence.slice(0, 2) : [] }
    }
    if (part.id === "flow") {
      if (!flowKnown) return { ...part, points: null, positives: [], negatives: ["Buy and sell WETH were not decoded, so flow is unknown rather than zero."] }
      let points = 10
      const positives: string[] = []
      const negatives: string[] = []
      if (totals.netWeth > 0) {
        points += 5
        positives.push(`Net flow +${totals.netWeth.toFixed(2)} WETH`)
      } else if (totals.netWeth < 0) {
        points -= 4
        negatives.push(`Net flow ${totals.netWeth.toFixed(2)} WETH`)
      }
      if (buySizePace === "increasing") {
        points += 2
        positives.push("Median buy size rising")
      }
      if (buySizePace === "declining") {
        points -= 2
        negatives.push("Median buy size declining")
      }
      if (trades.length === 0) negatives.push("The decoded window has no swaps. Earlier trading was not read.")
      if (buyerPace === "slowing") negatives.push("Buy cadence slowing")
      return { ...part, points: Math.max(0, Math.min(part.weight, points)), positives, negatives }
    }
    if (part.id === "liquidity") {
      if (reserves.change == null) return { ...part, points: null, positives: [], negatives: ["Reserve history has fewer than two observations."] }
      let points = 8
      const positives: string[] = []
      const negatives: string[] = []
      if (reserves.change >= 0) {
        points += 4
        positives.push(`Pooled WETH ${reserves.change === 0 ? "unchanged" : `+${Math.round(reserves.change * 100)}%`}`)
      } else {
        points -= Math.min(6, Math.round(Math.abs(reserves.change) * 10))
        negatives.push(`Pooled WETH ${Math.round(reserves.change * 100)}%`)
      }
      return { ...part, points: Math.max(0, Math.min(part.weight, points)), positives, negatives }
    }
    if (part.id === "data") return { ...part, points: dataPoints, positives: [], negatives: dataPoints < 3 ? ["Several modules have no measurement yet."] : [] }
    return { ...part, points: null, positives: [], negatives: [part.id === "buyers" ? "Unique buyers, retention, and replacement need wallet origins this feed does not store." : part.id === "wallets" ? "Whale, deployer, and cluster balances are unknown." : "Bot and MEV labels need trader identity. Repetitive sizes are shown separately and are not a score."] }
  })

  const scored = parts.filter((part) => part.points != null)
  const scoredWeight = scored.reduce((sum, part) => sum + part.weight, 0)
  const total = scoredWeight > 0 ? Math.round(scored.reduce((sum, part) => sum + (part.points as number) / part.weight * part.weight, 0) / scoredWeight * 100) : null

  let confidence = 20
  const confidenceReasons: string[] = []
  if (ageMs < 2 * 60_000) {
    confidence = 25
    confidenceReasons.push("Less than two minutes of history.")
  } else if (ageMs < 5 * 60_000) {
    confidence = 40
    confidenceReasons.push("Only a few minutes of history.")
  } else if (ageMs < 15 * 60_000) {
    confidence = 55
  } else {
    confidence = 70
  }
  if (samples.length < 4) {
    confidence = Math.min(confidence, 30)
    confidenceReasons.push("Fewer than four price observations.")
  }
  if (!flowKnown) {
    confidence = Math.min(confidence, 45)
    confidenceReasons.push("Buy and sell values are unknown.")
  } else if (trades.length < 5) {
    confidence = Math.min(confidence, 35)
    confidenceReasons.push(`${trades.length} decoded swaps.`)
  }
  if (traders.count == null) {
    confidence = Math.min(confidence, flowKnown ? 60 : confidence)
    confidenceReasons.push("Wallet attribution was not read.")
  }
  confidence = Math.max(0, Math.min(95, confidence))
  if (trades.length <= 3 && ageMs <= 60_000) confidence = Math.min(confidence, 22)

  let verdict: VerdictId = "insufficient"
  if (pattern.id === "liquidity-shock" && (reserves.change ?? 0) <= -0.35) verdict = "liquidity"
  else if (scoredWeight < 35 || samples.length < 4) verdict = "insufficient"
  else if (pattern.id === "pump-dump" || (flowKnown && totals.netWeth < 0 && (buyerPace === "slowing" || buySizePace === "declining"))) verdict = "weakening"
  else if (pattern.id === "consolidation" || pattern.id === "failed-breakout" || pattern.id === "distribution") verdict = "mixed"
  else if (pattern.id === "healthy-uptrend" && (!flowKnown || totals.netWeth >= 0)) verdict = "strong"
  else verdict = "mixed"
  if (split.repetitive >= 8 && traders.count != null && traders.count > 0 && split.repetitive / Math.max(1, split.raw) >= 0.5) {
    verdict = "manipulation"
    concerns.push("Repetitive trade sizes from a small set of origins")
  }

  const divergence = priceChange != null && reserves.change != null && Math.abs(priceChange) >= 0.2 && Math.sign(priceChange) !== Math.sign(reserves.change)
    ? `Price ${(priceChange * 100).toFixed(0)}% and pooled WETH ${(reserves.change * 100).toFixed(0)}% moved in opposite directions.`
    : null

  return {
    ageMs,
    stage: stageOf(ageMs).label,
    windows: reviewWindows(ageMs),
    pattern,
    flow: {
      known: flowKnown,
      reason: flowKnown ? "Uniswap V2-style swaps decoded for this pair. Counts and WETH values are both shown." : "No decoded swaps in this window. Flow is unknown, not zero.",
      buyWeth: flowKnown ? totals.buyWeth : null,
      sellWeth: flowKnown ? totals.sellWeth : null,
      netWeth: flowKnown ? totals.netWeth : null,
      buyCount: flowKnown ? totals.buyCount : null,
      sellCount: flowKnown ? totals.sellCount : null,
      medianBuy: flowKnown ? totals.medianBuy : null,
      medianSell: flowKnown ? totals.medianSell : null,
      buckets,
      buyerPace: flowKnown ? buyerPace : "unknown",
      sellerPace: flowKnown ? sellerPace : "unknown",
      buySizePace: flowKnown ? buySizePace : "unknown",
      sellSizePace: flowKnown ? sellSizePace : "unknown",
      buyerMedianMs: buyerIntervals?.medianMs ?? null,
      sellerMedianMs: sellerIntervals?.medianMs ?? null,
    },
    buyers: {
      known: false,
      reason: "Early-buyer retention, replacement, and independent buyer velocity need wallet origins. They are unknown, not zero.",
      makers24h: ageMs >= 24 * 60 * 60 * 1000 ? input.makers24h : null,
      buys24h: ageMs >= 24 * 60 * 60 * 1000 ? input.buys24h : null,
    },
    liquidity: { known: reserves.start != null, startWeth: reserves.start, endWeth: reserves.end, change: reserves.change, divergence, impacts: flowKnown ? tradeImpacts(trades, samples) : [] },
    wallets: { known: false, reason: traders.count == null ? "Deployer holdings, whale share, and wallet clusters were not read." : "Origins exist, but balances and relationships were not read.", deployer: input.deployer },
    execution: { known: trades.length >= 8, raw: split.raw, repetitive: split.repetitive, independent: split.independentEstimate, note: split.note },
    parts,
    total,
    scoredWeight,
    confidence,
    confidenceReasons,
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
    evidence,
    strengths: strengths.slice(0, 3),
    concerns: concerns.slice(0, 3),
    warnings: warnings.slice(0, 4),
    changed: changed.slice(0, 4),
    quality,
    safety: [
      { label: "LP status", value: input.lpStatus ?? "Unknown" },
      { label: "LP burned", value: input.lpBurnPercent == null ? "Unknown" : `${input.lpBurnPercent}%` },
      { label: "Contract verified", value: "Unknown" },
      { label: "Mint, blacklist, tax, proxy", value: "Unknown" },
      { label: "Holders", value: input.holders == null ? "Unknown" : String(input.holders) },
      { label: "USD liquidity", value: input.liquidityUsd == null ? "Unknown" : `$${Math.round(input.liquidityUsd).toLocaleString("en-US")}` },
    ],
  }
}

export function cutoffReport(input: ChartInput, cutoff: number): ChartReport {
  return analyze({ ...input, cutoff })
}
