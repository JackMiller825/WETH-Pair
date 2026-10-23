import { EMPTY_COUNTER, LOADING, addSwap, applyMetric, setTxBaseline, txTotal, type Metric, type MetricSlot, type SlotStatus, type TxBaseline, type TxCounter } from "@/lib/activity/metrics"
import { poolKind, wethIsToken0, type PoolKind } from "@/lib/activity/pool"
import { eventsOf, type LpBurnEvent } from "@/lib/lp/monitor"
import { parseIdentity } from "@/lib/narrative/text"
import type { SnapshotFile } from "@/lib/narrative/types"
import type { PairRecord } from "@/lib/types"

export type ActivityType = "new-pair" | "lp-burn" | "lp-lock" | "trend" | "news"

export const ACTIVITY_FILTERS = [
  { id: "all", label: "All", types: null },
  { id: "pairs", label: "Pairs", types: ["new-pair"] },
  { id: "burns", label: "LP Burns", types: ["lp-burn", "lp-lock"] },
  { id: "trends", label: "Trends", types: ["trend"] },
  { id: "news", label: "News", types: ["news"] },
] as const satisfies readonly { id: string; label: string; types: readonly ActivityType[] | null }[]

export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]["id"]

/** Published with the snapshot so the browser does not run the narrative engine next to LP detection. */
export type ActivitySignal = {
  id: string
  type: "trend" | "news"
  at: string
  title: string
  detail: string
  href: string
}

export type ActivityItem = {
  activityId: string
  type: ActivityType
  occurredAt: string
  tokenAddress: string | null
  pairAddress: string | null
  exchange: string | null
  name: string
  symbol: string
  pairCreatedAt: string | null
  lpBurnPercent: number | null
  title: string | null
  detail: string | null
  href: string
  /** From the realtime feed rather than the published snapshot. */
  live: boolean
  /** Local time this card first appeared, for the arrival highlight. */
  receivedAt: number
}

export type ActivityInput = Omit<ActivityItem, "receivedAt"> & { receivedAt?: number }

export type PairInfo = {
  pair: string
  token: string
  exchange: string
  createdAt: string | null
  creationBlock: number | null
  token0?: string | null
}

type PairState = {
  info: PairInfo
  kind: PoolKind
  wethFirst: boolean
  tx: TxCounter
  txStatus: SlotStatus
  txError: string | null
  pooled: MetricSlot<number>
  lastSwapAt: number | null
}

export type EnrichmentStatus = { coreReady: boolean; marketReady: boolean; holdersReady: boolean }

export type MetricsView = {
  totalTx: MetricSlot<number>
  pooledWeth: MetricSlot<number>
  holders: MetricSlot<number>
  enrichment: EnrichmentStatus
}

export type ActivityPatch =
  | { type: "activity.created"; item: ActivityItem }
  | { type: "activity.updated"; activityId: string; item: ActivityItem }
  | { type: "activity.metrics.updated"; pair: string | null; token: string | null; totalTx?: number | null; pooledWeth?: number | null; holders?: number | null }

export const MAX_ACTIVITY = 250
export const SNAPSHOT_PAIRS = 60
export const SNAPSHOT_BURNS = 40

const EMPTY_VIEW: MetricsView = { totalTx: LOADING, pooledWeth: LOADING, holders: LOADING, enrichment: { coreReady: true, marketReady: false, holdersReady: false } }

function settled(slot: MetricSlot<unknown>): boolean {
  return slot.status !== "loading"
}

/** DEXTools reports 0 holders and 0 trades for a pool it has not indexed yet. That is unknown, not zero. */
function dextoolsCount(row: PairRecord, value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  if (value === 0 && row.price == null && row.liquidity == null) return null
  return value
}

function pooledFromRow(row: PairRecord): number | null {
  if (row.remaining == null || !Number.isFinite(row.remaining) || row.remaining < 0) return null
  return /^w?eth$/i.test(row.remainingUnit) ? row.remaining : null
}

export function identityOf(record: PairRecord): { name: string; symbol: string } {
  if (record.listingSource === "ethereum-pair-created" && !record.symbol && record.name === "WETH pair") return { name: "", symbol: "" }
  const identity = parseIdentity(record)
  return { name: identity.tokenName, symbol: identity.symbol }
}

