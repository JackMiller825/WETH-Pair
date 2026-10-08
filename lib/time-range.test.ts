import assert from "node:assert/strict"
import test from "node:test"
import { getRangeStart, isInsidePrevious, isInsideRange, previousBounds, rangeById } from "./time-range"

const now = Date.parse("2026-10-08T21:00:00.000Z")

test("named ranges keep their own duration, including 24h", () => {
  assert.equal(rangeById("5m").ms, 5 * 60 * 1000)
  assert.equal(rangeById("15m").ms, 15 * 60 * 1000)
  assert.equal(rangeById("30m").ms, 30 * 60 * 1000)
  assert.equal(rangeById("1h").id, "1h")
  assert.equal(rangeById("3h").id, "3h")
  assert.equal(rangeById("3h").ms, 3 * 60 * 60 * 1000)
  assert.equal(rangeById("6h").ms, 6 * 60 * 60 * 1000)
  assert.equal(rangeById("12h").ms, 12 * 60 * 60 * 1000)
  assert.equal(rangeById("24h").id, "24h")
  assert.equal(rangeById("24h").ms, 24 * 60 * 60 * 1000)
  assert.equal(rangeById("3d").ms, 3 * 24 * 60 * 60 * 1000)
  assert.equal(rangeById("7d").ms, 7 * 24 * 60 * 60 * 1000)
  assert.equal(getRangeStart("1h", now), now - 60 * 60 * 1000)
  assert.equal(getRangeStart("24h", now), now - 24 * 60 * 60 * 1000)
})

test("a custom hour count is not forced into the 1h id", () => {
  const custom = rangeById("8h")
  assert.equal(custom.id, "8h")
  assert.equal(custom.ms, 8 * 60 * 60 * 1000)
})

test("previous window is the same length immediately before the current window", () => {
  for (const id of ["5m", "15m", "30m", "1h", "3h", "6h", "12h", "24h", "3d", "7d"]) {
    const current = getRangeStart(id, now)
    const previous = previousBounds(id, now)
    assert.equal(previous.end, current)
    assert.equal(previous.end - previous.start, now - current)
  }
  assert.equal(isInsideRange(now - 10 * 60 * 1000, "15m", now), true)
  assert.equal(isInsideRange(now - 20 * 60 * 1000, "15m", now), false)
  assert.equal(isInsidePrevious(now - 20 * 60 * 1000, "15m", now), true)
  assert.equal(isInsidePrevious(now - 10 * 60 * 1000, "15m", now), false)
})
