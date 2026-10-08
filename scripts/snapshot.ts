import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fetchPairDetails } from "../lib/details"
import { collectWethPairs } from "../lib/scrape"
import { EMPTY_DETAIL, MAX_HOURS, normalizeLp, type PairRecord } from "../lib/types"

async function main() {
  const requested = Number(process.env.SNAPSHOT_HOURS)
  const hours =
    Number.isFinite(requested) && requested > 0 && requested <= MAX_HOURS ? requested : MAX_HOURS

  console.log(`Collecting WETH pairs for the last ${hours} hours...`)
  const { rows, scanned } = await collectWethPairs(hours)
  console.log(`Matched ${rows.length} WETH pairs after scanning ${scanned} pools. Loading details...`)
  const details = await fetchPairDetails(rows.map((row) => row.address))
  const records: PairRecord[] = rows.map((row) =>
    normalizeLp({ ...row, ...(details[row.address.toLowerCase()] ?? { ...EMPTY_DETAIL }) }),
  )

  const snapshot = {
    generatedAt: new Date().toISOString(),
    hours,
    scanned,
    rows: records,
  }
  const file = path.join("public", "data", "snapshot.json")
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(snapshot))
  console.log(`Wrote ${file} (${records.length} rows).`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
