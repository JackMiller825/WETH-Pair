import assert from "node:assert/strict"
import test from "node:test"
import { barsFromCandles } from "./chart"
import type { Candle } from "./price"
import { downsampleGas, pointsFromFeeHistory } from "./gas-history"
import { absorbReceipt, rankUsage, usageBlocks, type UsageTotals } from "./gas-usage"

test("ETH bars keep candles inside the span and order them oldest first", () => {
  const now = Date.parse("2026-10-21T12:00:00Z")
  const candles: Candle[] = [
    [now / 1000 - 120, 1, 4, 2, 3, 1],
    [now / 1000 - 10_000, 1, 2, 1, 1, 1],
    [now / 1000 - 60, 2, 5, 3, 4, 1],
  ]
  const bars = barsFromCandles(candles, now, 5 * 60 * 1000)
  assert.deepEqual(bars.map((bar) => bar.close), [3, 4])
  assert.equal(bars[0].at < bars[1].at, true)
})

test("fee history becomes one gas point per block", () => {
  const points = pointsFromFeeHistory(
    {
      oldestBlock: "0x64",
      baseFeePerGas: ["0x3b9aca00", "0x3b9aca00", "0x77359400"],
      gasUsedRatio: [0.5, 0.5],
      reward: [
        ["0x5f5e100", "0xbebc200", "0x11e1a300"],
        ["0x5f5e100", "0xbebc200", "0x11e1a300"],
      ],
    },
    { block: 101, timeMs: 1_000_000 },
  )
  assert.equal(points.length, 2)
  assert.equal(points[0].block, 100)
  assert.equal(points[0].at, 1_000_000 - 12_000)
  assert.ok(Math.abs(points[0].base - 1) < 1e-9)
  assert.ok(Math.abs(points[0].standard - 1.1) < 1e-6)
  assert.ok(points[0].rapid >= points[0].fast && points[0].fast >= points[0].standard)
  assert.equal(downsampleGas(points, 2).length, 2)
})

test("guzzlers rank by gas and spenders rank by fees, with shares of the sample", () => {
  const guzzlers = new Map<string, UsageTotals>()
  const spenders = new Map<string, UsageTotals>()
  const contract = "0x1111111111111111111111111111111111111111"
  const other = "0x2222222222222222222222222222222222222222"
  const payer = "0x3333333333333333333333333333333333333333"
  absorbReceipt(guzzlers, spenders, { from: payer, to: contract, gasUsed: "0x10", effectiveGasPrice: "0x3b9aca00" }, true)
  absorbReceipt(guzzlers, spenders, { from: payer, to: other, gasUsed: "0x30", effectiveGasPrice: "0x3b9aca00" }, false)
  const byGas = rankUsage(guzzlers, "gas")
  assert.equal(byGas[0].address, other)
  assert.equal(byGas[0].share24, 75)
  assert.equal(byGas[1].share3, 100)
  const byFee = rankUsage(spenders, "fee")
  assert.equal(byFee.length, 1)
  assert.equal(byFee[0].share24, 100)
  assert.ok(usageBlocks(10_000).includes(10_000))
  assert.ok(usageBlocks(10_000).every((block) => block <= 10_000))
})
