import type { AlertSound } from "@/lib/alerts"
import type { ChainBurn } from "@/lib/lp/chain-scan"
import { burnTimeMs, classifyLpTransfer, formatBurnPercent, isReportedBurn, pairAgeMs, watchTableEvents } from "@/lib/lp/burn-logic"
import { matchConcepts, parseIdentity } from "@/lib/narrative/text"
import { RANGES, rangeById } from "@/lib/time-range"
import type { PairRecord } from "@/lib/types"

export const CHAIN_ID = 1

/** Addresses this monitor treats as LP burns. Locked liquidity is never included. */
export const BURN_ADDRESSES = [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dEaD",
] as const

export type WatchStatus = "burned" | "locked" | "not-burned" | "unknown"
export type BurnKind = "newly-burned" | "previously-burned"

export const STATUS_LABEL: Record<WatchStatus, string> = {
  burned: "🔥 LP Burned",
  locked: "🔒 LP Locked",
  "not-burned": "⚠ LP Not Burned",
  unknown: "❓ Unknown",
}

export type LpBurnEvent = {
  id: string
  chainId: number
  pair: string
  tokenAddress: string
  symbol: string
  tokenName: string
  exchange: string
  createdAt: string
  detectedAt: string
  burnAt: string | null
  kind: BurnKind
  lpBurntPercent: number
  lpSupply: number | null
  lpBurnedTokens: number | null
  lpRemaining: number | null
  liquidity: number | null
  marketCap: number | null
  volume24h: number | null
  buys24h: number | null
  deployer: string | null
  url: string
  burnTx: string | null
  burnBlock: number | null
  burnFrom: string | null
  logIndex?: number | null
  source?: "ethereum-transfer" | "dextools"
  /** Backfill burns are stored and are not live alerts. */
  detectionSource?: "live" | "backfill"
  percentKnown?: boolean
  burnTo?: string | null
}

export type LpScan = {
  scannedAt: string
  previousScanAt: string | null
  pairsChecked: number
  newPairs: number
  newBurns: number
  previouslyBurnedFound: number
  newestPairAt: string | null
  highestCreationBlock: number | null
}

const EVENT_MAX = 2000
const EVENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export function watchStatus(record: PairRecord): WatchStatus {
  if (record.lpStatus === "burnt") return "burned"
  if (record.lpStatus === "locked") return "locked"
  if (record.lpStatus === "none") return "not-burned"
  return "unknown"
}

export function burnEventId(pair: string, tx: string | null, logIndex?: number | null): string {
  const hash = tx && /^0x[0-9a-fA-F]{64}$/.test(tx) ? tx.toLowerCase() : "no-tx"
  const suffix = hash !== "no-tx" && logIndex != null ? `:${logIndex}` : ""
  return `${CHAIN_ID}:${pair.toLowerCase()}:${hash}${suffix}`
}

export { formatBurnPercent }

function remainingLp(supply: number | null | undefined, burned: number | null | undefined): number | null {
  if (supply == null || burned == null || !Number.isFinite(supply) || !Number.isFinite(burned)) return null
  return Math.max(0, supply - burned)
}

function eventFromRecord(record: PairRecord, detectedAt: string, kind: BurnKind): LpBurnEvent {
  const identity = parseIdentity(record)
  const tx = record.lpBurnTx ?? null
  const supply = record.lpSupply ?? null
  const burned = record.lpBurnedTokens ?? null
  return {
    id: burnEventId(record.address, tx),
    chainId: CHAIN_ID,
    pair: record.address.toLowerCase(),
    tokenAddress: record.tokenAddress.toLowerCase(),
    symbol: identity.symbol,
    tokenName: identity.tokenName,
    exchange: record.exchange,
    createdAt: record.created_at,
    detectedAt,
    burnAt: record.lpBurnAt ?? null,
    kind,
    lpBurntPercent: record.lpBurntPercent,
    lpSupply: supply,
    lpBurnedTokens: burned,
    lpRemaining: remainingLp(supply, burned),
    liquidity: record.liquidity ?? record.listingLiquidity,
    marketCap: record.marketCap,
    volume24h: record.volume24h ?? null,
    buys24h: record.buys24h ?? null,
    deployer: record.deployer ?? null,
    url: record.url,
    burnTx: tx && /^0x[0-9a-fA-F]{64}$/.test(tx) ? tx : null,
    burnBlock: record.lpBurnBlock ?? null,
    burnFrom: record.lpBurnFrom ?? null,
    logIndex: null,
    source: record.lpSource === "ethereum-transfer" ? "ethereum-transfer" : "dextools",
    percentKnown: record.lpBurntPercent > 0 || (supply != null && burned != null),
    burnTo: null,
  }
}

