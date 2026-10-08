import assert from "node:assert/strict"
import test from "node:test"
import { isLiveBurnAlert } from "../lp/burn-logic"
import {
  advanceJob,
  comparisonReady,
  countsByAge,
  decodeCallResult,
  inCustomRange,
  jobProgress,
  openHistoryJob,
  parsePairCreated,
  wethSide,
} from "./plan"

const now = Date.parse("2026-10-08T12:00:00.000Z")
const hour = 60 * 60 * 1000

test("24h, 3d, and 7d keep different ages", () => {
  const times = [
    now - 10 * 60 * 1000,
    now - 20 * hour,
    now - 30 * hour,
    now - 2 * 24 * hour,
    now - 5 * 24 * hour,
    now - 8 * 24 * hour,
  ]
  const counts = countsByAge(times, now)
  assert.equal(counts["24h"].count, 2)
  assert.equal(counts["3d"].count, 4)
  assert.equal(counts["7d"].count, 5)
  assert.ok(counts["3d"].count > counts["24h"].count)
  assert.ok(counts["7d"].count > counts["3d"].count)
})

test("a custom window is not rewritten as the last 24 hours", () => {
  const event = now - 5 * 24 * hour
  const start = now - 6 * 24 * hour
  const end = now - 4 * 24 * hour
  assert.equal(inCustomRange(event, start, end), true)
  assert.equal(inCustomRange(now - 2 * hour, start, end), false)
})

test("an exact 24-hour-old record is inside 24h and a slightly older one is not", () => {
  const counts = countsByAge([now - 24 * hour, now - 24 * hour - 1000], now)
  assert.equal(counts["24h"].count, 1)
  assert.equal(counts["3d"].count, 2)
})

test("pair-created logs keep only the WETH side", () => {
  const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
  const other = "0x1111111111111111111111111111111111111111"
  const pair = "0x2222222222222222222222222222222222222222"
  const log = parsePairCreated({
    address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    topics: [
      "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9",
      `0x${weth.slice(2).padStart(64, "0")}`,
      `0x${other.slice(2).padStart(64, "0")}`,
    ],
    data: `0x${pair.slice(2).padStart(64, "0")}0000000000000000000000000000000000000000000000000000000000000001`,
    blockNumber: "0x18f0c11",
  })
  assert.ok(log)
  assert.equal(log?.pair, pair)
  assert.deepEqual(wethSide(log!.token0, log!.token1), { weth: "token0", token: other })
  assert.equal(wethSide(other, "0x3333333333333333333333333333333333333333"), null)
})

test("a history job resumes from its cursor and can finish", () => {
  const opened = openHistoryJob("weth-pairs", 26_000_000, "2026-10-08T12:00:00.000Z", null)
  assert.equal(opened.phase, "recent")
  assert.ok(opened.blocksTotal > opened.blocksDone)
  const resumed = openHistoryJob("weth-pairs", 26_100_000, "2026-10-08T13:00:00.000Z", { ...opened, cursor: opened.cursor + 400, blocksDone: 400 })
  assert.equal(resumed.cursor, opened.cursor + 400)
  assert.equal(resumed.recentStart, opened.recentStart)
  const finished = advanceJob({ ...opened, phase: "older", cursor: opened.olderEnd - 10, blocksDone: opened.blocksTotal - 10 }, opened.olderEnd, "2026-10-08T14:00:00.000Z", "scan")
  assert.equal(finished.phase, "done")
  assert.equal(finished.status, "completed")
  assert.equal(jobProgress(finished), 100)
})

test("backfill burns are not live alerts", () => {
  assert.equal(isLiveBurnAlert({ kind: "newly-burned", detectionSource: "live" }), true)
  assert.equal(isLiveBurnAlert({ kind: "newly-burned", detectionSource: "backfill" }), false)
  assert.equal(isLiveBurnAlert({ kind: "previously-burned", detectionSource: "backfill" }), false)
})

test("a 7-day comparison is unavailable when history is only 8 days short of 14", () => {
  assert.equal(comparisonReady(now - 7 * 24 * hour, "7d", now), false)
  assert.equal(comparisonReady(now - 20 * hour, "1h", now), true)
})

test("abi strings decode", () => {
  const word = "5465736c61".padEnd(64, "0")
  assert.equal(decodeCallResult(`0x${word}`), "Tesla")
})
