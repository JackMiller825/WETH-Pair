export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Browsers reject `fetch` called with a `this` other than the window, so stored references go through this. */
export const defaultFetch: FetchLike = (input, init) => fetch(input, init)

/** LIVE: fresh primary data. REFRESHING: no fresh data yet but a request is in flight. */
export type FeedHealth = "live" | "refreshing" | "stale" | "degraded" | "unavailable"

export type EthMarket = {
  priceUsd: number
  /** Percent change versus the price one hour, one day, and seven days before `observedAt`. Null when the provider cannot supply it. */
  change1h: number | null
  change24h: number | null
  change7d: number | null
  observedAt: string
  /** Provider id, for example "coinbase" or "coingecko". */
  source: string
  sourceLabel: string
}

export type GasTier = {
  /** Expected price paid per gas: next base fee plus the priority tip, in gwei. This is the number shown. */
  gwei: number
  /** Priority tip in gwei. */
  priorityFee: number
  /** Suggested EIP-1559 cap: two times the next base fee plus the tip, in gwei. */
  maxFeePerGas: number
  estimatedSeconds: number
}

export type GasEstimate = {
  standard: GasTier
  fast: GasTier
  rapid: GasTier
  /** Base fee of the next block, in gwei. */
  baseFee: number
  blockNumber: number | null
  observedAt: string
  source: string
  sourceLabel: string
  /** Priority-fee percentiles used for standard, fast, and rapid. */
  percentiles: readonly [number, number, number]
}

export type FeedState<T> = {
  /** Last good value. Kept through failed refreshes. */
  data: T | null
  /** True while the service is on a fallback provider. */
  fallback: boolean
  lastAttemptAt: string | null
  lastError: string | null
  refreshing: boolean
}

export type MarketStatus = {
  eth: FeedState<EthMarket>
  gas: FeedState<GasEstimate>
  servedAt: string
}

export const EMPTY_FEED: FeedState<never> = { data: null, fallback: false, lastAttemptAt: null, lastError: null, refreshing: false }