export function applyChainBurns(records: PairRecord[], burns: ChainBurn[]): PairRecord[] {
  const byPair = new Map<string, ChainBurn>()
  for (const burn of burns) {
    const current = byPair.get(burn.pair)
    if (!current || burn.burnedAt >= current.burnedAt) byPair.set(burn.pair, burn)
  }
  return records.map((record) => {
    const burn = byPair.get(record.address.toLowerCase())
    if (!burn || !isReportedBurn(burn.percent)) return record
    const percent = burn.percent
    const next: PairRecord = {
      ...record,
      lpBurnTx: burn.tx,
      lpBurnAt: burn.burnedAt,
      lpBurnBlock: burn.block,
      lpBurnFrom: burn.from,
      lpSource: "ethereum-transfer",
    }
    if (percent == null) return next
    const burned = percent > 0 && percent > (record.lpLockedPercent ?? 0)
    return {
      ...next,
      lpStatus: burned ? "burnt" : record.lpStatus,
      lpBurntPercent: percent,
      lpSupply: burn.supply,
      lpBurnedTokens: burn.burnedTokens,
    }
  })
}

function eventFromChain(record: PairRecord, burn: ChainBurn, detectedAt: string, kind: BurnKind): LpBurnEvent {
  const base = eventFromRecord(record, detectedAt, kind)
  return {
    ...base,
    id: burnEventId(burn.pair, burn.tx, burn.logIndex),
    burnAt: burn.burnedAt,
    burnTx: burn.tx,
    burnBlock: burn.block,
    burnFrom: burn.from,
    burnTo: burn.to,
    logIndex: burn.logIndex,
    source: "ethereum-transfer",
    lpBurntPercent: burn.percent ?? base.lpBurntPercent,
    percentKnown: burn.percent != null,
    lpSupply: burn.supply ?? base.lpSupply,
    lpBurnedTokens: burn.burnedTokens ?? base.lpBurnedTokens,
    lpRemaining: burn.supply != null && burn.burnedTokens != null ? Math.max(0, burn.supply - burn.burnedTokens) : base.lpRemaining,
  }
}

