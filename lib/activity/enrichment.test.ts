import assert from "node:assert/strict"
import test from "node:test"
import type { SnapshotFile } from "../narrative/types"
import { EMPTY_DETAIL, type PairRecord } from "../types"
import { EnrichmentEngine } from "./enrichment"
import { BlockscoutHolderProvider, EthplorerHolderProvider } from "./holders"
import { POOL_MANAGER, POOL_TOPICS } from "./pool"
import { ActivityStore } from "./store"
import type { FetchLike } from "../market/types"

const HEAD = 26_000_000
const ONE = BigInt(10) ** BigInt(18)
const word = (value: bigint) => value.toString(16).padStart(64, "0")
const V2 = "0x2222222222222222222222222222222222220001"
const V2_TOKEN = "0xffffffffffffffffffffffffffffffffffff0001"
const V4 = `0x${"ab".repeat(32)}`
const V4_TOKEN = "0xffffffffffffffffffffffffffffffffffff0002"

class FakeSocket {
  static instances: FakeSocket[] = []
  readyState = 0
  sent: { id: number; method: string; params: unknown[] }[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }
  send(text: string) {
    const message = JSON.parse(text)
    this.sent.push(message)
    if (message.method === "eth_subscribe") queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, result: `0xsub${message.id}` }) }))
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  push(result: unknown) {
    this.onmessage?.({ data: JSON.stringify({ params: { result } }) })
  }
}

function row(address: string, token: string, exchange: string, patch: Partial<PairRecord> = {}): PairRecord {
  return { name: "TK(Token)", created_at: new Date().toISOString(), exchange, address, tokenAddress: token, url: "https://example.com", price: 0.001, remaining: null, remainingUnit: "ETH", listingLiquidity: null, ...EMPTY_DETAIL, liquidity: 1000, holders: 10, totalTx: 27, creationBlock: HEAD - 10, ...patch }
}

function swapLog(pair: string, tx: string, index: number, block: number) {
  return { address: pair, topics: [POOL_TOPICS.v2Swap], data: "0x", blockNumber: `0x${block.toString(16)}`, transactionHash: tx, logIndex: `0x${index.toString(16)}` }
}

function syncLog(block: number, weth: bigint) {
  // The token address sorts above WETH, so WETH is token0 and reserve0 is the pooled WETH.
  return { address: V2, topics: [POOL_TOPICS.v2Sync], data: `0x${word(weth)}${word(ONE * BigInt(1000))}`, blockNumber: `0x${block.toString(16)}`, transactionHash: "0xsync", logIndex: "0x0" }
}

function fakeFetch(holders: "ethplorer" | "none"): FetchLike {
  return async (url, init) => {
    if (url.includes("blockscout")) return new Response("busy", { status: 503 })
    if (url.includes("ethplorer")) return holders === "ethplorer" ? new Response(JSON.stringify({ holdersCount: 91 })) : new Response("busy", { status: 503 })
    const body = JSON.parse(String(init?.body ?? "{}")) as { method: string; params: unknown[] }
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }))
    if (body.method === "eth_blockNumber") return reply(`0x${HEAD.toString(16)}`)
    if (body.method === "eth_call") return reply(`0x${word((ONE * BigInt(842)) / BigInt(100))}${word(ONE * BigInt(1000))}${word(BigInt(1))}`)
    if (body.method === "eth_getLogs") {
      const filter = body.params[0] as { address: string }
      if (filter.address === V2) return reply([swapLog(V2, "0xa", 1, HEAD - 9), swapLog(V2, "0xb", 2, HEAD - 8), swapLog(V2, "0xa", 1, HEAD - 9)])
      return reply([])
    }
    return reply(null)
  }
}

async function until(check: () => boolean, label: string, ms = 6000) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > ms) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function setup(holders: "ethplorer" | "none") {
  FakeSocket.instances = []
  const store = new ActivityStore()
  const snapshot: SnapshotFile = { generatedAt: new Date(Date.now() - 1000).toISOString(), hours: 24, scanned: 2, rows: [row(V2, V2_TOKEN, "Uniswap V2"), row(V4, V4_TOKEN, "Uniswap V4", { holders: null })] }
  store.ingestSnapshot(snapshot)
  const fetcher = fakeFetch(holders)
  const engine = new EnrichmentEngine(store, {
    fetcher,
    holders: [new BlockscoutHolderProvider(fetcher), new EthplorerHolderProvider(fetcher)],
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
  })
  engine.onHead(HEAD)
  return { store, engine }
}

