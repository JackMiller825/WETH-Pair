import assert from "node:assert/strict"
import test from "node:test"
import { burnEventId, type LpBurnEvent } from "../lp/monitor"
import type { SnapshotFile } from "../narrative/types"
import { EMPTY_DETAIL, type PairRecord } from "../types"
import { applySighting } from "./client"
import { MAX_ACTIVITY, ActivityStore, filterActivity, type ActivityPatch } from "./store"

const T = Date.UTC(2026, 9, 20, 12, 0, 0)
const TX = `0x${"ab".repeat(32)}`

function record(index: number, patch: Partial<PairRecord> = {}): PairRecord {
  const hex = index.toString(16).padStart(4, "0")
  return {
    name: `TK${index}(Token ${index})`,
    created_at: new Date(T - index * 60_000).toISOString(),
    exchange: "Uniswap V2",
    address: `0x222222222222222222222222222222222222${hex}`,
    tokenAddress: `0xffffffffffffffffffffffffffffffffffff${hex}`,
    url: `https://www.dextools.io/app/ether/pair-explorer/${index}`,
    price: 0.001,
    remaining: 4.82,
    remainingUnit: "ETH",
    listingLiquidity: 1000,
    ...EMPTY_DETAIL,
    liquidity: 1000,
    holders: 19,
    totalTx: 27,
    creationBlock: 1000 - index,
    ...patch,
  }
}

function burn(row: PairRecord, at = T): LpBurnEvent {
  return {
    id: burnEventId(row.address, TX, 7),
    chainId: 1,
    pair: row.address.toLowerCase(),
    tokenAddress: row.tokenAddress.toLowerCase(),
    symbol: "TK1",
    tokenName: "Token 1",
    exchange: row.exchange,
    createdAt: row.created_at,
    detectedAt: new Date(at).toISOString(),
    burnAt: new Date(at).toISOString(),
    kind: "newly-burned",
    lpBurntPercent: 99.82,
    lpSupply: null,
    lpBurnedTokens: null,
    lpRemaining: null,
    liquidity: null,
    marketCap: null,
    volume24h: null,
    buys24h: null,
    deployer: null,
    url: row.url,
    burnTx: TX,
    burnBlock: 1001,
    burnFrom: null,
    logIndex: 7,
    source: "ethereum-transfer",
    detectionSource: "live",
    percentKnown: true,
  }
}

function snapshot(rows: PairRecord[], lpBurns: LpBurnEvent[] = [], generatedAt = T): SnapshotFile {
  return { generatedAt: new Date(generatedAt).toISOString(), hours: 24, scanned: rows.length, rows, lpBurns, signals: [{ id: "ai:1", type: "trend", at: new Date(T).toISOString(), title: "AI", detail: "5 launches", href: "/trends/ai" }] }
}

function syncStore() {
  return new ActivityStore(() => T, (run) => run())
}

test("a live new pair appears before any enrichment, with every metric loading rather than zero", () => {
  const store = syncStore()
  const row = record(1, { listingSource: "ethereum-pair-created", name: "WETH pair", holders: null, totalTx: null, remaining: null })
  applySighting(store, { type: "pair", record: row, token0: null })
  const [item] = store.getList()
  assert.equal(item.type, "new-pair")
  assert.equal(item.symbol, "")
  const view = store.metricsFor(item.pairAddress, item.tokenAddress)
  assert.equal(view.totalTx.status, "loading")
  assert.equal(view.pooledWeth.status, "loading")
  assert.equal(view.holders.status, "loading")
  assert.equal(view.enrichment.coreReady, true)
  assert.equal(view.enrichment.holdersReady, false)
})

test("an LP burn card carries the burn percent and the pair metrics from the snapshot", () => {
  const store = syncStore()
  const row = record(1)
  store.ingestSnapshot(snapshot([row], [burn(row)]))
  const card = store.getList().find((item) => item.type === "lp-burn")
  assert.ok(card)
  assert.equal(card.lpBurnPercent, 99.82)
  const view = store.metricsFor(card.pairAddress, card.tokenAddress)
  assert.equal(view.totalTx.metric?.value, 27)
  assert.equal(view.pooledWeth.metric?.value, 4.82)
  assert.equal(view.holders.metric?.value, 19)
})

