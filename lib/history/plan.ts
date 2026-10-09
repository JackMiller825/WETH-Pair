import { blocksForHours } from "@/lib/lp/burn-logic"
import { previousBounds } from "@/lib/time-range"

export const HISTORY_DAYS = 7
export const LIVE_LISTING_HOURS = 24
export const HISTORY_RETAIN_MS = 30 * 24 * 60 * 60 * 1000
export const HISTORY_CHUNK = 40
// One publish is allowed to keep scanning until the 7-day window is saved.
// The workflow waits instead of cancelling this run.
export const HISTORY_BUDGET_MS = 8 * 60 * 1000

export const HISTORY_SCOPE =
  "The newest 24 hours comes from the DEXTools live listing, which stops after about one day and includes every exchange that listing returns. Older WETH pairs are read from Uniswap V2 and SushiSwap PairCreated logs. A 3-day or 7-day count is partial until that backfill finishes."

export const PAIR_CREATED_TOPIC = "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9"
export const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

export const FACTORIES = [
  { address: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f", dex: "Uniswap V2" },
  { address: "0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac", dex: "SushiSwap" },
] as const

export type HistoryPhase = "recent" | "older" | "done"

export type HistoryJob = {
  id: "weth-pairs" | "lp-burns"
  status: "running" | "completed" | "failed"
  stage: string
  phase: HistoryPhase
  requestedDays: number
  recentStart: number
  recentEnd: number
  olderStart: number
  olderEnd: number
  cursor: number
  recentHold?: number | null
  olderCursor?: number
  blocksDone: number
  blocksTotal: number
  pairsFound: number
  burnsFound: number
  startedAt: string
  updatedAt: string
  error: string | null
}

export type BackfillState = {
  pairs: HistoryJob
  burns: HistoryJob
  scope: string
  providerNote: string | null
}

export function overallProgress(backfill: BackfillState | null | undefined): number | null {
  if (!backfill) return null
  const jobs = [backfill.pairs, backfill.burns]
  const total = jobs.reduce((sum, job) => sum + Math.max(0, job.blocksTotal), 0)
  if (total <= 0) return null
  if (jobs.every((job) => job.status === "completed" || job.phase === "done")) return 100
  const done = jobs.reduce((sum, job) => sum + Math.max(0, Math.min(job.blocksDone, job.blocksTotal)), 0)
  return Math.max(0, Math.min(99, Math.floor((done / total) * 100)))
}

export function jobProgress(job: HistoryJob | null | undefined): number | null {
  if (!job || job.blocksTotal <= 0) return null
  if (job.status === "completed" || job.phase === "done") return 100
  const ratio = job.blocksDone / job.blocksTotal
  return Math.max(0, Math.min(99, Math.floor(ratio * 100)))
}

export function jobEtaMs(job: HistoryJob | null | undefined, now: number): number | null {
  if (!job || job.status !== "running" || job.blocksDone < HISTORY_CHUNK) return null
  const elapsed = now - Date.parse(job.startedAt)
  if (!Number.isFinite(elapsed) || elapsed < 20_000) return null
  const left = job.blocksTotal - job.blocksDone
  if (left <= 0) return 0
  return Math.round((left / job.blocksDone) * elapsed)
}

export function openHistoryJob(id: HistoryJob["id"], head: number, nowIso: string, previous: HistoryJob | null | undefined): HistoryJob {
  if (previous && (previous.status === "running" || previous.status === "failed" || previous.status === "completed")) {
    if (previous.status === "completed" || previous.phase === "done") return { ...previous, status: "completed", phase: "done" }
    return { ...previous, status: "running", error: null }
  }
  const recentEnd = head - blocksForHours(LIVE_LISTING_HOURS)
  const recentStart = head - blocksForHours(72)
  const olderEnd = recentStart
  const olderStart = head - blocksForHours(HISTORY_DAYS * 24)
  const blocksTotal = Math.max(0, recentEnd - recentStart) + Math.max(0, olderEnd - olderStart)
  return {
    id,
    status: blocksTotal === 0 ? "completed" : "running",
    stage: blocksTotal === 0 ? "No historical blocks to scan" : "Scanning Ethereum for WETH pairs older than the live listing",
    phase: blocksTotal === 0 ? "done" : "recent",
    requestedDays: HISTORY_DAYS,
    recentStart,
    recentEnd,
    olderStart,
    olderEnd,
    cursor: recentStart,
    blocksDone: 0,
    blocksTotal,
    pairsFound: 0,
    burnsFound: 0,
    startedAt: nowIso,
    updatedAt: nowIso,
    error: null,
  }
}

export function focusOlderGap(job: HistoryJob): HistoryJob {
  const olderCursor = job.olderCursor ?? job.olderStart
  if (job.phase !== "recent" || job.blocksDone < 1500 || olderCursor >= job.olderEnd) {
    return { ...job, olderCursor }
  }
  return { ...job, phase: "older", recentHold: job.cursor, cursor: olderCursor, olderCursor }
}

export function advanceJob(job: HistoryJob, nextCursor: number, nowIso: string, stage: string): HistoryJob {
  const moved = Math.max(0, nextCursor - job.cursor)
  let phase = job.phase
  let cursor = nextCursor
  let recentHold = job.recentHold ?? null
  let olderCursor = job.olderCursor ?? job.olderStart
  if (phase === "recent" && cursor >= job.recentEnd) {
    phase = "older"
    cursor = olderCursor
  }
  if (phase === "older") olderCursor = cursor
  if (phase === "older" && cursor >= job.olderEnd) {
    if (recentHold != null && recentHold < job.recentEnd) {
      phase = "recent"
      cursor = recentHold
      recentHold = null
    } else {
      phase = "done"
      cursor = job.olderEnd
    }
  }
  const done = phase === "done"
  return {
    ...job,
    phase,
    cursor,
    recentHold,
    olderCursor,
    blocksDone: Math.min(job.blocksTotal, job.blocksDone + moved),
    status: done ? "completed" : "running",
    stage: done ? "Historical scan complete" : stage,
    updatedAt: nowIso,
    error: null,
  }
}

export function currentSlice(job: HistoryJob, maxBlocks: number): { from: number; to: number } | null {
  if (job.phase === "done" || job.status === "completed") return null
  const end = job.phase === "recent" ? job.recentEnd : job.olderEnd
  if (job.cursor >= end) return null
  const to = Math.min(end - 1, job.cursor + maxBlocks - 1)
  if (to < job.cursor) return null
  return { from: job.cursor, to }
}

export type CreatedPairLog = {
  factory: string
  token0: string
  token1: string
  pair: string
  block: number
}

export function parsePairCreated(log: { address?: string; topics?: string[]; data?: string; blockNumber?: string }): CreatedPairLog | null {
  const topics = log.topics ?? []
  if ((topics[0] ?? "").toLowerCase() !== PAIR_CREATED_TOPIC) return null
  const token0 = topicAddress(topics[1])
  const token1 = topicAddress(topics[2])
  const pair = wordAddress(log.data)
  const block = Number.parseInt(log.blockNumber ?? "", 16)
  const factory = (log.address ?? "").toLowerCase()
  if (!token0 || !token1 || !pair || !Number.isInteger(block) || !factory) return null
  return { factory, token0, token1, pair, block }
}

export function wethSide(token0: string, token1: string): { weth: "token0" | "token1"; token: string } | null {
  const left = token0.toLowerCase()
  const right = token1.toLowerCase()
  if (left === WETH) return { weth: "token0", token: right }
  if (right === WETH) return { weth: "token1", token: left }
  return null
}

/** First row wins, so a live listing is kept when a backfill sees the same pair. */
export function mergeRecords<T extends { address: string }>(current: T[], extra: T[]): T[] {
  const map = new Map(current.map((row) => [row.address.toLowerCase(), row]))
  for (const row of extra) {
    const key = row.address.toLowerCase()
    if (!map.has(key)) map.set(key, row)
  }
  return [...map.values()]
}

/** Rate-limit waits and retries. Oversized log replies shrink the chunk. Anything else stops the scan. */
export function classifyRpcFailure(message: string): "rate-limit" | "shrink" | "fatal" {
  if (/429|rate limit|too many requests/i.test(message)) return "rate-limit"
  if (/too many|10000|exceed|response size|log limit|more than/i.test(message)) return "shrink"
  return "fatal"
}

export function dexForFactory(factory: string): string | null {
  return FACTORIES.find((item) => item.address === factory.toLowerCase())?.dex ?? null
}

function topicAddress(topic: string | undefined): string | null {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null
  return `0x${topic.slice(-40).toLowerCase()}`
}

function wordAddress(data: string | undefined): string | null {
  if (!data || !data.startsWith("0x") || data.length < 66) return null
  return `0x${data.slice(26, 66).toLowerCase()}`
}

export function decodeCallResult(hex: string | null | undefined): string | null {
  if (!hex || hex === "0x" || !hex.startsWith("0x")) return null
  const body = hex.slice(2)
  if (body.length === 64) return cleanText(body)
  if (body.length < 128) return null
  const length = Number.parseInt(body.slice(64, 128), 16)
  if (!Number.isInteger(length) || length <= 0 || length > 128) return null
  return cleanText(body.slice(128, 128 + length * 2))
}

function cleanText(hex: string): string | null {
  const bytes = []
  for (let index = 0; index < hex.length; index += 2) bytes.push(Number.parseInt(hex.slice(index, index + 2), 16))
  const text = String.fromCharCode(...bytes.filter((item) => item > 0)).replace(/[^\x20-\x7e]/g, "").trim()
  return text || null
}

export function countsByAge(times: number[], now: number): Record<"1h" | "6h" | "12h" | "24h" | "3d" | "7d", { count: number; oldest: number | null }> {
  const windows = { "1h": 60 * 60 * 1000, "6h": 6 * 60 * 60 * 1000, "12h": 12 * 60 * 60 * 1000, "24h": 24 * 60 * 60 * 1000, "3d": 3 * 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000 }
  const result = {} as Record<"1h" | "6h" | "12h" | "24h" | "3d" | "7d", { count: number; oldest: number | null }>
  for (const [id, span] of Object.entries(windows) as [keyof typeof windows, number][]) {
    const inside = times.filter((time) => time >= now - span && time <= now).sort((a, b) => a - b)
    result[id] = { count: inside.length, oldest: inside[0] ?? null }
  }
  return result
}

export function inCustomRange(time: number, start: number, end: number): boolean {
  return time >= start && time < end
}

export function comparisonReady(oldestAt: number | null, range: string, now: number): boolean {
  if (oldestAt == null) return false
  return oldestAt <= previousBounds(range, now).start
}

export function coverageText(oldestAt: number | null, requestedMs: number, job: HistoryJob | null | undefined, now: number): string | null {
  if (job?.status === "completed") {
    if (oldestAt != null && now - oldestAt + 60_000 < requestedMs) {
      return `This range asks for ${formatSpan(requestedMs)}. The oldest stored record is ${formatSpan(now - oldestAt)} old. There is no older pair inside the Uniswap V2 and SushiSwap backfill.`
    }
    return null
  }
  const available = oldestAt == null ? 0 : now - oldestAt
  if (available + 60_000 >= requestedMs && job == null) return null
  const percent = jobProgress(job)
  return `Partial history. Requested ${formatSpan(requestedMs)}. Oldest stored record ${oldestAt == null ? "is not in the dataset yet" : `is ${formatSpan(available)} old`}. Backfill ${percent == null ? "is starting" : `${percent}%`}.`
}

function formatSpan(ms: number): string {
  const hours = Math.max(0, Math.round(ms / (60 * 60 * 1000)))
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}
