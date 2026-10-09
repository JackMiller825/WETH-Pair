import assert from "node:assert/strict"
import test from "node:test"
import {
  advanceJob,
  classifyRpcFailure,
  comparisonReady,
  coverageText,
  currentSlice,
  focusOlderGap,
  jobEtaMs,
  jobProgress,
  mergeRecords,
  overallProgress,
  openHistoryJob,
} from "../history/plan"
import { backfillHealth, rpcHealth } from "../health"

const nowIso = "2026-10-08T12:00:00.000Z"
const now = Date.parse(nowIso)

test("progress is the processed share and does not invent a percent when the total is unknown", () => {
  const job = openHistoryJob("weth-pairs", 26_000_000, nowIso, null)
  assert.equal(jobProgress({ ...job, blocksDone: 500, blocksTotal: 1000 }), 50)
  assert.equal(jobProgress({ ...job, blocksDone: 0, blocksTotal: 1000 }), 0)
  assert.equal(jobProgress({ ...job, blocksDone: 610, blocksTotal: 1000 }), 61)
  assert.equal(jobProgress({ ...job, blocksDone: 1000, blocksTotal: 1000, status: "running", phase: "recent" }), 99)
  assert.equal(jobProgress({ ...job, status: "completed", phase: "done" }), 100)
  assert.equal(jobProgress({ ...job, blocksTotal: 0 }), null)
})

test("overall history percent is the share of pair and burn blocks, and stays under 100 until both finish", () => {
  const pairs = openHistoryJob("weth-pairs", 26_000_000, nowIso, null)
  const burns = openHistoryJob("lp-burns", 26_000_000, nowIso, null)
  const backfill = {
    pairs: { ...pairs, blocksDone: 500, blocksTotal: 1000 },
    burns: { ...burns, blocksDone: 250, blocksTotal: 1000 },
    scope: "",
    providerNote: null,
  }
  assert.equal(overallProgress(backfill), 37)
  assert.equal(overallProgress({ ...backfill, pairs: { ...backfill.pairs, status: "completed", phase: "done" }, burns: { ...backfill.burns, status: "completed", phase: "done" } }), 100)
  assert.equal(overallProgress(null), null)
})

test("eta stays hidden until the scan has moved, and a rate limit does not count as success", () => {
  const job = openHistoryJob("weth-pairs", 26_000_000, nowIso, null)
  assert.equal(jobEtaMs({ ...job, blocksDone: 40, startedAt: new Date(now - 30_000).toISOString() }, now) == null, false)
  assert.equal(jobEtaMs({ ...job, blocksDone: 0, startedAt: nowIso }, now), null)
  assert.equal(classifyRpcFailure("HTTP 429"), "rate-limit")
  assert.equal(classifyRpcFailure("Too many requests"), "rate-limit")
  assert.equal(classifyRpcFailure("ranges over 10000 blocks are not supported"), "shrink")
  assert.equal(classifyRpcFailure("connection refused"), "fatal")
})

test("a stopped backfill resumes from its cursor instead of the latest block", () => {
  const opened = openHistoryJob("weth-pairs", 26_000_000, nowIso, null)
  const stopped = { ...opened, cursor: opened.cursor + 4000, blocksDone: Math.floor(opened.blocksTotal * 0.43), status: "failed" as const, error: "HTTP 429" }
  const resumed = openHistoryJob("weth-pairs", 26_100_000, "2026-10-08T13:00:00.000Z", stopped)
  assert.equal(resumed.cursor, stopped.cursor)
  assert.equal(resumed.blocksDone, stopped.blocksDone)
  assert.equal(resumed.status, "running")
  assert.equal(resumed.error, null)
  assert.ok(resumed.blocksDone > 0)
})

test("partial coverage is labeled, and a 7-day comparison needs 14 days", () => {
  const job = openHistoryJob("weth-pairs", 26_000_000, nowIso, null)
  const text = coverageText(now - 4 * 24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, { ...job, status: "running" }, now)
  assert.match(text ?? "", /Partial history/)
  assert.equal(comparisonReady(now - 8 * 24 * 60 * 60 * 1000, "7d", now), false)
  assert.equal(comparisonReady(now - 14 * 24 * 60 * 60 * 1000, "7d", now), true)
})

test("merging a replayed pair keeps one row and does not let backfill replace the live row", () => {
  const live = { address: "0xABC", name: "live" }
  const replay = { address: "0xabc", name: "backfill" }
  const merged = mergeRecords([live], [replay, { address: "0xdef", name: "older" }])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].name, "live")
})

test("the older gap is scanned without moving the live checkpoint", () => {
  const opened = openHistoryJob("lp-burns", 26_000_000, nowIso, null)
  const focused = focusOlderGap({ ...opened, blocksDone: 2000, cursor: opened.cursor + 2000 })
  assert.equal(focused.phase, "older")
  assert.equal(focused.recentHold, opened.cursor + 2000)
  const slice = currentSlice(focused, 40)
  assert.equal(slice?.from, focused.cursor)
  const checkpoint = { lpMonitorBlock: 123, pairMonitorBlock: 456 }
  const after = advanceJob(focused, focused.cursor + 40, nowIso, "scan")
  assert.equal(checkpoint.lpMonitorBlock, 123)
  assert.equal(after.cursor, focused.cursor + 40)
})

test("diagnostics do not report a failed RPC or a running backfill as connected", () => {
  assert.equal(rpcHealth({ lastError: "HTTP 429", lastSuccessAt: nowIso }, now), "failed")
  assert.equal(rpcHealth({ lastError: null, lastSuccessAt: new Date(now - 60 * 60 * 1000).toISOString() }, now), "delayed")
  assert.equal(rpcHealth(null, now), "waiting")
  const job = openHistoryJob("weth-pairs", 26_000_000, nowIso, null)
  assert.equal(backfillHealth({ pairs: { ...job, status: "running" }, burns: job, scope: "", providerNote: null }), "backfilling")
  assert.equal(backfillHealth({ pairs: { ...job, status: "failed" }, burns: job, scope: "", providerNote: null }), "failed")
})
