import { poolKind, wethIsToken0 } from "@/lib/activity/pool"
import type { FetchLike } from "@/lib/market/types"
import { blockForTime, priceWethFromReserves, type PricePoint } from "@/lib/pump/price"
import type { PairRecord } from "@/lib/types"

const RPCS = ["https://rpc.mevblocker.io", "https://eth.drpc.org"] as const

export type PumpSeed = {
  generatedAt: string
  chainId: 1
  headBlock: number | null
  ethUsd: number | null
  points: PricePoint[]
  decimals: Record<string, number>
}

async function rpc(fetcher: FetchLike, method: string, params: unknown[]): Promise<unknown> {
  let last: unknown = new Error("RPC failed")
  for (const url of RPCS) {
    try {
      const response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
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

function addressOf(word: string): string | null {
  const hex = word.startsWith("0x") ? word.slice(2) : word
  if (hex.length < 40) return null
  return `0x${hex.slice(-40).toLowerCase()}`
}

/** One historical reserve read. The timestamp is the block's own timestamp, so the point is a real observation. */
export async function sampleReserves(fetcher: FetchLike, pair: string, token: string, block: number, wethFirst: boolean, decimals: number, ethUsd: number, at: number): Promise<PricePoint | null> {
  if (!(ethUsd > 0)) return null
  let data: unknown
  try {
    data = await rpc(fetcher, "eth_call", [{ to: pair, data: "0x0902f1ac" }, `0x${block.toString(16)}`])
  } catch {
    return null
  }
  if (typeof data !== "string" || data.length < 130) return null
  const priced = priceWethFromReserves(BigInt(data.slice(0, 66)), BigInt(`0x${data.slice(66, 130)}`), wethFirst, decimals)
  if (!priced) return null
  return {
    pair: pair.toLowerCase(),
    token: token.toLowerCase(),
    block,
    at,
    priceWeth: priced.priceWeth,
    priceUsd: priced.priceWeth * ethUsd,
    reserveWeth: priced.reserveWeth,
    liquidityUsd: priced.reserveWeth * ethUsd * 2,
    source: "chain",
  }
}

export async function readDecimals(fetcher: FetchLike, token: string): Promise<number | null> {
  try {
    const data = await rpc(fetcher, "eth_call", [{ to: token, data: "0x313ce567" }, "latest"])
    if (typeof data !== "string") return null
    const decimals = Number(BigInt(data))
    return Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : null
  } catch {
    return null
  }
}

export async function readWethFirst(fetcher: FetchLike, pair: string, token: string): Promise<boolean | null> {
  try {
    const data = await rpc(fetcher, "eth_call", [{ to: pair, data: "0x0dfe1681" }, "latest"])
    const token0 = typeof data === "string" ? addressOf(data) : null
    if (token0 === "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2") return true
    if (token0 === token.toLowerCase()) return false
    return null
  } catch {
    return null
  }
}

export async function readHead(fetcher: FetchLike): Promise<{ block: number; timeMs: number } | null> {
  try {
    const hex = await rpc(fetcher, "eth_blockNumber", [])
    if (typeof hex !== "string") return null
    const block = Number.parseInt(hex, 16)
    const body = await rpc(fetcher, "eth_getBlockByNumber", [hex, false])
    const stamp = Number.parseInt(String((body as { timestamp?: string } | null)?.timestamp ?? ""), 16)
    if (!Number.isFinite(block) || !Number.isFinite(stamp)) return null
    return { block, timeMs: stamp * 1000 }
  } catch {
    return null
  }
}

const BUCKETS_MS = [15, 30, 60, 180, 360, 720, 1440, 4320, 10080].map((minutes) => minutes * 60 * 1000)
const SEED_PAIRS = 24
/** Sample slightly before the window start so the block timestamp is eligible as that window's baseline. */
const LEAD_MS = 90_000

export type SampleSlot = { target: number; block: number; at: number }

/** Blocks whose own timestamps fall at or before each bucket. Shared by every pair. */
export async function planSlots(fetcher: FetchLike, head: { block: number; timeMs: number }, now: number): Promise<SampleSlot[]> {
  const slots: SampleSlot[] = [{ target: now, block: head.block, at: head.timeMs }]
  for (const span of BUCKETS_MS) {
    const target = now - span
    const block = blockForTime(head.block, head.timeMs, target - LEAD_MS)
    try {
      const body = await rpc(fetcher, "eth_getBlockByNumber", [`0x${block.toString(16)}`, false])
      const stamp = Number.parseInt(String((body as { timestamp?: string } | null)?.timestamp ?? ""), 16)
      if (!Number.isFinite(stamp)) continue
      const at = stamp * 1000
      if (at <= target) slots.push({ target, block, at })
    } catch {
      // This bucket stays missing. Coverage stays partial rather than borrowing a nearer price.
    }
  }
  return slots
}

/**
 * Bounded historical reserve read for the publish job. It stops when the time budget runs out.
 * A failed read is skipped. It never invents a price, and it never blocks pair or burn collection:
 * the snapshot script calls this after those files are already written.
 */
export async function buildPumpSeed(options: { rows: PairRecord[]; fetcher: FetchLike; ethUsd: number; now?: number; budgetMs?: number }): Promise<PumpSeed> {
  const now = options.now ?? Date.now()
  const deadline = Date.now() + (options.budgetMs ?? 20_000)
  const empty: PumpSeed = { generatedAt: new Date(now).toISOString(), chainId: 1, headBlock: null, ethUsd: options.ethUsd, points: [], decimals: {} }
  if (!(options.ethUsd > 0)) return empty
  const head = await readHead(options.fetcher)
  if (!head) return empty
  const slots = await planSlots(options.fetcher, head, now)
  const pairs = options.rows
    .filter((row) => poolKind(row.exchange, row.address) === "v2")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, SEED_PAIRS)
  const points: PricePoint[] = []
  const decimals: Record<string, number> = {}
  for (const row of pairs) {
    if (Date.now() > deadline) break
    const token = row.tokenAddress.toLowerCase()
    const places = await readDecimals(options.fetcher, token)
    if (places == null) continue
    decimals[token] = places
    const created = Date.parse(row.created_at)
    const side = (await readWethFirst(options.fetcher, row.address, token)) ?? wethIsToken0(token)
    for (const slot of slots) {
      if (Date.now() > deadline) break
      if (Number.isFinite(created) && created > slot.at) continue
      const point = await sampleReserves(options.fetcher, row.address, token, slot.block, side, places, options.ethUsd, slot.at)
      if (point) points.push(point)
    }
  }
  return { generatedAt: new Date(now).toISOString(), chainId: 1, headBlock: head.block, ethUsd: options.ethUsd, points, decimals }
}

export { addressOf }
