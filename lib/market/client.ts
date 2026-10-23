import { DEFAULT_GAS_REFRESH_MS, DEFAULT_PRICE_REFRESH_MS, GasStatusService, MarketStatusService, refreshMs } from "@/lib/market/service"
import { EMPTY_FEED, type EthMarket, type FeedState, type GasEstimate, type MarketStatus } from "@/lib/market/types"

export type MarketView = {
  eth: FeedState<EthMarket>
  gas: FeedState<GasEstimate>
  /** server: this tab reads the cached /api/market/status. browser: the static site, so this tab runs the services. */
  via: "server" | "browser"
  /** Direction and time of the last change in ETH price and standard gas, for a brief arrow. */
  ethMove: Move | null
  gasMove: Move | null
}

export type Move = { dir: "up" | "down"; at: number }

function moveOf(previous: number | undefined, next: number | undefined, current: Move | null): Move | null {
  if (previous == null || next == null || previous === next) return current
  return { dir: next > previous ? "up" : "down", at: Date.now() }
}

const CACHE_KEY = "weth-market-cache-v1"
const PRICE_MS = refreshMs(process.env.NEXT_PUBLIC_MARKET_PRICE_REFRESH_MS, DEFAULT_PRICE_REFRESH_MS)
const GAS_MS = refreshMs(process.env.NEXT_PUBLIC_GAS_REFRESH_MS, DEFAULT_GAS_REFRESH_MS)
const HIDDEN_MS = 60_000
const SERVER_POLL_MS = 3000
/** A new block refreshes gas, but never more often than this. */
const MIN_GAS_GAP_MS = 6000

type Cache = { eth?: { data: EthMarket; fetchedAt: number; fallback: boolean }; gas?: { data: GasEstimate; fetchedAt: number; fallback: boolean } }

function readCache(): Cache {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") as Cache
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeCache(patch: Cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), ...patch }))
  } catch {
    // Storage full or blocked. The in-memory value still shows.
  }
}

class MarketClient {
  private eth = new MarketStatusService()
  private gas = new GasStatusService()
  private view: MarketView = { eth: { ...EMPTY_FEED }, gas: { ...EMPTY_FEED }, via: process.env.NEXT_PUBLIC_PAGES === "1" ? "browser" : "server", ethMove: null, gasMove: null }
  private listeners = new Set<() => void>()
  private started = false
  private timers: number[] = []
  private serverFailures = 0
  private lastGasAt = 0
  private lastPriceAt = 0

  constructor() {
    this.eth.subscribe(() => this.emit())
    this.gas.subscribe(() => this.emit())
  }

