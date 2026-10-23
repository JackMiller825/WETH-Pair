/** Rolling launch-market counts. Pure functions: nothing here runs on the LP burn path. */

export const COUNT_WINDOWS = [
  { id: "1h", label: "1H", ms: 60 * 60 * 1000 },
  { id: "6h", label: "6H", ms: 6 * 60 * 60 * 1000 },
  { id: "12h", label: "12H", ms: 12 * 60 * 60 * 1000 },
  { id: "24h", label: "24H", ms: 24 * 60 * 60 * 1000 },
] as const

export type CountWindowId = (typeof COUNT_WINDOWS)[number]["id"]

export const CHART_RANGES = [
  { id: "6h", label: "6H", ms: 6 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  { id: "12h", label: "12H", ms: 12 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  { id: "24h", label: "24H", ms: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  { id: "3d", label: "3D", ms: 3 * 24 * 60 * 60 * 1000, bucketMs: 3 * 60 * 60 * 1000 },
  { id: "7d", label: "7D", ms: 7 * 24 * 60 * 60 * 1000, bucketMs: 6 * 60 * 60 * 1000 },
] as const

export type ChartRangeId = (typeof CHART_RANGES)[number]["id"]

/** Standard gas, in gwei, at or below these levels. Shown in Help and in the condition detail. */
export const GAS_SCORE_GWEI = { veryLow: 0.15, low: 1, moderate: 8, high: 30 } as const

export type ActivityLevel = "surging" | "rising" | "steady" | "slowing" | "quiet"

export const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  surging: "Very Active",
  rising: "Increasing",
  steady: "Normal",
  slowing: "Slowing",
  quiet: "Quiet",
}

export type ConditionBand = "very-active" | "active" | "mixed" | "quiet" | "very-quiet"

export const CONDITION_LABEL: Record<ConditionBand, string> = {
  "very-active": "Very Active",
  active: "Active",
  mixed: "Mixed",
  quiet: "Quiet",
  "very-quiet": "Very Quiet",
}

export type ActivityBucket = { start: number; end: number; count: number; change: number | null }

export type WindowStat = { id: CountWindowId; label: string; current: number; previous: number; change: number | null }

/** Age is measured from `now`. An event exactly one span old still counts; one millisecond older does not. */
export function inRollingWindow(at: number, now: number, spanMs: number): boolean {
  if (!Number.isFinite(at) || !Number.isFinite(now) || spanMs < 0) return false
  const age = now - at
  return age >= 0 && age <= spanMs
}

export function inPreviousWindow(at: number, now: number, spanMs: number): boolean {
  if (!Number.isFinite(at) || !Number.isFinite(now) || spanMs < 0) return false
  const age = now - at
  return age > spanMs && age <= spanMs * 2
}

export function rollingCount(times: readonly number[], now: number, spanMs: number): number {
  let count = 0
  for (const at of times) if (inRollingWindow(at, now, spanMs)) count += 1
  return count
}

export function previousCount(times: readonly number[], now: number, spanMs: number): number {
  let count = 0
  for (const at of times) if (inPreviousWindow(at, now, spanMs)) count += 1
  return count
}

/** Equal-length previous window. Null when the previous window is empty and this one is not, so nothing divides by zero. */
export function periodChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

export function windowStats(times: readonly number[], now: number): WindowStat[] {
  return COUNT_WINDOWS.map((window) => {
    const current = rollingCount(times, now, window.ms)
    const previous = previousCount(times, now, window.ms)
    return { id: window.id, label: window.label, current, previous, change: periodChange(current, previous) }
  })
}

/** One timestamp per key. The earliest finite time wins, so a later enrichment cannot move a creation time. */
export function earliestTimes(entries: readonly { key: string; at: number }[]): number[] {
  const seen = new Map<string, number>()
  for (const entry of entries) {
    if (!Number.isFinite(entry.at)) continue
    const prev = seen.get(entry.key)
    if (prev == null || entry.at < prev) seen.set(entry.key, entry.at)
  }
  return [...seen.values()]
}

export function chartRange(id: string): (typeof CHART_RANGES)[number] {
  return CHART_RANGES.find((item) => item.id === id) ?? CHART_RANGES[2]
}

/** Real buckets only. Empty hours stay zero. Nothing is interpolated. */
export function activitySeries(times: readonly number[], now: number, spanMs: number, bucketMs: number): ActivityBucket[] {
  if (!(bucketMs > 0) || !(spanMs > 0)) return []
  const endBucket = Math.floor(now / bucketMs) * bucketMs
  const first = Math.floor((now - spanMs) / bucketMs) * bucketMs
  const buckets: ActivityBucket[] = []
  for (let start = first; start <= endBucket; start += bucketMs) buckets.push({ start, end: start + bucketMs, count: 0, change: null })
  for (const at of times) {
    if (!inRollingWindow(at, now, spanMs)) continue
    const index = Math.floor((at - first) / bucketMs)
    if (index >= 0 && index < buckets.length) buckets[index].count += 1
  }
  for (let index = 0; index < buckets.length; index += 1) {
    const previous = index === 0 ? 0 : buckets[index - 1].count
    buckets[index].change = index === 0 ? null : periodChange(buckets[index].count, previous)
  }
  return buckets
}

/**
 * Current hour against the previous hour and, when known, the average of that same clock hour
 * on earlier days. Thresholds: 1.8× the baseline (and ahead of the previous hour) is Very Active;
 * 1.15× the previous hour is Increasing; 0.75× or below is Slowing; under 0.4× the baseline is Quiet.
 */
export function activityState(current: number, previous: number, baseline: number | null): ActivityLevel {
  if (current === 0 && previous === 0 && !(baseline != null && baseline >= 1)) return "quiet"
  const aheadOfPrevious = previous > 0 && current >= previous * 1.8
  const aheadOfBaseline = baseline != null && baseline > 0 && current >= baseline * 1.8 && current > previous
  if (aheadOfBaseline || (aheadOfPrevious && (baseline == null || current >= baseline))) return "surging"
  if (previous > 0 && current >= previous * 1.15) return "rising"
  if (previous === 0 && current > 0 && (baseline == null || current >= baseline)) return "rising"
  if (baseline != null && baseline > 0 && current < baseline * 0.4 && current <= previous) return "quiet"
  if (previous > 0 && current <= previous * 0.75) return "slowing"
  if (current === 0) return "quiet"
  return "steady"
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>()

function hourFormatter(zone: string): Intl.DateTimeFormat {
  const existing = hourFormatters.get(zone)
  if (existing) return existing
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }
  let created: Intl.DateTimeFormat
  try {
    created = new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone })
  } catch {
    created = hourFormatters.get("UTC") ?? new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" })
    hourFormatters.set("UTC", created)
  }
  hourFormatters.set(zone, created)
  return created
}