export function pairActivity(record: PairRecord, live: boolean): ActivityInput {
  const identity = identityOf(record)
  return {
    activityId: `pair:${record.address.toLowerCase()}`,
    type: "new-pair",
    occurredAt: record.created_at,
    tokenAddress: record.tokenAddress.toLowerCase(),
    pairAddress: record.address.toLowerCase(),
    exchange: record.exchange,
    name: identity.name,
    symbol: identity.symbol,
    pairCreatedAt: record.created_at,
    lpBurnPercent: null,
    title: null,
    detail: null,
    href: live ? record.url : `/tokens/${record.tokenAddress.toLowerCase()}`,
    live,
  }
}

export function burnActivity(event: LpBurnEvent, live: boolean): ActivityInput {
  return {
    activityId: `burn:${event.id}`,
    type: "lp-burn",
    occurredAt: event.burnAt ?? event.detectedAt,
    tokenAddress: event.tokenAddress,
    pairAddress: event.pair,
    exchange: event.exchange,
    name: event.symbol === "WETH pair" ? "" : event.tokenName,
    symbol: event.symbol === "WETH pair" ? "" : event.symbol,
    pairCreatedAt: event.createdAt,
    lpBurnPercent: event.percentKnown === false ? null : event.lpBurntPercent,
    title: null,
    detail: null,
    href: live ? event.url : `/tokens/${event.tokenAddress}`,
    live,
  }
}

export function signalActivity(signal: ActivitySignal): ActivityInput {
  return {
    activityId: `${signal.type}:${signal.id}`,
    type: signal.type,
    occurredAt: signal.at,
    tokenAddress: null,
    pairAddress: null,
    exchange: null,
    name: signal.title,
    symbol: "",
    pairCreatedAt: null,
    lpBurnPercent: null,
    title: signal.title,
    detail: signal.detail,
    href: signal.href,
    live: false,
  }
}

function pairInfoOf(record: PairRecord): PairInfo {
  return {
    pair: record.address.toLowerCase(),
    token: record.tokenAddress.toLowerCase(),
    exchange: record.exchange,
    createdAt: record.created_at,
    creationBlock: record.creationBlock ?? null,
  }
}

/**
 * Live Activity state. Cards are created once per activity id and updated in place. Metrics belong to
 * the pair (Total Tx, Pooled WETH) or the token (Holders), so every card for that pair shows the same
 * value and enrichment never creates a second card.
 */
export class ActivityStore {
  private items = new Map<string, ActivityItem>()
  private list: ActivityItem[] = []
  private pairs = new Map<string, PairState>()
  private holders = new Map<string, MetricSlot<number>>()
  private pairVersion = new Map<string, number>()
  private holderVersion = new Map<string, number>()
  private views = new Map<string, { pv: number; hv: number; view: MetricsView }>()
  private listeners = new Set<() => void>()
  private patchListeners = new Set<(patch: ActivityPatch) => void>()
  private pending = false
  private listDirty = false
  private seq = 0

  constructor(private now: () => number = Date.now, private schedule: (run: () => void) => void = (run) => queueMicrotask(run)) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onPatch(listener: (patch: ActivityPatch) => void): () => void {
    this.patchListeners.add(listener)
    return () => this.patchListeners.delete(listener)
  }

  getList = (): ActivityItem[] => this.list

  /** Bumps when a card or a metric changes. Readers use it to refresh without touching the burn path. */
  revision = (): number => this.seq

  /**
   * Swaps this tab has stored. A swap stamped at the baseline observation time arrived in a bulk
   * backfill, so it has no trade time and is marked bulk. Live swaps keep the time they were seen.
   */
  timedSwaps(): { pair: string; id: string; seenAt: number; bulk: boolean }[] {
    const out: { pair: string; id: string; seenAt: number; bulk: boolean }[] = []
    for (const state of this.pairs.values()) {
      const bulkAt = state.tx.baseline?.observedAt ?? null
      for (const [id, swap] of state.tx.swaps) {
        out.push({ pair: state.info.pair, id, seenAt: swap.seenAt, bulk: bulkAt != null && swap.seenAt === bulkAt })
      }
    }
    return out
  }

