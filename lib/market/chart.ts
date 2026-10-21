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
const cache = new Map<number, { at: number; rows: Candle[] }>()

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

export async function loadEthBars(id: string, fetcher: FetchLike = defaultFetch, now = Date.now()): Promise<PriceBar[]> {
  const chart = chartById(id)
  const cached = cache.get(chart.granularity)
  if (cached && now - cached.at < 60_000) return barsFromCandles(cached.rows, now, chart.spanMs)
  const response = await fetcher(`${COINBASE}${chart.granularity}`, { signal: AbortSignal.timeout(8000), cache: "no-store" })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const rows = parseCandles(await response.json())
  cache.set(chart.granularity, { at: now, rows })
  return barsFromCandles(rows, now, chart.spanMs)
}
