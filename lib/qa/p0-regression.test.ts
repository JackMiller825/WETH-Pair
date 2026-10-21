import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { onActivity, publishActivity } from "../activity/bus"
import { applySighting } from "../activity/client"
import { ActivityStore } from "../activity/store"
import { TRANSFER_TOPIC, freshLiveAlerts, isLiveBurnAlert, passesNotifyFilter } from "../lp/burn-logic"
import { liveBurnEvent, sightingFromMessage } from "../lp/live-feed"
import { DEFAULT_CONFIG } from "../lp/monitor"
import { GasStatusService, MarketStatusService } from "../market/service"
import type { FetchLike } from "../market/types"
import { rankPumpers, type TokenCandidate } from "../pump/rank"
import { EMPTY_DETAIL, type PairRecord } from "../types"

/** P0 target for this test: an injected LP burn is turned into an alert within one 60 Hz frame. */
const P0_TARGET_MS = 16
const BURNS = 40

const HOLDER = "0x3333333333333333333333333333333333333333"
const DEAD = "0x000000000000000000000000000000000000dead"

function pairRecord(index: number): PairRecord {
  const hex = index.toString(16).padStart(4, "0")
  return {
    name: `TK${index}(Token ${index})`,
    created_at: new Date(Date.now() - index * 1000).toISOString(),
    exchange: "Uniswap V2",
    address: `0x111111111111111111111111111111111111${hex}`,
    tokenAddress: `0xffffffffffffffffffffffffffffffffffff${hex}`,
    url: "https://example.com",
    price: 0.001,
    remaining: 1,
    remainingUnit: "ETH",
    listingLiquidity: 1000,
    ...EMPTY_DETAIL,
    holders: 5,
    totalTx: 5,
  }
}

function burnMessage(pair: string, index: number): string {
  return JSON.stringify({
    params: {
      result: {
        address: pair,
        topics: [TRANSFER_TOPIC, `0x${HOLDER.slice(2).padStart(64, "0")}`, `0x${DEAD.slice(2).padStart(64, "0")}`],
        data: `0x${BigInt(5000).toString(16).padStart(64, "0")}`,
        blockNumber: "0x10",
        transactionHash: `0x${index.toString(16).padStart(64, "0")}`,
        logIndex: "0x1",
      },
    },
  })
}

/** The LP monitor's socket handler, minus React: parse, classify, build the event, decide the alert, then hand off. */
function detect(raw: string, pairs: Map<string, PairRecord>, seen: Set<string>, onAlert: (at: number) => void) {
  const sighting = sightingFromMessage(JSON.parse(raw), new Set(pairs.keys()))
  if (sighting?.type !== "burn") throw new Error("not a burn")
  const record = pairs.get(sighting.transfer.pair) as PairRecord
  const event = liveBurnEvent(record, sighting.transfer, new Date().toISOString())
  const fresh = freshLiveAlerts([event].filter(isLiveBurnAlert), seen, (item) => passesNotifyFilter(item, DEFAULT_CONFIG, Date.now()))
  assert.equal(fresh.length, 1)
  seen.add(event.id)
  onAlert(performance.now())
  publishActivity({ type: "burn", event })
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
}

async function injectBurns(pairs: Map<string, PairRecord>, offset: number): Promise<{ latencies: number[]; order: boolean }> {
  const seen = new Set<string>()
  const latencies: number[] = []
  const alertAt = new Map<string, number>()
  let ordered = true
  const off = onActivity((sighting) => {
    if (sighting.type !== "burn") return
    const at = alertAt.get(sighting.event.id)
    if (at == null || performance.now() < at) ordered = false
  })
  const list = [...pairs.values()]
  for (let index = 0; index < BURNS; index++) {
    const pair = list[index % list.length].address.toLowerCase()
    const raw = burnMessage(pair, offset + index)
    const injectedAt = performance.now()
    await new Promise<void>((resolve) =>
      setTimeout(() => {
        detect(raw, pairs, seen, (at) => {
          latencies.push(at - injectedAt)
          alertAt.set(`1:${pair}:0x${(offset + index).toString(16).padStart(64, "0")}:1`, at)
        })
        resolve()
      }, 0),
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  await new Promise((resolve) => setTimeout(resolve, 20))
  off()
  return { latencies, order: ordered }
}

function fakeMarketFetch(): FetchLike {
  const now = Math.floor(Date.now() / 1000)
  return async (url) => {
    if (url.endsWith("/ticker")) return new Response(JSON.stringify({ price: (2400 + Math.random()).toFixed(2), time: new Date().toISOString() }))
    if (url.includes("candles")) return new Response(JSON.stringify(Array.from({ length: 300 }, (_, index) => [now - index * 60, 1, 1, 2400, 2401, 1])))
    if (url.includes("coingecko")) return new Response(JSON.stringify([{ current_price: 2400 }]))
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { oldestBlock: "0x1", baseFeePerGas: Array(21).fill("0x2540be400"), gasUsedRatio: Array(20).fill(0.5), reward: Array(20).fill(["0x1", "0x2", "0x3"]) } }))
  }
}