test("holders arriving later update the existing card in place and never add a card", () => {
  const store = syncStore()
  const row = record(1, { holders: null })
  store.ingestSnapshot(snapshot([row]))
  const before = store.getList().length
  const patches: ActivityPatch[] = []
  store.onPatch((patch) => patches.push(patch))
  store.setHolders(row.tokenAddress, { value: 91, source: "blockscout", observedAt: T + 1000, block: null })
  assert.equal(store.getList().length, before)
  assert.deepEqual(patches.map((patch) => patch.type), ["activity.metrics.updated"])
  const patch = patches[0]
  assert.equal(patch.type === "activity.metrics.updated" && patch.holders, 91)
  assert.equal(store.metricsFor(row.address.toLowerCase(), row.tokenAddress.toLowerCase()).holders.metric?.value, 91)
})

test("the same burn from the live socket and from the snapshot is one card", () => {
  const store = syncStore()
  const row = record(1)
  applySighting(store, { type: "burn", event: burn(row) })
  store.ingestSnapshot(snapshot([row], [burn(row)]))
  applySighting(store, { type: "burn", event: burn(row) })
  assert.equal(store.getList().filter((item) => item.type === "lp-burn").length, 1)
  assert.equal(store.getList().filter((item) => item.type === "new-pair").length, 1)
})

test("a live card picks up its name from a later snapshot and keeps its arrival time", () => {
  const store = new ActivityStore(() => T + 5, (run) => run())
  const row = record(1, { listingSource: "ethereum-pair-created", name: "WETH pair" })
  applySighting(store, { type: "pair", record: row, token0: null })
  const first = store.getList()[0]
  store.ingestSnapshot(snapshot([record(1)]))
  const updated = store.get(first.activityId)
  assert.equal(updated?.symbol, "TK1")
  assert.equal(updated?.receivedAt, first.receivedAt)
  assert.ok(updated?.href.startsWith("/tokens/"))
})

test("DEXTools zeros for an unpriced pool are unknown, a real zero stays zero, and zero holders is never real", () => {
  const store = syncStore()
  const unpriced = record(1, { price: null, liquidity: null, holders: 0, totalTx: 0, remaining: null })
  const real = record(2, { holders: 0, totalTx: 0, remaining: 0 })
  store.ingestSnapshot(snapshot([unpriced, real]))
  const a = store.metricsFor(unpriced.address.toLowerCase(), unpriced.tokenAddress.toLowerCase())
  assert.equal(a.holders.metric, null)
  assert.equal(a.totalTx.metric, null)
  const b = store.metricsFor(real.address.toLowerCase(), real.tokenAddress.toLowerCase())
  assert.equal(b.holders.metric, null, "a token with a pool always has a holder, so 0 means DEXTools has not counted yet")
  assert.equal(b.totalTx.metric?.value, 0)
  assert.equal(b.pooledWeth.metric?.value, 0)
})

test("unavailable is shown only when there is nothing to keep", () => {
  const store = syncStore()
  const row = record(1, { holders: null, remaining: null })
  store.ingestSnapshot(snapshot([row]))
  const pair = row.address.toLowerCase()
  const token = row.tokenAddress.toLowerCase()
  store.markUnavailable("holders", token, "Holder provider temporarily unavailable.")
  store.markUnavailable("pooledWeth", pair, "Reserve read failed")
  store.markUnavailable("totalTx", pair, "no source")
  const view = store.metricsFor(pair, token)
  assert.equal(view.holders.status, "unavailable")
  assert.match(view.holders.error ?? "", /temporarily unavailable/)
  assert.equal(view.pooledWeth.status, "unavailable")
  assert.equal(view.totalTx.metric?.value, 27, "an existing value is kept")
})

