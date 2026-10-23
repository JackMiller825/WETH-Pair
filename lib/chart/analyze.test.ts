import assert from "node:assert/strict"
import test from "node:test"
import { analyze } from "@/lib/chart/analyze"
import { decodeV2Swap } from "@/lib/chart/decode"
import { cadencePace, splitActivity, summarizeFlow, traderCount, type ChartTrade } from "@/lib/chart/flow"
import { intervalStats } from "@/lib/chart/flow"
import { tradeSizePace } from "@/lib/chart/flow"
import { classifyStructure } from "@/lib/chart/structure"
import { appendOutcome, calibration, submitReview, type ChartReview } from "@/lib/chart/training"
import type { ChartInput, ChartSample } from "@/lib/chart/analyze"

const ONE = BigInt("1000000000000000000")

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0")
}

function data(...values: bigint[]): string {
  return `0x${values.map(word).join("")}`
}

function trade(at: number, side: "buy" | "sell", weth: number, trader: string | null = null): ChartTrade {
  return { id: `${side}:${at}:${weth}`, at, block: at, side, weth, token: 1, priceWeth: weth, sender: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", recipient: null, trader }
}

function sample(at: number, price: number, reserve: number | null = 10): ChartSample {
  return { at, price, reserveWeth: reserve }
}

function input(patch: Partial<ChartInput> = {}): ChartInput {
  return {
    createdAt: 0,
    now: 10 * 60_000,
    samples: [],
    trades: [],
    burns: [],
    lpStatus: "burnt",
    lpBurnPercent: 100,
    buys24h: null,
    makers24h: null,
    holders: null,
    holdersObservedAt: null,
    liquidityUsd: null,
    deployer: null,
    flowRead: "none",
    ...patch,
  }
}

test("net flow is buy WETH minus sell WETH, and counts stay separate", () => {
  const totals = summarizeFlow([trade(1, "buy", 12), trade(2, "sell", 45)])
  assert.equal(totals.netWeth, -33)
  assert.equal(totals.buyCount, 1)
  assert.equal(totals.sellCount, 1)
  const many = summarizeFlow([...Array.from({ length: 100 }, (_, index) => trade(index, "buy", 0.02)), ...Array.from({ length: 20 }, (_, index) => trade(1000 + index, "sell", 0.5))])
  assert.equal(many.buyCount, 100)
  assert.equal(many.sellCount, 20)
  assert.ok(Math.abs(many.netWeth - (2 - 10)) < 1e-9)
})

test("median buy interval is the middle gap", () => {
  const stats = intervalStats([0, 10_000, 20_000, 30_000])
  assert.equal(stats?.medianMs, 10_000)
})

test("buyer cadence slowing is three rising median intervals", () => {
  assert.equal(cadencePace([8_000, 18_000, 32_000]), "slowing")
  assert.equal(cadencePace([18_000, 11_000, 7_000]), "accelerating")
})

test("buyer size declining follows the median series", () => {
  assert.equal(tradeSizePace([0.3, 0.12, 0.05]), "declining")
  assert.equal(tradeSizePace([0.18, 0.24, 0.37]), "increasing")
})

test("V2 buys and sells follow whichever side WETH is on", () => {
  const token = ONE * BigInt(1000)
  const buy0 = decodeV2Swap(data(ONE, BigInt(0), BigInt(0), token), true, 18)
  assert.equal(buy0?.side, "buy")
  assert.equal(buy0?.weth, 1)
  const sell0 = decodeV2Swap(data(BigInt(0), token, ONE, BigInt(0)), true, 18)
  assert.equal(sell0?.side, "sell")
  assert.equal(sell0?.weth, 1)
  const buy1 = decodeV2Swap(data(BigInt(0), ONE, token, BigInt(0)), false, 18)
  assert.equal(buy1?.side, "buy")
  assert.equal(buy1?.weth, 1)
  const sell1 = decodeV2Swap(data(BigInt(1000) * (BigInt(10) ** BigInt(6)), BigInt(0), BigInt(0), ONE), false, 6)
  assert.equal(sell1?.side, "sell")
  assert.ok(sell1 && Math.abs(sell1.token - 1000) < 1e-6)
  assert.equal(decodeV2Swap("0x1234", true, 18), null)
})

test("router senders are not unique traders", () => {
  const swaps = Array.from({ length: 10 }, (_, index) => trade(index, "buy", 0.1, "0xabcabcabcabcabcabcabcabcabcabcabcabcabca"))
  assert.equal(traderCount(swaps).count, 1)
  assert.equal(traderCount(swaps.map((item) => ({ ...item, trader: null }))).count, null)
})

test("repetitive sizes stay separate from raw swaps", () => {
  const human = [0.11, 0.23, 0.4, 0.17].map((weth, index) => trade(index * 1000, "buy", weth))
  const bots = Array.from({ length: 6 }, (_, index) => trade(10_000 + index, "buy", 0.05))
  const split = splitActivity([...human, ...bots])
  assert.equal(split.raw, 10)
  assert.equal(split.repetitive, 6)
  assert.equal(split.independentEstimate, null)
})

test("replay hides every observation after the cutoff", () => {
  const future = trade(6 * 60_000, "sell", 45)
  const report = analyze(input({
    now: 10 * 60_000,
    cutoff: 5 * 60_000,
    flowRead: "decoded",
    trades: [trade(60_000, "buy", 1), future],
    samples: [sample(0, 1), sample(4 * 60_000, 1.2), sample(6 * 60_000, 0.2, 1)],
  }))
  assert.equal(report.flow.sellWeth, 0)
  assert.equal(report.flow.buyWeth, 1)
  assert.ok(!report.evidence.join(" ").includes("45"))
  assert.ok(report.liquidity.endWeth == null || report.liquidity.endWeth >= 10)
})

test("a one-minute pair with three swaps cannot score 95% confidence", () => {
  const report = analyze(input({
    now: 60_000,
    flowRead: "decoded",
    trades: [trade(10_000, "buy", 0.1), trade(20_000, "buy", 0.1), trade(30_000, "sell", 0.05)],
    samples: [sample(0, 1), sample(30_000, 1.1), sample(60_000, 1.05)],
  }))
  assert.ok(report.confidence < 50)
  assert.equal(report.wallets.known, false)
  assert.equal(report.buyers.known, false)
})

test("missing wallet data does not become zero", () => {
  const report = analyze(input({
    now: 20 * 60_000,
    samples: [0, 1, 2, 3, 4, 5].map((minute) => sample(minute * 60_000, 1 + minute * 0.05)),
  }))
  assert.equal(report.flow.known, false)
  assert.equal(report.flow.netWeth, null)
  assert.equal(report.wallets.known, false)
  assert.ok(report.parts.find((part) => part.id === "wallets")?.points == null)
})

test("structure fixtures stay distinct", () => {
  const minute = 60_000
  const up = [1, 1.05, 1.02, 1.12, 1.09, 1.2].map((price, index) => ({ at: index * minute, price }))
  assert.equal(classifyStructure(up, null).id, "healthy-uptrend")
  const dump = [1, 1.8, 3, 2.2, 1.2, 0.9].map((price, index) => ({ at: index * minute, price }))
  assert.equal(classifyStructure(dump, null).id, "pump-dump")
  const flat = [1, 1.02, 0.99, 1.01, 1, 1.01].map((price, index) => ({ at: index * 2 * minute, price }))
  assert.equal(classifyStructure(flat, null).id, "consolidation")
  const fail = [1, 1.05, 1.02, 1.08, 1.4, 1.04].map((price, index) => ({ at: index * minute, price }))
  assert.equal(classifyStructure(fail, null).id, "failed-breakout")
  const shock = [1, 1.1, 1.2, 1.15].map((price, index) => ({ at: index * minute, price }))
  assert.equal(classifyStructure(shock, -0.5).id, "liquidity-shock")
  const distributed = [1, 1.45, 1.2, 1.05, 0.9, 1].map((price, index) => ({ at: index * minute, price }))
  assert.equal(classifyStructure(distributed, null).id, "distribution")
  assert.equal(classifyStructure([{ at: 0, price: 1 }], null).id, "insufficient")
})

test("a saved verdict is not rewritten when a later outcome arrives", () => {
  const review: ChartReview = { id: "r1", pair: "0xabc", submittedAt: 1, cutoff: 1, verdict: "strong", confidence: 90, notes: "candles", engineVerdict: "weakening", engineConfidence: 40, outcomes: [] }
  const saved = submitReview([], review)
  const next = appendOutcome(saved, "r1", { horizon: "15m", priceChange: -0.4, reserveChange: -0.1, recordedAt: 2 })
  assert.equal(next[0].verdict, "strong")
  assert.equal(next[0].notes, "candles")
  assert.equal(appendOutcome(next, "r1", { horizon: "15m", priceChange: 1, reserveChange: 1, recordedAt: 3 })[0].outcomes.length, 1)
  const band = Array.from({ length: 8 }, (_, index) => ({ ...review, id: `b${index}`, outcomes: [{ horizon: "15m" as const, priceChange: -0.2, reserveChange: null, recordedAt: 2 }] }))
  assert.equal(calibration(band).label, "Overconfident")
})
