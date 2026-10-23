import { decodeV2Swap, topicAddress } from "@/lib/chart/decode"
import type { ChartTrade } from "@/lib/chart/flow"

const V2_SWAP = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822"
const RPCS = ["https://rpc.mevblocker.io", "https://ethereum-rpc.publicnode.com"]
const BLOCK_MS = 12_000
const MAX_BLOCKS = 1500

type Log = { topics?: string[]; data?: string; blockNumber?: string; transactionHash?: string; logIndex?: string; removed?: boolean }

async function rpc(method: string, params: unknown[], signal?: AbortSignal): Promise<unknown> {
  let last = "RPC failed"
  for (const url of RPCS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: signal ? AbortSignal.any([AbortSignal.timeout(12_000), signal]) : AbortSignal.timeout(12_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = (await response.json()) as { result?: unknown; error?: { message?: string } }
      if (payload.error) throw new Error(payload.error.message || "RPC error")
      return payload.result
    } catch (error) {
      last = error instanceof Error ? error.message : "RPC error"
    }
  }
  throw new Error(last)
}

function hex(value: number): string {
  return `0x${Math.max(0, Math.floor(value)).toString(16)}`
}

/**
 * Reads one V2 pair's swaps when the chart is opened. This is not on the LP burn path.
 * Times are estimated at 12 seconds per block from the pair's creation time.
 */
export async function loadV2Trades(pair: string, token: string, createdBlock: number, createdAt: number, wethIsToken0: boolean, signal?: AbortSignal): Promise<{ trades: ChartTrade[]; note: string; read: "decoded" | "unknown" }> {
  const decimalsHex = await rpc("eth_call", [{ to: token, data: "0x313ce567" }, "latest"], signal)
  const tokenDecimals = typeof decimalsHex === "string" ? Number.parseInt(decimalsHex, 16) : NaN
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
    return { trades: [], note: "Token decimals could not be read, so swap amounts stay unknown.", read: "unknown" }
  }
  const headHex = await rpc("eth_blockNumber", [], signal)
  const head = typeof headHex === "string" ? Number.parseInt(headHex, 16) : NaN
  if (!Number.isFinite(head) || createdBlock > head) throw new Error("No block range for this pair")
  const ranges: [number, number][] = head - createdBlock <= MAX_BLOCKS
    ? [[createdBlock, head]]
    : [[createdBlock, createdBlock + MAX_BLOCKS], [Math.max(createdBlock, head - MAX_BLOCKS), head]]
  const logs: Log[] = []
  for (const [from, to] of ranges) {
    const batch = await rpc("eth_getLogs", [{ address: pair, topics: [V2_SWAP], fromBlock: hex(from), toBlock: hex(to) }], signal)
    if (!Array.isArray(batch)) throw new Error("No swap logs")
    logs.push(...(batch as Log[]))
  }
  const trades: ChartTrade[] = []
  const seen = new Set<string>()
  for (const log of logs) {
    if (!log || log.removed) continue
    const decoded = decodeV2Swap(log.data ?? "", wethIsToken0, tokenDecimals)
    const block = typeof log.blockNumber === "string" ? Number.parseInt(log.blockNumber, 16) : NaN
    if (!decoded || !Number.isFinite(block)) continue
    const id = `${(log.transactionHash ?? "").toLowerCase()}:${Number.parseInt(log.logIndex ?? "0x0", 16)}`
    if (seen.has(id)) continue
    seen.add(id)
    trades.push({
      id,
      at: createdAt + (block - createdBlock) * BLOCK_MS,
      block,
      side: decoded.side,
      weth: decoded.weth,
      token: decoded.token,
      priceWeth: decoded.priceWeth,
      sender: topicAddress(log.topics?.[1]),
      recipient: topicAddress(log.topics?.[2]),
      trader: null,
    })
  }
  trades.sort((a, b) => a.at - b.at || a.block - b.block)
  const partial = head - createdBlock > MAX_BLOCKS
  return {
    trades,
    read: "decoded",
    note: partial
      ? `Decoded ${trades.length} V2 swaps from the first ${MAX_BLOCKS} blocks and the latest ${MAX_BLOCKS} blocks. The middle was not read. Times use 12 seconds per block. Trader origins were not read.`
      : `Decoded ${trades.length} V2 swaps since creation. Times use 12 seconds per block. Trader origins were not read.`,
  }
}
