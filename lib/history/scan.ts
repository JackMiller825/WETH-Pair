import { HISTORY_CHUNK, HISTORY_BUDGET_MS, FACTORIES, PAIR_CREATED_TOPIC, advanceJob, currentSlice, decodeCallResult, dexForFactory, parsePairCreated, wethSide, type HistoryJob } from "@/lib/history/plan"
import { TRANSFER_TOPIC, burnPercent, isBurnAddress, parseTransferLog } from "@/lib/lp/burn-logic"
import type { ChainBurn } from "@/lib/lp/chain-scan"
import { EMPTY_DETAIL, type PairRecord } from "@/lib/types"

const RPCS = ["https://rpc.mevblocker.io", "https://eth.drpc.org"]
const ZERO_TOPIC = "0x0000000000000000000000000000000000000000000000000000000000000000"
const DEAD_TOPIC = "0x000000000000000000000000000000000000000000000000000000000000dead"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "weth-live-pairs" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  })
  const payload = (await response.json().catch(() => null)) as { result?: unknown; error?: { message?: string } } | null
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || `HTTP ${response.status}`)
  }
  return payload?.result
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  let last = "RPC failed"
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await callRpc(RPCS[0], method, params)
    } catch (error) {
      last = error instanceof Error ? error.message : "RPC error"
      await sleep(400 * (attempt + 1))
    }
  }
  try {
    return await callRpc(RPCS[1], method, params)
  } catch (error) {
    const message = error instanceof Error ? error.message : "RPC error"
    if (/unknown state/i.test(message)) throw new Error(last)
    throw new Error(message)
  }
}

function hex(value: number): string {
  return `0x${value.toString(16)}`
}

async function blockTime(block: number, cache: Map<number, string>): Promise<string> {
  const saved = cache.get(block)
  if (saved) return saved
  const result = (await rpc("eth_getBlockByNumber", [hex(block), false])) as { timestamp?: string } | null
  const seconds = Number.parseInt(result?.timestamp ?? "", 16)
  const iso = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date(0).toISOString()
  cache.set(block, iso)
  return iso
}

export async function readHead(): Promise<number> {
  const result = (await rpc("eth_blockNumber", [])) as string
  const head = Number.parseInt(result, 16)
  if (!Number.isInteger(head)) throw new Error("Block number was unreadable")
  return head
}

function shouldShrink(message: string): boolean {
  return /too many|10000|exceed|response size|log limit|more than/i.test(message)
}

export async function scanHistoricalPairs(job: HistoryJob, now = new Date()): Promise<{ job: HistoryJob; pairs: PairRecord[] }> {
  const deadline = Date.now() + HISTORY_BUDGET_MS
  const pairs: PairRecord[] = []
  const times = new Map<number, string>()
  let current = job
  let chunk = HISTORY_CHUNK
  while (Date.now() < deadline) {
    const slice = currentSlice(current, chunk)
    if (!slice) {
      current = advanceJob(current, current.phase === "recent" ? current.recentEnd : current.olderEnd, now.toISOString(), current.stage)
      if (current.phase === "done") break
      continue
    }
    const found: PairRecord[] = []
    let shrink = false
    for (const factory of FACTORIES) {
      let logs: { address?: string; topics?: string[]; data?: string; blockNumber?: string }[] = []
      try {
        logs = (await rpc("eth_getLogs", [{
          fromBlock: hex(slice.from),
          toBlock: hex(slice.to),
          address: factory.address,
          topics: [PAIR_CREATED_TOPIC],
        }])) as typeof logs
      } catch (error) {
        const message = error instanceof Error ? error.message : "Log scan failed"
        if (chunk > 8 && shouldShrink(message)) {
          chunk = Math.max(8, Math.floor(chunk / 2))
          shrink = true
          break
        }
        return { job: { ...current, status: "failed", error: message, stage: "Pair scan stopped. The cursor stays here.", updatedAt: now.toISOString() }, pairs }
      }
      for (const log of logs) {
        const created = parsePairCreated(log)
        if (!created) continue
        const side = wethSide(created.token0, created.token1)
        const dex = dexForFactory(created.factory)
        if (!side || !dex) continue
        const createdAt = await blockTime(created.block, times)
        found.push(chainPair(created.pair, side.token, dex, createdAt, created.block))
      }
    }
    if (shrink) continue
    pairs.push(...found)
    if (chunk < HISTORY_CHUNK) chunk = Math.min(HISTORY_CHUNK, chunk + 8)
    current = advanceJob(current, slice.to + 1, now.toISOString(), "Scanning Ethereum for WETH pairs older than the live listing")
    current = { ...current, pairsFound: current.pairsFound + found.length }
    if (current.phase === "done") break
  }
  if (current.phase !== "done" && Date.now() >= deadline) {
    current = { ...current, stage: "Paused at the time budget. The next publish resumes from this block.", updatedAt: now.toISOString() }
  }
  return { job: current, pairs }
}

