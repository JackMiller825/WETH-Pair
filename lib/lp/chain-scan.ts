import { canBurnLp, type PairRecord } from "@/lib/types"
import {
  BURN_ADDRESS_LIST,
  TRANSFER_TOPIC,
  blocksForHours,
  burnPercent,
  commitCheckpoint,
  parseTransferLog,
  planChunks,
  scanStart,
  type ChainCheckpoint,
  type ParsedTransfer,
  type TransferLog,
} from "@/lib/lp/burn-logic"

const DEFAULT_RPCS = [
  "https://1rpc.io/eth",
  "https://rpc.ankr.com/eth",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
]
const TOTAL_SUPPLY = "0x18160ddd"
const BALANCE_OF = "0x70a08231"

export type ChainBurn = {
  pair: string
  tx: string
  logIndex: number
  block: number
  burnedAt: string
  from: string | null
  to: string
  percent: number | null
  supply: number | null
  burnedTokens: number | null
}

export type { ChainCheckpoint }

export type ChainScanResult = {
  checkpoint: ChainCheckpoint
  burns: ChainBurn[]
}

type RpcLog = TransferLog

function rpcHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "configured RPC"
  }
}

function hex(value: number): string {
  return `0x${value.toString(16)}`
}

async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  let last = "RPC failed"
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "weth-live-pairs" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = (await response.json()) as { result?: unknown; error?: { message?: string } }
      if (payload.error) throw new Error(payload.error.message || "RPC error")
      return payload.result
    } catch (error) {
      last = error instanceof Error ? error.message : "RPC error"
      console.warn(`[LP-MONITOR] ${method} failed (attempt ${attempt}): ${last}`)
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 400))
    }
  }
  throw new Error(last)
}

function monitoredPairs(records: PairRecord[]): string[] {
  const addresses: string[] = []
  for (const record of records) {
    if (!canBurnLp(record.exchange)) continue
    if (record.lpSource === "ethereum-transfer" && record.lpBurntPercent >= 99.5) continue
    addresses.push(record.address.toLowerCase())
  }
  return [...new Set(addresses)]
}

async function logsForChunk(url: string, pairs: string[], from: number, to: number): Promise<ParsedTransfer[]> {
  const parsed: ParsedTransfer[] = []
  const batchSize = 40
  for (let index = 0; index < pairs.length; index += batchSize) {
    const address = pairs.slice(index, index + batchSize)
    console.log(`[LP-MONITOR] Scanning blocks ${from} → ${to} across ${address.length} pairs`)
    const result = (await rpcCall(url, "eth_getLogs", [
      {
        fromBlock: hex(from),
        toBlock: hex(to),
        address,
        topics: [TRANSFER_TOPIC],
      },
    ])) as RpcLog[]
    if (!Array.isArray(result)) continue
    for (const log of result) {
      const transfer = parseTransferLog(log)
      if (!transfer) continue
      console.log(`[LP-MONITOR] Pair ${transfer.pair} LP transfer detected`)
      console.log(`[LP-BURN] Destination ${transfer.to} Amount ${transfer.amount.toString()} LP`)
      parsed.push(transfer)
    }
  }
  return parsed
}

async function blockTimestamp(url: string, block: number, cache: Map<number, string>): Promise<string> {
  const cached = cache.get(block)
  if (cached) return cached
  const result = (await rpcCall(url, "eth_getBlockByNumber", [hex(block), false])) as { timestamp?: string } | null
  const seconds = Number.parseInt(result?.timestamp ?? "", 16)
  const iso = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date().toISOString()
  cache.set(block, iso)
  return iso
}

function callData(selector: string, address?: string): string {
  if (!address) return selector
  return selector + address.slice(2).padStart(64, "0")
}

async function readSupply(url: string, pair: string): Promise<{ supply: bigint; burned: bigint } | null> {
  try {
    const supplyHex = (await rpcCall(url, "eth_call", [{ to: pair, data: TOTAL_SUPPLY }, "latest"])) as string
    const supply = BigInt(supplyHex)
    let burned = BigInt(0)
    for (const destination of BURN_ADDRESS_LIST) {
      const data = callData(BALANCE_OF, destination)
      const balanceHex = (await rpcCall(url, "eth_call", [{ to: pair, data }, "latest"])) as string
      burned += BigInt(balanceHex)
    }
    return { supply, burned }
  } catch (error) {
    console.warn(`[LP-BURN] Balance read failed for ${pair}: ${error instanceof Error ? error.message : "unknown error"}`)
    return null
  }
}

function numberFromBig(value: bigint): number | null {
  const asNumber = Number(value)
  return Number.isFinite(asNumber) ? asNumber : null
}

async function enrich(url: string, transfers: ParsedTransfer[]): Promise<ChainBurn[]> {
  const cache = new Map<number, string>()
  const supplyCache = new Map<string, { supply: bigint; burned: bigint } | null>()
  const burns: ChainBurn[] = []
  for (const transfer of transfers) {
    if (!supplyCache.has(transfer.pair)) supplyCache.set(transfer.pair, await readSupply(url, transfer.pair))
    const balances = supplyCache.get(transfer.pair) ?? null
    const percent = balances ? burnPercent(balances.supply, [balances.burned]) : null
    if (percent != null) console.log(`[LP-BURN] Burn percentage ${percent}%`)
    const burnedAt = await blockTimestamp(url, transfer.block, cache)
    burns.push({
      pair: transfer.pair,
      tx: transfer.tx,
      logIndex: transfer.logIndex,
      block: transfer.block,
      burnedAt,
      from: transfer.from,
      to: transfer.to,
      percent,
      supply: balances ? numberFromBig(balances.supply) : null,
      burnedTokens: balances ? numberFromBig(balances.burned) : null,
    })
  }
  return burns
}

