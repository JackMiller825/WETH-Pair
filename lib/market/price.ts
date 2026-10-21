import { defaultFetch, type EthMarket, type FetchLike } from "@/lib/market/types"

export type ProviderHealth = {
  ok: boolean
  lastSuccessAt: string | null
  lastError: string | null
}

export type EthChanges = { change1h: number | null; change24h: number | null; change7d: number | null }

/** One market-data source. The UI never talks to a provider; MarketStatusService does. */
export interface MarketPriceProvider {
  readonly id: string
  readonly label: string
  getEthPrice(): Promise<{ priceUsd: number; observedAt: string }>
  getEthChanges(priceUsd: number, at: number): Promise<EthChanges>
  getHealth(): ProviderHealth
}

/** Above this the payload is treated as corrupt rather than a real ETH price. */
export const MAX_SANE_PRICE = 100_000_000

export function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < MAX_SANE_PRICE
}

/** (current - past) / past × 100. Null when the past price is missing or not positive. */
export function percentChange(current: number, past: number | null | undefined): number | null {
  if (!validPrice(current) || past == null || !validPrice(past)) return null
  return ((current - past) / past) * 100
}

/** Coinbase candle: [startSeconds, low, high, open, close, volume]. */
export type Candle = [number, number, number, number, number, number]

/**
 * Price at `atMs` from candles of `granularitySec`: the candle that contains the instant, interpolated
 * from its open to its close by how far into the candle the instant falls. Null when no candle covers it.
 */
export function priceAt(candles: readonly Candle[], atMs: number, granularitySec: number): number | null {
  const at = atMs / 1000
  for (const candle of candles) {
    const [start, , , open, close] = candle
    if (at >= start && at < start + granularitySec) {
      if (!validPrice(open) || !validPrice(close)) return null
      const fraction = (at - start) / granularitySec
      return open + (close - open) * fraction
    }
  }
  return null
}

export function parseCandles(payload: unknown): Candle[] {
  if (!Array.isArray(payload)) throw new Error("Candle payload is not an array")
  return payload.filter((row): row is Candle => Array.isArray(row) && row.length >= 5 && row.slice(0, 5).every((value) => typeof value === "number" && Number.isFinite(value)))
}

async function getJson(fetcher: FetchLike, url: string, timeoutMs = 8000): Promise<unknown> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

class HealthTracker {
  private health: ProviderHealth = { ok: false, lastSuccessAt: null, lastError: null }
  success(at: number) {
    this.health = { ok: true, lastSuccessAt: new Date(at).toISOString(), lastError: null }
  }
  failure(error: unknown) {
    this.health = { ...this.health, ok: false, lastError: error instanceof Error ? error.message : String(error) }
  }
  get(): ProviderHealth {
    return this.health
  }
}

const COINBASE = "https://api.exchange.coinbase.com/products/ETH-USD"

/**
 * Coinbase Exchange ETH-USD. The ticker is the live trade price. Coinbase does not publish 1h/24h/7d
 * percentages, so they are computed from candles: 1-minute candles for one hour ago, 15-minute for one
 * day ago, and hourly for seven days ago. Candles refresh far less often than the ticker.
 */
export class CoinbaseProvider implements MarketPriceProvider {
  readonly id = "coinbase"
  readonly label = "Coinbase Exchange ETH-USD"
  private health = new HealthTracker()
  private candles = new Map<number, { rows: Candle[]; fetchedAt: number }>()

  constructor(private fetcher: FetchLike = defaultFetch, private now: () => number = Date.now) {}

  async getEthPrice() {
    try {
      const payload = (await getJson(this.fetcher, `${COINBASE}/ticker`)) as { price?: unknown; time?: unknown }
      const price = typeof payload?.price === "string" ? Number(payload.price) : payload?.price
      if (!validPrice(price)) throw new Error("Coinbase returned an invalid price")
      const time = typeof payload.time === "string" ? Date.parse(payload.time) : NaN
      const at = Number.isFinite(time) ? Math.min(time, this.now()) : this.now()
      this.health.success(this.now())
      return { priceUsd: price, observedAt: new Date(at).toISOString() }
    } catch (error) {
      this.health.failure(error)
      throw error
    }
  }

