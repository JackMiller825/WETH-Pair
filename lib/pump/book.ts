import type { PricePoint } from "@/lib/pump/price"

const MINUTE = 60_000
const MAX_POINTS = 400
const MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000

/**
 * Price snapshots keyed by pair. One point per minute: a later block replaces that minute, an older block never does.
 * This is the indexed history rankings read. It is not queried from Ethereum when someone changes the interval.
 */
export class PriceBook {
  version = 0
  private byPair = new Map<string, PricePoint[]>()

  insert(point: PricePoint): "added" | "replaced" | "rejected" {
    if (!(point.priceUsd > 0) || !Number.isFinite(point.at)) return "rejected"
    const pair = point.pair.toLowerCase()
    const next = { ...point, pair, token: point.token.toLowerCase() }
    const list = this.byPair.get(pair) ?? []
    const bucket = Math.floor(next.at / MINUTE)
    const index = list.findIndex((item) => Math.floor(item.at / MINUTE) === bucket)
    if (index >= 0) {
      const current = list[index]
      const newerBlock = next.block != null && (current.block == null || next.block > current.block)
      const newerTime = next.block == null && current.block == null && next.at > current.at
      if (!newerBlock && !newerTime) return "rejected"
      list[index] = next
      this.byPair.set(pair, list)
      this.version += 1
      return "replaced"
    }
    list.push(next)
    list.sort((a, b) => a.at - b.at || (a.block ?? 0) - (b.block ?? 0))
    this.byPair.set(pair, trim(list, next.at))
    this.version += 1
    return "added"
  }

  points(pair: string): readonly PricePoint[] {
    return this.byPair.get(pair.toLowerCase()) ?? []
  }

  oldest(): number | null {
    let oldest: number | null = null
    for (const list of this.byPair.values()) {
      const at = list[0]?.at
      if (at != null && (oldest == null || at < oldest)) oldest = at
    }
    return oldest
  }

  load(points: readonly PricePoint[]) {
    for (const point of points) this.insert(point)
  }

  dump(): PricePoint[] {
    return [...this.byPair.values()].flat()
  }
}

function trim(list: PricePoint[], now: number): PricePoint[] {
  const fresh = list.filter((point) => now - point.at <= MAX_AGE_MS)
  if (fresh.length <= MAX_POINTS) return fresh
  return fresh.slice(fresh.length - MAX_POINTS)
}