  get(activityId: string): ActivityItem | undefined {
    return this.items.get(activityId)
  }

  private emit(patch: ActivityPatch) {
    for (const listener of this.patchListeners) listener(patch)
    if (this.pending) return
    this.pending = true
    this.schedule(() => {
      this.pending = false
      if (this.listDirty) {
        this.listDirty = false
        this.rebuild()
      }
      for (const listener of this.listeners) listener()
    })
  }

  private rebuild() {
    const sorted = [...this.items.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.activityId.localeCompare(b.activityId))
    const kept = sorted.slice(0, MAX_ACTIVITY)
    for (const item of sorted.slice(MAX_ACTIVITY)) this.items.delete(item.activityId)
    this.list = kept
    const referenced = new Set(kept.map((item) => item.pairAddress).filter(Boolean))
    for (const pair of this.pairs.keys()) {
      if (!referenced.has(pair)) {
        this.pairs.delete(pair)
        this.pairVersion.delete(pair)
      }
    }
  }

  /** Adds a card, or updates the existing one with the same id. Never duplicates. */
  upsert(input: ActivityInput): ActivityItem {
    const existing = this.items.get(input.activityId)
    if (existing) {
      const merged: ActivityItem = {
        ...existing,
        ...input,
        name: input.name || existing.name,
        symbol: input.symbol || existing.symbol,
        lpBurnPercent: input.lpBurnPercent ?? existing.lpBurnPercent,
        href: existing.href.startsWith("/") ? existing.href : input.href,
        live: existing.live || input.live,
        receivedAt: existing.receivedAt,
      }
      const changed = (Object.keys(merged) as (keyof ActivityItem)[]).some((key) => merged[key] !== existing[key])
      if (!changed) return existing
      this.items.set(merged.activityId, merged)
      this.listDirty = true
      this.emit({ type: "activity.updated", activityId: merged.activityId, item: merged })
      return merged
    }
    const item: ActivityItem = { ...input, receivedAt: input.receivedAt ?? this.now() }
    this.items.set(item.activityId, item)
    this.listDirty = true
    this.emit({ type: "activity.created", item })
    return item
  }

  /** Fills in a token's name and ticker on every card for it, for example after an on-chain read. */
  setIdentity(token: string, name: string, symbol: string) {
    for (const item of this.items.values()) {
      if (item.tokenAddress === token.toLowerCase() && (!item.symbol || !item.name)) this.upsert({ ...item, name: item.name || name, symbol: item.symbol || symbol })
    }
  }

  ensurePair(info: PairInfo): PairState {
    const key = info.pair.toLowerCase()
    const existing = this.pairs.get(key)
    if (existing) {
      if (existing.info.creationBlock == null && info.creationBlock != null) existing.info = { ...existing.info, creationBlock: info.creationBlock }
      if (!existing.info.token0 && info.token0) {
        existing.info = { ...existing.info, token0: info.token0 }
        existing.wethFirst = wethIsToken0(info.token, info.token0)
      }
      return existing
    }
    const state: PairState = {
      info: { ...info, pair: key, token: info.token.toLowerCase() },
      kind: poolKind(info.exchange, key),
      wethFirst: wethIsToken0(info.token, info.token0),
      tx: EMPTY_COUNTER,
      txStatus: "loading",
      txError: null,
      pooled: LOADING,
      lastSwapAt: null,
    }
    this.pairs.set(key, state)
    this.pairVersion.set(key, ++this.seq)
    return state
  }

  pairState(pair: string): Readonly<PairState> | undefined {
    return this.pairs.get(pair.toLowerCase())
  }

  trackedPairs(limit: number): PairState[] {
    const out: PairState[] = []
    const seen = new Set<string>()
    for (const item of this.list) {
      if (!item.pairAddress || seen.has(item.pairAddress)) continue
      const state = this.pairs.get(item.pairAddress)
      if (!state) continue
      seen.add(item.pairAddress)
      out.push(state)
      if (out.length >= limit) break
    }
    return out
  }