export function hourParts(at: number, zone: string): { key: string; hour: number; weekday: string } {
  const parts = hourFormatter(zone).formatToParts(new Date(at))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
  let hour = Number(get("hour"))
  if (!Number.isFinite(hour)) hour = 0
  if (hour === 24) hour = 0
  return { key: `${get("year")}-${get("month")}-${get("day")}`, hour, weekday: get("weekday") }
}

const partCache = new Map<string, { key: string; hour: number; weekday: string }>()

function cachedParts(zone: string): (at: number) => { key: string; hour: number; weekday: string } {
  return (at: number) => {
    const minute = Math.floor(at / 60_000)
    const id = `${zone}:${minute}`
    const hit = partCache.get(id)
    if (hit) return hit
    const value = hourParts(minute * 60_000, zone)
    if (partCache.size > 20_000) partCache.clear()
    partCache.set(id, value)
    return value
  }
}

function dayKeysBefore(now: number, zone: string, days: number): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  const today = hourParts(now, zone).key
  for (let step = 1; step <= days + 1 && keys.length < days; step += 1) {
    const key = hourParts(now - step * 24 * 60 * 60 * 1000, zone).key
    if (key === today || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

/** Mean count in the same clock hour on the previous days. The current, unfinished hour is left out. */
export function typicalHour(times: readonly number[], now: number, zone: string, days = 7): number | null {
  const parts = cachedParts(zone)
  const hour = parts(now).hour
  const keys = dayKeysBefore(now, zone, days)
  if (keys.length === 0) return null
  const oldest = now - (days + 1) * 24 * 60 * 60 * 1000
  const counts = new Map<string, number>()
  for (const at of times) {
    if (at > now || at < oldest) continue
    const part = parts(at)
    if (part.hour !== hour) continue
    counts.set(part.key, (counts.get(part.key) ?? 0) + 1)
  }
  let sum = 0
  for (const key of keys) sum += counts.get(key) ?? 0
  return sum / keys.length
}

export type HeatCell = { key: string; weekday: string; hours: number[] }

/** Seven local days by hour. Changing the zone moves events between columns; it does not drop them. */
export function heatmap(times: readonly number[], now: number, zone: string, days = 7): HeatCell[] {
  const parts = cachedParts(zone)
  const keys = [...dayKeysBefore(now, zone, days - 1)].reverse()
  const today = parts(now)
  keys.push(today.key)
  const grid = new Map<string, number[]>()
  const weekday = new Map<string, string>()
  weekday.set(today.key, today.weekday)
  for (const key of keys) grid.set(key, Array.from({ length: 24 }, () => 0))
  for (const at of times) {
    if (at > now) continue
    const part = parts(at)
    weekday.set(part.key, part.weekday)
    const row = grid.get(part.key)
    if (row) row[part.hour] += 1
  }
  return keys.map((key) => ({
    key,
    weekday: weekday.get(key) ?? parts(Date.parse(`${key}T12:00:00Z`)).weekday,
    hours: grid.get(key) ?? Array.from({ length: 24 }, () => 0),
  }))
}

export function hourSpanLabel(hour: number): string {
  const fmt = (value: number) => {
    const normalized = ((value % 24) + 24) % 24
    const suffix = normalized < 12 ? "AM" : "PM"
    const clock = normalized % 12 === 0 ? 12 : normalized % 12
    return `${clock} ${suffix}`
  }
  return `${fmt(hour)} – ${fmt(hour + 1)}`
}

export type ActiveHour = { hour: number; label: string; total: number }

/** Hours with the most events over the recent days. This is history, not a forecast. */
export function activeHours(times: readonly number[], now: number, zone: string, days = 7, limit = 3): ActiveHour[] {
  const parts = cachedParts(zone)
  const totals = Array.from({ length: 24 }, () => 0)
  const oldest = now - days * 24 * 60 * 60 * 1000
  for (const at of times) {
    if (at > now || at < oldest) continue
    totals[parts(at).hour] += 1
  }
  return totals
    .map((total, hour) => ({ hour, label: hourSpanLabel(hour), total }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total || a.hour - b.hour)
    .slice(0, limit)
}

/** LP burn events in a window divided by pair launches in that same window. An activity ratio, not a cohort rate. */
export function activityRatio(launches: number, burns: number): number | null {
  if (!(launches > 0) || burns < 0) return null
  return (burns / launches) * 100
}

/**
 * Of pairs created in the previous equal window, the share that have a confirmed burn.
 * They have had one full window in which to burn, so a burn an hour after launch still counts.
 */
export function cohortBurnRate(pairs: readonly { createdAt: number; burned: boolean }[], now: number, spanMs: number): { launched: number; burned: number; rate: number | null } {
  let launched = 0
  let burned = 0
  for (const pair of pairs) {
    if (!inPreviousWindow(pair.createdAt, now, spanMs)) continue
    launched += 1
    if (pair.burned) burned += 1
  }
  return { launched, burned, rate: launched === 0 ? null : (burned / launched) * 100 }
}

export type Distribution = { n: number; median: number; p25: number; p75: number; p90: number; above12: number; above15: number; above2: number }

function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const index = (sorted.length - 1) * p
  const low = Math.floor(index)
  const high = Math.ceil(index)
  if (low === high) return sorted[low]
  return sorted[low] * (high - index) + sorted[high] * (index - low)
}

/** Share of a cohort at or above each multiple. Empty input is null, not a zero success rate. */
export function performanceDistribution(multiples: readonly number[]): Distribution | null {
  const values = multiples.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (values.length === 0) return null
  const share = (floor: number) => values.filter((value) => value >= floor).length / values.length
  return { n: values.length, median: quantile(values, 0.5), p25: quantile(values, 0.25), p75: quantile(values, 0.75), p90: quantile(values, 0.9), above12: share(1.2), above15: share(1.5), above2: share(2) }
}

/** Pairs old enough to have reached `afterMs`, and the share with a timed trade at or after that age. */
export function stillTrading(pairs: readonly { createdAt: number; lastTradeAt: number | null }[], now: number, afterMs: number, cohortMs: number): { eligible: number; active: number; rate: number | null } {
  let eligible = 0
  let active = 0
  for (const pair of pairs) {
    const age = now - pair.createdAt
    if (age < afterMs || age > cohortMs) continue
    eligible += 1
    if (pair.lastTradeAt != null && pair.lastTradeAt >= pair.createdAt + afterMs) active += 1
  }
  return { eligible, active, rate: eligible === 0 ? null : (active / eligible) * 100 }
}

/** Sum of (latest reserve − earliest reserve) inside the window. Null when no pair has two samples. */
export function reserveChange(series: readonly (readonly { at: number; weth: number }[])[], start: number, end: number): number | null {
  let total = 0
  let used = 0
  for (const samples of series) {
    const inside = samples.filter((sample) => sample.at >= start && sample.at <= end && Number.isFinite(sample.weth)).sort((a, b) => a.at - b.at)
    if (inside.length < 2) continue
    total += inside[inside.length - 1].weth - inside[0].weth
    used += 1
  }
  return used === 0 ? null : total
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—"
  const sign = value < 0 ? "-" : ""
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`
  return `${sign}${Math.round(abs).toLocaleString("en-US")}`
}

export function formatDelta(current: number, previous: number): string {
  const change = periodChange(current, previous)
  if (change == null) return current > 0 ? "new" : "0%"
  const rounded = Math.round(change * 10) / 10
  if (Object.is(rounded, -0) || rounded === 0) return "0%"
  return `${rounded > 0 ? "+" : ""}${rounded}%`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 1.0× baseline maps near the middle. A zero baseline with new activity is active, not infinite. */
export function paceScore(current: number, previous: number, baseline: number | null): number {
  const reference = baseline != null && baseline > 0 ? baseline : previous
  if (current === 0 && reference <= 0) return 12
  if (reference <= 0) return 72
  return clamp(Math.round(18 + (current / reference) * 38), 0, 100)
}

export function gasCondition(gwei: number): { score: number; label: string } {
  if (!Number.isFinite(gwei) || gwei < 0) return { score: 0, label: "Unknown" }
  if (gwei <= GAS_SCORE_GWEI.veryLow) return { score: 96, label: "Very Low" }
  if (gwei <= GAS_SCORE_GWEI.low) return { score: 82, label: "Low" }
  if (gwei <= GAS_SCORE_GWEI.moderate) return { score: 58, label: "Moderate" }
  if (gwei <= GAS_SCORE_GWEI.high) return { score: 32, label: "High" }
  return { score: 12, label: "Very High" }
}

/** Large moves in either direction lower the score. A missing change is left out, not treated as zero. */
export function ethStability(change1h: number | null, change24h: number | null): number | null {
  if (change1h == null && change24h == null) return null
  const penalty = Math.abs(change1h ?? 0) * 20 + Math.abs(change24h ?? 0) * 2
  return clamp(Math.round(100 - penalty), 0, 100)
}

export function momentumScore(median: number | null, above12: number | null): number | null {
  if (median == null && above12 == null) return null
  const fromMedian = median == null ? null : clamp(Math.round(50 + (median - 1) * 80), 0, 100)
  const fromShare = above12 == null ? null : clamp(Math.round(above12 * 100), 0, 100)
  if (fromMedian == null) return fromShare
  if (fromShare == null) return fromMedian
  return clamp(Math.round(fromMedian * 0.7 + fromShare * 0.3), 0, 100)
}

export type ScoreInput = {
  pairs1h: number
  pairsPrevious: number
  pairsBaseline: number | null
  burns1h: number
  burnsPrevious: number
  burnsBaseline: number | null
  tx1h: number
  txPrevious: number
  txBaseline: number | null
  netWeth: number | null
  medianMultiple: number | null
  above12Share: number | null
  gasGwei: number | null
  eth1h: number | null
  eth24h: number | null
}

export type ScorePart = { id: string; label: string; score: number; weight: number }

export type ScoreResult = { score: number; band: ConditionBand; parts: ScorePart[]; gasLabel: string | null; read: string }

const WEIGHTS: { id: string; label: string; weight: number }[] = [
  { id: "pairs", label: "Pair activity", weight: 20 },
  { id: "burns", label: "LP burn activity", weight: 12 },
  { id: "tx", label: "Trader activity", weight: 18 },
  { id: "weth", label: "Liquidity activity", weight: 10 },
  { id: "momentum", label: "Recent token momentum", weight: 14 },
  { id: "gas", label: "Gas conditions", weight: 16 },
  { id: "eth", label: "ETH stability", weight: 10 },
]

function bandOf(score: number): ConditionBand {
  if (score >= 85) return "very-active"
  if (score >= 70) return "active"
  if (score >= 50) return "mixed"
  if (score >= 30) return "quiet"
  return "very-quiet"
}

function conditionRead(parts: ScorePart[], gasLabel: string | null): string {
  const byId = new Map(parts.map((part) => [part.id, part.score]))
  const notes: string[] = []
  const pairs = byId.get("pairs")
  const tx = byId.get("tx")
  const burns = byId.get("burns")
  if (pairs != null && pairs >= 70) notes.push("pair launches are above their recent baseline")
  else if (pairs != null && pairs <= 35) notes.push("pair launches are below their recent baseline")
  if (burns != null && burns >= 70) notes.push("LP burn activity is elevated")
  if (tx != null && tx >= 70) notes.push("tracked swap activity is above its recent baseline")
  else if (tx != null && tx <= 35) notes.push("tracked swap activity is quiet")
  if (gasLabel === "Very Low" || gasLabel === "Low") notes.push("gas remains low")
  else if (gasLabel === "High" || gasLabel === "Very High") notes.push("gas is expensive")
  if (notes.length === 0) {
    if (parts.every((part) => part.score <= 20)) return "Pair launches, LP burns, and tracked swaps are quiet in the last hour."
    return "Launch activity is close to its recent baseline."
  }
  const sentence = notes.join(", ")
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

/** Same inputs always return the same score. The sentence is a template over those parts. */
export function launchScore(input: ScoreInput): ScoreResult {
  const gas = input.gasGwei == null ? null : gasCondition(input.gasGwei)
  const eth = ethStability(input.eth1h, input.eth24h)
  const momentum = momentumScore(input.medianMultiple, input.above12Share)
  const weth = input.netWeth == null ? null : clamp(Math.round(50 + input.netWeth / 2), 0, 100)
  const raw: Record<string, number | null> = {
    pairs: paceScore(input.pairs1h, input.pairsPrevious, input.pairsBaseline),
    burns: paceScore(input.burns1h, input.burnsPrevious, input.burnsBaseline),
    tx: paceScore(input.tx1h, input.txPrevious, input.txBaseline),
    weth,
    momentum,
    gas: gas?.score ?? null,
    eth,
  }
  const present = WEIGHTS.filter((item) => raw[item.id] != null)
  const weight = present.reduce((sum, item) => sum + item.weight, 0)
  const parts: ScorePart[] = present.map((item) => ({ id: item.id, label: item.label, score: raw[item.id] as number, weight: item.weight }))
  const score = weight === 0 ? 0 : clamp(Math.round(parts.reduce((sum, part) => sum + part.score * part.weight, 0) / weight), 0, 100)
  return { score, band: bandOf(score), parts, gasLabel: gas?.label ?? null, read: conditionRead(parts, gas?.label ?? null) }
}

export type ActivityCandidate = {
  pair: string
  token: string
  name: string
  symbol: string
  url: string
  tx: number
  buys: number | null
  sells: number | null
  traders: number | null
  pooledWeth: number | null
  holders: number | null
  volumeUsd: number | null
  percent: number | null
}

export type ActivityRank = ActivityCandidate & { rank: number; density: number | null }

export type ActivitySort = "tx" | "volume" | "weth" | "holders"

function activityValue(row: ActivityCandidate, sort: ActivitySort): number {
  if (sort === "tx") return row.tx
  if (sort === "volume") return row.volumeUsd ?? -1
  if (sort === "weth") return row.pooledWeth ?? -1
  return row.holders ?? -1
}

/** Descending by the selected field. Ties break on pooled WETH, then volume, then pair address. */
export function rankActivity(rows: readonly ActivityCandidate[], sort: ActivitySort, limit: number): ActivityRank[] {
  const ordered = [...rows].sort((a, b) => activityValue(b, sort) - activityValue(a, sort) || (b.pooledWeth ?? 0) - (a.pooledWeth ?? 0) || (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0) || a.pair.localeCompare(b.pair))
  return ordered.slice(0, Math.max(0, limit)).map((row, index) => ({
    ...row,
    rank: index + 1,
    density: row.traders != null && row.traders > 0 ? row.tx / row.traders : null,
  }))
}

/** Timed swaps inside [start, end]. The same pair and log id counts once. Bulk backfill rows have no trade time. */
export function swapsInWindow(swaps: readonly { pair: string; id: string; seenAt: number; bulk: boolean }[], start: number, end: number): Map<string, number> {
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const swap of swaps) {
    if (swap.bulk || swap.seenAt < start || swap.seenAt > end) continue
    const key = `${swap.pair}:${swap.id}`
    if (seen.has(key)) continue
    seen.add(key)
    counts.set(swap.pair, (counts.get(swap.pair) ?? 0) + 1)
  }
  return counts
}

export type ConditionPoint = { hour: number; score: number; pairs: number; burns: number; tx: number; gas: number | null }

const CONDITION_HISTORY_KEY = "weth-condition-history"

/** Hourly readings kept in this browser. Missing hours stay missing. */
export function readConditionHistory(): ConditionPoint[] {
  if (typeof localStorage === "undefined") return []
  try {
    const parsed = JSON.parse(localStorage.getItem(CONDITION_HISTORY_KEY) ?? "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter((row): row is ConditionPoint => !!row && Number.isFinite(row.hour) && Number.isFinite(row.score))
  } catch {
    return []
  }
}

export function recordConditionHistory(now: number, point: Omit<ConditionPoint, "hour">): ConditionPoint[] {
  if (typeof localStorage === "undefined") return []
  const hour = Math.floor(now / 3_600_000)
  const next = readConditionHistory().filter((row) => row.hour !== hour && row.hour >= hour - 168)
  next.push({ hour, score: point.score, pairs: point.pairs, burns: point.burns, tx: point.tx, gas: point.gas })
  next.sort((a, b) => a.hour - b.hour)
  const kept = next.slice(-169)
  localStorage.setItem(CONDITION_HISTORY_KEY, JSON.stringify(kept))
  return kept
}
