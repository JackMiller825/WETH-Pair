const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
})

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-"
  if (value < 1000) return `$${value.toFixed(2)}`
  return `$${COMPACT.format(value)}`
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-"
  return value.toLocaleString("en-US")
}