  private bumpPair(pair: string, patch: Omit<Extract<ActivityPatch, { type: "activity.metrics.updated" }>, "type" | "pair" | "token">) {
    this.pairVersion.set(pair, ++this.seq)
    this.emit({ type: "activity.metrics.updated", pair, token: this.pairs.get(pair)?.info.token ?? null, ...patch })
  }

  setTxBaseline(pair: string, baseline: TxBaseline): boolean {
    const state = this.pairs.get(pair.toLowerCase())
    if (!state) return false
    const next = setTxBaseline(state.tx, baseline)
    if (!next) return false
    const before = txTotal(state.tx)
    state.tx = next
    state.txStatus = "ready"
    state.txError = null
    const after = txTotal(next)
    if (after !== before) this.bumpPair(state.info.pair, { totalTx: after })
    else this.pairVersion.set(state.info.pair, ++this.seq)
    return true
  }

  /** Counts one swap. A repeated transaction hash and log index is ignored. */
  addSwap(pair: string, id: string, block: number, seenAt = this.now()): boolean {
    const state = this.pairs.get(pair.toLowerCase())
    if (!state) return false
    const next = addSwap(state.tx, id, block, seenAt)
    if (!next) return false
    const before = txTotal(state.tx)
    state.tx = next
    state.lastSwapAt = seenAt
    const after = txTotal(next)
    if (after !== before) this.bumpPair(state.info.pair, { totalTx: after })
    return true
  }

  setPooledWeth(pair: string, metric: Metric<number>): boolean {
    const state = this.pairs.get(pair.toLowerCase())
    if (!state) return false
    const next = applyMetric(state.pooled, metric)
    if (!next) return false
    const changed = state.pooled.metric?.value !== next.metric?.value || state.pooled.status !== "ready"
    state.pooled = next
    if (changed) this.bumpPair(state.info.pair, { pooledWeth: metric.value })
    return true
  }

  setHolders(token: string, metric: Metric<number>): boolean {
    const key = token.toLowerCase()
    const next = applyMetric(this.holders.get(key), metric)
    if (!next) return false
    const before = this.holders.get(key)
    this.holders.set(key, next)
    if (before?.metric?.value !== metric.value || before?.status !== "ready") {
      this.holderVersion.set(key, ++this.seq)
      this.emit({ type: "activity.metrics.updated", pair: null, token: key, holders: metric.value })
    }
    return true
  }

  /** Marks a metric unavailable only when there is no value to keep showing. */
  markUnavailable(kind: "totalTx" | "pooledWeth" | "holders", key: string, error: string) {
    const id = key.toLowerCase()
    if (kind === "holders") {
      const slot = this.holders.get(id)
      if (slot?.metric) return
      this.holders.set(id, { metric: null, status: "unavailable", error })
      this.holderVersion.set(id, ++this.seq)
      this.emit({ type: "activity.metrics.updated", pair: null, token: id, holders: null })
      return
    }
    const state = this.pairs.get(id)
    if (!state) return
    if (kind === "pooledWeth") {
      if (state.pooled.metric) return
      state.pooled = { metric: null, status: "unavailable", error }
    } else {
      if (state.tx.baseline) return
      state.txStatus = "unavailable"
      state.txError = error
    }
    this.bumpPair(id, kind === "pooledWeth" ? { pooledWeth: null } : { totalTx: null })
  }

  holderSlot(token: string): MetricSlot<number> | undefined {
    return this.holders.get(token.toLowerCase())
  }