async function collectRange(url: string, pairs: string[], from: number, to: number): Promise<{ burns: ChainBurn[]; through: number | null; error: string | null }> {
  if (pairs.length === 0) return { burns: [], through: to, error: null }
  const chunks = planChunks(from, to)
  const transfers: ParsedTransfer[] = []
  let through: number | null = null
  for (const chunk of chunks) {
    try {
      transfers.push(...(await logsForChunk(url, pairs, chunk.from, chunk.to)))
      through = chunk.to
    } catch (error) {
      const message = error instanceof Error ? error.message : "Log scan failed"
      console.warn(`[LP-MONITOR] Checkpoint held. ${message}`)
      return { burns: await enrich(url, transfers), through, error: message }
    }
  }
  return { burns: await enrich(url, transfers), through, error: null }
}

async function chooseRpc(candidates: string[]): Promise<string> {
  let last = "No Ethereum RPC responded"
  for (const url of candidates) {
    try {
      const hexHead = (await rpcCall(url, "eth_blockNumber", [])) as string
      const head = Number.parseInt(hexHead, 16)
      if (!Number.isInteger(head)) throw new Error("Block number was unreadable")
      console.log(`[LP-MONITOR] Ethereum RPC ${rpcHost(url)} head ${head}`)
      return url
    } catch (error) {
      last = error instanceof Error ? error.message : "RPC error"
      console.warn(`[LP-MONITOR] ${rpcHost(url)} was not usable: ${last}`)
    }
  }
  throw new Error(last)
}

export async function scanChain(records: PairRecord[], previous: ChainCheckpoint | null, now = new Date()): Promise<ChainScanResult> {
  const candidates = [process.env.ETH_RPC_URL, ...DEFAULT_RPCS].filter((url): url is string => Boolean(url))
  let url = candidates[0]
  let host = rpcHost(url)
  const pairs = monitoredPairs(records)
  const pairMonitorBlock = records.reduce<number | null>((best, record) => {
    if (record.creationBlock == null) return best
    return best == null ? record.creationBlock : Math.max(best, record.creationBlock)
  }, null)
  const base: ChainCheckpoint = {
    lpMonitorBlock: previous?.lpMonitorBlock ?? null,
    pairMonitorBlock,
    headBlock: previous?.headBlock ?? null,
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    lastError: previous?.lastError ?? null,
    blocksBehind: null,
    rpcHost: host,
  }

  let head: number
  try {
    url = await chooseRpc(candidates)
    host = rpcHost(url)
    const hexHead = (await rpcCall(url, "eth_blockNumber", [])) as string
    head = Number.parseInt(hexHead, 16)
    if (!Number.isInteger(head)) throw new Error("Block number was unreadable")
  } catch (error) {
    const message = error instanceof Error ? error.message : "RPC error"
    console.warn(`[LP-MONITOR] Head block was not read. Checkpoint held. ${message}`)
    return { checkpoint: { ...base, rpcHost: host, lastError: message }, burns: [] }
  }

  const from = scanStart(previous?.lpMonitorBlock ?? null, head)
  if (from == null) {
    return {
      checkpoint: { ...base, rpcHost: host, headBlock: head, blocksBehind: 0, lastError: null, lastSuccessAt: now.toISOString() },
      burns: [],
    }
  }

  console.log(`[LP-MONITOR] Scanning blocks ${from} → ${head}`)
  const live = await collectRange(url, pairs, from, head)
  let burns = live.burns
  const backfillFrom = Number(process.env.BACKFILL_FROM_BLOCK)
  const backfillTo = Number(process.env.BACKFILL_TO_BLOCK)
  const backfillHours = Number(process.env.BACKFILL_HOURS)
  if (Number.isInteger(backfillFrom) && Number.isInteger(backfillTo) && backfillTo >= backfillFrom) {
    console.log(`[LP-MONITOR] Backfill blocks ${backfillFrom} → ${backfillTo}`)
    const extra = await collectRange(url, pairs, backfillFrom, backfillTo)
    burns = [...burns, ...extra.burns]
  } else if (Number.isFinite(backfillHours) && backfillHours > 0) {
    const start = Math.max(0, head - blocksForHours(backfillHours))
    console.log(`[LP-MONITOR] Backfill last ${backfillHours} hours, blocks ${start} → ${head}`)
    const extra = await collectRange(url, pairs, start, head)
    burns = [...burns, ...extra.burns]
  }

  const lpMonitorBlock = commitCheckpoint(previous?.lpMonitorBlock ?? null, live.through)
  const success = live.error == null && lpMonitorBlock != null
  return {
    burns,
    checkpoint: {
      lpMonitorBlock,
      pairMonitorBlock,
      headBlock: head,
      lastSuccessAt: success ? now.toISOString() : base.lastSuccessAt,
      lastError: live.error,
      blocksBehind: lpMonitorBlock == null ? null : Math.max(0, head - lpMonitorBlock),
      rpcHost: host,
    },
  }
}
