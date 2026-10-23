import assert from "node:assert/strict"
import test from "node:test"
import { activitySeries, activityState, activeHours, cohortBurnRate, earliestTimes, formatCompact, formatInZone, heatmap, inRollingWindow, launchScore, performanceDistribution, periodChange, rankActivity, recordConditionHistory, rollingCount, stillTrading, swapsInWindow, typicalHour, windowStats } from "./pulse"

const HOUR = 60 * 60 * 1000

test("pair counts use creation time and age out of each rolling window", () => {
  const now = Date.parse("2026-10-22T12:00:00Z")
  const times = [30 * 60 * 1000, 2 * HOUR, 8 * HOUR, 18 * HOUR, 30 * HOUR].map((age) => now - age)
  const stats = Object.fromEntries(windowStats(times, now).map((item) => [item.id, item.current]))
  assert.deepEqual(stats, { "1h": 1, "6h": 2, "12h": 3, "24h": 4 })
})

test("a pair leaves the 1 hour count once it is older than one hour", () => {
  const created = Date.parse("2026-10-22T09:01:00Z")
  assert.equal(inRollingWindow(created, Date.parse("2026-10-22T10:00:00Z"), HOUR), true)
  assert.equal(inRollingWindow(created, Date.parse("2026-10-22T10:02:00Z"), HOUR), false)
})

test("LP burn counts use the burn time, including a burn of an older pair", () => {
  const now = Date.parse("2026-10-22T12:00:00Z")
  const burns = [20 * 60 * 1000, 4 * HOUR, 10 * HOUR, 20 * HOUR, 2 * 24 * HOUR].map((age) => now - age)
  const createdSevenHoursAgo = now - 7 * HOUR
  burns.push(now - 30 * 60 * 1000)
  const stats = Object.fromEntries(windowStats(burns, now).map((item) => [item.id, item.current]))
  assert.equal(stats["1h"], 2)
  assert.equal(rollingCount([createdSevenHoursAgo], now, HOUR), 0)
  assert.equal(windowStats([20 * 60 * 1000, 4 * HOUR, 10 * HOUR, 20 * HOUR, 2 * 24 * HOUR].map((age) => now - age), now).map((item) => item.current).join(","), "1,2,3,4")
})

test("hourly buckets count the events inside each clock hour and leave the next hour separate", () => {
  const hour10 = Date.parse("2026-10-22T10:00:00Z")
  const times = ["2026-10-22T10:05:00Z", "2026-10-22T10:15:00Z", "2026-10-22T10:46:00Z", "2026-10-22T11:01:00Z"].map((iso) => Date.parse(iso))
  const series = activitySeries(times, Date.parse("2026-10-22T11:30:00Z"), 6 * HOUR, HOUR)
  const at10 = series.find((bucket) => bucket.start === hour10)
  const at11 = series.find((bucket) => bucket.start === hour10 + HOUR)
  assert.equal(at10?.count, 3)
  assert.equal(at11?.count, 1)
  assert.equal(at11?.change, periodChange(1, 3))
})

test("a display timezone does not change rolling pair counts", () => {
  const now = Date.parse("2026-10-22T18:00:00Z")
  const times = [1, 2, 5].map((hour) => now - hour * HOUR)
  assert.equal(rollingCount(times, now, 6 * HOUR), 3)
  assert.equal(heatmap(times, now, "UTC").reduce((sum, row) => sum + row.hours.reduce((a, b) => a + b, 0), 0), 3)
  assert.equal(heatmap(times, now, "America/Los_Angeles").reduce((sum, row) => sum + row.hours.reduce((a, b) => a + b, 0), 0), 3)
})

test("period change compares the previous equal window, and a zero previous window does not divide", () => {
  const now = Date.parse("2026-10-22T12:00:00Z")
  const times = [30 * 60 * 1000, 90 * 60 * 1000].map((age) => now - age)
  const hour = windowStats(times, now)[0]
  assert.equal(hour.current, 1)
  assert.equal(hour.previous, 1)
  assert.equal(hour.change, 0)
  assert.equal(periodChange(4, 0), null)
  assert.equal(periodChange(0, 0), 0)
})

test("activity state uses the previous hour and the same-hour baseline", () => {
  assert.equal(activityState(21, 11, 9.4), "surging")
  assert.equal(activityState(0, 0, 0), "quiet")
  assert.equal(activityState(12, 10, 11), "rising")
  const now = Date.parse("2026-10-22T15:30:00Z")
  const times = [1, 2, 3].flatMap((day) => [0, 1].map((extra) => now - day * 24 * HOUR - extra * 60 * 1000))
  const typical = typicalHour(times, now, "UTC", 7)
  assert.equal(typical, 6 / 7)
})

