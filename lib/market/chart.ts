import { parseCandles, type Candle } from "@/lib/market/price"
import { defaultFetch, type FetchLike } from "@/lib/market/types"

/** Candle size for the ETH chart. Coinbase returns at most 300 candles per request. */
export const ETH_CHARTS = [
  { id: "1m", label: "1m", granularity: 60, spanMs: 4 * 60 * 60 * 1000 },
  { id: "5m", label: "5m", granularity: 300, spanMs: 24 * 60 * 60 * 1000 },
  { id: "15m", label: "15m", granularity: 900, spanMs: 3 * 24 * 60 * 60 * 1000 },
  { id: "1h", label: "1H", granularity: 3600, spanMs: 14 * 24 * 60 * 60 * 1000 },
  { id: "6h", label: "6H", granularity: 21600, spanMs: 60 * 24 * 60 * 60 * 1000 },
  { id: "1d", label: "1D", granularity: 86400, spanMs: 300 * 24 * 60 * 60 * 1000 },
] as const

export type EthChartId = (typeof ETH_CHARTS)[number]["id"]

export type PriceBar = { at: number; open: number; high: number; low: number; close: number }

const COINBASE = "https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity="
const KRAKEN = "https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval="
const COINGECKO = "https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days="
const KRAKEN_MINUTES: Record<EthChartId, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "6h": 60, "1d": 1440 }
const GECKO_DAYS: Record<EthChartId, number> = { "1m": 1, "5m": 1, "15m": 1, "1h": 7, "6h": 30, "1d": 365 }
const cache = new Map<string, { at: number; bars: PriceBar[]; source: string }>()

export function clearEthBarCache() {
  cache.clear()
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value)
  return null
}

/** Kraken rows are [time, open, high, low, close, vwap, volume, count], with prices as strings. */
export function candlesFromKraken(payload: unknown): Candle[] {
  if (!payload || typeof payload !== "object") throw new Error("Kraken candles were not a document")
  const body = payload as { error?: unknown; result?: Record<string, unknown> }
  if (Array.isArray(body.error) && body.error.length > 0) throw new Error("Kraken rejected the candle request")
  const rows = Object.entries(body.result ?? {}).find(([key, value]) => key !== "last" && Array.isArray(value))?.[1]
  if (!Array.isArray(rows)) throw new Error("Kraken candles were empty")
  const candles: Candle[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const time = asNumber(row[0])
    const open = asNumber(row[1])
    const high = asNumber(row[2])
    const low = asNumber(row[3])
    const close = asNumber(row[4])
    const volume = asNumber(row[6]) ?? 0
    if (time == null || open == null || high == null || low == null || close == null) continue
    candles.push([time, low, high, open, close, volume])
  }
  if (candles.length === 0) throw new Error("Kraken candles were empty")
  return candles
}

/** CoinGecko rows are [timeMs, open, high, low, close]. */
export function candlesFromCoinGecko(payload: unknown): Candle[] {
  if (!Array.isArray(payload)) throw new Error("CoinGecko candles were not an array")
  const candles: Candle[] = []
  for (const row of payload) {
    if (!Array.isArray(row)) continue
    const time = asNumber(row[0])
    const open = asNumber(row[1])
    const high = asNumber(row[2])
    const low = asNumber(row[3])
    const close = asNumber(row[4])
    if (time == null || open == null || high == null || low == null || close == null) continue
    candles.push([Math.floor(time / 1000), low, high, open, close, 0])
  }
  if (candles.length === 0) throw new Error("CoinGecko candles were empty")
  return candles
}

/** Combine finer bars into one candle per bucket. Open is the first print and close is the last. */
export function bucketBars(bars: readonly PriceBar[], bucketMs: number): PriceBar[] {
  const groups = new Map<number, PriceBar>()
  for (const bar of bars) {
    const at = Math.floor(bar.at / bucketMs) * bucketMs
    const existing = groups.get(at)
    if (!existing) {
      groups.set(at, { at, open: bar.open, high: bar.high, low: bar.low, close: bar.close })
      continue
    }
    existing.high = Math.max(existing.high, bar.high)
    existing.low = Math.min(existing.low, bar.low)
    existing.close = bar.close
  }
  return [...groups.values()].sort((a, b) => a.at - b.at)
}

async function readJson(fetcher: FetchLike, url: string): Promise<unknown> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000), cache: "no-store" })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export function chartById(id: string): (typeof ETH_CHARTS)[number] {
  return ETH_CHARTS.find((item) => item.id === id) ?? ETH_CHARTS[1]
}

/** Newest-first Coinbase candles become oldest-first bars inside the span. */
export function barsFromCandles(candles: readonly Candle[], now: number, spanMs: number): PriceBar[] {
  const start = now - spanMs
  return candles
    .filter((candle) => candle[0] * 1000 >= start && candle[0] * 1000 <= now + 60_000)
    .map((candle) => ({ at: candle[0] * 1000, low: candle[1], high: candle[2], open: candle[3], close: candle[4] }))
    .filter((bar) => bar.high >= bar.low && bar.open > 0 && bar.close > 0)
    .sort((a, b) => a.at - b.at)
}

export type EthBars = { bars: PriceBar[]; source: string }

function withinSpan(bars: readonly PriceBar[], now: number, spanMs: number): PriceBar[] {
  const start = now - spanMs
  return bars.filter((bar) => bar.at >= start && bar.at <= now + 60_000)
}

export async function loadEthBars(id: string, fetcher: FetchLike = defaultFetch, now = Date.now()): Promise<EthBars> {
  const chart = chartById(id)
  const cached = cache.get(chart.id)
  if (cached && now - cached.at < 60_000) return { bars: withinSpan(cached.bars, now, chart.spanMs), source: cached.source }
  const bucketMs = chart.id === "6h" ? 6 * 60 * 60 * 1000 : null
  const attempts: { source: string; load: () => Promise<Candle[]> }[] = [
    { source: "Coinbase", load: () => readJson(fetcher, `${COINBASE}${chart.granularity}`).then(parseCandles) },
    { source: "Kraken", load: () => readJson(fetcher, `${KRAKEN}${KRAKEN_MINUTES[chart.id]}`).then(candlesFromKraken) },
    { source: "CoinGecko", load: () => readJson(fetcher, `${COINGECKO}${GECKO_DAYS[chart.id]}`).then(candlesFromCoinGecko) },
  ]
  let lastError: unknown = null
  for (const attempt of attempts) {
    try {
      const candles = await attempt.load()
      const lookback = bucketMs == null ? chart.spanMs : Math.max(chart.spanMs, bucketMs * 400)
      const sized = bucketMs == null ? barsFromCandles(candles, now, lookback) : bucketBars(barsFromCandles(candles, now, lookback), bucketMs)
      const bars = withinSpan(sized, now, chart.spanMs)
      if (bars.length < 2) throw new Error(`${attempt.source} returned too few candles`)
      cache.set(chart.id, { at: now, bars, source: attempt.source })
      return { bars, source: attempt.source }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The ETH chart could not be loaded")
}
