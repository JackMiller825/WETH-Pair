import { HISTORY_BUDGET_MS, FACTORIES, PAIR_CREATED_TOPIC, advanceJob, classifyRpcFailure, currentSlice, decodeCallResult, dexForFactory, focusOlderGap, parsePairCreated, wethSide, type HistoryJob } from "@/lib/history/plan"
import { TRANSFER_TOPIC, burnPercent, classifyLpTransfer, isBurnAddress, parseTransferLog } from "@/lib/lp/burn-logic"
import type { ChainBurn } from "@/lib/lp/chain-scan"
import { EMPTY_DETAIL, type PairRecord } from "@/lib/types"

const RPCS = ["https://rpc.mevblocker.io", "https://mainnet.gateway.tenderly.co", "https://rpc.flashbots.net", "https://ethereum-rpc.publicnode.com"]
let preferredRpc = 0
const PAIR_CHUNK = 500
const BURN_CHUNK = 2_000
const MIN_CHUNK = 20
const ADDRESS_BATCH = 10
const ZERO_TOPIC = "0x0000000000000000000000000000000000000000000000000000000000000000"
const DEAD_TOPIC = "0x000000000000000000000000000000000000000000000000000000000000dead"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  const failures: string[] = []
  for (let index = 0; index < RPCS.length; index += 1) {
    const choice = (preferredRpc + index) % RPCS.length
    try {
      const result = await callRpc(RPCS[choice], method, params)
      preferredRpc = choice
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : "RPC error"
      failures.push(`${new URL(RPCS[choice]).host}: ${message}`)
      if (classifyRpcFailure(message) === "rate-limit") await sleep(1_000)
    }
  }
  throw new Error(failures.join(" · "))
}

function hex(value: number): string {
  return `0x${value.toString(16)}`
}

async function blockStamp(block: number, cache: Map<number, string>): Promise<number | null> {
  const saved = cache.get(block)
  if (saved) return Date.parse(saved)
  try {
    const result = (await rpc("eth_getBlockByNumber", [hex(block), false])) as { timestamp?: string } | null
    const seconds = Number.parseInt(result?.timestamp ?? "", 16)
    if (!Number.isFinite(seconds)) return null
    const ms = seconds * 1000
    cache.set(block, new Date(ms).toISOString())
    return ms
  } catch {
    return null
  }
}

/** Two block reads cover the slice. Events between them are placed by block number, not one request each. */
async function sliceClock(from: number, to: number, cache: Map<number, string>): Promise<(block: number) => string> {
  const start = await blockStamp(from, cache)
  const end = to === from ? start : await blockStamp(to, cache)
  return (block: number) => {
    const saved = cache.get(block)
    if (saved) return saved
    if (start == null) return new Date(0).toISOString()
    if (end == null || to === from) return new Date(start).toISOString()
    const ratio = (block - from) / Math.max(1, to - from)
    const iso = new Date(start + ratio * (end - start)).toISOString()
    cache.set(block, iso)
    return iso
  }
}

function paused(job: HistoryJob, message: string, now: Date): HistoryJob {
  return { ...job, status: "running", error: message, stage: "Paused on an RPC error. The next publish continues from this block.", updatedAt: now.toISOString() }
}

export async function readHead(): Promise<number> {
  const result = (await rpc("eth_blockNumber", [])) as string
  const head = Number.parseInt(result, 16)
  if (!Number.isInteger(head)) throw new Error("Block number was unreadable")
  return head
}

export async function scanHistoricalPairs(job: HistoryJob, now = new Date()): Promise<{ job: HistoryJob; pairs: PairRecord[] }> {
  const deadline = Date.now() + HISTORY_BUDGET_MS
  const pairs: PairRecord[] = []
  const times = new Map<number, string>()
  let current = focusOlderGap(job)
  let chunk = PAIR_CHUNK
  while (Date.now() < deadline) {
    const slice = currentSlice(current, chunk)
    if (!slice) {
      current = advanceJob(current, current.phase === "recent" ? current.recentEnd : current.olderEnd, now.toISOString(), current.stage)
      if (current.phase === "done") break
      continue
    }
    let logs: { address?: string; topics?: string[]; data?: string; blockNumber?: string }[] = []
    try {
      logs = (await rpc("eth_getLogs", [{
        fromBlock: hex(slice.from),
        toBlock: hex(slice.to),
        address: FACTORIES.map((item) => item.address),
        topics: [PAIR_CREATED_TOPIC],
      }])) as typeof logs
    } catch (error) {
      const message = error instanceof Error ? error.message : "Log scan failed"
      if (classifyRpcFailure(message) === "rate-limit") {
        await sleep(2_000)
        continue
      }
      if (chunk > MIN_CHUNK) {
        chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2))
        continue
      }
      return { job: paused(current, message, now), pairs }
    }
    const clock = await sliceClock(slice.from, slice.to, times)
    const found: PairRecord[] = []
    for (const log of logs) {
      const created = parsePairCreated(log)
      if (!created) continue
      const side = wethSide(created.token0, created.token1)
      const dex = dexForFactory(created.factory)
      if (!side || !dex) continue
      found.push(chainPair(created.pair, side.token, dex, clock(created.block), created.block))
    }
    pairs.push(...found)
    if (chunk < PAIR_CHUNK) chunk = Math.min(PAIR_CHUNK, chunk * 2)
    current = advanceJob(current, slice.to + 1, now.toISOString(), "Scanning Ethereum for WETH pairs older than the live listing")
    current = { ...current, pairsFound: current.pairsFound + found.length, error: null }
    if (current.phase === "done") break
  }
  if (current.phase !== "done" && Date.now() >= deadline) {
    current = { ...current, stage: "Paused at the time budget. The next publish resumes from this block.", updatedAt: now.toISOString() }
  }
  return { job: current, pairs }
}

