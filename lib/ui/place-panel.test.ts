import assert from "node:assert/strict"
import test from "node:test"
import { placeFloatingPanel } from "./place-panel"

const viewport = { width: 1440, height: 900 }

test("a panel beside the right edge stays inside the viewport", () => {
  const box = placeFloatingPanel({ top: 200, right: 1420, bottom: 224 }, viewport, 320)
  assert.equal(box.above, false)
  assert.equal(box.left + box.width <= viewport.width - 8, true)
  assert.equal(box.top, 232)
})

test("a panel near the bottom opens upward", () => {
  const box = placeFloatingPanel({ top: 780, right: 700, bottom: 804 }, viewport, 320)
  assert.equal(box.above, true)
  assert.equal(box.top, 772)
  assert.ok(box.maxHeight >= 120)
})

test("a narrow viewport shrinks the panel instead of pushing it off screen", () => {
  const box = placeFloatingPanel({ top: 40, right: 300, bottom: 64 }, { width: 300, height: 700 }, 320)
  assert.equal(box.left, 8)
  assert.equal(box.width, 284)
  assert.equal(box.left + box.width <= 292, true)
  assert.equal(box.above, false)
})
