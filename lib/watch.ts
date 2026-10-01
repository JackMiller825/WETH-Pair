import type { PairRecord } from "@/lib/types"

export const WATCH_INTERVAL_MS = 60_000

export type WatchAlert = {
  id: string
  address: string
  name: string
  exchange: string
  url: string
  liquidity: number | null
  marketCap: number | null
  burntPercent: number
  foundAt: number
  test?: boolean
}

export function burntAddresses(records: PairRecord[]): string[] {
  return records.filter((record) => record.lpStatus === "burnt").map((record) => record.address.toLowerCase())
}

/** Burnt pairs the watcher has not reported before, in the order they appear. */
export function findNewBurnt(records: PairRecord[], seen: ReadonlySet<string>): PairRecord[] {
  return records.filter((record) => record.lpStatus === "burnt" && !seen.has(record.address.toLowerCase()))
}

export function toAlert(record: PairRecord, foundAt: number): WatchAlert {
  return {
    id: `${record.address.toLowerCase()}-${foundAt}`,
    address: record.address.toLowerCase(),
    name: record.name,
    exchange: record.exchange,
    url: record.url,
    liquidity: record.liquidity ?? record.listingLiquidity,
    marketCap: record.marketCap,
    burntPercent: record.lpBurntPercent,
    foundAt,
  }
}