async function transferLogs(addresses: string[], from: number, to: number, batchSize: number): Promise<Parameters<typeof parseTransferLog>[0][]> {
  const logs: Parameters<typeof parseTransferLog>[0][] = []
  const batches: string[][] = []
  for (let index = 0; index < addresses.length; index += batchSize) batches.push(addresses.slice(index, index + batchSize))
  for (const topic of [DEAD_TOPIC, ZERO_TOPIC]) {
    for (let index = 0; index < batches.length; index += 4) {
      const pages = await Promise.all(batches.slice(index, index + 4).map((batch) => rpc("eth_getLogs", [{
        fromBlock: hex(from),
        toBlock: hex(to),
        address: batch,
        topics: [TRANSFER_TOPIC, null, topic],
      }])))
      for (const page of pages) logs.push(...(page as Parameters<typeof parseTransferLog>[0][]))
    }
  }
  return logs
}

async function burnPercents(pairs: string[]): Promise<Map<string, number | null>> {
  const pending = [...new Set(pairs)]
  const percents = new Map<string, number | null>()
  async function worker() {
    while (pending.length > 0) {
      const pair = pending.shift()
      if (!pair || percents.has(pair)) continue
      percents.set(pair, await currentBurnPercent(pair))
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, pending.length) }, () => worker()))
  return percents
}

export async function scanHistoricalBurns(job: HistoryJob, pairAddresses: Set<string>, now = new Date()): Promise<{ job: HistoryJob; burns: ChainBurn[] }> {
  const deadline = Date.now() + HISTORY_BUDGET_MS
  const burns: ChainBurn[] = []
  const times = new Map<number, string>()
  const addresses = [...pairAddresses].filter((item) => /^0x[0-9a-f]{40}$/i.test(item))
  let current = focusOlderGap(job)
  if (addresses.length === 0) {
    return { job: { ...current, stage: "Waiting for WETH pairs before the LP burn scan.", updatedAt: now.toISOString() }, burns }
  }
  let chunk = BURN_CHUNK
  let batchSize = ADDRESS_BATCH
  while (Date.now() < deadline) {
    const slice = currentSlice(current, chunk)
    if (!slice) {
      current = advanceJob(current, current.phase === "recent" ? current.recentEnd : current.olderEnd, now.toISOString(), current.stage)
      if (current.phase === "done") break
      continue
    }
    const found: ChainBurn[] = []
    try {
      const clock = await sliceClock(slice.from, slice.to, times)
      const logs = await transferLogs(addresses, slice.from, slice.to, batchSize)
      for (const log of logs) {
          const transfer = parseTransferLog(log)
          if (!transfer || !pairAddresses.has(transfer.pair) || !isBurnAddress(transfer.to) || transfer.amount <= BigInt(0)) continue
          if (classifyLpTransfer(transfer) !== "irreversible-burn") continue
          found.push({
            pair: transfer.pair,
            tx: transfer.tx,
            logIndex: transfer.logIndex,
            block: transfer.block,
            burnedAt: clock ? clock(transfer.block) : new Date(0).toISOString(),
            from: transfer.from,
            to: transfer.to,
            percent: null,
            supply: null,
            burnedTokens: null,
            detectionSource: "backfill",
          })
      }
      const percents = await burnPercents(found.map((item) => item.pair))
      let kept = 0
      for (const burn of found) {
        const percent = percents.get(burn.pair) ?? null
        if (percent != null && percent <= 0) continue
        burn.percent = percent
        burns.push(burn)
        kept += 1
      }
      found.length = kept
    } catch (error) {
      const message = error instanceof Error ? error.message : "Log scan failed"
      if (/address|expected 20|invalid params/i.test(message) && batchSize > 1) {
        batchSize = 1
        continue
      }
      if (classifyRpcFailure(message) === "rate-limit") {
        await sleep(2_000)
        continue
      }
      if (chunk > MIN_CHUNK) {
        chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2))
        continue
      }
      return { job: paused(current, message, now), burns }
    }
    if (chunk < BURN_CHUNK) chunk = Math.min(BURN_CHUNK, chunk * 2)
    if (batchSize < ADDRESS_BATCH) batchSize = ADDRESS_BATCH
    current = advanceJob(current, slice.to + 1, now.toISOString(), "Scanning historical LP transfers to burn addresses")
    current = { ...current, burnsFound: current.burnsFound + found.length, error: null, stage: current.phase === "done" ? "Historical LP scan complete" : "Scanning historical LP transfers to burn addresses" }
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
