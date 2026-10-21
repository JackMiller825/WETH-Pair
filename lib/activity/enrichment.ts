import { BlockscoutHolderProvider, EthplorerHolderProvider, holderRefreshMs, type TokenHolderProvider } from "@/lib/activity/holders"
import { GET_RESERVES, POOL_MANAGER, POOL_TOPICS, balanceOfCall, classifyPoolLog, decodeReserves, decodeUint, pooledWethFromReserves, toWeth, type PoolEvent } from "@/lib/activity/pool"
import type { ActivityStore } from "@/lib/activity/store"
import { WETH } from "@/lib/history/plan"
import { noteReserves } from "@/lib/pump/tape"
import { defaultFetch, type FetchLike } from "@/lib/market/types"

/** Not publicnode: that endpoint carries the LP burn socket, and enrichment must never compete with it. */
export const ENRICH_WS = ["wss://eth.drpc.org"] as const
export const ENRICH_RPCS = ["https://rpc.mevblocker.io", "https://eth.drpc.org"] as const
export const TRACKED_PAIRS = 40
/** Swaps are counted from the creation block on chain when the pair is younger than this many blocks (~6h). */
export const BACKFILL_MAX_BLOCKS = 1800
const CONCURRENCY = 3

type Task = { key: string; priority: number; run: () => Promise<void> }

export type EnrichmentSocket = "connecting" | "open" | "closed"

function hex(value: number): string {
  return `0x${value.toString(16)}`
}

function decodeAbiString(data: unknown): string {
  if (typeof data !== "string" || data.length < 66) return ""
  const body = data.slice(2)
  try {
    if (body.length >= 128) {
      const offset = Number.parseInt(body.slice(0, 64), 16) * 2
      const length = Number.parseInt(body.slice(offset, offset + 64), 16)
      if (Number.isFinite(length) && length > 0 && length <= 128) {
        const bytes = body.slice(offset + 64, offset + 64 + length * 2)
        return new TextDecoder().decode(Uint8Array.from(bytes.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))).replace(/\0/g, "").trim()
      }
    }
    const raw = body.slice(0, 64).replace(/(00)+$/, "")
    return new TextDecoder().decode(Uint8Array.from(raw.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))).replace(/\0/g, "").trim()
  } catch {
    return ""
  }
}

/**
 * Fills Total Tx, Pooled WETH, Holders, and missing token identity for the pairs shown in Live Activity.
 * Everything here is P2/P3 work: a separate socket, separate RPC endpoints, and a small task queue that
 * yields between tasks. Nothing in this file is called from the LP burn path.
 */
export class EnrichmentEngine {
  private ws: WebSocket | null = null
  private wsIndex = 0
  private reconnect: ReturnType<typeof setTimeout> | null = null
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  private holderTimer: ReturnType<typeof setInterval> | null = null
  private subscriptions: string[] = []
  private pendingSubs = new Set<number>()
  private requestId = 10
  private tracked = new Set<string>()
  private initialized = new Set<string>()
  private holderDue = new Map<string, number>()
  private rank = new Map<string, number>()
  private v3Refresh = new Map<string, { block: number; timer: ReturnType<typeof setTimeout> }>()
  private queue: Task[] = []
  private queued = new Set<string>()
  private running = 0
  private head: number | null = null
  private stopped = true
  private unsubscribe: (() => void) | null = null
  socket: EnrichmentSocket = "closed"

  constructor(
    private store: ActivityStore,
    private options: { fetcher?: FetchLike; now?: () => number; holders?: TokenHolderProvider[]; WebSocketImpl?: typeof WebSocket } = {},
  ) {}

  private get now() {
    return this.options.now ?? Date.now
  }

  private get fetcher() {
    return this.options.fetcher ?? defaultFetch
  }

