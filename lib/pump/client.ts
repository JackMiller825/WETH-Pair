import { poolKind, wethIsToken0 } from "@/lib/activity/pool"
import { marketClient } from "@/lib/market/client"
import { defaultFetch } from "@/lib/market/types"
import { PriceBook } from "@/lib/pump/book"
import { priceWethFromReserves } from "@/lib/pump/price"
import { planSlots, readDecimals, readHead, readWethFirst, sampleReserves, type PumpSeed } from "@/lib/pump/sample"
import { onReserves, type ReserveNote } from "@/lib/pump/tape"
import type { PairRecord } from "@/lib/types"

const STORAGE_KEY = "weth-pump-book-v1"
const listeners = new Set<() => void>()

/**
 * The browser's copy of the price book. Sync events record reserves as they happen.
 * Historical buckets are filled one RPC call at a time, and only while Top Pumpers is open.
 */
class PumpHub {
  readonly book = new PriceBook()
  private decimals = new Map<string, number>()
  private requested = new Set<string>()
  private pending: ReserveNote[] = []
  private queue: { pair: string; token: string; wethFirst: boolean; decimals: number; block: number; at: number }[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private backfill: ReturnType<typeof setTimeout> | null = null
  private seeded = false

  subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  version = (): number => this.book.version

  private emit() {
    for (const listener of listeners) listener()
  }

  remember(token: string, decimals: number) {
    this.decimals.set(token.toLowerCase(), decimals)
  }

  start() {
    this.loadLocal()
    if (!this.seeded) {
      this.seeded = true
      void this.loadSeed()
    }
    onReserves((note) => {
      this.pending.push(note)
    })
    if (this.timer == null) this.timer = setInterval(() => this.flush(), 5000)
  }

  stop() {
    onReserves(null)
    if (this.timer != null) clearInterval(this.timer)
    this.timer = null
    this.stopBackfill()
  }

  /** Low-priority reserve reads for pairs that do not yet have a bucket. One call at a time. */
  startBackfill(rows: readonly PairRecord[]) {
    this.stopBackfill()
    const v2 = rows.filter((row) => poolKind(row.exchange, row.address) === "v2").slice(0, 40)
    const step = async () => {
      try {
        if (this.queue.length === 0) {
          const head = await readHead(defaultFetch)
          const eth = marketClient().getView().eth.data?.priceUsd
          if (head && eth && eth > 0) {
            const slots = await planSlots(defaultFetch, head, Date.now())
            for (const row of v2) {
              const token = row.tokenAddress.toLowerCase()
              const places = this.decimals.get(token) ?? (await readDecimals(defaultFetch, token))
              if (places == null) continue
              this.decimals.set(token, places)
              const side = (await readWethFirst(defaultFetch, row.address, token)) ?? wethIsToken0(token)
              const created = Date.parse(row.created_at)
              for (const slot of slots) {
                if (Number.isFinite(created) && created > slot.at) continue
                const have = this.book.points(row.address).some((point) => Math.abs(point.at - slot.at) < 10 * 60 * 1000)
                if (have) continue
                this.queue.push({ pair: row.address, token, wethFirst: side, decimals: places, block: slot.block, at: slot.at })
              }
            }
          }
          if (this.queue.length === 0) {
            this.backfill = setTimeout(() => void step(), 30_000)
            return
          }
        }
        const job = this.queue.shift()
        const eth = marketClient().getView().eth.data?.priceUsd
        if (job && eth && eth > 0) {
          const point = await sampleReserves(defaultFetch, job.pair, job.token, job.block, job.wethFirst, job.decimals, eth, job.at)
          if (point) {
            this.book.insert(point)
            this.persist()
            this.emit()
          }
        }
      } catch {
        // One failed read waits for the next tick. Coverage stays partial.
      }
      this.backfill = setTimeout(() => void step(), 400)
    }
    this.backfill = setTimeout(() => void step(), 400)
  }

  stopBackfill() {
    if (this.backfill != null) clearTimeout(this.backfill)
    this.backfill = null
    this.queue = []
  }

  private async loadSeed() {
    try {
      const response = await fetch("/data/pumpers.json", { cache: "no-store" })
      if (!response.ok) return
      const seed = (await response.json()) as PumpSeed
      for (const [token, places] of Object.entries(seed.decimals ?? {})) this.decimals.set(token.toLowerCase(), places)
      this.book.load(seed.points ?? [])
      this.emit()
    } catch {
      // The published seed is optional. Live reserves still record from here.
    }
  }

  private loadLocal() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as PricePointList
      if (Array.isArray(parsed)) this.book.load(parsed)
    } catch {
      // A broken cache is ignored. The next flush replaces it.
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.book.dump()))
    } catch {
      // Quota is not worth dropping a price update.
    }
  }

  private flush() {
    const eth = marketClient().getView().eth.data?.priceUsd
    if (!(eth && eth > 0)) return
    const still: ReserveNote[] = []
    for (const note of this.pending) {
      const places = this.decimals.get(note.token.toLowerCase())
      if (places == null) {
        still.push(note)
        const token = note.token.toLowerCase()
        if (!this.requested.has(token)) {
          this.requested.add(token)
          void readDecimals(defaultFetch, token).then((value) => {
            if (value != null) this.decimals.set(token, value)
          })
        }
        continue
      }
      const priced = priceWethFromReserves(note.reserve0, note.reserve1, note.wethFirst, places)
      if (!priced) continue
      this.book.insert({
        pair: note.pair,
        token: note.token,
        block: note.block,
        at: note.at,
        priceWeth: priced.priceWeth,
        priceUsd: priced.priceWeth * eth,
        reserveWeth: priced.reserveWeth,
        liquidityUsd: priced.reserveWeth * eth * 2,
        source: "chain",
      })
    }
    this.pending = still.slice(-100)
    if (this.book.version > 0) this.persist()
    this.emit()
  }
}

type PricePointList = Parameters<PriceBook["load"]>[0]

let hub: PumpHub | null = null

export function pumpHub(): PumpHub {
  hub ??= new PumpHub()
  return hub
}

let watches = 0

/** Records reserves while the app is open. Cheap when no Sync arrives: one interval and no RPC. */
export function watchPumpTape(): () => void {
  watches += 1
  if (watches === 1) pumpHub().start()
  return () => {
    watches -= 1
    if (watches === 0) pumpHub().stop()
  }
}
