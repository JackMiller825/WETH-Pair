import { isInsideRange } from "@/lib/time-range"

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
export const REORG_BLOCKS = 12
/** First run only. Later runs continue from the saved block, not from a 24-hour query. */
export const BOOTSTRAP_LOOKBACK_BLOCKS = 300
/** Several public RPCs reject eth_getLogs ranges above 50 blocks. */
export const BLOCK_CHUNK = 40
export const MAX_CHUNKS_PER_RUN = 20

export const BURN_ADDRESS_LIST = [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
] as const

const BURN_ADDRESS_SET = new Set<string>(BURN_ADDRESS_LIST)

export function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null
  return trimmed.toLowerCase()
}

export function isBurnAddress(value: string | null | undefined): boolean {
  const address = normalizeAddress(value)
  return address != null && BURN_ADDRESS_SET.has(address)
}

export function addressFromTopic(topic: string | null | undefined): string | null {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null
  return normalizeAddress(`0x${topic.slice(-40)}`)
}

/** Burned balance across every recognized burn address, as a percentage of total LP supply. */
export function burnPercent(supply: bigint, balances: bigint[]): number | null {
  if (supply <= BigInt(0)) return null
  const burned = balances.reduce((sum, value) => sum + (value > BigInt(0) ? value : BigInt(0)), BigInt(0))
  if (burned <= BigInt(0)) return 0
  const hundredths = (burned * BigInt(10000)) / supply
  const capped = hundredths > BigInt(10000) ? BigInt(10000) : hundredths
  return Number(capped) / 100
}

export type TransferLog = {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
  logIndex: string
}

export type ParsedTransfer = {
  pair: string
  from: string | null
  to: string
  amount: bigint
  block: number
  tx: string
  logIndex: number
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead"
const PROTOCOL_MINIMUM = BigInt(1000)

export type LpTransferClass = "irreversible-burn" | "protocol-minimum" | "liquidity-removal" | "mint" | "ordinary-transfer"

/**
 * A transfer into the dead address, or into zero from a holder, is an irreversible LP burn.
 * Uniswap removes liquidity by burning LP from the pair contract to zero. That is not a creator burn.
 * The 1000-wei mint to zero is protocol minimum liquidity.
 */
export function classifyLpTransfer(transfer: { pair: string; from: string | null; to: string; amount: bigint }): LpTransferClass {
  const to = transfer.to.toLowerCase()
  const from = transfer.from?.toLowerCase() ?? null
  const pair = transfer.pair.toLowerCase()
  if (!isBurnAddress(to)) return "ordinary-transfer"
  if (from == null || from === ZERO_ADDRESS) return transfer.amount <= PROTOCOL_MINIMUM ? "protocol-minimum" : "mint"
  if (to === ZERO_ADDRESS && from === pair) return "liquidity-removal"
  if (to === ZERO_ADDRESS && transfer.amount <= PROTOCOL_MINIMUM) return "protocol-minimum"
  if (to === DEAD_ADDRESS || to === ZERO_ADDRESS) return "irreversible-burn"
  return "ordinary-transfer"
}

export function parseTransferLog(log: TransferLog): ParsedTransfer | null {
  if ((log.topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) return null
  const to = addressFromTopic(log.topics[2])
  if (!to || !isBurnAddress(to)) return null
  const pair = normalizeAddress(log.address)
  if (!pair) return null
  let amount = BigInt(0)
  try {
    amount = BigInt(log.data)
  } catch {
    return null
  }
  const block = Number.parseInt(log.blockNumber, 16)
  const logIndex = Number.parseInt(log.logIndex, 16)
  if (!Number.isInteger(block) || !Number.isInteger(logIndex)) return null
  if (!/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash)) return null
  return {
    pair,
    from: addressFromTopic(log.topics[1]),
    to,
    amount,
    block,
    tx: log.transactionHash.toLowerCase(),
    logIndex,
  }
}

export function scanStart(lastProcessed: number | null, head: number): number | null {
  if (!Number.isInteger(head) || head < 0) return null
  if (lastProcessed == null) return Math.max(0, head - BOOTSTRAP_LOOKBACK_BLOCKS)
  const from = Math.max(0, lastProcessed - REORG_BLOCKS + 1)
  if (from > head) return null
  return from
}

export function planChunks(from: number, to: number, chunkSize = BLOCK_CHUNK, maxChunks = MAX_CHUNKS_PER_RUN): { from: number; to: number }[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from || chunkSize < 1 || maxChunks < 1) return []
  const chunks: { from: number; to: number }[] = []
  let cursor = from
  while (cursor <= to && chunks.length < maxChunks) {
    const end = Math.min(to, cursor + chunkSize - 1)
    chunks.push({ from: cursor, to: end })
    cursor = end + 1
  }
  return chunks
}

/** Keep the previous checkpoint when a call fails. Never move the checkpoint backwards. */
export function commitCheckpoint(previous: number | null, lastSuccessfulBlock: number | null): number | null {
  if (lastSuccessfulBlock == null || !Number.isInteger(lastSuccessfulBlock)) return previous
  if (previous == null) return lastSuccessfulBlock
  return Math.max(previous, lastSuccessfulBlock)
}

export type TimedBurn = {
  burnAt?: string | null
  createdAt: string
}

export function burnTimeMs(event: { burnAt?: string | null }): number | null {
  if (!event.burnAt) return null
  const at = Date.parse(event.burnAt)
  return Number.isFinite(at) ? at : null
}

