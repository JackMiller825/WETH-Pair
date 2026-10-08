import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { allTrendSlugs, buildIntelligence } from "@/lib/narrative/engine"
import type { SnapshotFile } from "@/lib/narrative/types"

export function readSnapshot(): SnapshotFile | null {
  const file = path.join(process.cwd(), "public", "data", "snapshot.json")
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, "utf8")) as SnapshotFile
}

export function trendParams(): { slug: string }[] {
  const snapshot = readSnapshot()
  if (!snapshot?.rows?.length) return []
  const intel = buildIntelligence(snapshot, "7d", Date.parse(snapshot.generatedAt))
  return allTrendSlugs(intel).map((slug) => ({ slug }))
}

export function tokenParams(): { address: string }[] {
  const snapshot = readSnapshot()
  if (!snapshot?.rows?.length) return []
  const addresses = new Set<string>()
  for (const row of snapshot.rows) {
    if (row.tokenAddress) addresses.add(row.tokenAddress.toLowerCase())
  }
  return [...addresses].map((address) => ({ address }))
}