test("transaction ranking follows the selected window and ignores a repeated swap id", () => {
  const ranked = rankActivity(
    [
      { pair: "0xa", token: "0x1", name: "A", symbol: "A", url: "", tx: 100, buys: null, sells: null, traders: null, pooledWeth: 1, holders: 1, volumeUsd: 1, percent: 1 },
      { pair: "0xb", token: "0x2", name: "B", symbol: "B", url: "", tx: 500, buys: null, sells: null, traders: 100, pooledWeth: 1, holders: 1, volumeUsd: 1, percent: 1 },
      { pair: "0xc", token: "0x3", name: "C", symbol: "C", url: "", tx: 250, buys: null, sells: null, traders: null, pooledWeth: 1, holders: 1, volumeUsd: 1, percent: 1 },
    ],
    "tx",
    10,
  )
  assert.deepEqual(ranked.map((row) => row.symbol), ["B", "C", "A"])
  assert.equal(ranked[0].density, 5)
  const start = 1_000
  const swaps = [
    { pair: "0xa", id: "1", seenAt: start + 10, bulk: false },
    { pair: "0xa", id: "1", seenAt: start + 10, bulk: false },
    { pair: "0xb", id: "2", seenAt: start + 20, bulk: false },
    { pair: "0xb", id: "3", seenAt: start + 30, bulk: false },
    { pair: "0xa", id: "old", seenAt: start - HOUR, bulk: false },
    { pair: "0xa", id: "bulk", seenAt: start + 5, bulk: true },
  ]
  const counts = swapsInWindow(swaps, start, start + HOUR)
  assert.equal(counts.get("0xa"), 1)
  assert.equal(counts.get("0xb"), 2)
})

test("the launch score is deterministic, stays finite at zero, and does not invent a success probability", () => {
  const quiet = launchScore({ pairs1h: 0, pairsPrevious: 0, pairsBaseline: 0, burns1h: 0, burnsPrevious: 0, burnsBaseline: 0, tx1h: 0, txPrevious: 0, txBaseline: 0, netWeth: null, medianMultiple: null, above12Share: null, gasGwei: null, eth1h: null, eth24h: null })
  const again = launchScore({ pairs1h: 0, pairsPrevious: 0, pairsBaseline: 0, burns1h: 0, burnsPrevious: 0, burnsBaseline: 0, tx1h: 0, txPrevious: 0, txBaseline: 0, netWeth: null, medianMultiple: null, above12Share: null, gasGwei: null, eth1h: null, eth24h: null })
  assert.deepEqual(quiet, again)
  assert.equal(quiet.band, "very-quiet")
  assert.ok(quiet.score >= 0 && quiet.score <= 100)
  assert.equal(quiet.read.includes("success"), false)
  const active = launchScore({ pairs1h: 21, pairsPrevious: 11, pairsBaseline: 9.4, burns1h: 4, burnsPrevious: 2, burnsBaseline: 2, tx1h: 4105, txPrevious: 2810, txBaseline: 2640, netWeth: 121, medianMultiple: 1.2, above12Share: 0.18, gasGwei: 0.041, eth1h: 0.31, eth24h: 1.2 })
  assert.equal(active.gasLabel, "Very Low")
  assert.ok(active.score > quiet.score)
  assert.equal(formatCompact(14200), "14.2K")
  assert.equal(formatCompact(4105), "4,105")
})

test("cohort burn rate is not the same-hour activity ratio, and performance stats need real multiples", () => {
  const now = Date.parse("2026-10-22T12:00:00Z")
  const cohort = cohortBurnRate(
    [
      { createdAt: now - 90 * 60 * 1000, burned: true },
      { createdAt: now - 30 * 60 * 1000, burned: false },
    ],
    now,
    HOUR,
  )
  assert.equal(cohort.launched, 1)
  assert.equal(cohort.burned, 1)
  assert.equal(cohort.rate, 100)
  assert.equal(performanceDistribution([]), null)
  const spread = performanceDistribution([0.5, 1, 1.3, 2])
  assert.equal(spread?.n, 4)
  assert.equal(spread?.median, 1.15)
  const trading = stillTrading([{ createdAt: now - 2 * HOUR, lastTradeAt: now - 30 * 60 * 1000 }, { createdAt: now - 2 * HOUR, lastTradeAt: null }], now, HOUR, 6 * HOUR)
  assert.equal(trading.eligible, 2)
  assert.equal(trading.active, 1)
})

test("active hours rank observed history and a 7 day chart stays aggregated", () => {
  const now = Date.parse("2026-10-22T22:00:00Z")
  const times = [1, 2, 3].flatMap((day) => [20, 20, 21].map((hour) => Date.parse(`2026-10-${22 - day}T${String(hour).padStart(2, "0")}:15:00Z`)))
  const top = activeHours(times, now, "UTC", 7, 2)
  assert.equal(top[0].hour, 20)
  assert.equal(top[0].label, "8 PM – 9 PM")
  const week = activitySeries(times, now, 7 * 24 * HOUR, 6 * HOUR)
  assert.ok(week.length >= 24 && week.length <= 30)
  assert.deepEqual(earliestTimes([{ key: "a", at: 20 }, { key: "a", at: 5 }, { key: "b", at: Number.NaN }]), [5])
})

test("a chart label survives an unknown timezone and an invalid instant", () => {
  const at = Date.parse("2026-10-22T12:00:00Z")
  assert.equal(formatInZone(at, "Not/AZone", { hour: "numeric" }).length > 0, true)
  assert.equal(formatInZone(Number.NaN, "UTC", { hour: "numeric" }), "")
  assert.equal(formatInZone(at, "UTC", { hour: "numeric", hourCycle: "h23" }).includes("12"), true)
})

test("condition history keeps one reading per hour in this browser", () => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) },
  })
  const now = Date.parse("2026-10-22T12:30:00Z")
  const point = { score: 80, pairs: 10, burns: 2, tx: 100, gas: 0.04 }
  recordConditionHistory(now, point)
  const updated = recordConditionHistory(now + 10 * 60 * 1000, { ...point, score: 81 })
  assert.equal(updated.length, 1)
  assert.equal(updated[0].score, 81)
  const later = recordConditionHistory(now + 2 * HOUR, point)
  assert.equal(later.length, 2)
  assert.equal(later[0].hour < later[1].hour, true)
})
