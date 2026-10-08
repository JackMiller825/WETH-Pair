import type { LpStatus, PairRecord } from "@/lib/types"

export type SortKey =
  | "created"
  | "price"
  | "marketCap"
  | "liquidity"
  | "remaining"
  | "holders"
  | "totalTx"
  | "lp"

export type SortDirection = "asc" | "desc"
export type SortState = { key: SortKey; direction: SortDirection }
export type Filters = { name: string; exchange: string }

export const ALL_EXCHANGES = "all"

export const DEFAULT_SORT: SortState = { key: "created", direction: "desc" }
export const DEFAULT_FILTERS: Filters = { name: "", exchange: ALL_EXCHANGES }

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "created", label: "Created" },
  { key: "price", label: "Price" },
  { key: "marketCap", label: "Market cap" },
  { key: "liquidity", label: "Total liquidity" },
  { key: "remaining", label: "Remaining" },
  { key: "holders", label: "Holders" },
  { key: "totalTx", label: "Total Tx" },
  { key: "lp", label: "LP status" },
]

const LP_RANK: Record<LpStatus, number> = {
  burnt: 4,
  locked: 3,
  unverified: 2,
  none: 1,
  unknown: 0,
}

export function liquidityOf(record: PairRecord): number | null {
  return record.liquidity ?? record.listingLiquidity
}

/** Within the same LP state, a larger burnt share ranks higher, then a larger locked share. */
function lpScore(record: PairRecord): number {
  return LP_RANK[record.lpStatus] * 1_000_000 + record.lpBurntPercent * 1_000 + record.lpLockedPercent
}

export function sortValue(record: PairRecord, key: SortKey): number | null {
  switch (key) {
    case "created": {
      const time = new Date(record.created_at).getTime()
      return Number.isFinite(time) ? time : null
    }
    case "price":
      return record.price
    case "marketCap":
      return record.marketCap
    case "liquidity":
      return liquidityOf(record)
    case "remaining":
      return record.remaining
    case "holders":
      return record.holders
    case "totalTx":
      return record.totalTx
    case "lp":
      return record.lpStatus === "unknown" ? null : lpScore(record)
  }
}

export function exchangeOptions(records: PairRecord[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const record of records) counts.set(record.exchange, (counts.get(record.exchange) ?? 0) + 1)
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function isFiltered(filters: Filters): boolean {
  return filters.name.trim() !== "" || filters.exchange !== ALL_EXCHANGES
}

/** Filters, then sorts. Rows with no value for the sort column always go last. */
export function applyView(records: PairRecord[], filters: Filters, sort: SortState): PairRecord[] {
  const needle = filters.name.trim().toLowerCase()
  const filtered = records.filter((record) => {
    if (filters.exchange !== ALL_EXCHANGES && record.exchange !== filters.exchange) return false
    if (needle && !record.name.toLowerCase().includes(needle)) return false
    return true
  })
  const factor = sort.direction === "asc" ? 1 : -1
  return filtered
    .map((record, index) => ({ record, index, value: sortValue(record, sort.key) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index
      if (a.value === null) return 1
      if (b.value === null) return -1
      if (a.value === b.value) return a.index - b.index
      return (a.value - b.value) * factor
    })
    .map((entry) => entry.record)
}
