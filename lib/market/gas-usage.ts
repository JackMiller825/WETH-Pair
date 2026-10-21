import { GAS_RPCS } from "@/lib/market/gas"
import { defaultFetch, type FetchLike } from "@/lib/market/types"

const BLOCK_MS = 12_000
const THREE_H = 3 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

export type ReceiptLike = {
  from?: string
  to?: string | null
  contractAddress?: string | null
  gasUsed?: string
  effectiveGasPrice?: string
}

export type UsageTotals = { fee3: bigint; gas3: bigint; fee24: bigint; gas24: bigint }

export type UsageRank = {
  rank: number
  address: string
  fee3: bigint
  gas3: bigint
  fee24: bigint
  gas24: bigint
  share3: number
  share24: number
}

export function weiToEth(wei: bigint): number {
  const scale = BigInt(10) ** BigInt(18)
  return Number(wei / scale) + Number(wei % scale) / 1e18
}

function hexBig(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

/** Newest blocks first. Denser inside 3 hours, then a wider step out to 24 hours. */
export function usageBlocks(head: number): number[] {
  const seen = new Set<number>()
  const push = (spanMs: number, step: number) => {
    const count = Math.floor(spanMs / BLOCK_MS)
    for (let ago = 0; ago <= count; ago += step) {
      const block = head - ago
      if (block >= 0) seen.add(block)
    }
  }
  push(THREE_H, 20)
  push(DAY, 100)
  return [...seen].sort((a, b) => b - a)
}

export function emptyTotals(): UsageTotals {
  return { fee3: BigInt(0), gas3: BigInt(0), fee24: BigInt(0), gas24: BigInt(0) }
}

function add(map: Map<string, UsageTotals>, address: string | null | undefined, gas: bigint, fee: bigint, in3h: boolean) {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return
  const key = address.toLowerCase()
  const row = map.get(key) ?? emptyTotals()
  row.fee24 += fee
  row.gas24 += gas
  if (in3h) {
    row.fee3 += fee
    row.gas3 += gas
  }
  map.set(key, row)
}

/** Guzzlers are the contracts that used the gas. Spenders are the accounts that paid it. */
export function absorbReceipt(guzzlers: Map<string, UsageTotals>, spenders: Map<string, UsageTotals>, receipt: ReceiptLike, in3h: boolean) {
  const gas = hexBig(receipt.gasUsed)
  const price = hexBig(receipt.effectiveGasPrice)
  if (gas == null || price == null || gas <= BigInt(0)) return
  const fee = gas * price
  const contract = receipt.to ?? receipt.contractAddress
  add(guzzlers, contract, gas, fee, in3h)
  add(spenders, receipt.from, gas, fee, in3h)
}

export function rankUsage(map: Map<string, UsageTotals>, kind: "gas" | "fee", limit = 50): UsageRank[] {
  const rows = [...map.entries()].map(([address, totals]) => ({ address, ...totals }))
  const total3 = rows.reduce((sum, row) => sum + (kind === "gas" ? row.gas3 : row.fee3), BigInt(0))
  const total24 = rows.reduce((sum, row) => sum + (kind === "gas" ? row.gas24 : row.fee24), BigInt(0))
  const share = (part: bigint, total: bigint) => (total > BigInt(0) ? (Number(part) / Number(total)) * 100 : 0)
  const metric = (row: UsageTotals & { address: string }, window: "3" | "24") => (kind === "gas" ? (window === "3" ? row.gas3 : row.gas24) : window === "3" ? row.fee3 : row.fee24)
  return rows
    .sort((a, b) => (metric(b, "24") > metric(a, "24") ? 1 : metric(b, "24") < metric(a, "24") ? -1 : metric(b, "3") > metric(a, "3") ? 1 : -1))
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      address: row.address,
      fee3: row.fee3,
      gas3: row.gas3,
      fee24: row.fee24,
      gas24: row.gas24,
      share3: share(kind === "gas" ? row.gas3 : row.fee3, total3),
      share24: share(kind === "gas" ? row.gas24 : row.fee24, total24),
    }))
}

export type UsageProgress = { read: number; total: number; guzzlers: UsageRank[]; spenders: UsageRank[] }

/** Reads sampled block receipts and reports the top accounts as blocks arrive. */
export async function scanUsage(onProgress: (progress: UsageProgress) => void, fetcher: FetchLike = defaultFetch, signal?: AbortSignal): Promise<void> {
  let error: unknown = null
  for (const url of GAS_RPCS.slice(0, 2)) {
    try {
      const headResponse = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        signal,
      })
      const headPayload = (await headResponse.json()) as { result?: string }
      const head = Number.parseInt(headPayload.result ?? "", 16)
      if (!Number.isFinite(head)) throw new Error("No head block")
      const blocks = usageBlocks(head)
      const guzzlers = new Map<string, UsageTotals>()
      const spenders = new Map<string, UsageTotals>()
      for (let index = 0; index < blocks.length; index += 1) {
        if (signal?.aborted) return
        const block = blocks[index]
        const in3h = (head - block) * BLOCK_MS <= THREE_H
        const response = await fetcher(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockReceipts", params: [`0x${block.toString(16)}`] }),
          signal,
        })
        const payload = (await response.json()) as { result?: ReceiptLike[]; error?: { message?: string } }
        if (payload.error) throw new Error(payload.error.message || "Receipts failed")
        for (const receipt of payload.result ?? []) absorbReceipt(guzzlers, spenders, receipt, in3h)
        if (index % 3 === 2 || index === blocks.length - 1) {
          onProgress({ read: index + 1, total: blocks.length, guzzlers: rankUsage(guzzlers, "gas"), spenders: rankUsage(spenders, "fee") })
        }
      }
      return
    } catch (caught) {
      if (signal?.aborted) return
      error = caught
    }
  }
  throw error instanceof Error ? error : new Error("Gas usage failed")
}