  private async series(granularity: number, maxAgeMs: number): Promise<Candle[]> {
    const cached = this.candles.get(granularity)
    if (cached && this.now() - cached.fetchedAt < maxAgeMs) return cached.rows
    try {
      const rows = parseCandles(await getJson(this.fetcher, `${COINBASE}/candles?granularity=${granularity}`))
      this.candles.set(granularity, { rows, fetchedAt: this.now() })
      return rows
    } catch (error) {
      if (cached) return cached.rows
      throw error
    }
  }

  async getEthChanges(priceUsd: number, at: number): Promise<EthChanges> {
    const [minute, quarter, hour] = await Promise.allSettled([
      this.series(60, 60_000),
      this.series(900, 5 * 60_000),
      this.series(3600, 10 * 60_000),
    ])
    const ref = (result: PromiseSettledResult<Candle[]>, ms: number, granularity: number) =>
      result.status === "fulfilled" ? priceAt(result.value, at - ms, granularity) : null
    return {
      change1h: percentChange(priceUsd, ref(minute, 60 * 60_000, 60)),
      change24h: percentChange(priceUsd, ref(quarter, 24 * 60 * 60_000, 900)),
      change7d: percentChange(priceUsd, ref(hour, 7 * 24 * 60 * 60_000, 3600)),
    }
  }

  getHealth() {
    return this.health.get()
  }
}

const COINGECKO = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum&price_change_percentage=1h,24h,7d"

/** CoinGecko supplies the 1h, 24h, and 7d percentages directly. Its public API caches for about a minute. */
export class CoinGeckoProvider implements MarketPriceProvider {
  readonly id = "coingecko"
  readonly label = "CoinGecko"
  private health = new HealthTracker()
  private last: { fetchedAt: number; row: Record<string, unknown> } | null = null

  constructor(private fetcher: FetchLike = defaultFetch, private now: () => number = Date.now) {}

  private async row(): Promise<Record<string, unknown>> {
    if (this.last && this.now() - this.last.fetchedAt < 1000) return this.last.row
    const payload = await getJson(this.fetcher, COINGECKO)
    const row = Array.isArray(payload) ? (payload[0] as Record<string, unknown> | undefined) : undefined
    if (!row || typeof row !== "object") throw new Error("CoinGecko returned no ETH row")
    this.last = { fetchedAt: this.now(), row }
    return row
  }

  async getEthPrice() {
    try {
      const row = await this.row()
      if (!validPrice(row.current_price)) throw new Error("CoinGecko returned an invalid price")
      const updated = typeof row.last_updated === "string" ? Date.parse(row.last_updated) : NaN
      this.health.success(this.now())
      return { priceUsd: row.current_price, observedAt: new Date(Number.isFinite(updated) ? Math.min(updated, this.now()) : this.now()).toISOString() }
    } catch (error) {
      this.health.failure(error)
      throw error
    }
  }

  async getEthChanges(): Promise<EthChanges> {
    const row = await this.row()
    const pick = (key: string) => (typeof row[key] === "number" && Number.isFinite(row[key]) ? (row[key] as number) : null)
    return {
      change1h: pick("price_change_percentage_1h_in_currency"),
      change24h: pick("price_change_percentage_24h_in_currency") ?? pick("price_change_percentage_24h"),
      change7d: pick("price_change_percentage_7d_in_currency"),
    }
  }

  getHealth() {
    return this.health.get()
  }
}

/** Reads one complete market value from a provider. Price is required; a missing change stays null. */
export async function readEthMarket(provider: MarketPriceProvider, now: () => number = Date.now): Promise<EthMarket> {
  const price = await provider.getEthPrice()
  const changes = await provider.getEthChanges(price.priceUsd, Date.parse(price.observedAt) || now()).catch(
    (): EthChanges => ({ change1h: null, change24h: null, change7d: null }),
  )
  return { priceUsd: price.priceUsd, ...changes, observedAt: price.observedAt, source: provider.id, sourceLabel: provider.label }
}