export function pairAgeMs(createdAt: string, now: number): number | null {
  const created = Date.parse(createdAt)
  if (!Number.isFinite(created)) return null
  return now - created
}

/**
 * LP Burn Watch: the clock range applies to the burn timestamp.
 * Pair age is a separate cap. A missing burn timestamp never matches a clock range.
 */
export function filterBurnEvents<T extends TimedBurn>(
  events: T[],
  burnStart: number,
  burnEnd: number,
  maxPairAgeMs: number | null,
  now: number,
): T[] {
  return events.filter((event) => {
    const burned = burnTimeMs(event)
    if (burned == null || burned < burnStart || burned > burnEnd) return false
    return pairAgeAllowed(event.createdAt, maxPairAgeMs, now)
  })
}

/**
 * The watch table keeps timed burns on the burn clock.
 * A burned pair with no burn timestamp still appears when the pair itself was created in that window.
 */
export function watchTableEvents<T extends TimedBurn>(
  events: T[],
  burnStart: number,
  burnEnd: number,
  maxPairAgeMs: number | null,
  now: number,
): T[] {
  const timed = filterBurnEvents(events, burnStart, burnEnd, maxPairAgeMs, now)
  const seen = new Set(timed)
  const undated = events.filter((event) => {
    if (seen.has(event) || burnTimeMs(event) != null) return false
    const created = Date.parse(event.createdAt)
    if (!Number.isFinite(created) || created < burnStart || created > burnEnd) return false
    return pairAgeAllowed(event.createdAt, maxPairAgeMs, now)
  })
  return [...timed, ...undated]
}

function pairAgeAllowed(createdAt: string, maxPairAgeMs: number | null, now: number): boolean {
  if (maxPairAgeMs == null) return true
  const age = pairAgeMs(createdAt, now)
  return age != null && age >= 0 && age <= maxPairAgeMs
}

export function createdInRange(createdAt: string, range: string, now: number): boolean {
  return isInsideRange(createdAt, range, now)
}

export type NotifySettings = {
  minBurnPercent: number
  minLiquidity: number
  maxPairAgeMinutes: number | null
}

export function passesNotifyFilter(
  event: { lpBurntPercent: number; percentKnown?: boolean; liquidity: number | null; createdAt: string },
  settings: NotifySettings,
  now: number,
): boolean {
  if (event.percentKnown === false) return settings.minBurnPercent <= 0
  if (event.lpBurntPercent <= 0 || event.lpBurntPercent < settings.minBurnPercent) return false
  if (settings.minLiquidity > 0 && (event.liquidity == null || event.liquidity < settings.minLiquidity)) return false
  if (settings.maxPairAgeMinutes != null) {
    const age = pairAgeMs(event.createdAt, now)
    if (age == null || age > settings.maxPairAgeMinutes * 60_000) return false
  }
  return true
}

/** Historical backfill is stored, but it must not buzz as a new live burn. */
export function isLiveBurnAlert(event: { kind?: string; detectionSource?: string | null }): boolean {
  return event.kind === "newly-burned" && event.detectionSource !== "backfill"
}

/** One notification per event id. Backfill and already-seen ids are left out. */
export function freshLiveAlerts<T extends { id: string; kind?: string; detectionSource?: string | null }>(
  events: T[],
  seen: ReadonlySet<string>,
  allow: (event: T) => boolean = () => true,
): T[] {
  const announced = new Set<string>()
  const fresh: T[] = []
  for (const event of events) {
    if (!isLiveBurnAlert(event) || seen.has(event.id) || announced.has(event.id) || !allow(event)) continue
    announced.add(event.id)
    fresh.push(event)
  }
  return fresh
}

/** A zero result is the Uniswap minimum-liquidity lock, not a burned LP position. */
export function isReportedBurn(percent: number | null | undefined): boolean {
  return percent == null || percent > 0
}

export function formatBurnPercent(value: number | null | undefined, percentKnown = true): string {
  if (!percentKnown || value == null || !Number.isFinite(value)) return "N/A"
  return `${Number(value.toFixed(2))}%`
}

export function notificationCopy(
  event: { tokenName: string; symbol: string; tokenAddress: string; lpBurntPercent: number; percentKnown?: boolean; liquidity: number | null; createdAt: string; id: string },
  now: number,
): { title: string; body: string; url: string; tag: string } {
  const age = pairAgeMs(event.createdAt, now)
  const ageText = age == null ? "unknown" : age < 60_000 ? `${Math.max(0, Math.round(age / 1000))}s` : `${Math.round(age / 60_000)}m`
  const liquidity = event.liquidity == null ? "N/A" : `$${Math.round(event.liquidity).toLocaleString("en-US")}`
  return {
    title: "🔥 New WETH LP Burn",
    body: [
      `${event.tokenName} ($${event.symbol})`,
      `LP Burn: ${formatBurnPercent(event.lpBurntPercent, event.percentKnown !== false)}`,
      `Liquidity: ${liquidity}`,
      `Pair Age: ${ageText}`,
      "Click to investigate",
    ].join("\n"),
    url: `/tokens/${event.tokenAddress}/`,
    tag: event.id,
  }
}

export type ChainCheckpoint = {
  lpMonitorBlock: number | null
  pairMonitorBlock: number | null
  headBlock: number | null
  lastSuccessAt: string | null
  lastError: string | null
  blocksBehind: number | null
  rpcHost: string
}

export function blocksForHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0
  return Math.round(hours * 300)
}
