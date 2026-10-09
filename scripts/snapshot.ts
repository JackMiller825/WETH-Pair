import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fetchPairDetails } from "../lib/details"
import { captureHistory } from "../lib/narrative/engine"
import { fetchNews } from "../lib/narrative/rss"
import type { HistoryPoint, SnapshotFile } from "../lib/narrative/types"
import { scanChain } from "../lib/lp/chain-scan"
import { applyChainBurns, buildLpBurns } from "../lib/lp/monitor"
import { HISTORY_RETAIN_MS, HISTORY_SCOPE, mergeRecords, openHistoryJob } from "../lib/history/plan"
import { enrichIdentity, readHead, scanHistoricalBurns, scanHistoricalPairs } from "../lib/history/scan"
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

  const generatedAt = new Date().toISOString()
  const generatedMs = Date.parse(generatedAt)
  const previousP = loadPrevious()
  const newsP = fetchNews(generatedMs)
  console.log(`Collecting WETH pairs for the last ${hours} hours...`)
  const listingP = collectWethPairs(hours)
  const previous = await previousP
  const liveStarted = Date.now()
  const liveP = scanChain(previous?.rows ?? [], previous?.chain ?? null, new Date(generatedAt))
    .then((result) => {
      console.log(`[LP-MONITOR] Known-pair scan finished in ${Date.now() - liveStarted}ms, before market details.`)
      return result
    })
    .catch((error: unknown) => {
      console.warn(`[LP-MONITOR] Scan stopped. Checkpoint kept. ${error instanceof Error ? error.message : "unknown error"}`)
      return null
    })
  const listing = await listingP
  const { rows, scanned } = listing
  if (!listing.listingComplete) {
    console.warn(`[HISTORY] DEXTools live listing ended at ${listing.listingOldestAt ?? "unknown"} before the ${hours}h cutoff. Older pairs require the Ethereum backfill.`)
  }
  console.log(`Matched ${rows.length} WETH pairs after scanning ${scanned} pools. Loading details while the chain scan continues...`)
  const detailsP = fetchPairDetails(rows.map((row) => row.address))
  const [live, details, news] = await Promise.all([liveP, detailsP, newsP])
  const records: PairRecord[] = rows.map((row) =>
    normalizeLp({ ...row, ...(details[row.address.toLowerCase()] ?? { ...EMPTY_DETAIL }) }),
  )
  const retained = retainPairs(records.map((row) => ({ ...row, listingSource: row.listingSource ?? "dextools" })), previous?.rows, generatedMs)
  let chain = live?.checkpoint ?? previous?.chain
  let chainBurns: Awaited<ReturnType<typeof scanChain>>["burns"] = live?.burns ?? []
  if (chain?.lastError) console.warn(`[LP-MONITOR] ${chain.lastError}`)
  else if (chain) console.log(`[LP-MONITOR] Checkpoint ${chain.lpMonitorBlock ?? "unset"} · head ${chain.headBlock ?? "unknown"}`)
  const alreadyWatched = new Set((previous?.rows ?? []).map((row) => row.address.toLowerCase()))
  const fresh = retained.filter((row) => !alreadyWatched.has(row.address.toLowerCase()))
  if (fresh.length > 0 && chain?.headBlock != null) {
    try {
      const extra = await scanChain(fresh, { ...chain, lpMonitorBlock: Math.max(0, chain.headBlock - 400) }, new Date(generatedAt))
      const kept = chain.lpMonitorBlock
      if (extra.checkpoint.lpMonitorBlock != null && (kept == null || extra.checkpoint.lpMonitorBlock >= kept)) chain = extra.checkpoint
      chainBurns = [...chainBurns, ...extra.burns]
      console.log(`[LP-MONITOR] New pairs scanned: ${fresh.length}`)
    } catch (error) {
      console.warn(`[LP-MONITOR] New-pair scan stopped. ${error instanceof Error ? error.message : "unknown error"}`)
    }
  }
  let backfill = previous?.backfill
  let historicalRows = retained
  let historicalBurns = chainBurns
  try {
    const head = chain?.headBlock ?? await readHead()
    const pairJob = openHistoryJob("weth-pairs", head, generatedAt, previous?.backfill?.pairs)
    const burnJob = previous?.backfill?.burns
      ? openHistoryJob("lp-burns", head, generatedAt, previous.backfill.burns)
      : { ...pairJob, id: "lp-burns" as const, status: "running" as const, phase: "recent" as const, cursor: pairJob.recentStart, blocksDone: 0, pairsFound: 0, burnsFound: 0, error: null, stage: "Scanning historical LP transfers to burn addresses", startedAt: generatedAt, updatedAt: generatedAt }
    const pairScan = pairJob.status === "completed" ? { job: pairJob, pairs: [] as PairRecord[] } : await scanHistoricalPairs(pairJob, new Date(generatedAt))
    historicalRows = mergePairs(retained, pairScan.pairs)
    historicalRows = await enrichIdentity(historicalRows)
    const knownPairs = new Set(historicalRows.filter((row) => row.exchange !== "Unknown DEX").map((row) => row.address.toLowerCase()))
    const burnScan = burnJob.status === "completed" ? { job: burnJob, burns: [] as typeof chainBurns } : await scanHistoricalBurns(burnJob, knownPairs, new Date(generatedAt))
    historicalBurns = [...chainBurns, ...burnScan.burns]
    backfill = {
      pairs: { ...pairScan.job, pairsFound: historicalRows.filter((row) => row.listingSource === "ethereum-pair-created").length },
      burns: burnScan.job,
      scope: HISTORY_SCOPE,
      providerNote: listing.listingComplete ? null : `DEXTools live listing oldest pool: ${listing.listingOldestAt ?? "unknown"}.`,
    }
    console.log(`[HISTORY] Pairs ${pairScan.job.phase} ${pairScan.job.blocksDone}/${pairScan.job.blocksTotal}. Burns ${burnScan.job.phase} ${burnScan.job.blocksDone}/${burnScan.job.blocksTotal}.`)
  } catch (error) {
    console.warn(`[HISTORY] Backfill paused. Live snapshot still publishes. ${error instanceof Error ? error.message : "unknown error"}`)
  }
  const withChain = applyChainBurns(historicalRows, historicalBurns)
  const history = trimHistory([...(previous?.history ?? []), captureHistory(withChain, generatedAt)], generatedMs)
  const lp = buildLpBurns(withChain, previous, generatedAt, historicalBurns)
  for (const event of lp.events.filter((event) => event.kind === "newly-burned" && event.detectedAt === generatedAt)) {
    console.log(`[LP-BURN] New event saved ${event.pair} ${event.burnTx ?? "no-tx"}`)
  }
  const snapshot: SnapshotFile = {
    generatedAt,
    hours,
    scanned,
    rows: withChain,
    news,
    history,
    lpBurns: lp.events,
    lpScan: lp.scan,
    chain,
    backfill,
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

function retainPairs(current: PairRecord[], previous: PairRecord[] | undefined, now: number): PairRecord[] {
  const seen = new Set(current.map((row) => row.address.toLowerCase()))
  const extra = (previous ?? []).filter((row) => {
    const at = Date.parse(row.created_at)
    return !seen.has(row.address.toLowerCase()) && Number.isFinite(at) && now - at <= HISTORY_RETAIN_MS
  })
  if (extra.length > 0) console.log(`[LP-MONITOR] Kept ${extra.length} stored pairs that this listing page did not return`)
  return [...current, ...extra]
}

function mergePairs(current: PairRecord[], extra: PairRecord[]): PairRecord[] {
  return mergeRecords(current, extra)
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