export async function scanHistoricalBurns(job: HistoryJob, pairAddresses: Set<string>, now = new Date()): Promise<{ job: HistoryJob; burns: ChainBurn[] }> {
  const deadline = Date.now() + HISTORY_BUDGET_MS
  const burns: ChainBurn[] = []
  const times = new Map<number, string>()
  let current = job
  let chunk = HISTORY_CHUNK
  while (Date.now() < deadline) {
    const slice = currentSlice(current, chunk)
    if (!slice) {
      current = advanceJob(current, current.phase === "recent" ? current.recentEnd : current.olderEnd, now.toISOString(), current.stage)
      if (current.phase === "done") break
      continue
    }
    let found = 0
    let shrink = false
    const sliceBurns: ChainBurn[] = []
    for (const topic of [DEAD_TOPIC, ZERO_TOPIC]) {
      let logs: Parameters<typeof parseTransferLog>[0][] = []
      try {
        logs = (await rpc("eth_getLogs", [{
          fromBlock: hex(slice.from),
          toBlock: hex(slice.to),
          topics: [TRANSFER_TOPIC, null, topic],
        }])) as typeof logs
      } catch (error) {
        const message = error instanceof Error ? error.message : "Log scan failed"
        if (chunk > 8 && shouldShrink(message)) {
          chunk = Math.max(8, Math.floor(chunk / 2))
          shrink = true
          break
        }
        return { job: { ...current, status: "failed", error: message, stage: "LP scan stopped. The cursor stays here.", updatedAt: now.toISOString() }, burns }
      }
      for (const log of logs) {
        const transfer = parseTransferLog(log)
        if (!transfer || !pairAddresses.has(transfer.pair) || !isBurnAddress(transfer.to) || transfer.amount <= BigInt(0)) continue
        const percent = await currentBurnPercent(transfer.pair)
        if (percent == null || percent <= 0) continue
        found += 1
        sliceBurns.push({
          pair: transfer.pair,
          tx: transfer.tx,
          logIndex: transfer.logIndex,
          block: transfer.block,
          burnedAt: await blockTime(transfer.block, times),
          from: transfer.from,
          to: transfer.to,
          percent,
          supply: null,
          burnedTokens: null,
          detectionSource: "backfill",
        })
      }
    }
    if (shrink) continue
    burns.push(...sliceBurns)
    if (chunk < HISTORY_CHUNK) chunk = Math.min(HISTORY_CHUNK, chunk + 8)
    current = advanceJob(current, slice.to + 1, now.toISOString(), "Scanning historical LP transfers to burn addresses")
    current = { ...current, burnsFound: current.burnsFound + found, stage: current.phase === "done" ? "Historical LP scan complete" : "Scanning historical LP transfers to burn addresses" }
    if (current.phase === "done") break
  }
  if (current.phase !== "done" && Date.now() >= deadline) {
    current = { ...current, stage: "Paused at the time budget. The next publish resumes from this block.", updatedAt: now.toISOString() }
  }
  return { job: current, burns }
}

async function currentBurnPercent(pair: string): Promise<number | null> {
  try {
    const supplyHex = (await rpc("eth_call", [{ to: pair, data: "0x18160ddd" }, "latest"])) as string
    const supply = BigInt(supplyHex)
    let burned = BigInt(0)
    for (const destination of ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]) {
      const data = `0x70a08231${destination.slice(2).padStart(64, "0")}`
      const balanceHex = (await rpc("eth_call", [{ to: pair, data }, "latest"])) as string
      burned += BigInt(balanceHex)
    }
    return burnPercent(supply, [burned])
  } catch {
    return null
  }
}

export async function enrichIdentity(records: PairRecord[], limit = 80): Promise<PairRecord[]> {
  const next = records.map((row) => ({ ...row }))
  let used = 0
  for (const row of next) {
    if (used >= limit) break
    if (row.listingSource !== "ethereum-pair-created" || row.identityResolved) continue
    used += 1
    const name = decodeCallResult(await rpc("eth_call", [{ to: row.tokenAddress, data: "0x06fdde03" }, "latest"]).catch(() => null) as string | null)
    const symbol = decodeCallResult(await rpc("eth_call", [{ to: row.tokenAddress, data: "0x95d89b41" }, "latest"]).catch(() => null) as string | null)
    row.identityResolved = true
    if (symbol) row.symbol = symbol
    if (name) row.tokenName = name
    if (symbol || name) row.name = symbol && name && name.toLowerCase() !== symbol.toLowerCase() ? `${symbol}(${name})` : symbol || name || row.name
  }
  return next
}

function chainPair(pair: string, token: string, dex: string, createdAt: string, block: number): PairRecord {
  const short = `${token.slice(0, 8)}…`
  return {
    name: short,
    created_at: createdAt,
    exchange: dex,
    address: pair,
    tokenAddress: token,
    url: `https://www.dextools.io/app/ether/pair-explorer/${pair}`,
    price: null,
    remaining: null,
    remainingUnit: "ETH",
    listingLiquidity: null,
    ...EMPTY_DETAIL,
    symbol: short,
    tokenName: "Name not read yet",
    creationBlock: block,
    listingSource: "ethereum-pair-created",
    identityResolved: false,
  }
}
