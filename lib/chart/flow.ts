import { intervals, mean, median, paceOf, percentile, sizePace, type Pace, type SizePace } from "@/lib/chart/math"

export type ChartTrade = {
  id: string
  at: number
  block: number
  side: "buy" | "sell"
  weth: number
  token: number
  priceWeth: number
  /** Indexed pool sender. Often a router, so this is not a trader count. */
  sender: string | null
  recipient: string | null
  /** Transaction origin when it was actually read. Null means the trader is unknown. */
  trader: string | null
}

export type FlowTotals = {
  buyWeth: number
  sellWeth: number
  netWeth: number
  buyCount: number
  sellCount: number
  medianBuy: number | null
  medianSell: number | null
  averageBuy: number | null
  averageSell: number | null
  largestBuy: number | null
  largestSell: number | null
}

export function summarizeFlow(trades: readonly ChartTrade[]): FlowTotals {
  const buys: number[] = []
  const sells: number[] = []
  for (const trade of trades) {
    if (!(trade.weth > 0)) continue
    if (trade.side === "buy") buys.push(trade.weth)
    else sells.push(trade.weth)
  }
  const buyWeth = buys.reduce((sum, value) => sum + value, 0)
  const sellWeth = sells.reduce((sum, value) => sum + value, 0)
  return {
    buyWeth,
    sellWeth,
    netWeth: buyWeth - sellWeth,
    buyCount: buys.length,
    sellCount: sells.length,
    medianBuy: median(buys),
    medianSell: median(sells),
    averageBuy: mean(buys),
    averageSell: mean(sells),
    largestBuy: buys.length ? buys.reduce((best, value) => Math.max(best, value), buys[0]) : null,
    largestSell: sells.length ? sells.reduce((best, value) => Math.max(best, value), sells[0]) : null,
  }
}

export type FlowBucket = { start: number; end: number; buyWeth: number; sellWeth: number; netWeth: number; buyCount: number; sellCount: number }

export function flowBuckets(trades: readonly ChartTrade[], start: number, end: number, bucketMs: number): FlowBucket[] {
  if (!(bucketMs > 0) || !(end > start)) return []
  const buckets: FlowBucket[] = []
  for (let cursor = start; cursor < end; cursor += bucketMs) {
    buckets.push({ start: cursor, end: Math.min(end, cursor + bucketMs), buyWeth: 0, sellWeth: 0, netWeth: 0, buyCount: 0, sellCount: 0 })
  }
  for (const trade of trades) {
    if (trade.at < start || trade.at >= end || !(trade.weth > 0)) continue
    const index = Math.floor((trade.at - start) / bucketMs)
    const bucket = buckets[index]
    if (!bucket) continue
    if (trade.side === "buy") {
      bucket.buyWeth += trade.weth
      bucket.buyCount += 1
    } else {
      bucket.sellWeth += trade.weth
      bucket.sellCount += 1
    }
    bucket.netWeth = bucket.buyWeth - bucket.sellWeth
  }
  return buckets
}

export type IntervalStats = { medianMs: number; meanMs: number | null; p25Ms: number | null; p75Ms: number | null }

export function intervalStats(times: readonly number[]): IntervalStats | null {
  const gaps = intervals(times)
  const mid = median(gaps)
  if (mid == null) return null
  return { medianMs: mid, meanMs: mean(gaps), p25Ms: percentile(gaps, 0.25), p75Ms: percentile(gaps, 0.75) }
}

export function cadencePace(mediansMs: readonly number[]): Pace {
  return paceOf(mediansMs)
}

export function tradeSizePace(medians: readonly number[]): SizePace {
  return sizePace(medians)
}

const ROUTERS = new Set([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
  "0xe592427a0aece92de3edee1f18e0157c05861564",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad",
  "0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b",
])

/** Counts transaction origins. Router senders are never traders. Missing origins stay unknown. */
export function traderCount(trades: readonly ChartTrade[]): { count: number } | { count: null; reason: string } {
  const traders = new Set<string>()
  let attributed = 0
  for (const trade of trades) {
    const trader = trade.trader?.toLowerCase() ?? ""
    if (!/^0x[0-9a-f]{40}$/.test(trader) || ROUTERS.has(trader)) continue
    attributed += 1
    traders.add(trader)
  }
  if (attributed === 0) return { count: null, reason: "Swap senders are usually routers. Transaction origins were not read, so unique traders are unknown." }
  return { count: traders.size }
}

export type ActivitySplit = {
  raw: number
  repetitive: number
  independentEstimate: number | null
  note: string
}

/** Repetitive sizes are a heuristic. They are not subtracted from raw counts, and they are not called organic. */
export function splitActivity(trades: readonly ChartTrade[]): ActivitySplit {
  const raw = trades.length
  if (raw < 8) return { raw, repetitive: 0, independentEstimate: null, note: "Too few swaps to separate repetitive sizes from the rest." }
  const buckets = new Map<string, number>()
  for (const trade of trades) {
    const key = trade.weth.toFixed(4)
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  let repetitive = 0
  for (const count of buckets.values()) if (count >= 4) repetitive += count
  const traders = traderCount(trades)
  return {
    raw,
    repetitive,
    independentEstimate: traders.count,
    note: traders.count == null ? "Repetitive sizes are counted separately. Estimated independent traders stay unknown without transaction origins." : "Independent estimate uses transaction origins and ignores router senders.",
  }
}