export function buildLpBurns(
  records: PairRecord[],
  previous: { rows?: PairRecord[]; lpBurns?: LpBurnEvent[]; generatedAt?: string } | null,
  scannedAt: string,
  chainBurns: ChainBurn[] = [],
): { events: LpBurnEvent[]; scan: LpScan } {
  const now = Date.parse(scannedAt)
  const previousRows = new Map((previous?.rows ?? []).map((row) => [row.address.toLowerCase(), row]))
  const recordsByPair = new Map(records.map((record) => [record.address.toLowerCase(), record]))
  const previousById = new Map<string, LpBurnEvent>()
  const previousByPair = new Map<string, LpBurnEvent[]>()
  for (const event of previous?.lpBurns ?? []) {
    if (!isIrreversibleBurnEvent(event)) continue
    previousById.set(event.id, event)
    const list = previousByPair.get(event.pair) ?? []
    list.push(event)
    previousByPair.set(event.pair, list)
  }

  const fresh: LpBurnEvent[] = []
  const seenIds = new Set<string>()
  const pairsWithChain = new Set<string>()
  let newBurns = 0
  let previouslyBurnedFound = 0
  let newPairs = 0
  let newestPairAt: string | null = null
  let highestCreationBlock: number | null = null

  for (const record of records) {
    const pair = record.address.toLowerCase()
    if (!previousRows.has(pair)) newPairs += 1
    if (record.created_at && (!newestPairAt || record.created_at > newestPairAt)) newestPairAt = record.created_at
    if (record.creationBlock != null && (highestCreationBlock == null || record.creationBlock > highestCreationBlock)) {
      highestCreationBlock = record.creationBlock
    }
  }

  for (const burn of chainBurns) {
    const record = recordsByPair.get(burn.pair)
    if (!record || !isReportedBurn(burn.percent)) continue
    pairsWithChain.add(burn.pair)
    const id = burnEventId(burn.pair, burn.tx, burn.logIndex)
    const stored = previousById.get(id)
    if (stored) {
      fresh.push({
        ...stored,
        burnAt: burn.burnedAt,
        burnTx: burn.tx,
        burnBlock: burn.block,
        burnFrom: burn.from,
        burnTo: burn.to,
        logIndex: burn.logIndex,
        source: "ethereum-transfer",
        lpBurntPercent: burn.percent ?? stored.lpBurntPercent,
        percentKnown: burn.percent != null || stored.percentKnown !== false,
      })
      seenIds.add(stored.id)
      continue
    }
    const placeholder = (previousByPair.get(burn.pair) ?? []).find((event) => !event.burnTx && !seenIds.has(event.id))
    if (placeholder) {
      fresh.push({ ...eventFromChain(record, burn, placeholder.detectedAt, placeholder.kind), id: placeholder.id })
      seenIds.add(placeholder.id)
      continue
    }
    const backfill = burn.detectionSource === "backfill"
    if (!backfill) newBurns += 1
    const created = eventFromChain(record, burn, scannedAt, backfill ? "previously-burned" : "newly-burned")
    created.detectionSource = backfill ? "backfill" : "live"
    fresh.push(created)
    seenIds.add(created.id)
  }

  for (const record of records) {
    if (watchStatus(record) !== "burned") continue
    const pair = record.address.toLowerCase()
    if (pairsWithChain.has(pair)) continue
    const existing = (previousByPair.get(pair) ?? []).find((event) => !seenIds.has(event.id))
    if (existing) {
      fresh.push(existing)
      seenIds.add(existing.id)
      continue
    }
    const prior = previousRows.get(pair)
    const kind: BurnKind = prior && watchStatus(prior) !== "burned" ? "newly-burned" : "previously-burned"
    if (kind === "newly-burned") newBurns += 1
    else previouslyBurnedFound += 1
    const created = eventFromRecord(record, scannedAt, kind)
    fresh.push(created)
    seenIds.add(created.id)
  }

  for (const event of previousById.values()) {
    if (seenIds.has(event.id)) continue
    if (event.source === "ethereum-transfer" && !isReportedBurn(event.lpBurntPercent)) continue
    const at = Date.parse(event.burnAt ?? event.detectedAt)
    if (Number.isFinite(at) && now - at <= EVENT_MAX_AGE_MS) fresh.push(event)
  }

  const events = fresh
    .sort((a, b) => (b.burnAt ?? b.detectedAt).localeCompare(a.burnAt ?? a.detectedAt))
    .slice(0, EVENT_MAX)

  return {
    events,
    scan: {
      scannedAt,
      previousScanAt: previous?.generatedAt ?? null,
      pairsChecked: records.length,
      newPairs,
      newBurns,
      previouslyBurnedFound,
      newestPairAt,
      highestCreationBlock,
    },
  }
}

/** A stored event whose from/to show a mint or a Uniswap liquidity removal is not a creator burn. */
export function isIrreversibleBurnEvent(event: { pair: string; burnFrom?: string | null; burnTo?: string | null }): boolean {
  if (!event.burnFrom || !event.burnTo) return true
  return classifyLpTransfer({ pair: event.pair, from: event.burnFrom, to: event.burnTo, amount: BigInt(1001) }) === "irreversible-burn"
}

export function eventsOf(snapshot: { rows: PairRecord[]; generatedAt: string; lpBurns?: LpBurnEvent[] }): LpBurnEvent[] {
  if (snapshot.lpBurns) return snapshot.lpBurns.filter(isIrreversibleBurnEvent)
  return buildLpBurns(snapshot.rows, null, snapshot.generatedAt).events.filter(isIrreversibleBurnEvent)
}

/** Pairs DEXTools marks burned by LP balance, plus chain burns whose burn time is in the window. */
export function burnedWatchRows(
  records: PairRecord[],
  events: LpBurnEvent[],
  start: number,
  end: number,
  maxPairAgeMs: number | null,
  now: number,
): LpBurnEvent[] {
  const listed = watchTableEvents(events, start, end, maxPairAgeMs, now)
  const seen = new Set(listed.map((event) => event.pair))
  const extra: LpBurnEvent[] = []
  for (const record of records) {
    const pair = record.address.toLowerCase()
    if (seen.has(pair)) continue
    if (watchStatus(record) !== "burned" && !(record.lpBurntPercent > 0)) continue
    const created = Date.parse(record.created_at)
    if (!Number.isFinite(created) || created < start || created > end) continue
    if (maxPairAgeMs != null) {
      const age = pairAgeMs(record.created_at, now)
      if (age == null || age < 0 || age > maxPairAgeMs) continue
    }
    extra.push(eventFromRecord(record, record.lpBurnAt ?? record.created_at, "previously-burned"))
    seen.add(pair)
  }
  return [...listed, ...extra]
}

