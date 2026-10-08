import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fetchPairDetails } from "../lib/details"
import { captureHistory } from "../lib/narrative/engine"
import { fetchNews } from "../lib/narrative/rss"
import type { HistoryPoint, SnapshotFile } from "../lib/narrative/types"
import { buildLpBurns } from "../lib/lp/monitor"
import { collectWethPairs } from "../lib/scrape"
import { COLLECTION_MAX_HOURS, EMPTY_DETAIL, normalizeLp, type PairRecord } from "../lib/types"

const PREVIOUS_URL = "https://wethlivepairs.site/data/snapshot.json"
const HISTORY_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000
const HISTORY_MAX_POINTS = 700

async function main() {
  const requested = Number(process.env.SNAPSHOT_HOURS)
  const hours =
    Number.isFinite(requested) && requested > 0 && requested <= COLLECTION_MAX_HOURS
      ? requested
      : COLLECTION_MAX_HOURS

  console.log(`Collecting WETH pairs for the last ${hours} hours...`)
  const { rows, scanned } = await collectWethPairs(hours)
  console.log(`Matched ${rows.length} WETH pairs after scanning ${scanned} pools. Loading details...`)
  const details = await fetchPairDetails(rows.map((row) => row.address))
  const records: PairRecord[] = rows.map((row) =>
    normalizeLp({ ...row, ...(details[row.address.toLowerCase()] ?? { ...EMPTY_DETAIL }) }),
  )

  const generatedAt = new Date().toISOString()
  const [news, previous] = await Promise.all([fetchNews(Date.parse(generatedAt)), loadPrevious()])
  const history = trimHistory([...(previous?.history ?? []), captureHistory(records, generatedAt)], Date.parse(generatedAt))
  const lp = buildLpBurns(records, previous, generatedAt)
  const snapshot: SnapshotFile = {
    generatedAt,
    hours,
    scanned,
    rows: records,
    news,
    history,
    lpBurns: lp.events,
    lpScan: lp.scan,
  }
  const file = path.join("public", "data", "snapshot.json")
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(snapshot))
  console.log(
    `Wrote ${file} (${records.length} rows, ${news.length} headlines, ${history.length} history points, ${lp.events.length} LP burns).`,
  )
}

async function loadPrevious(): Promise<SnapshotFile | null> {
  try {
    const response = await fetch(PREVIOUS_URL, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return null
    const payload = (await response.json()) as SnapshotFile
    return Array.isArray(payload.history) ? payload : { ...payload, history: [] }
  } catch (error) {
    console.warn(`Previous snapshot was not loaded: ${error instanceof Error ? error.message : "unknown error"}`)
    return null
  }
}

function trimHistory(points: HistoryPoint[], now: number): HistoryPoint[] {
  return points
    .filter((point) => Number.isFinite(Date.parse(point.at)) && now - Date.parse(point.at) <= HISTORY_MAX_AGE_MS)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-HISTORY_MAX_POINTS)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
