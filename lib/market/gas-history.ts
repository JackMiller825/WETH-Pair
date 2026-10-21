import { GAS_PERCENTILES, GAS_RPCS, type FeeHistory } from "@/lib/market/gas"
import { defaultFetch, type FetchLike } from "@/lib/market/types"

const BLOCK_MS = 12_000
const CHUNK = 1024
const GWEI = 1e9

export const GAS_RANGES = [
  { id: "15m", label: "15m", blocks: 75 },
  { id: "1h", label: "1h", blocks: 300 },
  { id: "6h", label: "6h", blocks: 1800 },
  { id: "24h", label: "24h", blocks: 7200 },
] as const

export type GasRangeId = (typeof GAS_RANGES)[number]["id"]

export type GasPoint = { at: number; block: number; base: number; standard: number; fast: number; rapid: number }

export function gasRangeById(id: string): (typeof GAS_RANGES)[number] {
  return GAS_RANGES.find((item) => item.id === id) ?? GAS_RANGES[1]
}

function gwei(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null
  const parsed = Number(BigInt(value)) / GWEI
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** One point per block in a fee-history response. Time is estimated from a known block. */
export function pointsFromFeeHistory(history: FeeHistory, ref: { block: number; timeMs: number }): GasPoint[] {
  if (!Array.isArray(history.baseFeePerGas) || !Array.isArray(history.reward)) return []
  const oldest = Number.parseInt(history.oldestBlock, 16)
  if (!Number.isFinite(oldest)) return []
  const out: GasPoint[] = []
  history.reward.forEach((row, index) => {
    const base = gwei(history.baseFeePerGas[index])
    if (base == null || !Array.isArray(row)) return
    const tips = row.slice(0, 3).map(gwei)
    const standardTip = tips[0] ?? 0
    const fastTip = Math.max(standardTip, tips[1] ?? standardTip)
    const rapidTip = Math.max(fastTip, tips[2] ?? fastTip)
    const block = oldest + index
    out.push({
      at: ref.timeMs - (ref.block - block) * BLOCK_MS,
      block,
      base,
      standard: base + standardTip,
      fast: base + fastTip,
      rapid: base + rapidTip,
    })
  })
  return out
}

/** Average groups so a 24 hour line stays readable. The first and last points are kept. */
export function downsampleGas(points: readonly GasPoint[], max: number): GasPoint[] {
  if (points.length <= max || max < 2) return [...points]
  const out: GasPoint[] = []
  const step = (points.length - 1) / (max - 1)
  for (let index = 0; index < max; index += 1) {
    const start = Math.round(index * step)
    const end = Math.min(points.length, Math.round((index + 1) * step))
    const group = points.slice(start, Math.max(end, start + 1))
    const mean = (pick: (point: GasPoint) => number) => group.reduce((sum, point) => sum + pick(point), 0) / group.length
    const mid = group[Math.floor(group.length / 2)]
    out.push({ at: mid.at, block: mid.block, base: mean((point) => point.base), standard: mean((point) => point.standard), fast: mean((point) => point.fast), rapid: mean((point) => point.rapid) })
  }
  return out
}

async function feeHistory(fetcher: FetchLike, url: string, blocks: number, newest: number | "latest"): Promise<FeeHistory> {
  const count = `0x${Math.min(CHUNK, Math.max(1, blocks)).toString(16)}`
  const target = newest === "latest" ? "latest" : `0x${newest.toString(16)}`
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_feeHistory", params: [count, target, GAS_PERCENTILES] }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = (await response.json()) as { result?: FeeHistory; error?: { message?: string } }
  if (payload.error || !payload.result) throw new Error(payload.error?.message || "Fee history failed")
  return payload.result
}

/** Standard, fast, and rapid across the range, from Ethereum fee history. Walks backward in chunks. */
export async function loadGasSeries(id: string, fetcher: FetchLike = defaultFetch, now = Date.now()): Promise<GasPoint[]> {
  const range = gasRangeById(id)
  let error: unknown = null
  for (const url of GAS_RPCS.slice(0, 2)) {
    try {
      const head = await feeHistory(fetcher, url, Math.min(CHUNK, range.blocks), "latest")
      const newest = Number.parseInt(head.oldestBlock, 16) + head.reward!.length - 1
      let points = pointsFromFeeHistory(head, { block: newest, timeMs: now })
      let remaining = range.blocks - (head.reward?.length ?? 0)
      let cursor = Number.parseInt(head.oldestBlock, 16) - 1
      while (remaining > 0 && cursor > 0) {
        const page = await feeHistory(fetcher, url, Math.min(CHUNK, remaining), cursor)
        points = pointsFromFeeHistory(page, { block: newest, timeMs: now }).concat(points)
        remaining -= page.reward?.length ?? 0
        const oldest = Number.parseInt(page.oldestBlock, 16)
        if (!Number.isFinite(oldest) || oldest >= cursor) break
        cursor = oldest - 1
      }
      return downsampleGas(points.sort((a, b) => a.at - b.at), 240)
    } catch (caught) {
      error = caught
    }
  }
  throw error instanceof Error ? error : new Error("Gas history failed")
}