export const INTERVAL_PRESETS = [
  { id: "1m", label: "1m", ms: 60_000 },
  { id: "5m", label: "5m", ms: 5 * 60_000 },
  { id: "15m", label: "15m", ms: 15 * 60_000 },
  { id: "30m", label: "30m", ms: 30 * 60_000 },
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "3h", label: "3h", ms: 3 * 60 * 60_000 },
  { id: "6h", label: "6h", ms: 6 * 60 * 60_000 },
  { id: "custom", label: "Custom", ms: null },
] as const

export const SEARCH_WINDOWS = [
  ...RANGES.map((item) => ({ id: item.id, label: `Last ${item.label.toLowerCase()}`, ms: item.ms })),
  { id: "custom" as const, label: "Custom range", ms: null },
]

export const PAIR_AGE_FILTERS = [
  { id: "any", label: "Any", ms: null },
  { id: "5m", label: "< 5m", ms: 5 * 60_000 },
  { id: "15m", label: "< 15m", ms: 15 * 60_000 },
  { id: "1h", label: "< 1h", ms: 60 * 60_000 },
  { id: "6h", label: "< 6h", ms: 6 * 60 * 60_000 },
  { id: "24h", label: "< 24h", ms: 24 * 60 * 60_000 },
  { id: "custom", label: "Custom", ms: null },
] as const

export type WatchConfig = {
  enabled: boolean
  paused: boolean
  realtime: boolean
  preset: (typeof INTERVAL_PRESETS)[number]["id"]
  customValue: number
  customUnit: "minutes" | "hours"
  windowId: (typeof SEARCH_WINDOWS)[number]["id"]
  customStart: string
  customEnd: string
  pairAgeId: (typeof PAIR_AGE_FILTERS)[number]["id"]
  pairAgeMinutes: number
  minBurnPercent: number
  minLiquidity: number
  maxPairAgeMinutes: number | null
  inApp: boolean
  browser: boolean
  sound: boolean
  soundId: AlertSound
  webhook: boolean
  webhookUrl: string
  telegram: boolean
  telegramUrl: string
}

export const DEFAULT_CONFIG: WatchConfig = {
  enabled: true,
  paused: false,
  realtime: false,
  preset: "1m",
  customValue: 3,
  customUnit: "minutes",
  windowId: "24h",
  customStart: "",
  customEnd: "",
  pairAgeId: "any",
  pairAgeMinutes: 60,
  minBurnPercent: 0,
  minLiquidity: 0,
  maxPairAgeMinutes: null,
  inApp: true,
  browser: false,
  sound: false,
  soundId: "beep",
  webhook: false,
  webhookUrl: "",
  telegram: false,
  telegramUrl: "",
}

export function customIntervalMs(value: number, unit: "minutes" | "hours"): { ms: number } | { error: string } {
  if (!Number.isInteger(value)) return { error: "Use a whole number." }
  if (value < 1) return { error: "The interval must be at least 1." }
  const ms = unit === "hours" ? value * 60 * 60_000 : value * 60_000
  if (ms < 60_000) return { error: "The interval must be at least 1 minute." }
  if (ms > 24 * 60 * 60_000) return { error: "The interval cannot be longer than 24 hours." }
  return { ms }
}

export function resolveInterval(config: WatchConfig): { ms: number; label: string } | { error: string } {
  if (config.preset !== "custom") {
    const preset = INTERVAL_PRESETS.find((item) => item.id === config.preset)
    if (!preset || preset.ms == null) return { error: "Unknown monitoring interval." }
    return { ms: preset.ms, label: `every ${preset.label === "1m" ? "1 minute" : preset.label}` }
  }
  const custom = customIntervalMs(config.customValue, config.customUnit)
  if ("error" in custom) return custom
  const unit = config.customUnit === "hours" ? (config.customValue === 1 ? "hour" : "hours") : config.customValue === 1 ? "minute" : "minutes"
  return { ms: custom.ms, label: `every ${config.customValue} ${unit}` }
}

