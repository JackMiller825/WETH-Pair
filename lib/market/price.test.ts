import assert from "node:assert/strict"
import test from "node:test"
import { changeTone, formatChange, formatEthPrice, formatEthPriceCompact, spokenChange } from "./format"
import { CoinGeckoProvider, CoinbaseProvider, percentChange, priceAt, readEthMarket, type Candle } from "./price"
import { FeedService, PRICE_STALE_MS, PRIMARY_RETRY_MS, feedHealth } from "./service"
import type { EthMarket, FetchLike } from "./types"

const T = Date.UTC(2026, 9, 20, 12, 0, 0)
const S = T / 1000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function coinbaseFetch(overrides: Partial<Record<"ticker" | "60" | "900" | "3600", unknown>> = {}): FetchLike {
  const candles: Record<string, Candle[]> = {
    // One hour ago sits at the start of a flat 2490 candle.
    "60": [[S - 3600, 2480, 2495, 2490, 2490, 1]],
    // One day ago is halfway through a candle that moved 2400 → 2500, so 2450.
    "900": [[S - 86400 - 450, 2390, 2510, 2400, 2500, 1]],
    // Seven days ago: 2600.
    "3600": [[S - 7 * 86400, 2590, 2610, 2600, 2600, 1]],
  }
  return async (url) => {
    if (url.endsWith("/ticker")) return json(overrides.ticker ?? { price: "2500.00", time: new Date(T).toISOString() })
    const granularity = /granularity=(\d+)/.exec(url)?.[1] as "60" | "900" | "3600"
    return json(overrides[granularity] ?? candles[granularity])
  }
}

test("percent change is (current - past) / past × 100, signed", () => {
  assert.equal(percentChange(110, 100), 10)
  assert.equal(percentChange(90, 100), -10)
  assert.equal(percentChange(100, 100), 0)
  assert.equal(percentChange(100, null), null)
  assert.equal(percentChange(100, 0), null)
})

test("priceAt interpolates inside the candle that contains the instant and is null outside every candle", () => {
  const candles: Candle[] = [[1000, 0, 0, 100, 200, 0]]
  assert.equal(priceAt(candles, 1000 * 1000, 60), 100)
  assert.equal(priceAt(candles, 1030 * 1000, 60), 150)
  assert.equal(priceAt(candles, 2000 * 1000, 60), null)
})

test("Coinbase: positive 1h, positive 24h, negative 7d, each from its own candle series", async () => {
  const provider = new CoinbaseProvider(coinbaseFetch(), () => T)
  const market = await readEthMarket(provider, () => T)
  assert.equal(market.priceUsd, 2500)
  assert.ok(Math.abs((market.change1h ?? 0) - ((2500 - 2490) / 2490) * 100) < 1e-9)
  assert.ok(Math.abs((market.change24h ?? 0) - ((2500 - 2450) / 2450) * 100) < 1e-9)
  assert.ok(Math.abs((market.change7d ?? 0) - ((2500 - 2600) / 2600) * 100) < 1e-9)
  assert.equal(market.source, "coinbase")
})

test("Coinbase: negative 24h and a missing 1h value stay null instead of borrowing another period", async () => {
  const provider = new CoinbaseProvider(coinbaseFetch({ "60": [], "900": [[S - 86400, 0, 0, 2700, 2700, 1]] }), () => T)
  const market = await readEthMarket(provider, () => T)
  assert.equal(market.change1h, null)
  assert.ok((market.change24h ?? 0) < 0)
  assert.ok(market.change7d != null)
})

test("7D is computed from the price seven days ago, not from 24-hour data", async () => {
  const provider = new CoinbaseProvider(coinbaseFetch({ "3600": [[S - 7 * 86400, 0, 0, 1250, 1250, 1]] }), () => T)
  const market = await readEthMarket(provider, () => T)
  assert.ok(Math.abs((market.change7d ?? 0) - 100) < 1e-9)
  assert.notEqual(market.change7d, market.change24h)
})

test("invalid provider payloads are rejected", async () => {
  await assert.rejects(new CoinbaseProvider(coinbaseFetch({ ticker: { price: "abc" } }), () => T).getEthPrice())
  await assert.rejects(new CoinbaseProvider(coinbaseFetch({ ticker: { price: "-5" } }), () => T).getEthPrice())
  await assert.rejects(new CoinGeckoProvider(async () => json({ error: "rate limited" }), () => T).getEthPrice())
  await assert.rejects(new CoinbaseProvider(async () => json({}, 503), () => T).getEthPrice())
})

