import assert from "node:assert/strict"
import test from "node:test"
import { formatWeth } from "../market/format"
import { holderRefreshMs } from "./holders"
import { EMPTY_COUNTER, STALE_FALLBACK_MS, acceptMetric, addSwap, setTxBaseline, txTotal, type Metric, type TxCounter } from "./metrics"
import { POOL_MANAGER, POOL_TOPICS, classifyPoolLog, decodeReserves, pooledWethFromReserves, toWeth, wethIsToken0 } from "./pool"
import { WETH } from "../history/plan"

const T = Date.UTC(2026, 9, 20, 12, 0, 0)
const LOW = "0x1111111111111111111111111111111111111111"
const HIGH = "0xffffffffffffffffffffffffffffffffffffffff"
const ONE = BigInt(10) ** BigInt(18)

function m(value: number, observedAt: number, block: number | null, source: Metric<number>["source"] = "chain"): Metric<number> {
  return { value, observedAt, block, source }
}

const word = (value: bigint) => value.toString(16).padStart(64, "0")

test("WETH side: token0 from the log when known, otherwise the lower address", () => {
  assert.equal(wethIsToken0(HIGH), true, "WETH 0xc02a… sorts below 0xffff…")
  assert.equal(wethIsToken0(LOW), false, "0x1111… sorts below WETH, so WETH is token1")
  assert.equal(wethIsToken0(LOW, WETH), true)
  assert.equal(wethIsToken0(HIGH, HIGH), false)
})

test("pooled WETH reads reserve0 when WETH is token0 and reserve1 when it is token1", () => {
  const data = `0x${word(BigInt(842) * ONE / BigInt(100))}${word(BigInt(5_000_000) * ONE)}${word(BigInt(1))}`
  const { reserve0, reserve1 } = decodeReserves(data)
  assert.equal(pooledWethFromReserves(reserve0, reserve1, true), 8.42)
  assert.equal(pooledWethFromReserves(reserve1, reserve0, false), 8.42)
  assert.equal(pooledWethFromReserves(reserve0, reserve1, false), 5_000_000)
})

test("large and tiny reserves keep their precision and format readably", () => {
  assert.equal(toWeth(BigInt(182_345) * ONE), 182_345)
  assert.equal(toWeth(BigInt(42) * BigInt(10) ** BigInt(14)), 0.0042)
  assert.equal(formatWeth(0.0042), "0.0042")
  assert.equal(formatWeth(0.82), "0.82")
  assert.equal(formatWeth(4.371), "4.37")
  assert.equal(formatWeth(18.43), "18.4")
  assert.equal(formatWeth(1284.2), "1,284")
  assert.equal(formatWeth(182_345), "182.3K")
  assert.equal(formatWeth(0), "0")
  assert.equal(formatWeth(null), "N/A")
})

test("pool logs: V2 Sync, V2 and V3 swaps, and a V4 swap keyed by pool id", () => {
  const sync = classifyPoolLog({ address: LOW, topics: [POOL_TOPICS.v2Sync], data: `0x${word(ONE)}${word(ONE * BigInt(2))}`, blockNumber: "0x10", transactionHash: "0xaa", logIndex: "0x1" })
  assert.equal(sync?.kind, "sync")
  const swap = classifyPoolLog({ address: LOW, topics: [POOL_TOPICS.v3Swap], data: "0x", blockNumber: "0x10", transactionHash: "0xaa", logIndex: "0x2" })
  assert.deepEqual(swap, { kind: "swap", pair: LOW, id: "0xaa:2", block: 16 })
  const poolId = `0x${"ab".repeat(32)}`
  const v4 = classifyPoolLog({ address: POOL_MANAGER, topics: [POOL_TOPICS.v4Swap, poolId], data: "0x", blockNumber: "0x11", transactionHash: "0xbb", logIndex: "0x0" })
  assert.equal(v4?.kind === "swap" && v4.pair, poolId)
  assert.equal(classifyPoolLog({ address: LOW, topics: [POOL_TOPICS.v2Swap], blockNumber: "0x10", removed: true }), null)
})

test("metric ordering: a later block wins and an older block is rejected", () => {
  assert.equal(acceptMetric(m(8.4, T, 500), m(7.9, T + 1000, 490)), false)
  assert.equal(acceptMetric(m(8.4, T, 500), m(8.5, T + 1000, 501)), true)
  assert.equal(acceptMetric(m(8.4, T, 500), m(8.6, T + 1, 500)), true)
})