export function intervalLabel(config: WatchConfig): string {
  const resolved = resolveInterval(config)
  return "error" in resolved ? resolved.error : resolved.label
}

export function pairAgeLimitMs(config: WatchConfig): number | null {
  if (config.pairAgeId === "any") return null
  if (config.pairAgeId === "custom") {
    if (!Number.isFinite(config.pairAgeMinutes) || config.pairAgeMinutes <= 0) return null
    return config.pairAgeMinutes * 60_000
  }
  return PAIR_AGE_FILTERS.find((item) => item.id === config.pairAgeId)?.ms ?? null
}

export function searchBounds(config: WatchConfig, now: number): { start: number; end: number } | { error: string } {
  if (config.windowId !== "custom") {
    const range = rangeById(config.windowId)
    return { start: now - range.ms, end: now }
  }
  const start = Date.parse(config.customStart)
  const end = Date.parse(config.customEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: "Choose a start and an end." }
  if (start >= end) return { error: "The start must be before the end." }
  if (end - start > 30 * 24 * 60 * 60_000) return { error: "A custom range cannot be longer than 30 days." }
  return { start, end }
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  const total = Math.round(ms / 1000)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function ago(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 45_000) return "Just now"
  return `${formatDuration(ms)} ago`
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export type LpStats = {
  pairs: number
  burned: number
  locked: number
  notBurned: number
  unknown: number
  rate: number | null
  averageDetectMs: number | null
  medianDetectMs: number | null
  timedBurns: number
  averageBurnMs: number | null
  medianBurnMs: number | null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function statsFor(records: PairRecord[], events: LpBurnEvent[], start: number, end: number): LpStats {
  const pairs = records.filter((record) => {
    const at = Date.parse(record.created_at)
    return Number.isFinite(at) && at >= start && at <= end
  })
  const counts = { burned: 0, locked: 0, notBurned: 0, unknown: 0 }
  for (const record of pairs) {
    const status = watchStatus(record)
    if (status === "burned") counts.burned += 1
    else if (status === "locked") counts.locked += 1
    else if (status === "not-burned") counts.notBurned += 1
    else counts.unknown += 1
  }
  const byPair = new Map(events.map((event) => [event.pair, event]))
  const detect: number[] = []
  const burn: number[] = []
  for (const record of pairs) {
    if (watchStatus(record) !== "burned") continue
    const event = byPair.get(record.address.toLowerCase())
    const created = Date.parse(record.created_at)
    if (!event || !Number.isFinite(created)) continue
    const detected = Date.parse(event.detectedAt)
    if (Number.isFinite(detected) && detected >= created) detect.push(detected - created)
    if (event.burnAt) {
      const burnedAt = Date.parse(event.burnAt)
      if (Number.isFinite(burnedAt) && burnedAt >= created) burn.push(burnedAt - created)
    }
  }
  return {
    pairs: pairs.length,
    burned: counts.burned,
    locked: counts.locked,
    notBurned: counts.notBurned,
    unknown: counts.unknown,
    rate: pairs.length ? counts.burned / pairs.length : null,
    averageDetectMs: average(detect),
    medianDetectMs: median(detect),
    timedBurns: burn.length,
    averageBurnMs: average(burn),
    medianBurnMs: median(burn),
  }
}

export function intervalBuckets(events: LpBurnEvent[], start: number, end: number, intervalMs: number): { start: number; end: number; count: number }[] {
  if (intervalMs < 60_000 || end <= start) return []
  const buckets: { start: number; end: number; count: number }[] = []
  const last = Math.floor(end / intervalMs) * intervalMs
  for (let cursor = last; cursor >= start && buckets.length < 12; cursor -= intervalMs) {
    buckets.push({ start: cursor, end: Math.min(end, cursor + intervalMs), count: 0 })
  }
  buckets.reverse()
  for (const event of events) {
    const at = burnTimeMs(event)
    if (at == null) continue
    const bucket = buckets.find((item) => at >= item.start && at < item.end)
    if (bucket) bucket.count += 1
  }
  return buckets
}

export type SurgeReport = {
  active: boolean
  current24h: number
  previous24h: number
  currentHour: number
  previousHour: number
  current6h: number
  previous6h: number
  dailyAverage7: number | null
  daysUsed7: number
  dailyAverage30: number | null
  daysUsed30: number
  increase7: number | null
  themes: { name: string; count: number }[]
  deployers: { address: string; count: number }[]
  exchanges: { name: string; count: number }[]
  liquidity: { label: string; count: number }[]
  note: string
}

function countBetween(events: LpBurnEvent[], start: number, end: number): number {
  return events.filter((event) => {
    const at = burnTimeMs(event)
    return at != null && at >= start && at < end
  }).length
}

function dailyAverage(events: LpBurnEvent[], now: number, days: number): { average: number | null; daysUsed: number } {
  const start = now - days * 24 * 60 * 60_000
  const present = new Set<string>()
  const counts = new Map<string, number>()
  for (const event of events) {
    const at = burnTimeMs(event)
    if (at == null || at < start || at > now) continue
    const day = new Date(at).toISOString().slice(0, 10)
    present.add(day)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  if (present.size < 2) return { average: null, daysUsed: present.size }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
  return { average: total / present.size, daysUsed: present.size }
}

function liquidityBand(value: number | null): string {
  if (value == null) return "Unknown liquidity"
  if (value < 10_000) return "Under $10k"
  if (value < 50_000) return "$10k–$50k"
  if (value < 200_000) return "$50k–$200k"
  return "$200k or more"
}

export function surgeReport(events: LpBurnEvent[], now: number): SurgeReport {
  const day = 24 * 60 * 60_000
  const current24h = countBetween(events, now - day, now + 1)
  const previous24h = countBetween(events, now - 2 * day, now - day)
  const currentHour = countBetween(events, now - 60 * 60_000, now + 1)
  const previousHour = countBetween(events, now - 2 * 60 * 60_000, now - 60 * 60_000)
  const current6h = countBetween(events, now - 6 * 60 * 60_000, now + 1)
  const previous6h = countBetween(events, now - 12 * 60 * 60_000, now - 6 * 60 * 60_000)
  const week = dailyAverage(events, now, 7)
  const month = dailyAverage(events, now, 30)
  const increase7 = week.average && week.average > 0 ? (current24h - week.average) / week.average : null
  const active = week.average != null && current24h >= 5 && current24h >= week.average * 3

  const recent = events.filter((event) => {
    const at = burnTimeMs(event)
    return at != null && at >= now - day && at <= now
  })
  const themes = new Map<string, number>()
  const deployers = new Map<string, number>()
  const exchanges = new Map<string, number>()
  const liquidity = new Map<string, number>()
  for (const event of recent) {
    for (const hit of matchConcepts(event.tokenName, event.symbol, null)) {
      themes.set(hit.label, (themes.get(hit.label) ?? 0) + 1)
    }
    if (event.deployer) deployers.set(event.deployer.toLowerCase(), (deployers.get(event.deployer.toLowerCase()) ?? 0) + 1)
    exchanges.set(event.exchange, (exchanges.get(event.exchange) ?? 0) + 1)
    const band = liquidityBand(event.liquidity)
    liquidity.set(band, (liquidity.get(band) ?? 0) + 1)
  }

  const ranked = (map: Map<string, number>, key: "name" | "address" | "label") =>
    [...map.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ [key]: value, count }) as { name: string; count: number } & { address: string; label: string })

  let note = "Not enough stored scans to compare with a 7-day average."
  if (week.average != null && !active) note = "The last 24 hours are within the recent daily range."
  if (active) note = "The last 24 hours are at least three times the recent daily average."

  return {
    active,
    current24h,
    previous24h,
    currentHour,
    previousHour,
    current6h,
    previous6h,
    dailyAverage7: week.average,
    daysUsed7: week.daysUsed,
    dailyAverage30: month.average,
    daysUsed30: month.daysUsed,
    increase7,
    themes: ranked(themes, "name"),
    deployers: ranked(deployers, "address"),
    exchanges: ranked(exchanges, "name"),
    liquidity: [...liquidity.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count })),
    note,
  }
}

export function launchGap(event: LpBurnEvent): { ms: number; source: "burn" | "detection" } | null {
  const created = Date.parse(event.createdAt)
  if (!Number.isFinite(created)) return null
  if (event.burnAt) {
    const burned = Date.parse(event.burnAt)
    if (Number.isFinite(burned) && burned >= created) return { ms: burned - created, source: "burn" }
  }
  const detected = Date.parse(event.detectedAt)
  if (Number.isFinite(detected) && detected >= created) return { ms: detected - created, source: "detection" }
  return null
}
