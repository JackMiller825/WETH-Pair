import { WETH } from "@/lib/history/plan"

export const POOL_TOPICS = {
  v2Swap: "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822",
  v2Sync: "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1",
  v2Mint: "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f",
  v2Burn: "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496",
  v3Swap: "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  v3Mint: "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde",
  v3Burn: "0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c",
  v4Swap: "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
} as const

/** Uniswap V4 keeps every pool inside one PoolManager. A V4 "pair address" is the 32-byte pool id. */
export const POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90"

export const WETH_DECIMALS = 18

export type PoolKind = "v2" | "v3" | "v4" | "other"

export function poolKind(exchange: string, address: string): PoolKind {
  if (/^0x[0-9a-fA-F]{64}$/.test(address)) return "v4"
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return "other"
  if (/\bv4\b/i.test(exchange)) return "v4"
  if (/\bv3\b/i.test(exchange)) return "v3"
  if (/\bv2\b|sushi|pancake/i.test(exchange)) return "v2"
  return "other"
}

/**
 * Whether WETH is token0. Uses token0 when the PairCreated log supplied it. Otherwise V2 and V3 factories
 * sort the two addresses, so token0 is the lower one.
 */
export function wethIsToken0(tokenAddress: string, token0?: string | null): boolean {
  if (token0) return token0.toLowerCase() === WETH
  return WETH < tokenAddress.toLowerCase()
}

function word(data: string, index: number): bigint {
  const hex = data.startsWith("0x") ? data.slice(2) : data
  const chunk = hex.slice(index * 64, index * 64 + 64)
  if (chunk.length !== 64 || !/^[0-9a-fA-F]+$/.test(chunk)) throw new Error("ABI word is malformed")
  return BigInt(`0x${chunk}`)
}

/** `getReserves()` returns three words and a `Sync` log carries two. Both start with reserve0, reserve1. */
export function decodeReserves(data: string): { reserve0: bigint; reserve1: bigint } {
  return { reserve0: word(data, 0), reserve1: word(data, 1) }
}

export function decodeUint(data: string): bigint {
  return word(data, 0)
}

/** Raw WETH units to WETH, without losing the integer part for large pools. */
export function toWeth(raw: bigint): number {
  const scale = BigInt(10) ** BigInt(WETH_DECIMALS)
  const whole = raw / scale
  const fraction = raw % scale
  return Number(whole) + Number(fraction) / 1e18
}

export function pooledWethFromReserves(reserve0: bigint, reserve1: bigint, wethFirst: boolean): number {
  return toWeth(wethFirst ? reserve0 : reserve1)
}

export const GET_RESERVES = "0x0902f1ac"

export function balanceOfCall(holder: string): string {
  return `0x70a08231${holder.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`
}

export type PoolLog = {
  address?: string
  topics?: string[]
  data?: string
  blockNumber?: string
  transactionHash?: string
  logIndex?: string
  removed?: boolean
}

export type PoolEvent =
  | { kind: "swap"; pair: string; id: string; block: number }
  | { kind: "sync"; pair: string; block: number; logIndex: number; reserve0: bigint; reserve1: bigint }
  | { kind: "liquidity"; pair: string; block: number }

/** Reads the pool events Live Activity uses. A V4 swap is keyed by its pool id, not the PoolManager. */
export function classifyPoolLog(log: PoolLog): PoolEvent | null {
  if (!log || log.removed || !Array.isArray(log.topics) || typeof log.address !== "string") return null
  const block = typeof log.blockNumber === "string" ? Number.parseInt(log.blockNumber, 16) : NaN
  if (!Number.isFinite(block)) return null
  const topic = log.topics[0]?.toLowerCase()
  const address = log.address.toLowerCase()
  const id = `${(log.transactionHash ?? "").toLowerCase()}:${Number.parseInt(log.logIndex ?? "0x0", 16)}`
  if (topic === POOL_TOPICS.v4Swap) {
    if (address !== POOL_MANAGER || !log.topics[1]) return null
    return { kind: "swap", pair: log.topics[1].toLowerCase(), id, block }
  }
  if (topic === POOL_TOPICS.v2Swap || topic === POOL_TOPICS.v3Swap) return { kind: "swap", pair: address, id, block }
  if (topic === POOL_TOPICS.v2Sync) {
    try {
      const { reserve0, reserve1 } = decodeReserves(log.data ?? "")
      return { kind: "sync", pair: address, block, logIndex: Number.parseInt(log.logIndex ?? "0x0", 16), reserve0, reserve1 }
    } catch {
      return null
    }
  }
  if (topic === POOL_TOPICS.v2Mint || topic === POOL_TOPICS.v2Burn || topic === POOL_TOPICS.v3Mint || topic === POOL_TOPICS.v3Burn) return { kind: "liquidity", pair: address, block }
  return null
}