test("metric ordering: a third-party value without a block does not overwrite on-chain data until it is stale", () => {
  const chain = m(8.4, T, 500)
  assert.equal(acceptMetric(chain, m(7.9, T + 60_000, null, "dextools")), false)
  assert.equal(acceptMetric(chain, m(7.9, T + STALE_FALLBACK_MS + 1, null, "dextools")), true)
  assert.equal(acceptMetric(m(7.9, T, null, "dextools"), m(8.4, T - 1000, 500)), true, "on-chain outranks the snapshot")
})

test("holder counts: newer wins, a delayed older reply loses, and a lower-ranked source waits for staleness", () => {
  const newer = m(91, T + 5000, null, "blockscout")
  assert.equal(acceptMetric(newer, m(80, T, null, "blockscout")), false, "old request answering late")
  assert.equal(acceptMetric(m(80, T, null, "blockscout"), newer), true)
  assert.equal(acceptMetric(newer, m(95, T + 60_000, null, "dextools")), false)
  assert.equal(acceptMetric(newer, m(95, T + 5000 + STALE_FALLBACK_MS + 1, null, "dextools")), true)
  for (const value of [0, 1, 100, 10_000]) assert.equal(acceptMetric(null, m(value, T, null, "blockscout")), true)
})

function counter(baseline: Parameters<typeof setTxBaseline>[1]): TxCounter {
  return setTxBaseline(EMPTY_COUNTER, baseline) as TxCounter
}

test("Total Tx: unknown until a baseline exists, then 0, a buy, a sell, and several swaps", () => {
  assert.equal(txTotal(EMPTY_COUNTER), null)
  let value = counter({ count: 0, observedAt: T, block: 99, source: "chain" })
  assert.equal(txTotal(value), 0)
  value = addSwap(value, "0xa:1", 100, T) as TxCounter
  assert.equal(txTotal(value), 1)
  value = addSwap(value, "0xb:4", 101, T) as TxCounter
  value = addSwap(value, "0xc:0", 101, T) as TxCounter
  assert.equal(txTotal(value), 3)
})

test("Total Tx: a duplicate log never double counts", () => {
  let value = counter({ count: 10, observedAt: T, block: null, source: "dextools" })
  value = addSwap(value, "0xa:1", 100, T + 1) as TxCounter
  assert.equal(addSwap(value, "0xa:1", 100, T + 2), null)
  assert.equal(txTotal(value), 11)
})

test("Total Tx after reload: a newer snapshot baseline absorbs live swaps seen before it, and the ids stay deduplicated", () => {
  let value = counter({ count: 140, observedAt: T, block: null, source: "dextools" })
  value = addSwap(value, "0xa:1", 100, T + 10_000) as TxCounter
  value = addSwap(value, "0xb:1", 101, T + 70_000) as TxCounter
  assert.equal(txTotal(value), 142)
  value = setTxBaseline(value, { count: 146, observedAt: T + 60_000, block: null, source: "dextools" }) as TxCounter
  assert.equal(txTotal(value), 147, "0xa is inside the new baseline; 0xb came after it")
  assert.equal(addSwap(value, "0xa:1", 100, T + 80_000), null)
  assert.equal(setTxBaseline(value, { count: 120, observedAt: T, block: null, source: "dextools" }), null, "an older snapshot is ignored")
})

test("Total Tx: an exact on-chain count is not replaced by a DEXTools total", () => {
  const exact = counter({ count: 0, observedAt: T, block: 99, source: "chain" })
  assert.equal(setTxBaseline(exact, { count: 5, observedAt: T + 60_000, block: null, source: "dextools" }), null)
})

test("holder refresh is fastest for new tokens and slowest for quiet old ones", () => {
  assert.equal(holderRefreshMs(5 * 60_000), 20_000)
  assert.equal(holderRefreshMs(30 * 60_000), 60_000)
  assert.equal(holderRefreshMs(5 * 60 * 60_000), 3 * 60_000)
  assert.equal(holderRefreshMs(3 * 24 * 60 * 60_000), 10 * 60_000)
  assert.equal(holderRefreshMs(3 * 24 * 60 * 60_000, 60_000), 3 * 60_000)
})
