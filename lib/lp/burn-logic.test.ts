import assert from "node:assert/strict"
import test from "node:test"
import {
  burnEventId,
} from "./monitor"
import {
  burnPercent,
  burnTimeMs,
  commitCheckpoint,
  createdInRange,
  filterBurnEvents,
  formatBurnPercent,
  isReportedBurn,
  notificationCopy,
  parseTransferLog,
  passesNotifyFilter,
  planChunks,
  scanStart,
  TRANSFER_TOPIC,
} from "./burn-logic"

const now = Date.parse("2026-10-08T21:00:00.000Z")

function at(minutesAgo: number): string {
  return new Date(now - minutesAgo * 60 * 1000).toISOString()
}

function burn(createdMinutes: number, burnedMinutes: number | null) {
  return {
    createdAt: at(createdMinutes),
    burnAt: burnedMinutes == null ? null : at(burnedMinutes),
  }
}

test("burn percent sums every burn address and does not round 99.8 up to 100", () => {
  const supply = BigInt(10000)
  const percent = burnPercent(supply, [BigInt(7500), BigInt(2480)])
  assert.equal(percent, 99.8)
  assert.equal(formatBurnPercent(percent), "99.8%")
  assert.equal(burnPercent(supply, [BigInt(10000)]), 100)
  assert.equal(burnPercent(BigInt(0), [BigInt(1)]), null)
  assert.equal(isReportedBurn(0), false)
  assert.equal(isReportedBurn(0.01), true)
  assert.equal(isReportedBurn(null), true)
})

test("case A: a two-minute-old pair burned one minute ago is inside every short burn window", () => {
  const event = burn(2, 1)
  for (const range of ["5m", "15m", "1h"]) {
    assert.equal(createdInRange(event.createdAt, range, now), true)
    const start = now - (range === "5m" ? 5 : range === "15m" ? 15 : 60) * 60 * 1000
    assert.equal(filterBurnEvents([event], start, now, null, now).length, 1)
  }
})

test("case B: a three-hour-old pair burned two minutes ago is a new burn, not a new pair", () => {
  const event = burn(180, 2)
  assert.equal(createdInRange(event.createdAt, "5m", now), false)
  for (const minutes of [5, 15, 60]) {
    assert.equal(filterBurnEvents([event], now - minutes * 60 * 1000, now, null, now).length, 1)
  }
  assert.equal(filterBurnEvents([event], now - 5 * 60 * 1000, now, 15 * 60 * 1000, now).length, 0)
})

test("case C: a burn 18 minutes ago is outside 5m and 15m and inside 30m and 1h", () => {
  const event = burn(20, 18)
  assert.equal(filterBurnEvents([event], now - 5 * 60 * 1000, now, null, now).length, 0)
  assert.equal(filterBurnEvents([event], now - 15 * 60 * 1000, now, null, now).length, 0)
  assert.equal(filterBurnEvents([event], now - 30 * 60 * 1000, now, null, now).length, 1)
  assert.equal(filterBurnEvents([event], now - 60 * 60 * 1000, now, null, now).length, 1)
})

test("case D: a 26-hour-old pair burned two minutes ago is outside the 24h pair window and inside the 5m burn window", () => {
  const event = burn(26 * 60, 2)
  assert.equal(createdInRange(event.createdAt, "24h", now), false)
  assert.equal(filterBurnEvents([event], now - 5 * 60 * 1000, now, null, now).length, 1)
  assert.equal(burnTimeMs({ burnAt: null }), null)
  assert.equal(filterBurnEvents([burn(2, null)], now - 24 * 60 * 60 * 1000, now, null, now).length, 0)
})

test("the same chain log keeps one id, and a failed scan does not move the checkpoint", () => {
  const id = burnEventId("0xabcabcabcabcabcabcabcabcabcabcabcabcabca", "0x" + "ab".repeat(32), 4)
  assert.equal(burnEventId("0xABCabcabcabcabcabcabcabcabcabcabcabcABCA", "0x" + "AB".repeat(32), 4), id)
  assert.notEqual(burnEventId("0xabcabcabcabcabcabcabcabcabcabcabcabcabca", "0x" + "ab".repeat(32), 5), id)
  assert.equal(commitCheckpoint(100, null), 100)
  assert.equal(commitCheckpoint(100, 90), 100)
  assert.equal(commitCheckpoint(100, 114), 114)
  assert.equal(scanStart(null, 1000), 700)
  assert.equal(scanStart(100, 114), 89)
  assert.equal(planChunks(1, 250, 100, 20).length, 3)
})

test("notification filters and copy do not depend on a display range", () => {
  const event = {
    id: "1",
    tokenName: "Super Intelligence Pepe",
    symbol: "SIPEPE",
    tokenAddress: "0x" + "11".repeat(20),
    lpBurntPercent: 99.8,
    liquidity: 74200,
    createdAt: at(8),
    percentKnown: true,
  }
  const open = { minBurnPercent: 0, minLiquidity: 0, maxPairAgeMinutes: null }
  const strict = { minBurnPercent: 95, minLiquidity: 20_000, maxPairAgeMinutes: 30 }
  const tooSmall = { ...strict, minLiquidity: 80_000 }
  assert.equal(passesNotifyFilter(event, open, now), true)
  assert.equal(passesNotifyFilter(event, strict, now), true)
  assert.equal(passesNotifyFilter({ ...event, lpBurntPercent: 90 }, strict, now), false)
  assert.equal(passesNotifyFilter(event, tooSmall, now), false)
  const copy = notificationCopy(event, now)
  assert.match(copy.title, /New WETH LP Burn/)
  assert.match(copy.body, /99\.8%/)
  assert.match(copy.body, /Pair Age: 8m/)
  assert.equal(copy.url, `/tokens/${event.tokenAddress}/`)
})

test("only transfers into a burn address are LP burns", () => {
  const pair = "0x" + "22".repeat(20)
  const dead = "0x000000000000000000000000000000000000dead"
  const holder = "0x" + "33".repeat(20)
  const base = {
    address: pair,
    data: "0x" + BigInt(1000).toString(16).padStart(64, "0"),
    blockNumber: "0x10",
    transactionHash: "0x" + "ab".repeat(32),
    logIndex: "0x1",
  }
  const burned = parseTransferLog({
    ...base,
    topics: [TRANSFER_TOPIC, "0x" + holder.slice(2).padStart(64, "0"), "0x" + dead.slice(2).padStart(64, "0")],
  })
  assert.equal(burned?.to, dead)
  assert.equal(burned?.logIndex, 1)
  const moved = parseTransferLog({
    ...base,
    topics: [TRANSFER_TOPIC, "0x" + holder.slice(2).padStart(64, "0"), "0x" + holder.slice(2).padStart(64, "0")],
  })
  assert.equal(moved, null)
})
