import assert from "node:assert/strict"
import test from "node:test"
import { formatGwei } from "./format"
import { RpcFeeHistoryProvider, estimateFromFeeHistory } from "./gas"
import { GAS_STALE_MS, GasStatusService, feedHealth } from "./service"
import type { FetchLike } from "./types"

const T = Date.UTC(2026, 9, 20, 12, 0, 0)
const AT = new Date(T).toISOString()

const gwei = (value: number) => `0x${BigInt(Math.round(value * 1e9)).toString(16)}`

function history(base: number[], rewards: number[][], used?: number[]) {
  return {
    oldestBlock: "0x100",
    baseFeePerGas: base.map(gwei),
    gasUsedRatio: used ?? rewards.map(() => 0.5),
    reward: rewards.map((row) => row.map(gwei)),
  }
}

test("normal fee: next-block base fee plus the median percentile tip", () => {
  const estimate = estimateFromFeeHistory(history([20, 21, 22, 24], [[1, 2, 3], [1, 2, 4], [2, 3, 5]]), AT, "rpc", "RPC")
  assert.equal(estimate.baseFee, 24)
  assert.equal(estimate.standard.gwei, 25)
  assert.equal(estimate.fast.gwei, 26)
  assert.equal(estimate.rapid.gwei, 28)
  assert.equal(estimate.standard.maxFeePerGas, 49)
  assert.equal(estimate.blockNumber, 0x100 + 2)
})

test("sub-0.1 gwei values survive and format with three decimals", () => {
  const estimate = estimateFromFeeHistory(history([0.035, 0.035], [[0, 0, 0.004]]), AT, "rpc", "RPC")
  assert.equal(formatGwei(estimate.standard.gwei), "0.035")
  assert.equal(formatGwei(estimate.rapid.gwei), "0.039")
  assert.equal(formatGwei(0.0004), "0.0004")
})

test("high gas formats with one decimal, and over 100 as a whole number", () => {
  const estimate = estimateFromFeeHistory(history([150, 152.3], [[2, 3, 10]]), AT, "rpc", "RPC")
  assert.equal(formatGwei(estimate.standard.gwei), "154")
  assert.equal(formatGwei(12.44), "12.4")
})

test("standard can equal fast, and rapid is never below fast", () => {
  const equal = estimateFromFeeHistory(history([1, 1], [[0.5, 0.5, 0.5]]), AT, "rpc", "RPC")
  assert.equal(equal.standard.gwei, equal.fast.gwei)
  const inverted = estimateFromFeeHistory(history([1, 1], [[0.5, 0.3, 0.1]]), AT, "rpc", "RPC")
  assert.ok(inverted.fast.gwei >= inverted.standard.gwei)
  assert.ok(inverted.rapid.gwei >= inverted.fast.gwei)
  const spread = estimateFromFeeHistory(history([1, 1], [[0.1, 0.2, 0.9]]), AT, "rpc", "RPC")
  assert.ok(spread.rapid.gwei > spread.fast.gwei)
})

test("empty blocks do not drag the tips to zero", () => {
  const estimate = estimateFromFeeHistory(history([1, 1, 1, 1], [[0, 0, 0], [1, 1, 1], [1, 1, 1]], [0, 0.5, 0.6]), AT, "rpc", "RPC")
  assert.equal(estimate.standard.priorityFee, 1)
})

test("a base fee change moves every tier with it", () => {
  const before = estimateFromFeeHistory(history([10, 10], [[1, 2, 3]]), AT, "rpc", "RPC")
  const after = estimateFromFeeHistory(history([10, 12], [[1, 2, 3]]), AT, "rpc", "RPC")
  assert.equal(after.standard.gwei - before.standard.gwei, 2)
  assert.equal(after.rapid.gwei - before.rapid.gwei, 2)
})

test("malformed fee history is rejected", () => {
  assert.throws(() => estimateFromFeeHistory(null, AT, "rpc", "RPC"))
  assert.throws(() => estimateFromFeeHistory({ baseFeePerGas: [], reward: [] }, AT, "rpc", "RPC"))
  assert.throws(() => estimateFromFeeHistory({ baseFeePerGas: ["zz"], reward: [["0x1", "0x1", "0x1"]], gasUsedRatio: [1] }, AT, "rpc", "RPC"))
  assert.throws(() => estimateFromFeeHistory(history([1, 1], [[1, 1]]), AT, "rpc", "RPC"))
})

function rpcFetch(failing: Set<string>, base = 0.035): FetchLike {
  return async (url) => {
    if (failing.has(new URL(url).host)) return new Response("busy", { status: 429 })
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: history([base, base], [[0.001, 0.002, 0.004]]) }))
  }
}

test("primary RPC unavailable falls back to the next RPC and is marked as a fallback", async () => {
  const service = new GasStatusService({ fetcher: rpcFetch(new Set(["rpc.mevblocker.io"])), now: () => T })
  const state = await service.refresh()
  assert.equal(state.fallback, true)
  assert.match(state.data?.sourceLabel ?? "", /eth\.drpc\.org/)
  assert.equal(feedHealth(state, T, GAS_STALE_MS), "degraded")
})

test("every gas source failing is unavailable, then stale data is labelled stale", async () => {
  let now = T
  const down = new Set(["rpc.mevblocker.io", "eth.drpc.org", "ethereum-rpc.publicnode.com"])
  const none = new GasStatusService({ fetcher: rpcFetch(down), now: () => now })
  const empty = await none.refresh()
  assert.equal(empty.data, null)
  assert.equal(feedHealth(empty, now, GAS_STALE_MS), "unavailable")

  const up = new Set<string>()
  const service = new GasStatusService({ fetcher: rpcFetch(up), now: () => now })
  await service.refresh()
  for (const host of down) up.add(host)
  now += GAS_STALE_MS + 1000
  const kept = await service.refresh()
  assert.equal(kept.data?.baseFee, 0.035)
  assert.equal(feedHealth(kept, now, GAS_STALE_MS), "stale")
})

test("an RPC error body is a provider failure", async () => {
  const provider = new RpcFeeHistoryProvider("https://rpc.example", async () => new Response(JSON.stringify({ error: { message: "rate limited" } })), () => T)
  await assert.rejects(provider.getGasEstimate(), /rate limited/)
  assert.equal(provider.getHealth().ok, false)
})
