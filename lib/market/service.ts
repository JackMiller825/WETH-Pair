import { EtherscanGasOracleProvider, GAS_RPCS, RpcFeeHistoryProvider, type GasProvider } from "@/lib/market/gas"
import { CoinGeckoProvider, CoinbaseProvider, readEthMarket, type MarketPriceProvider } from "@/lib/market/price"
import { EMPTY_FEED, defaultFetch, type EthMarket, type FeedHealth, type FeedState, type FetchLike, type GasEstimate, type MarketStatus } from "@/lib/market/types"

export const DEFAULT_PRICE_REFRESH_MS = 10_000
export const DEFAULT_GAS_REFRESH_MS = 12_000
/** While on a fallback, the primary is retried this often. Switching back only happens when it answers. */
export const PRIMARY_RETRY_MS = 60_000
export const PRICE_STALE_MS = 45_000
export const GAS_STALE_MS = 45_000

export function refreshMs(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 2000 && parsed <= 10 * 60_000 ? parsed : fallback
}

type Source<T> = { id: string; label: string; read: () => Promise<T> }

/**
 * Keeps one normalized value from an ordered provider list. The primary is used whenever it works, so
 * the shown value does not alternate between providers. A failed refresh keeps the last good value, and
 * a response older than the value already held is ignored.
 */
export class FeedService<T extends { observedAt: string }> {
  private state: FeedState<T> = { ...EMPTY_FEED }
  private active = 0
  private primaryTriedAt = 0
  private inflight: Promise<FeedState<T>> | null = null
  private listeners = new Set<(state: FeedState<T>) => void>()

  constructor(private sources: Source<T>[], private now: () => number = Date.now) {
    if (sources.length === 0) throw new Error("A feed needs at least one provider")
  }

  get(): FeedState<T> {
    return this.state
  }

  /** Seeds a cached value, for example from storage or a published file. Never replaces newer data. */
  seed(data: T | null, fallback = false) {
    if (!data || !this.isNewer(data)) return
    this.set({ ...this.state, data, fallback })
  }

  subscribe(listener: (state: FeedState<T>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(next: FeedState<T>) {
    this.state = next
    for (const listener of this.listeners) listener(next)
  }

  private isNewer(data: T): boolean {
    const current = this.state.data
    if (!current) return true
    return Date.parse(data.observedAt) >= Date.parse(current.observedAt)
  }

  refresh(): Promise<FeedState<T>> {
    if (this.inflight) return this.inflight
    this.inflight = this.run().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private order(): number[] {
    const all = this.sources.map((_, index) => index)
    if (this.active === 0 || this.now() - this.primaryTriedAt >= PRIMARY_RETRY_MS) return all
    return [this.active, ...all.filter((index) => index !== this.active && index !== 0), 0]
  }

  private async run(): Promise<FeedState<T>> {
    const startedAt = new Date(this.now()).toISOString()
    this.set({ ...this.state, refreshing: true })
    const errors: string[] = []
    for (const index of this.order()) {
      if (index === 0) this.primaryTriedAt = this.now()
      const source = this.sources[index]
      try {
        const data = await source.read()
        this.active = index
        const keep = this.isNewer(data) ? data : this.state.data
        this.set({ data: keep, fallback: index !== 0, lastAttemptAt: startedAt, lastError: null, refreshing: false })
        return this.state
      } catch (error) {
        errors.push(`${source.label}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.set({ ...this.state, lastAttemptAt: startedAt, lastError: errors.join(" · "), refreshing: false })
    return this.state
  }
}

export function feedHealth<T extends { observedAt: string }>(state: FeedState<T>, now: number, staleMs: number): FeedHealth {
  if (!state.data) return state.refreshing || !state.lastAttemptAt ? "refreshing" : "unavailable"
  const age = now - Date.parse(state.data.observedAt)
  if (!Number.isFinite(age) || age > staleMs) return "stale"
  if (state.fallback) return "degraded"
  return "live"
}

export function priceSources(providers: MarketPriceProvider[], now: () => number = Date.now): Source<EthMarket>[] {
  return providers.map((provider) => ({ id: provider.id, label: provider.label, read: () => readEthMarket(provider, now) }))
}

export function gasSources(providers: GasProvider[]): Source<GasEstimate>[] {
  return providers.map((provider) => ({ id: provider.id, label: provider.label, read: () => provider.getGasEstimate() }))
}

/** ETH price and 1h / 24h / 7d change. Coinbase is primary and CoinGecko is the fallback. */
export class MarketStatusService extends FeedService<EthMarket> {
  constructor(options: { fetcher?: FetchLike; now?: () => number; providers?: MarketPriceProvider[] } = {}) {
    const now = options.now ?? Date.now
    const fetcher = options.fetcher ?? defaultFetch
    super(priceSources(options.providers ?? [new CoinbaseProvider(fetcher, now), new CoinGeckoProvider(fetcher, now)], now), now)
  }
}

/**
 * Standard, fast, rapid, and base fee. Ethereum fee history from public RPCs is computed here. When the
 * server has ETHERSCAN_API_KEY, Etherscan's oracle goes first and fee history stays as the fallback.
 */
export class GasStatusService extends FeedService<GasEstimate> {
  constructor(options: { fetcher?: FetchLike; now?: () => number; etherscanKey?: string | null; providers?: GasProvider[] } = {}) {
    const now = options.now ?? Date.now
    const fetcher = options.fetcher ?? defaultFetch
    const rpc = GAS_RPCS.map((url) => new RpcFeeHistoryProvider(url, fetcher, now))
    const providers = options.providers ?? (options.etherscanKey ? [new EtherscanGasOracleProvider(options.etherscanKey, fetcher, now), ...rpc] : rpc)
    super(gasSources(providers), now)
  }
}

export function marketStatusOf(eth: FeedService<EthMarket>, gas: FeedService<GasEstimate>, now = Date.now()): MarketStatus {
  return { eth: eth.get(), gas: gas.get(), servedAt: new Date(now).toISOString() }
}