test("P0: LP burn alert latency stays within one frame while ETH price, gas, holders, and 100 Live Activity events update", async () => {
  const pairs = new Map<string, PairRecord>()
  for (let index = 0; index < 100; index++) {
    const record = pairRecord(index)
    pairs.set(record.address.toLowerCase(), record)
  }

  const idle = await injectBurns(pairs, 0)

  const store = new ActivityStore()
  const offStore = onActivity((sighting) => applySighting(store, sighting))
  for (const record of pairs.values()) applySighting(store, { type: "pair", record, token0: null })
  const eth = new MarketStatusService({ fetcher: fakeMarketFetch() })
  const gas = new GasStatusService({ fetcher: fakeMarketFetch() })
  let running = true
  let marketRefreshes = 0
  let metricUpdates = 0
  let pumpRanks = 0
  const pumpTokens: TokenCandidate[] = Array.from({ length: 2000 }, (_, index) => ({
    pair: `0x${index.toString(16).padStart(40, "a")}`,
    token: `0x${index.toString(16).padStart(40, "b")}`,
    name: `Token ${index}`,
    symbol: `T${index}`,
    createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    url: "https://example.com",
    points: [
      { pair: `0x${index.toString(16).padStart(40, "a")}`, token: `0x${index.toString(16).padStart(40, "b")}`, block: 1, at: Date.now() - 24 * 60 * 60 * 1000, priceWeth: 1, priceUsd: 1, reserveWeth: 2, liquidityUsd: 1000, source: "chain" as const },
      { pair: `0x${index.toString(16).padStart(40, "a")}`, token: `0x${index.toString(16).padStart(40, "b")}`, block: 2, at: Date.now(), priceWeth: 1 + (index % 5), priceUsd: 1 + (index % 5), reserveWeth: 2, liquidityUsd: 1000, source: "chain" as const },
    ],
    pooledWeth: 2,
    liquidityUsd: 1000,
    volumeUsd: index,
    totalTx: 20,
    holders: 10,
    lpBurnPercent: null,
  }))
  const marketLoop = (async () => {
    while (running) {
      await Promise.all([eth.refresh(), gas.refresh()])
      const stamp = Date.now()
      rankPumpers(pumpTokens, { start: stamp - 24 * 60 * 60 * 1000, end: stamp, mode: "window", limit: 20, pumpsOnly: true, hideLowConfidence: true, minLiquidityUsd: null, minWeth: null, minTx: null, minHolders: null, minAgeMs: null, movement: "all", sort: "multiple", coverageOldest: stamp - 8 * 24 * 60 * 60 * 1000 })
      pumpRanks += 1
      marketRefreshes += 1
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
  })()
  const enrichment = setInterval(() => {
    const now = Date.now()
    for (const record of pairs.values()) {
      store.setHolders(record.tokenAddress, { value: metricUpdates, source: "blockscout", observedAt: now + metricUpdates, block: null })
      store.addSwap(record.address, `0x${metricUpdates}:${record.address}`, 100 + metricUpdates, now)
      metricUpdates += 1
    }
    for (const item of store.getList()) store.metricsFor(item.pairAddress, item.tokenAddress)
  }, 3)

  const loaded = await injectBurns(pairs, 10_000)
  running = false
  clearInterval(enrichment)
  await marketLoop
  offStore()

  const idleP95 = p95(idle.latencies)
  const loadedP95 = p95(loaded.latencies)
  console.log(`[P0] Burn-to-alert p95 idle ${idleP95.toFixed(2)}ms, under load ${loadedP95.toFixed(2)}ms (${marketRefreshes} market refreshes, ${pumpRanks} pump rankings, ${metricUpdates} metric updates, ${store.getList().length} activity cards)`)
  assert.equal(loaded.latencies.length, BURNS)
  assert.ok(marketRefreshes > 5 && pumpRanks > 5 && metricUpdates > 1000, "the load actually ran")
  assert.ok(loadedP95 < P0_TARGET_MS, `p95 ${loadedP95}ms exceeds the ${P0_TARGET_MS}ms P0 target`)
  assert.ok(idle.order && loaded.order, "Live Activity only hears about a burn after its alert was decided")
  assert.ok(store.getList().some((item) => item.type === "lp-burn"), "burns still reach Live Activity")
})

test("P0 isolation: LP monitoring code imports nothing from market data or Live Activity", () => {
  const dir = path.join(process.cwd(), "lib", "lp")
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
    const source = readFileSync(path.join(dir, file), "utf8")
    assert.doesNotMatch(source, /@\/lib\/(market|activity|pump)|\.\.\/(market|activity|pump)\//, `${file} must not depend on enrichment`)
  }
})

test("P0 ordering: the monitor decides and delivers a burn alert before it publishes to Live Activity", () => {
  const source = readFileSync(path.join(process.cwd(), "components", "lp", "monitor-context.tsx"), "utf8")
  const announce = source.slice(source.indexOf("const announce = useCallback"), source.indexOf("const load = useCallback"))
  assert.ok(announce.indexOf("considerAlerts(") >= 0)
  assert.ok(announce.indexOf("publishActivity(") > announce.indexOf("considerAlerts("))
  const bus = readFileSync(path.join(process.cwd(), "lib", "activity", "bus.ts"), "utf8")
  assert.match(bus, /setTimeout\(flush, 0\)/, "listeners run in a later task, not inside the socket handler")
})