  /** Same object until this pair's or token's metrics change, for cheap per-card subscriptions. */
  metricsFor(pair: string | null, token: string | null): MetricsView {
    if (!pair && !token) return EMPTY_VIEW
    const key = `${pair ?? ""}|${token ?? ""}`
    const pv = pair ? (this.pairVersion.get(pair) ?? 0) : 0
    const hv = token ? (this.holderVersion.get(token) ?? 0) : 0
    const cached = this.views.get(key)
    if (cached && cached.pv === pv && cached.hv === hv) return cached.view
    const state = pair ? this.pairs.get(pair) : undefined
    const total = state ? txTotal(state.tx) : null
    const totalTx: MetricSlot<number> = state
      ? total != null
        ? { metric: { value: total, source: state.tx.baseline?.source ?? "chain", observedAt: state.tx.baseline?.observedAt ?? 0, block: state.tx.baseline?.block ?? null }, status: "ready", error: null }
        : { metric: null, status: state.txStatus === "ready" ? "loading" : state.txStatus, error: state.txError }
      : LOADING
    const pooledWeth = state?.pooled ?? LOADING
    const holders = (token ? this.holders.get(token) : undefined) ?? LOADING
    const view: MetricsView = {
      totalTx,
      pooledWeth,
      holders,
      enrichment: { coreReady: true, marketReady: settled(totalTx) && settled(pooledWeth), holdersReady: settled(holders) },
    }
    this.views.set(key, { pv, hv, view })
    if (this.views.size > MAX_ACTIVITY * 4) this.views.delete(this.views.keys().next().value as string)
    return view
  }

  /** Cards and DEXTools baselines from the published snapshot. Live cards with the same id are updated, not repeated. */
  ingestSnapshot(snapshot: SnapshotFile) {
    const observedAt = Date.parse(snapshot.generatedAt)
    const byPair = new Map<string, PairRecord>()
    for (const row of snapshot.rows) byPair.set(row.address.toLowerCase(), row)
    const newest = [...snapshot.rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, SNAPSHOT_PAIRS)
    const burns = eventsOf(snapshot)
      .slice()
      .sort((a, b) => (b.burnAt ?? b.detectedAt).localeCompare(a.burnAt ?? a.detectedAt))
      .slice(0, SNAPSHOT_BURNS)
    const touched = new Set<string>()
    for (const row of newest) {
      this.upsert(pairActivity(row, false))
      touched.add(row.address.toLowerCase())
    }
    for (const event of burns) {
      const row = byPair.get(event.pair)
      const input = burnActivity(event, false)
      if (row && (!input.symbol || !input.name)) {
        const identity = identityOf(row)
        input.symbol ||= identity.symbol
        input.name ||= identity.name
      }
      this.upsert(input)
      touched.add(event.pair)
      if (!row) this.ensurePair({ pair: event.pair, token: event.tokenAddress, exchange: event.exchange, createdAt: event.createdAt, creationBlock: null })
    }
    for (const signal of snapshot.signals ?? []) this.upsert(signalActivity(signal))
    // Live cards whose identity was unknown pick it up from the snapshot.
    for (const item of this.items.values()) {
      if (item.pairAddress && (!item.symbol || !item.name)) {
        const row = byPair.get(item.pairAddress)
        if (row) {
          const identity = identityOf(row)
          if (identity.symbol) this.upsert({ ...item, name: item.name || identity.name, symbol: item.symbol || identity.symbol })
          touched.add(item.pairAddress)
        }
      }
    }
    for (const pair of touched) {
      const row = byPair.get(pair)
      if (!row) continue
      this.ensurePair(pairInfoOf(row))
      this.applyRowBaseline(row, observedAt)
    }
  }

  private applyRowBaseline(row: PairRecord, observedAt: number) {
    if (!Number.isFinite(observedAt)) return
    const pair = row.address.toLowerCase()
    const tx = dextoolsCount(row, row.totalTx)
    if (tx != null) this.setTxBaseline(pair, { count: tx, observedAt, block: null, source: "dextools" })
    const pooled = pooledFromRow(row)
    if (pooled != null) this.setPooledWeth(pair, { value: pooled, source: "dextools", observedAt, block: null })
    const holders = dextoolsCount(row, row.holders)
    if (holders) this.setHolders(row.tokenAddress, { value: holders, source: "dextools", observedAt, block: null })
  }
}

export function filterActivity(list: readonly ActivityItem[], filter: ActivityFilter): ActivityItem[] {
  const entry = ACTIVITY_FILTERS.find((item) => item.id === filter)
  if (!entry || !entry.types) return list as ActivityItem[]
  const types = entry.types as readonly ActivityType[]
  return list.filter((item) => types.includes(item.type))
}
