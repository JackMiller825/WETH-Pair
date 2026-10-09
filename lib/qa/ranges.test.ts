import assert from "node:assert/strict"
import test from "node:test"
import { countsByAge, inCustomRange } from "../history/plan"
import { isInsidePrevious, isInsideRange, parseRange, previousBounds, rangeById } from "../time-range"

const now = Date.parse("2026-10-08T12:00:00.000Z")
const minute = 60 * 1000
const hour = 60 * minute
const day = 24 * hour

const ages = {
  A: now - 3 * minute,
  B: now - 20 * minute,
  C: now - 8 * hour,
  D: now - 20 * hour,
  E: now - 30 * hour,
  F: now - 2 * day,
  G: now - 5 * day,
  H: now - 8 * day,
}

test("seeded pair ages fall into different ranges and never share one expected count", () => {
  const times = Object.values(ages)
  const counts = countsByAge(times, now)
  assert.deepEqual(Object.fromEntries(["5m", "1h", "24h", "3d", "7d"].map((id) => {
    const inside = times.filter((time) => isInsideRange(time, id, now))
    return [id, inside.length]
  })), {
    "5m": 1,
    "1h": 2,
    "24h": 4,
    "3d": 6,
    "7d": 7,
  })
  assert.equal(counts["24h"].count, 4)
  assert.equal(counts["3d"].count, 6)
  assert.equal(counts["7d"].count, 7)
  assert.ok(counts["7d"].count > counts["3d"].count)
  assert.ok(counts["3d"].count > counts["24h"].count)
})

test("a 5-day-old pair burned 2 minutes ago is not a new pair and is a new burn", () => {
  const created = now - 5 * day
  const burned = now - 2 * minute
  assert.equal(isInsideRange(created, "5m", now), false)
  assert.equal(isInsideRange(burned, "5m", now), true)
  assert.equal(isInsideRange(created, "7d", now), true)
  assert.equal(isInsideRange(burned, "7d", now), true)
})

test("relative windows include the start and the exact end, and exclude one millisecond earlier", () => {
  for (const [id, span] of [["5m", 5 * minute], ["24h", 24 * hour], ["3d", 3 * day], ["7d", 7 * day]] as const) {
    assert.equal(isInsideRange(now - span, id, now), true)
    assert.equal(isInsideRange(now, id, now), true)
    assert.equal(isInsideRange(now - span - 1, id, now), false)
  }
})

test("the previous comparison window is the same length and does not reuse the current boundary", () => {
  for (const id of ["1h", "3d", "7d"]) {
    const previous = previousBounds(id, now)
    const currentStart = now - rangeById(id).ms
    assert.equal(previous.end, currentStart)
    assert.equal(previous.start, currentStart - rangeById(id).ms)
    assert.equal(isInsidePrevious(currentStart, id, now), false)
    assert.equal(isInsidePrevious(currentStart - 1, id, now), true)
  }
  assert.equal(previousBounds("7d", now).start, now - 14 * day)
  assert.equal(previousBounds("3d", now).start, now - 6 * day)
})

test("browser timezone display does not change which UTC instant is inside a relative range", () => {
  const iso = new Date(now - 30 * minute).toISOString()
  for (const zone of ["UTC", "America/New_York", "Europe/London", "Europe/Helsinki", "Asia/Tokyo"]) {
    const shown = new Date(iso).toLocaleString("en-US", { timeZone: zone })
    assert.ok(shown.length > 0)
    assert.equal(Date.parse(iso), now - 30 * minute)
    assert.equal(isInsideRange(iso, "1h", now), true)
    assert.equal(isInsideRange(iso, "15m", now), false)
  }
})

test("custom ranges keep the requested interval and reject an inverted or empty one", () => {
  const start = now - 6 * day
  const end = now - 4 * day
  assert.equal(inCustomRange(now - 5 * day, start, end), true)
  assert.equal(inCustomRange(now - 1 * hour, start, end), false)
  assert.equal(inCustomRange(start, start, end), true)
  assert.equal(inCustomRange(end, start, end), false)
  assert.equal(parseRange("36h").ok && parseRange("36h").ok ? rangeById("36h").ms : 0, 36 * hour)
  assert.equal(rangeById("14d").ms, 14 * day)
  assert.equal(rangeById("90m").ms, 90 * minute)
  assert.notEqual(rangeById("14d").ms, rangeById("24h").ms)
})

test("invalid ranges throw instead of becoming 1h or 24h", () => {
  for (const input of ["banana", "24", "1x", "-3d", "0h", "0m", "31d", "800h"]) {
    const parsed = parseRange(input)
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.match(parsed.error, /Invalid time range|30 days/)
    assert.throws(() => rangeById(input), /Invalid time range|30 days/)
  }
})

test("for one end time, the 24h set is a subset of 3d and 3d is a subset of 7d", () => {
  const times = [1, 2, 5, 20, 40, 80, 200].map((hoursAgo) => now - hoursAgo * hour)
  const pick = (id: string) => times.filter((time) => isInsideRange(time, id, now))
  const daySet = new Set(pick("24h"))
  const three = pick("3d")
  const week = pick("7d")
  assert.ok([...daySet].every((time) => three.includes(time)))
  assert.ok(three.every((time) => week.includes(time)))
})
