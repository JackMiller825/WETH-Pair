export type Tone = "up" | "down" | "flat"

/** Changes smaller than this, in percent, are shown neutral. */
export const FLAT_CHANGE = 0.05

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
const COMPACT_USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 })

export function formatEthPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return USD.format(value)
}

/** Narrow headers: $2.45K. */
export function formatEthPriceCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return COMPACT_USD.format(value)
}

export function changeTone(value: number | null | undefined): Tone {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < FLAT_CHANGE) return "flat"
  return value > 0 ? "up" : "down"
}

/** Always signed with two decimals so the direction never depends on color: +2.05%, -3.18%, 0.00%. */
export function formatChange(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const rounded = Math.round(value * 100) / 100
  if (rounded === 0) return "0.00%"
  return `${rounded > 0 ? "+" : "-"}${Math.abs(rounded).toFixed(2)}%`
}

export function spokenChange(value: number | null | undefined, period: string): string {
  if (value == null || !Number.isFinite(value)) return `${period} change unavailable`
  const tone = changeTone(value)
  if (tone === "flat") return `flat over ${period}`
  return `${tone === "up" ? "up" : "down"} ${Math.abs(value).toFixed(2)} percent over ${period}`
}

export function spokenUsd(value: number): string {
  const dollars = Math.trunc(value)
  const cents = Math.round((value - dollars) * 100)
  return `${dollars.toLocaleString("en-US")} dollars${cents ? ` and ${cents} cents` : ""}`
}

/** Under 1 gwei keeps three decimals (0.035), more when that would round to zero. 1 and over uses one decimal (12.4). */
export function formatGwei(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—"
  if (value === 0) return "0"
  if (value >= 100) return Math.round(value).toLocaleString("en-US")
  if (value >= 1) return value.toFixed(1)
  if (value >= 0.001) return value.toFixed(3)
  return Number(value.toPrecision(2)).toString()
}

/** Pooled WETH: 0.0042, 0.82, 4.37, 18.4, 1,284, 182K. */
export function formatWeth(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "N/A"
  if (value === 0) return "0"
  if (value < 0.000001) return "<0.000001"
  if (value < 0.01) return Number(value.toPrecision(2)).toString()
  if (value < 10) return value.toFixed(2)
  if (value < 1000) return value.toFixed(1)
  if (value < 100_000) return Math.round(value).toLocaleString("en-US")
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

export function formatAge(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—"
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function formatAgo(ms: number | null | undefined): string {
  const age = formatAge(ms)
  return age === "—" ? age : `${age} ago`
}
