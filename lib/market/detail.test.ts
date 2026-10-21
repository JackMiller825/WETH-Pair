import assert from "node:assert/strict"
import test from "node:test"
import { applyLivePrice, barsFromCandles, bucketBars, candleCountdown, candlesFromCoinGecko, candlesFromKraken, clearEthBarCache, formatCountdown, lastPriceFromCoinGecko, lastPriceFromKraken, loadEthBars } from "./chart"
import type { FetchLike } from "./types"
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

test("Kraken and CoinGecko candles become the same bar shape, and 1h bars bucket into 6h", () => {
  const kraken = candlesFromKraken({
    error: [],
    result: { XETHZUSD: [[1_700_000_000, "10", "14", "9", "12", "11", "3", 4]], last: 1 },
  })
  assert.deepEqual(kraken[0], [1_700_000_000, 9, 14, 10, 12, 3])
  const gecko = candlesFromCoinGecko([[1_700_000_000_000, 10, 14, 9, 12]])
  assert.equal(gecko[0][0], 1_700_000_000)
  assert.equal(gecko[0][4], 12)
  const hour = 60 * 60 * 1000
  const bucket = bucketBars([
    { at: hour, open: 10, high: 12, low: 9, close: 11 },
    { at: hour * 2, open: 11, high: 15, low: 8, close: 14 },
    { at: hour * 7, open: 14, high: 16, low: 13, close: 15 },
  ], 6 * hour)
  assert.equal(bucket.length, 2)
  assert.deepEqual(bucket[0], { at: 0, open: 10, high: 15, low: 8, close: 14 })
})

test("the countdown is the time left in the candle, and a live trade moves the open candle", () => {
  const minute = 60_000
  const now = Date.parse("2026-10-21T12:00:40.000Z")
  const left = candleCountdown(now, minute)
  assert.equal(left.remainingMs, 20_000)
  assert.equal(formatCountdown(left.remainingMs), "00:20")
  assert.equal(formatCountdown(70_000), "01:10")
  assert.equal(formatCountdown(3_661_000), "1:01:01")
  assert.equal(candleCountdown(Date.parse("2026-10-21T12:00:00.000Z"), minute).remainingMs, minute)
  const bars = applyLivePrice([{ at: now - 40_000, open: 10, high: 11, low: 9, close: 10 }], 12, now, minute)
  assert.equal(bars[0].close, 12)
  assert.equal(bars[0].high, 12)
  const rolled = applyLivePrice(bars, 13, now + minute, minute)
  assert.equal(rolled.length, 2)
  assert.equal(rolled[1].open, 12)
  assert.equal(rolled[1].close, 13)
  assert.equal(lastPriceFromKraken({ error: [], result: { XETHZUSD: { c: ["2436.47", "0.1"] } } }), 2436.47)
  assert.equal(lastPriceFromCoinGecko({ ethereum: { usd: 2435.1 } }), 2435.1)
})

test("the ETH chart uses Kraken when Coinbase does not answer", async () => {
  clearEthBarCache()
  const now = Date.parse("2026-10-21T12:00:00Z")
  const fetcher: FetchLike = async (input) => {
    const url = String(input)
    if (url.includes("coinbase")) throw new Error("Failed to fetch")
    if (url.includes("kraken")) {
      const body = { error: [], result: { XETHZUSD: [[(now - 600_000) / 1000, "10", "12", "9", "11", "10", "1", 1], [(now - 300_000) / 1000, "11", "13", "10", "12", "12", "1", 1]] } }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    throw new Error(url)
  }
  const loaded = await loadEthBars("5m", fetcher, now)
  assert.equal(loaded.source, "Kraken")
  assert.deepEqual(loaded.bars.map((bar) => bar.close), [11, 12])
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