test("enrichment fills reserves, an exact swap count, and holders through the fallback provider, then follows live logs", async () => {
  const { store, engine } = setup("ethplorer")
  engine.start()
  try {
    const socket = FakeSocket.instances[0]
    socket.open()
    const v2 = () => store.metricsFor(V2, V2_TOKEN)
    await until(() => v2().pooledWeth.metric?.source === "chain", "on-chain reserves")
    assert.equal(v2().pooledWeth.metric?.value, 8.42)
    assert.equal(v2().pooledWeth.metric?.block, HEAD)
    await until(() => v2().totalTx.metric?.source === "chain", "exact swap count")
    assert.equal(v2().totalTx.metric?.value, 2, "two unique swaps since creation; the repeated log is not counted")
    await until(() => v2().holders.metric?.source === "ethplorer", "holders")
    assert.equal(v2().holders.metric?.value, 91)

    await until(() => socket.sent.filter((message) => message.method === "eth_subscribe").length >= 2, "subscriptions")
    const subs = socket.sent.filter((message) => message.method === "eth_subscribe").map((message) => message.params[1] as { address: string | string[]; topics: unknown[] })
    assert.ok(subs.some((sub) => Array.isArray(sub.address) && sub.address.includes(V2)))
    assert.ok(subs.some((sub) => sub.address === POOL_MANAGER && JSON.stringify(sub.topics).includes(V4)))

    socket.push(syncLog(HEAD + 1, ONE * BigInt(9)))
    assert.equal(v2().pooledWeth.metric?.value, 9)
    socket.push(syncLog(HEAD - 5, ONE * BigInt(7)))
    assert.equal(v2().pooledWeth.metric?.value, 9, "a Sync from an older block is ignored")
    socket.push(swapLog(V2, "0xb", 2, HEAD - 8))
    assert.equal(v2().totalTx.metric?.value, 2, "a replayed swap is not counted again")
    socket.push(swapLog(V2, "0xc", 0, HEAD + 1))
    assert.equal(v2().totalTx.metric?.value, 3)

    await until(() => store.metricsFor(V4, V4_TOKEN).pooledWeth.status === "unavailable", "V4 pooled N/A")
  } finally {
    engine.stop()
  }
})

test("a dropped enrichment socket reconnects and subscribes again", async () => {
  const { engine } = setup("ethplorer")
  engine.start()
  try {
    FakeSocket.instances[0].open()
    await until(() => FakeSocket.instances[0].sent.some((message) => message.method === "eth_subscribe"), "first subscription")
    FakeSocket.instances[0].close()
    await until(() => FakeSocket.instances.length === 2, "reconnect", 6000)
    FakeSocket.instances[1].open()
    assert.ok(FakeSocket.instances[1].sent.some((message) => message.method === "eth_subscribe"))
  } finally {
    engine.stop()
  }
})

test("when every holder provider fails, a token with no value shows unavailable and one with a value keeps it", async () => {
  const { store, engine } = setup("none")
  engine.start()
  try {
    FakeSocket.instances[0].open()
    await until(() => store.metricsFor(V4, V4_TOKEN).holders.status === "unavailable", "unavailable holders")
    assert.match(store.metricsFor(V4, V4_TOKEN).holders.error ?? "", /temporarily unavailable/)
    assert.equal(store.metricsFor(V2, V2_TOKEN).holders.metric?.value, 10)
  } finally {
    engine.stop()
  }
})

test("an indexer that has not caught up with a token is not reported as its holder count", async () => {
  const reply = (body: object): FetchLike => async () => new Response(JSON.stringify(body))
  await assert.rejects(new BlockscoutHolderProvider(reply({ token_holders_count: "0", transfers_count: "0" })).getHolderCount(V2_TOKEN))
  await assert.rejects(new BlockscoutHolderProvider(reply({ token_holders_count: "4", transfers_count: "0" })).getHolderCount(V2_TOKEN), "partial index")
  await assert.rejects(new EthplorerHolderProvider(reply({ holdersCount: 0, transfersCount: 0 })).getHolderCount(V2_TOKEN))
  assert.equal(await new BlockscoutHolderProvider(reply({ token_holders_count: "37", transfers_count: "80" })).getHolderCount(V2_TOKEN), 37)
  assert.equal(await new EthplorerHolderProvider(reply({ holdersCount: 20, transfersCount: 23 })).getHolderCount(V2_TOKEN), 20)
})

test("stopping and starting again (React remounts the panel) resumes enrichment on one socket", async () => {
  const { store, engine } = setup("ethplorer")
  engine.start()
  engine.stop()
  engine.start()
  try {
    const live = FakeSocket.instances.filter((socket) => socket.readyState !== 3)
    assert.equal(live.length, 1, "the stopped socket is not reopened next to the new one")
    live[0].open()
    await until(() => store.metricsFor(V2, V2_TOKEN).pooledWeth.metric?.source === "chain", "reserves after restart")
    await until(() => store.metricsFor(V2, V2_TOKEN).holders.metric?.source === "ethplorer", "holders after restart")
    await new Promise((resolve) => setTimeout(resolve, 3500))
    assert.equal(FakeSocket.instances.filter((socket) => socket.readyState !== 3).length, 1)
  } finally {
    engine.stop()
  }
})