  getView = (): MarketView => this.view

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.arm()
    return () => this.listeners.delete(listener)
  }

  private emit() {
    const eth = this.eth.get()
    const gas = this.gas.get()
    this.view = {
      eth,
      gas,
      via: this.view.via,
      ethMove: moveOf(this.view.eth.data?.priceUsd, eth.data?.priceUsd, this.view.ethMove),
      gasMove: moveOf(this.view.gas.data?.standard?.gwei, gas.data?.standard?.gwei, this.view.gasMove),
    }
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error(error)
      }
    }
  }

  /** Starts after subscribe returns, so the snapshot cannot change while React is checking it. */
  private arm() {
    if (this.started || typeof window === "undefined") return
    this.started = true
    queueMicrotask(() => {
      if (typeof window === "undefined") return
      this.seedFromCache()
      void this.seedFromPublished()
      window.addEventListener("storage", (event) => {
        if (event.key === CACHE_KEY) this.seedFromCache()
      })
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.tick(true)
      })
      this.tick(true)
      this.timers.push(window.setInterval(() => this.tick(false), 1000))
    })
  }

  private seedFromCache() {
    const cache = readCache()
    if (cache.eth) this.eth.seed(cache.eth.data, cache.eth.fallback)
    if (cache.gas) this.gas.seed(cache.gas.data, cache.gas.fallback)
  }

  private async seedFromPublished() {
    try {
      const response = await fetch(`/data/market.json?t=${Math.floor(Date.now() / 60_000)}`)
      if (!response.ok) return
      const status = (await response.json()) as MarketStatus
      if (status.eth?.data) this.eth.seed(status.eth.data, status.eth.fallback)
      if (status.gas?.data) this.gas.seed(status.gas.data, status.gas.fallback)
    } catch {
      // The published seed is optional.
    }
  }

  private tick(force: boolean) {
    const now = Date.now()
    const hidden = document.hidden
    if (this.view.via === "server") {
      if (force || now - this.lastPriceAt >= (hidden ? HIDDEN_MS : SERVER_POLL_MS)) void this.pollServer()
      return
    }
    if (force || now - this.lastPriceAt >= (hidden ? HIDDEN_MS : PRICE_MS)) void this.refreshPrice()
    if (force || now - this.lastGasAt >= (hidden ? HIDDEN_MS : GAS_MS)) void this.refreshGas()
  }

  /** Another tab may have fetched within the interval. Its stored value is used instead of a new request. */
  private sharedFresh(kind: "eth" | "gas", intervalMs: number): boolean {
    const entry = readCache()[kind]
    if (!entry || Date.now() - entry.fetchedAt >= intervalMs * 0.8) return false
    if (kind === "eth") this.eth.seed(entry.data as EthMarket, entry.fallback)
    else this.gas.seed(entry.data as GasEstimate, entry.fallback)
    return true
  }

  private async refreshPrice(force = false) {
    this.lastPriceAt = Date.now()
    if (!force && this.sharedFresh("eth", PRICE_MS)) return
    const state = await this.eth.refresh()
    if (state.data && !state.lastError) writeCache({ eth: { data: state.data, fetchedAt: Date.now(), fallback: state.fallback } })
  }

  private async refreshGas(force = false) {
    this.lastGasAt = Date.now()
    if (!force && this.sharedFresh("gas", GAS_MS)) return
    const state = await this.gas.refresh()
    if (state.data && !state.lastError) writeCache({ gas: { data: state.data, fetchedAt: Date.now(), fallback: state.fallback } })
  }

  private async pollServer() {
    this.lastPriceAt = Date.now()
    try {
      const response = await fetch("/api/market/status", { cache: "no-store" })
      if (!response.ok) throw new Error(String(response.status))
      const status = (await response.json()) as MarketStatus
      this.serverFailures = 0
      this.eth.seed(status.eth.data, status.eth.fallback)
      this.gas.seed(status.gas.data, status.gas.fallback)
      if (status.eth.data) writeCache({ eth: { data: status.eth.data, fetchedAt: Date.now(), fallback: status.eth.fallback } })
      if (status.gas.data) writeCache({ gas: { data: status.gas.data, fetchedAt: Date.now(), fallback: status.gas.fallback } })
      this.applyServerErrors(status)
    } catch {
      this.serverFailures += 1
      if (this.serverFailures >= 3) {
        this.view = { ...this.view, via: "browser" }
        this.emit()
      }
    }
  }

  private applyServerErrors(status: MarketStatus) {
    const eth = this.eth.get()
    const gas = this.gas.get()
    this.view = {
      ...this.view,
      eth: { ...eth, lastError: status.eth.lastError, lastAttemptAt: status.eth.lastAttemptAt, refreshing: status.eth.refreshing, fallback: status.eth.fallback },
      gas: { ...gas, lastError: status.gas.lastError, lastAttemptAt: status.gas.lastAttemptAt, refreshing: status.gas.refreshing, fallback: status.gas.fallback },
      via: "server",
    }
    for (const listener of this.listeners) listener()
  }

  /** Called with each new Ethereum head the page already receives. Costs nothing on the LP path. */
  onBlock() {
    if (!this.started || this.view.via === "server" || document.hidden) return
    if (Date.now() - this.lastGasAt < MIN_GAS_GAP_MS) return
    void this.refreshGas()
  }

  refreshNow(kind: "eth" | "gas") {
    if (this.view.via === "server") return void this.pollServer()
    if (kind === "eth") void this.refreshPrice(true)
    else void this.refreshGas(true)
  }
}

let client: MarketClient | null = null

export function marketClient(): MarketClient {
  client ??= new MarketClient()
  return client
}
