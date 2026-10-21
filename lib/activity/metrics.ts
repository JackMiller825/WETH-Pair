/**
 * Source rank. On-chain reads beat live indexers, which beat the DEXTools values in the published snapshot.
 */
export const SOURCE_RANK = { dextools: 1, blockscout: 2, ethplorer: 2, chain: 3 } as const
export type MetricSource = keyof typeof SOURCE_RANK

export type Metric<T> = {
  value: T
  source: MetricSource
  /** Milliseconds. For a provider call this is when the request started, so a delayed reply stays old. */
  observedAt: number
  /** Ethereum block the value reflects, when known. */
  block: number | null
}

/** loading: nothing yet and a request is pending. unavailable: every source failed or has no value. */
export type SlotStatus = "loading" | "ready" | "unavailable"

export type MetricSlot<T> = { metric: Metric<T> | null; status: SlotStatus; error: string | null }

export const LOADING: MetricSlot<never> = { metric: null, status: "loading", error: null }

/** A value from a source without a block replaces a block-tagged value only after this long. */
export const STALE_FALLBACK_MS = 5 * 60_000

/**
 * Whether `next` may replace `current`. Block numbers decide when both have one. A value without a block
 * never overwrites a newer one, and a lower-ranked source only takes over once the current value is stale.
 */
export function acceptMetric<T>(current: Metric<T> | null | undefined, next: Metric<T>, staleAfterMs = STALE_FALLBACK_MS): boolean {
  if (!current) return true
  if (current.block != null && next.block != null) {
    if (next.block !== current.block) return next.block > current.block
    return next.observedAt >= current.observedAt
  }
  if (current.block != null) return next.observedAt - current.observedAt > staleAfterMs
  if (next.block != null) return next.observedAt >= current.observedAt || SOURCE_RANK[next.source] > SOURCE_RANK[current.source]
  if (next.observedAt <= current.observedAt) return false
  if (SOURCE_RANK[next.source] >= SOURCE_RANK[current.source]) return true
  return next.observedAt - current.observedAt > staleAfterMs
}

export function applyMetric<T>(slot: MetricSlot<T> | undefined, next: Metric<T>, staleAfterMs = STALE_FALLBACK_MS): MetricSlot<T> | null {
  const current = slot?.metric ?? null
  if (!acceptMetric(current, next, staleAfterMs)) return null
  return { metric: next, status: "ready", error: null }
}

/**
 * Total Tx is the number of swap events (buys plus sells) on this pair since it was created.
 *
 * The baseline is either exact (counted from the creation block on chain, `block` set) or the DEXTools
 * total at `observedAt`. Live swaps are added on top: after the baseline block when it is exact, or seen
 * after the baseline time otherwise. A swap is identified by transaction hash and log index, so replaying
 * the same log never counts twice.
 */
export type TxBaseline = { count: number; observedAt: number; block: number | null; source: MetricSource }
export type TxCounter = { baseline: TxBaseline | null; swaps: ReadonlyMap<string, { block: number; seenAt: number }> }

export const EMPTY_COUNTER: TxCounter = { baseline: null, swaps: new Map() }

function counted(baseline: TxBaseline, swap: { block: number; seenAt: number }): boolean {
  return baseline.block != null ? swap.block > baseline.block : swap.seenAt > baseline.observedAt
}

export function txTotal(counter: TxCounter): number | null {
  const baseline = counter.baseline
  if (!baseline) return null
  let total = baseline.count
  for (const swap of counter.swaps.values()) if (counted(baseline, swap)) total += 1
  return total
}

export function addSwap(counter: TxCounter, id: string, block: number, seenAt: number): TxCounter | null {
  if (counter.swaps.has(id)) return null
  const swaps = new Map(counter.swaps)
  swaps.set(id, { block, seenAt })
  return { baseline: counter.baseline, swaps }
}

/** An exact on-chain baseline is only replaced by a later exact one. A DEXTools baseline by anything newer. */
export function setTxBaseline(counter: TxCounter, baseline: TxBaseline): TxCounter | null {
  const current = counter.baseline
  if (current) {
    if (current.block != null && baseline.block == null) return null
    if (current.block != null && baseline.block != null && baseline.block <= current.block && baseline.count <= current.count) return null
    if (current.block == null && baseline.block == null && baseline.observedAt <= current.observedAt) return null
  }
  // Swaps the new baseline already includes stay in the map, so a replay of the same log is still a duplicate.
  return { baseline, swaps: counter.swaps }
}