  private holderProviders = (): TokenHolderProvider[] => this.options.holders ?? (this.defaultHolders ??= [new BlockscoutHolderProvider(this.fetcher, this.now), new EthplorerHolderProvider(this.fetcher, this.now)])
  private defaultHolders: TokenHolderProvider[] | null = null

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.unsubscribe = this.store.subscribe(() => this.scheduleSync())
    this.holderTimer = setInterval(() => this.queueDueHolders(), 2000)
    this.connect()
    this.scheduleSync()
  }

  stop() {
    this.stopped = true
    this.unsubscribe?.()
    if (this.reconnect) clearTimeout(this.reconnect)
    if (this.syncTimer) clearTimeout(this.syncTimer)
    if (this.holderTimer) clearInterval(this.holderTimer)
    for (const entry of this.v3Refresh.values()) clearTimeout(entry.timer)
    this.reconnect = this.syncTimer = this.holderTimer = null
    this.v3Refresh.clear()
    this.initialized.clear()
    this.tracked.clear()
    this.holderDue.clear()
    this.queue = []
    this.queued.clear()
    this.ws?.close()
    this.ws = null
  }

  onHead(block: number | null) {
    if (block != null && (this.head == null || block > this.head)) this.head = block
  }

  private scheduleSync() {
    if (this.stopped || this.syncTimer) return
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      this.sync()
    }, 1500)
  }

  private sync() {
    const pairs = this.store.trackedPairs(TRACKED_PAIRS)
    const next = new Set(pairs.map((state) => state.info.pair))
    const changed = next.size !== this.tracked.size || [...next].some((pair) => !this.tracked.has(pair))
    this.tracked = next
    pairs.forEach((state, index) => {
      const pair = state.info.pair
      if (this.initialized.has(pair)) return
      this.initialized.add(pair)
      if (state.kind === "v2" || state.kind === "v3") this.enqueue(`pool:${pair}`, index + 0.2, () => this.readPooled(pair))
      else this.store.markUnavailable("pooledWeth", pair, state.kind === "v4" ? "Uniswap V4 pools share one contract. Pooled WETH comes from DEXTools, which has no value for this pool yet." : "This exchange has no reserve read here, and DEXTools has no value yet.")
      this.enqueue(`swaps:${pair}`, index + 0.3, () => this.backfillSwaps(pair))
      const item = this.store.getList().find((entry) => entry.pairAddress === pair)
      if (item && !item.symbol) this.enqueue(`identity:${state.info.token}`, index + 0.1, () => this.readIdentity(state.info.token))
      if (!this.holderDue.has(state.info.token)) this.holderDue.set(state.info.token, 0)
    })
    for (const pair of [...this.initialized]) if (!next.has(pair)) this.initialized.delete(pair)
    this.rank = new Map(pairs.map((state, index) => [state.info.token, index]))
    const tokens = new Set(this.rank.keys())
    for (const token of [...this.holderDue.keys()]) if (!tokens.has(token)) this.holderDue.delete(token)
    if (changed) this.resubscribe()
  }

  private enqueue(key: string, priority: number, run: () => Promise<void>) {
    if (this.queued.has(key)) return
    this.queued.add(key)
    this.queue.push({ key, priority, run })
    this.queue.sort((a, b) => a.priority - b.priority)
    this.pump()
  }

  private pump() {
    while (!this.stopped && this.running < CONCURRENCY && this.queue.length > 0) {
      const task = this.queue.shift() as Task
      this.running += 1
      void task
        .run()
        .catch(() => undefined)
        .finally(() => {
          this.running -= 1
          this.queued.delete(task.key)
          setTimeout(() => this.pump(), 0)
        })
    }
  }

  private async rpc(method: string, params: unknown[], urls: readonly string[] = ENRICH_RPCS): Promise<unknown> {
    let last: unknown = new Error("RPC failed")
    for (const url of urls) {
      try {
        const response = await this.fetcher(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = (await response.json()) as { result?: unknown; error?: { message?: string } }
        if (payload.error) throw new Error(payload.error.message || "RPC error")
        return payload.result
      } catch (error) {
        last = error
      }
    }
    throw last
  }

  private async headBlock(): Promise<number> {
    if (this.head != null) return this.head
    const value = await this.rpc("eth_blockNumber", [])
    const parsed = typeof value === "string" ? Number.parseInt(value, 16) : NaN
    if (!Number.isFinite(parsed)) throw new Error("No block number")
    this.head = parsed
    return parsed
  }

  private async readPooled(pair: string, atBlock?: number) {
    const state = this.store.pairState(pair)
    if (!state) return
    const startedAt = this.now()
    try {
      const block = atBlock ?? (await this.headBlock())
      if (state.kind === "v2") {
        const data = await this.rpc("eth_call", [{ to: pair, data: GET_RESERVES }, hex(block)])
        const { reserve0, reserve1 } = decodeReserves(String(data))
        this.store.setPooledWeth(pair, { value: pooledWethFromReserves(reserve0, reserve1, state.wethFirst), source: "chain", observedAt: startedAt, block })
      } else if (state.kind === "v3") {
        const data = await this.rpc("eth_call", [{ to: WETH, data: balanceOfCall(pair) }, hex(block)])
        this.store.setPooledWeth(pair, { value: toWeth(decodeUint(String(data))), source: "chain", observedAt: startedAt, block })
      }
    } catch (error) {
      this.store.markUnavailable("pooledWeth", pair, `Reserve read failed: ${error instanceof Error ? error.message : "RPC error"}`)
    }
  }

  private async backfillSwaps(pair: string) {
    const state = this.store.pairState(pair)
    if (!state) return
    const created = state.info.creationBlock
    try {
      const head = await this.headBlock()
      if (created == null || head - created > BACKFILL_MAX_BLOCKS || created > head) {
        this.store.markUnavailable("totalTx", pair, "DEXTools has no trade count for this pair yet, and it is too old to count from its creation block.")
        return
      }
      const filter =
        state.kind === "v4"
          ? { address: POOL_MANAGER, topics: [POOL_TOPICS.v4Swap, pair], fromBlock: hex(created), toBlock: hex(head) }
          : { address: pair, topics: [[POOL_TOPICS.v2Swap, POOL_TOPICS.v3Swap]], fromBlock: hex(created), toBlock: hex(head) }
      const observedAt = this.now()
      const logs = await this.rpc("eth_getLogs", [filter], [ENRICH_RPCS[0]])
      if (!Array.isArray(logs)) throw new Error("No log list")
      this.store.setTxBaseline(pair, { count: 0, observedAt, block: created - 1, source: "chain" })
      for (const log of logs) {
        const event = classifyPoolLog(log)
        if (event?.kind === "swap") this.store.addSwap(pair, event.id, event.block, observedAt)
      }
    } catch (error) {
      this.store.markUnavailable("totalTx", pair, `Swap count failed: ${error instanceof Error ? error.message : "RPC error"}`)
    }
  }

  private async readIdentity(token: string) {
    const [symbol, name] = await Promise.all([
      this.rpc("eth_call", [{ to: token, data: "0x95d89b41" }, "latest"]).catch(() => null),
      this.rpc("eth_call", [{ to: token, data: "0x06fdde03" }, "latest"]).catch(() => null),
    ])
    const ticker = decodeAbiString(symbol).slice(0, 24)
    const full = decodeAbiString(name).slice(0, 48)
    if (ticker || full) this.store.setIdentity(token, full || ticker, ticker || full)
  }

  private queueDueHolders() {
    const now = this.now()
    for (const [token, due] of this.holderDue) {
      if (due > now) continue
      this.holderDue.set(token, Number.POSITIVE_INFINITY)
      const rank = this.rank.get(token) ?? TRACKED_PAIRS
      this.enqueue(`holders:${token}`, this.store.holderSlot(token)?.metric ? TRACKED_PAIRS + rank : rank + 0.4, () => this.readHolders(token))
    }
  }

  private async readHolders(token: string) {
    const startedAt = this.now()
    const errors: string[] = []
    for (const provider of this.holderProviders()) {
      try {
        const value = await provider.getHolderCount(token)
        this.store.setHolders(token, { value, source: provider.id, observedAt: startedAt, block: null })
        errors.length = 0
        break
      } catch (error) {
        errors.push(`${provider.label}: ${error instanceof Error ? error.message : "failed"}`)
      }
    }
    if (errors.length) this.store.markUnavailable("holders", token, `Holder provider temporarily unavailable (${errors.join("; ")}).`)
    const item = this.store.getList().find((entry) => entry.tokenAddress === token)
    const pairState = item?.pairAddress ? this.store.pairState(item.pairAddress) : undefined
    const created = item?.pairCreatedAt ? Date.parse(item.pairCreatedAt) : NaN
    const wait = holderRefreshMs(Number.isFinite(created) ? this.now() - created : null, pairState?.lastSwapAt != null ? this.now() - pairState.lastSwapAt : null)
    if (this.holderDue.has(token)) this.holderDue.set(token, this.now() + (errors.length ? Math.max(wait, 60_000) : wait))
  }

  private connect() {
    if (this.stopped) return
    const Impl = this.options.WebSocketImpl ?? (typeof WebSocket === "undefined" ? null : WebSocket)
    if (!Impl) return
    const url = ENRICH_WS[this.wsIndex % ENRICH_WS.length]
    this.socket = "connecting"
    let ws: WebSocket
    try {
      ws = new Impl(url)
    } catch {
      this.retry()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.socket = "open"
      this.subscriptions = []
      this.resubscribe()
    }
    ws.onmessage = (message) => this.onMessage(message.data)
    ws.onerror = () => undefined
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.socket = "closed"
      this.retry()
    }
  }

  private retry() {
    if (this.stopped || this.reconnect) return
    this.wsIndex += 1
    this.reconnect = setTimeout(() => {
      this.reconnect = null
      this.connect()
    }, 3000)
  }

  private send(method: string, params: unknown[], track = false) {
    if (!this.ws || this.ws.readyState !== 1) return
    const id = ++this.requestId
    if (track) this.pendingSubs.add(id)
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
  }

  private resubscribe() {
    if (!this.ws || this.ws.readyState !== 1) return
    for (const id of this.subscriptions) this.send("eth_unsubscribe", [id])
    this.subscriptions = []
    this.pendingSubs.clear()
    const states = [...this.tracked].map((pair) => this.store.pairState(pair)).filter((state) => state != null)
    const direct = states.filter((state) => state.kind === "v2" || state.kind === "v3").map((state) => state.info.pair)
    const v4 = states.filter((state) => state.kind === "v4").map((state) => state.info.pair)
    if (direct.length) {
      this.send("eth_subscribe", ["logs", { address: direct, topics: [[POOL_TOPICS.v2Swap, POOL_TOPICS.v2Sync, POOL_TOPICS.v3Swap, POOL_TOPICS.v3Mint, POOL_TOPICS.v3Burn]] }], true)
    }
    if (v4.length) this.send("eth_subscribe", ["logs", { address: POOL_MANAGER, topics: [POOL_TOPICS.v4Swap, v4] }], true)
  }

  private onMessage(data: unknown) {
    let message: { id?: number; result?: unknown; params?: { result?: unknown } }
    try {
      message = JSON.parse(String(data))
    } catch {
      return
    }
    if (typeof message.id === "number" && this.pendingSubs.has(message.id)) {
      this.pendingSubs.delete(message.id)
      if (typeof message.result === "string") this.subscriptions.push(message.result)
      return
    }
    const event = classifyPoolLog(message.params?.result as never)
    if (event) this.apply(event)
  }

  /** Applies one pool event. Exposed for tests. */
  apply(event: PoolEvent) {
    const state = this.store.pairState(event.pair)
    if (!state) return
    this.onHead(event.block)
    if (event.kind === "swap") {
      this.store.addSwap(event.pair, event.id, event.block)
      if (state.kind === "v3") this.refreshV3(event.pair, event.block)
      return
    }
    if (event.kind === "sync" && state.kind === "v2") {
      this.store.setPooledWeth(event.pair, { value: pooledWethFromReserves(event.reserve0, event.reserve1, state.wethFirst), source: "chain", observedAt: this.now(), block: event.block })
      noteReserves({ pair: event.pair, token: state.info.token, wethFirst: state.wethFirst, reserve0: event.reserve0, reserve1: event.reserve1, block: event.block, at: this.now() })
      return
    }
    if (event.kind === "liquidity" && state.kind === "v3") this.refreshV3(event.pair, event.block)
  }

  private refreshV3(pair: string, block: number) {
    const current = this.v3Refresh.get(pair)
    if (current) {
      current.block = Math.max(current.block, block)
      return
    }
    const entry = {
      block,
      timer: setTimeout(() => {
        this.v3Refresh.delete(pair)
        this.enqueue(`v3:${pair}:${entry.block}`, -1, () => this.readPooled(pair, entry.block))
      }, 1500),
    }
    this.v3Refresh.set(pair, entry)
  }
}