test("filters return only the chosen type", () => {
  const store = syncStore()
  const row = record(1)
  store.ingestSnapshot(snapshot([row, record(2)], [burn(row)]))
  const list = store.getList()
  assert.equal(filterActivity(list, "all").length, list.length)
  assert.ok(filterActivity(list, "pairs").every((item) => item.type === "new-pair"))
  assert.equal(filterActivity(list, "burns").length, 1)
  assert.equal(filterActivity(list, "trends").length, 1)
  assert.equal(filterActivity(list, "news").length, 0)
})

test("the metrics view is the same object until that pair changes, so other cards do not re-render", () => {
  const store = syncStore()
  const a = record(1)
  const b = record(2)
  store.ingestSnapshot(snapshot([a, b]))
  const viewA = store.metricsFor(a.address.toLowerCase(), a.tokenAddress.toLowerCase())
  const viewB = store.metricsFor(b.address.toLowerCase(), b.tokenAddress.toLowerCase())
  store.addSwap(b.address, "0xff:1", 2000, T + 1)
  assert.equal(store.metricsFor(a.address.toLowerCase(), a.tokenAddress.toLowerCase()), viewA)
  assert.notEqual(store.metricsFor(b.address.toLowerCase(), b.tokenAddress.toLowerCase()), viewB)
})

test("a card with a missing time still leaves the live list readable", () => {
  const store = syncStore()
  const row = record(1)
  const broken = burn(row)
  broken.burnAt = ""
  broken.detectedAt = ""
  store.ingestSnapshot(snapshot([row], [broken]))
  store.upsert({
    activityId: "pair:bad",
    type: "new-pair",
    occurredAt: undefined,
    tokenAddress: row.tokenAddress,
    pairAddress: row.address,
    exchange: row.exchange,
    name: "",
    symbol: "BAD",
    pairCreatedAt: null,
    lpBurnPercent: null,
    title: null,
    detail: null,
    href: "/tokens/x",
    live: true,
  } as never)
  assert.ok(store.getList().some((item) => item.activityId === `pair:${row.address.toLowerCase()}`))
  assert.ok(store.getList().some((item) => item.activityId === "pair:bad"))
  const view = store.metricsFor(row.address.toLowerCase(), row.tokenAddress.toLowerCase())
  assert.equal(store.metricsFor(row.address.toLowerCase(), row.tokenAddress.toLowerCase()), view)
})

test("a full metrics cache still returns one stable view", () => {
  const store = syncStore()
  for (let index = 0; index < MAX_ACTIVITY * 4 + 2; index += 1) store.metricsFor(`0x${index}`, `0xt${index}`)
  const first = store.metricsFor("0x0", "0xt0")
  assert.equal(store.metricsFor("0x0", "0xt0"), first)
})

test("history is pruned to the newest events", () => {
  const store = syncStore()
  for (let index = 0; index < MAX_ACTIVITY + 50; index++) applySighting(store, { type: "pair", record: record(index), token0: null })
  assert.equal(store.getList().length, MAX_ACTIVITY)
  assert.equal(store.getList()[0].pairAddress, record(0).address.toLowerCase())
})

for (const count of [50, 100, 500]) {
  test(`performance: ${count} events plus enrichment updates, rebuilding the list after every change`, () => {
    const store = syncStore()
    const started = performance.now()
    for (let index = 0; index < count; index++) applySighting(store, { type: "pair", record: record(index), token0: null })
    for (let index = 0; index < count; index++) {
      const row = record(index)
      store.setHolders(row.tokenAddress, { value: index, source: "blockscout", observedAt: T + index, block: null })
      store.addSwap(row.address, `0x${index}:1`, 2000 + index, T + index)
      store.setPooledWeth(row.address, { value: index / 10, source: "chain", observedAt: T, block: 2000 + index })
    }
    for (const item of store.getList()) store.metricsFor(item.pairAddress, item.tokenAddress)
    const elapsed = performance.now() - started
    console.log(`[PERF] ${count} activity events with 3 metric updates each: ${elapsed.toFixed(1)}ms`)
    assert.ok(elapsed < 250, `${elapsed}ms`)
  })
}
