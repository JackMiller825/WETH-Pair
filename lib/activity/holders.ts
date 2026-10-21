import { defaultFetch, type FetchLike } from "@/lib/market/types"
import type { ProviderHealth } from "@/lib/market/price"
import type { MetricSource } from "@/lib/activity/metrics"

/** Holder count for one token. Indexers differ, so the UI never depends on a single one. */
export interface TokenHolderProvider {
  readonly id: MetricSource
  readonly label: string
  getHolderCount(token: string): Promise<number>
  getHealth(): ProviderHealth
}

function count(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

/**
 * A token with a pool always has at least one holder and one transfer (the mint), so a zero in either
 * means the indexer has not caught up with this token yet. Indexers report those zeros as if they were real.
 */
function indexed(holders: number | null, transfers: number | null): number | null {
  if (holders == null || holders === 0 || transfers === 0) return null
  return holders
}

abstract class BaseProvider implements TokenHolderProvider {
  abstract readonly id: MetricSource
  abstract readonly label: string
  private health: ProviderHealth = { ok: false, lastSuccessAt: null, lastError: null }
  constructor(protected fetcher: FetchLike = defaultFetch, protected now: () => number = Date.now) {}

  protected abstract url(token: string): string
  protected abstract pick(payload: unknown): number | null

  async getHolderCount(token: string): Promise<number> {
    try {
      const response = await this.fetcher(this.url(token.toLowerCase()), { signal: AbortSignal.timeout(8000), cache: "no-store" })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const value = this.pick(await response.json())
      if (value == null) throw new Error(`${this.label} returned no holder count`)
      this.health = { ok: true, lastSuccessAt: new Date(this.now()).toISOString(), lastError: null }
      return value
    } catch (error) {
      this.health = { ...this.health, ok: false, lastError: error instanceof Error ? error.message : String(error) }
      throw error
    }
  }

  getHealth() {
    return this.health
  }
}

export class BlockscoutHolderProvider extends BaseProvider {
  readonly id = "blockscout" as const
  readonly label = "Blockscout"
  protected url(token: string) {
    return `https://eth.blockscout.com/api/v2/tokens/${token}/counters`
  }
  protected pick(payload: unknown) {
    const counters = payload as { token_holders_count?: unknown; transfers_count?: unknown } | null
    return indexed(count(counters?.token_holders_count), count(counters?.transfers_count))
  }
}

export class EthplorerHolderProvider extends BaseProvider {
  readonly id = "ethplorer" as const
  readonly label = "Ethplorer"
  protected url(token: string) {
    return `https://api.ethplorer.io/getTokenInfo/${token}?apiKey=freekey`
  }
  protected pick(payload: unknown) {
    const info = payload as { holdersCount?: unknown; transfersCount?: unknown } | null
    return indexed(count(info?.holdersCount), count(info?.transfersCount))
  }
}

/**
 * How often to re-read holders. Very new tokens change fast; old quiet ones rarely do. A swap in the last
 * ten minutes keeps an older token on the faster schedule.
 */
export function holderRefreshMs(pairAgeMs: number | null, lastSwapAgeMs: number | null = null): number {
  const active = lastSwapAgeMs != null && lastSwapAgeMs < 10 * 60_000
  if (pairAgeMs == null) return active ? 3 * 60_000 : 10 * 60_000
  if (pairAgeMs < 10 * 60_000) return 20_000
  if (pairAgeMs < 60 * 60_000) return 60_000
  if (pairAgeMs < 24 * 60 * 60_000 || active) return 3 * 60_000
  return 10 * 60_000
}
