/** Display windows. These never control how often the chain is scanned. */
export const RANGES = [
  { id: "5m", label: "5 minutes", ms: 5 * 60 * 1000 },
  { id: "15m", label: "15 minutes", ms: 15 * 60 * 1000 },
  { id: "30m", label: "30 minutes", ms: 30 * 60 * 1000 },
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "3h", label: "3 hours", ms: 3 * 60 * 60 * 1000 },
  { id: "6h", label: "6 hours", ms: 6 * 60 * 60 * 1000 },
  { id: "12h", label: "12 hours", ms: 12 * 60 * 60 * 1000 },
  { id: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { id: "3d", label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
] as const

export type TimeRangeId = (typeof RANGES)[number]["id"]

const NAMED = new Map<string, (typeof RANGES)[number]>(RANGES.map((item) => [item.id, item]))

/** Custom durations longer than this are rejected. They are not rewritten as 24h or 7d. */
export const MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Named ranges win before the custom pattern, so "24h" stays 24 hours.
 * Unknown text is an error. It is never replaced with 1h or 24h.
 */
export function parseRange(id: string): { ok: true; id: string; label: string; ms: number } | { ok: false; error: string } {
  const trimmed = id.trim()
  const named = NAMED.get(trimmed)
  if (named) return { ok: true, id: named.id, label: named.label, ms: named.ms }
  const match = /^(\d+)(m|h|d)$/.exec(trimmed)
  if (!match) return { ok: false, error: "Invalid time range" }
  const amount = Number(match[1])
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, error: "Invalid time range" }
  const unit = match[2]
  const ms = unit === "m" ? amount * 60 * 1000 : unit === "h" ? amount * 60 * 60 * 1000 : amount * 24 * 60 * 60 * 1000
  if (ms > MAX_RANGE_MS) return { ok: false, error: "A time range cannot be longer than 30 days." }
  const noun = unit === "m" ? "minute" : unit === "h" ? "hour" : "day"
  return { ok: true, id: `${amount}${unit}`, label: `${amount} ${noun}${amount === 1 ? "" : "s"}`, ms }
}

export function rangeById(id: string): { id: string; label: string; ms: number } {
  const parsed = parseRange(id)
  if (!parsed.ok) throw new Error(parsed.error)
  return { id: parsed.id, label: parsed.label, ms: parsed.ms }
}

export function getRangeStart(range: string, now: number): number {
  return now - rangeById(range).ms
}

export function getRangeEnd(_range: string, now: number): number {
  return now
}

export function rangeBounds(range: string, now: number): { start: number; end: number } {
  return { start: getRangeStart(range, now), end: getRangeEnd(range, now) }
}

export function previousBounds(range: string, now: number): { start: number; end: number } {
  const current = rangeBounds(range, now)
  const span = current.end - current.start
  return { start: current.start - span, end: current.start }
}

function instant(timestamp: number | string): number {
  return typeof timestamp === "string" ? Date.parse(timestamp) : timestamp
}

/** Current window is inclusive on both ends. Timestamps are UTC milliseconds. */
export function isInsideRange(timestamp: number | string, range: string, now: number): boolean {
  const at = instant(timestamp)
  if (!Number.isFinite(at)) return false
  const bounds = rangeBounds(range, now)
  return at >= bounds.start && at <= bounds.end
}

/** The previous window of the same length. Its end is exclusive so a boundary is not counted twice. */
export function isInsidePrevious(timestamp: number | string, range: string, now: number): boolean {
  const at = instant(timestamp)
  if (!Number.isFinite(at)) return false
  const bounds = previousBounds(range, now)
  return at >= bounds.start && at < bounds.end
}
