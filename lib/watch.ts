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

/** Remember the burnt pairs already on screen, so the first check does not alert for them. */
export function seedBurnt(records: PairRecord[], seen: Set<string>) {
  for (const address of burntAddresses(records)) seen.add(address)
}

/**
 * Burnt pairs that are new since the last check. Confirmed burns are remembered, and a burn that
 * is confirmed gone can alert again if it returns. A failed check (`unknown`) changes nothing.
 */
export function takeNewBurnt(records: PairRecord[], seen: Set<string>): PairRecord[] {
  const found = findNewBurnt(records, seen)
  for (const record of records) {
    const address = record.address.toLowerCase()
    if (record.lpStatus === "burnt") seen.add(address)
    else if (record.lpStatus !== "unknown") seen.delete(address)
  }
  return found
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
