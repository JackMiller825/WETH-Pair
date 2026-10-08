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

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉"

/** Prices below $0.001 use DEXTools-style subscripts for the run of zeros: $0.0₅4957. */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-"
  if (value === 0) return "$0"
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
  if (value >= 0.001) return `$${Number(value.toPrecision(4)).toString()}`
  let zeros = Math.ceil(-Math.log10(value)) - 1
  let digits = Math.round(value * 10 ** (zeros + 4)).toString()
  if (digits.length > 4) {
    zeros -= 1
    digits = "1"
  }
  digits = digits.replace(/0+$/, "")
  const subscript = String(zeros)
    .split("")
    .map((digit) => SUBSCRIPT[Number(digit)])
    .join("")
  return `$0.0${subscript}${digits || "0"}`
}

export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-"
  if (value >= 1000) return COMPACT.format(value)
  if (value > 0 && value < 0.0001) return "<0.0001"
  return Number(value.toFixed(4)).toLocaleString("en-US", { maximumFractionDigits: 4 })
}

/** Up to four decimals with trailing zeros dropped, so 99.9533 stays exact and 100 stays 100. */
export function formatExactPercent(value: number): string {
  if (value > 0 && value < 0.0001) return "<0.0001%"
  return `${Number(value.toFixed(4))}%`
}

export function shortAddress(address: string): string {
  if (address.length <= 14) return address
  return `${address.slice(0, 5)}...${address.slice(-4)}`
}

/** Plain decimal text (never exponent notation) with about six significant digits, for files. */
export function plainNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ""
  if (value === 0) return "0"
  const decimals = Math.min(20, Math.max(0, 5 - Math.floor(Math.log10(Math.abs(value)))))
  return value.toFixed(decimals).replace(/\.?0+$/, "")
}