test("CoinGecko supplies 1h, 24h, and 7d directly", async () => {
  const provider = new CoinGeckoProvider(async () => json([{ current_price: 2455.66, last_updated: new Date(T).toISOString(), price_change_percentage_1h_in_currency: 0.42, price_change_percentage_24h_in_currency: 2.05, price_change_percentage_7d_in_currency: -3.18 }]), () => T)
  const market = await readEthMarket(provider, () => T)
  assert.deepEqual([market.priceUsd, market.change1h, market.change24h, market.change7d], [2455.66, 0.42, 2.05, -3.18])
})

test("formatting: price, signed change, tone, and an extremely large price", () => {
  assert.equal(formatEthPrice(2455.657817323), "$2,455.66")
  assert.equal(formatEthPrice(1234567.891), "$1,234,567.89")
  assert.equal(formatEthPriceCompact(2455.66), "$2.46K")
  assert.equal(formatChange(2.0478390234), "+2.05%")
  assert.equal(formatChange(-3.18), "-3.18%")
  assert.equal(formatChange(0), "0.00%")
  assert.equal(formatChange(-0.001), "0.00%")
  assert.equal(formatChange(null), "—")
  assert.equal(changeTone(0.42), "up")
  assert.equal(changeTone(-3.18), "down")
  assert.equal(changeTone(0.01), "flat")
  assert.equal(spokenChange(2.05, "24 hours"), "up 2.05 percent over 24 hours")
})

function market(price: number, at: number, source = "a"): EthMarket {
  return { priceUsd: price, change1h: null, change24h: null, change7d: null, observedAt: new Date(at).toISOString(), source, sourceLabel: source }
}

test("primary failure uses the fallback, stays on it until the primary answers again, then switches back", async () => {
  let now = T
  let primaryUp = false
  const calls = { primary: 0, fallback: 0 }
  const feed = new FeedService<EthMarket>(
    [
      { id: "a", label: "A", read: async () => { calls.primary += 1; if (!primaryUp) throw new Error("down"); return market(2500, now, "a") } },
      { id: "b", label: "B", read: async () => { calls.fallback += 1; return market(2499, now, "b") } },
    ],
    () => now,
  )
  let state = await feed.refresh()
  assert.equal(state.data?.source, "b")
  assert.equal(state.fallback, true)
  now += 10_000
  primaryUp = true
  state = await feed.refresh()
  assert.equal(calls.primary, 1, "the primary is not retried on every refresh")
  assert.equal(state.data?.source, "b")
  now += PRIMARY_RETRY_MS
  state = await feed.refresh()
  assert.equal(state.data?.source, "a")
  assert.equal(state.fallback, false)
})

test("a failed refresh keeps the last good value, which then turns stale", async () => {
  let now = T
  let up = true
  const feed = new FeedService<EthMarket>([{ id: "a", label: "A", read: async () => { if (!up) throw new Error("down"); return market(2455.66, now) } }], () => now)
  await feed.refresh()
  up = false
  now += 27_000
  const state = await feed.refresh()
  assert.equal(state.data?.priceUsd, 2455.66)
  assert.ok(state.lastError)
  assert.equal(feedHealth(state, now, PRICE_STALE_MS), "live")
  now += PRICE_STALE_MS
  assert.equal(feedHealth(feed.get(), now, PRICE_STALE_MS), "stale")
})

test("no data and every provider failing is unavailable, never an invented value", async () => {
  const feed = new FeedService<EthMarket>([{ id: "a", label: "A", read: async () => { throw new Error("down") } }], () => T)
  assert.equal(feedHealth(feed.get(), T, PRICE_STALE_MS), "refreshing")
  const state = await feed.refresh()
  assert.equal(state.data, null)
  assert.equal(feedHealth(state, T, PRICE_STALE_MS), "unavailable")
})

test("an older observation never replaces a newer cached one", async () => {
  const feed = new FeedService<EthMarket>([{ id: "a", label: "A", read: async () => market(2400, T - 60_000) }], () => T)
  feed.seed(market(2500, T))
  await feed.refresh()
  assert.equal(feed.get().data?.priceUsd, 2500)
})
