/** Sorts a copy. Empty input is unknown, not zero. */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function percentile(values: readonly number[], p: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0 || p < 0 || p > 1) return null
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

export function mean(values: readonly number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return null
  let total = 0
  for (const value of finite) total += value
  return total / finite.length
}

/** Gaps between successive times, in milliseconds. One observation has no interval. */
export function intervals(times: readonly number[]): number[] {
  const sorted = times.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  const gaps: number[] = []
  for (let index = 1; index < sorted.length; index += 1) gaps.push(sorted[index] - sorted[index - 1])
  return gaps
}

export type Pace = "accelerating" | "slowing" | "stable" | "unknown"

/** Falling intervals mean events are getting closer together. */
export function paceOf(series: readonly number[]): Pace {
  const values = series.filter((value) => Number.isFinite(value) && value >= 0)
  if (values.length < 2) return "unknown"
  const first = values[0]
  const last = values[values.length - 1]
  if (first === 0) return last === 0 ? "stable" : "slowing"
  const ratio = last / first
  if (ratio <= 0.8) return "accelerating"
  if (ratio >= 1.25) return "slowing"
  return "stable"
}

export type SizePace = "increasing" | "declining" | "stable" | "unknown"

export function sizePace(series: readonly number[]): SizePace {
  const values = series.filter((value) => Number.isFinite(value) && value >= 0)
  if (values.length < 2) return "unknown"
  const first = values[0]
  const last = values[values.length - 1]
  if (first === 0) return last === 0 ? "stable" : "increasing"
  const ratio = last / first
  if (ratio >= 1.25) return "increasing"
  if (ratio <= 0.8) return "declining"
  return "stable"
}
