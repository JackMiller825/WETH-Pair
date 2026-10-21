import assert from "node:assert/strict"
import test from "node:test"
import { PriceBook } from "./book"
import { blockForTime, formatMultiple, formatPumpPercent, priceWethFromReserves, pumpOf, type PricePoint } from "./price"
import { RankCache, rankCacheKey, rankPumpers, type RankOptions, type TokenCandidate } from "./rank"

const NOW = Date.parse("2026-10-21T12:00:00Z")
const HOUR = 60 * 60 * 1000

function point(at: number, priceUsd: number, extra: Partial<PricePoint> = {}): PricePoint {
  return { pair: "0xpair", token: "0xtoken", block: Math.round(at / 1000), at, priceWeth: priceUsd, priceUsd, reserveWeth: 10, liquidityUsd: 1000, source: "chain", ...extra }
}

function token(id: string, prices: { hoursAgo: number; usd: number; weth?: number }[], extra: Partial<TokenCandidate> = {}): TokenCandidate {
  const pair = `0x${id.padStart(40, "a")}`
  const points = prices.map((price) => point(NOW - price.hoursAgo * HOUR, price.usd, { pair, reserveWeth: price.weth ?? 10, block: 1000 - price.hoursAgo }))
  return {
    pair,
    token: `0x${id.padStart(40, "b")}`,
    name: id,
    symbol: id.toUpperCase(),
    createdAt: NOW - 10 * 24 * HOUR,
    url: "https://example.test",
    points,
    pooledWeth: 10,
    liquidityUsd: 1000,
    volumeUsd: 100,
    totalTx: 50,
    holders: 20,
    lpBurnPercent: null,
    ...extra,
  }
}

function options(patch: Partial<RankOptions> = {}): RankOptions {
  return {
    start: NOW - 24 * HOUR,
    end: NOW,
    mode: "window",
    limit: 10,
    pumpsOnly: true,
    hideLowConfidence: true,
    minLiquidityUsd: null,
    minWeth: null,
    minTx: null,
    minHolders: null,
    minAgeMs: null,
    movement: "all",
    sort: "multiple",
    coverageOldest: NOW - 8 * 24 * HOUR,
    ...patch,
  }
}

test("2x is +100%, 3x is +200%, and 4x is +300%, ranked highest first", () => {
  assert.deepEqual(pumpOf(1, 4), { multiple: 4, percent: 300 })
  assert.equal(formatMultiple(4), "4.00x")
  assert.equal(formatPumpPercent(300), "+300%")
  assert.equal(formatPumpPercent(-50), "-50.0%")
  const ranked = rankPumpers(
    [token("a", [{ hoursAgo: 24, usd: 1 }, { hoursAgo: 0, usd: 2 }]), token("b", [{ hoursAgo: 24, usd: 1 }, { hoursAgo: 0, usd: 3 }]), token("c", [{ hoursAgo: 24, usd: 1 }, { hoursAgo: 0, usd: 4 }])],
    options(),
  )
  assert.deepEqual(ranked.items.map((row) => [row.symbol, row.multiple, row.percent]), [["C", 4, 300], ["B", 3, 200], ["A", 2, 100]])
})

test("absolute price does not decide the rank", () => {
  const ranked = rankPumpers(
    [
      token("a", [{ hoursAgo: 24, usd: 2 }, { hoursAgo: 0, usd: 4 }]),
      token("b", [{ hoursAgo: 24, usd: 0.001 }, { hoursAgo: 0, usd: 0.003 }]),
      token("c", [{ hoursAgo: 24, usd: 50 }, { hoursAgo: 0, usd: 200 }]),
    ],
    options(),
  )
  assert.deepEqual(ranked.items.map((row) => row.symbol), ["C", "B", "A"])
})

test("a decline is 0.5x and -50%, and it is not listed as a pump", () => {
  const change = pumpOf(4, 2)
  assert.deepEqual(change, { multiple: 0.5, percent: -50 })
  const hidden = rankPumpers([token("a", [{ hoursAgo: 24, usd: 4 }, { hoursAgo: 0, usd: 2 }])], options())
  assert.equal(hidden.items.length, 0)
  assert.equal(hidden.excludedFlat, 1)
  const shown = rankPumpers([token("a", [{ hoursAgo: 24, usd: 4 }, { hoursAgo: 0, usd: 2 }])], options({ pumpsOnly: false }))
  assert.equal(shown.items[0].multiple, 0.5)
})

test("equal multiples break the tie by pooled WETH, then volume, then pair address", () => {
  const ranked = rankPumpers(
    [
      token("a", [{ hoursAgo: 24, usd: 1 }, { hoursAgo: 0, usd: 3 }], { pooledWeth: 2, volumeUsd: 9 }),
      token("b", [{ hoursAgo: 24, usd: 1 }, { hoursAgo: 0, usd: 3 }], { pooledWeth: 5, volumeUsd: 1 }),
      token("c", [{ hoursAgo: 24, usd: 1 }, { hoursAgo: 0, usd: 3 }], { pooledWeth: 2, volumeUsd: 20 }),
    ],
    options(),
  )
  assert.deepEqual(ranked.items.map((row) => row.symbol), ["B", "C", "A"])
})

test("a token younger than the window is not given that window's return", () => {
  const young = token("spepe", [{ hoursAgo: 2, usd: 1, weth: 2 }, { hoursAgo: 0, usd: 5, weth: 2 }], { createdAt: NOW - 2 * HOUR })
  const windowed = rankPumpers([young], options())
  assert.equal(windowed.items.length, 0)
  assert.equal(windowed.excludedYoung, 1)
  const launched = rankPumpers([young], options({ mode: "launch" }))
  assert.equal(launched.items.length, 1)
  assert.equal(launched.items[0].sinceLaunch, true)
  assert.equal(launched.items[0].multiple, 5)
  assert.notEqual(launched.items[0].sinceLaunch, false)
})

test("a zero reference is invalid and a dust baseline is not ranked first", () => {
  assert.equal(pumpOf(0, 1), null)
  const dust = token("dust", [{ hoursAgo: 24, usd: 0.0000001, weth: 0.002 }, { hoursAgo: 0, usd: 1.5, weth: 0.002 }])
  const real = token("real", [{ hoursAgo: 24, usd: 1 }, { hoursAgo: 0, usd: 2 }])
  const ranked = rankPumpers([dust, real], options())
  assert.deepEqual(ranked.items.map((row) => row.symbol), ["REAL"])
  assert.equal(ranked.hiddenLowConfidence.length, 1)
  assert.match(ranked.hiddenLowConfidence[0].confidenceReason ?? "", /0\.0020 WETH/)
  assert.equal(ranked.hiddenLowConfidence[0].confidence, "low")
})

test("the launch baseline is the first price after real liquidity, not the dust print", () => {
  const launched = token(
    "spepe",
    [
      { hoursAgo: 2, usd: 0.00001, weth: 0.002 },
      { hoursAgo: 1.5, usd: 1, weth: 1 },
      { hoursAgo: 0, usd: 3, weth: 1 },
    ],
    { createdAt: NOW - 2 * HOUR },
  )
  const ranked = rankPumpers([launched], options({ mode: "launch" }))
  assert.equal(ranked.items[0].referencePriceUsd, 1)
  assert.equal(ranked.items[0].multiple, 3)
})

test("WETH on either side and 6, 8, 9, or 18 decimals produce the same price", () => {
  const one = BigInt(10) ** BigInt(18)
  const raw = (decimals: number) => BigInt(1000) * BigInt(10) ** BigInt(decimals)
  const cases: [number, bigint][] = [
    [6, raw(6)],
    [8, raw(8)],
    [9, raw(9)],
    [18, raw(18)],
  ]
  for (const [decimals, raw] of cases) {
    const token0 = priceWethFromReserves(one, raw, true, decimals)
    const token1 = priceWethFromReserves(raw, one, false, decimals)
    assert.ok(token0 && token1)
    assert.equal(token0.priceWeth, 0.001)
    assert.equal(token1.priceWeth, token0.priceWeth)
    assert.equal(token0.reserveWeth, 1)
  }
  assert.equal(priceWethFromReserves(BigInt(0), one, true, 18), null)
})

test("each range uses its own baseline, and 3d is not the 24h price", () => {
  const series = token("a", [
    { hoursAgo: 168, usd: 1 },
    { hoursAgo: 72, usd: 2 },
    { hoursAgo: 24, usd: 4 },
    { hoursAgo: 12, usd: 5 },
    { hoursAgo: 10, usd: 5 },
    { hoursAgo: 6, usd: 6 },
    { hoursAgo: 1, usd: 7 },
    { hoursAgo: 0, usd: 8 },
  ])
  const at = (hours: number) => rankPumpers([series], options({ start: NOW - hours * HOUR })).items[0].referencePriceUsd
  assert.equal(at(1), 7)
  assert.equal(at(6), 6)
  assert.equal(at(12), 5)
  assert.equal(at(24), 4)
  assert.equal(at(72), 2)
  assert.equal(at(168), 1)
  const custom = rankPumpers([series], options({ start: NOW - 10 * HOUR, end: NOW - 5 * HOUR }))
  assert.equal(custom.items[0].referencePriceUsd, 5)
  assert.equal(custom.items[0].currentPriceUsd, 6)
})

test("a baseline too far from the window start is not sold as that window", () => {
  const late = token("a", [{ hoursAgo: 9, usd: 1 }, { hoursAgo: 0, usd: 4 }])
  const missed = rankPumpers([late], options({ start: NOW - 6 * HOUR }))
  assert.equal(missed.items.length, 0)
  assert.equal(missed.excludedInsufficient, 1)
  const close = token("b", [{ hoursAgo: 6 + 1 / 60, usd: 1 }, { hoursAgo: 0, usd: 4 }])
  const hit = rankPumpers([close], options({ start: NOW - 6 * HOUR }))
  assert.equal(hit.items[0].multiple, 4)
})

test("partial coverage is reported and does not relabel a shorter ranking", () => {
  const onlyRecent = token("a", [{ hoursAgo: 12, usd: 1 }, { hoursAgo: 0, usd: 3 }])
  const ranked = rankPumpers([onlyRecent], options({ coverageOldest: NOW - 12 * HOUR }))
  assert.equal(ranked.coverage.complete, false)
  assert.equal(ranked.coverage.requestedMs, 24 * HOUR)
  assert.equal(ranked.coverage.availableMs, 12 * HOUR)
  assert.equal(ranked.items.length, 0)
})

test("a newer block replaces the same minute and an older block does not", () => {
  const book = new PriceBook()
  const base = point(NOW, 4, { block: 100 })
  assert.equal(book.insert(base), "added")
  assert.equal(book.insert(point(NOW + 1000, 3, { block: 98 })), "rejected")
  assert.equal(book.points(base.pair)[0].priceUsd, 4)
  assert.equal(book.insert(point(NOW + 2000, 5, { block: 101 })), "replaced")
  assert.equal(book.points(base.pair)[0].priceUsd, 5)
})

test("raising one price moves that token to rank 1 without rebuilding the inputs", () => {
  const a = token("a", [{ hoursAgo: 1, usd: 1 }, { hoursAgo: 0, usd: 3 }])
  const b = token("b", [{ hoursAgo: 1, usd: 1 }, { hoursAgo: 0, usd: 2 }])
  const before = rankPumpers([a, b], options({ start: NOW - HOUR }))
  assert.deepEqual(before.items.map((row) => row.symbol), ["A", "B"])
  const raised = { ...b, points: [...b.points.slice(0, -1), point(NOW, 4, { pair: b.pair })] }
  const after = rankPumpers([a, raised], options({ start: NOW - HOUR }))
  assert.deepEqual(after.items.map((row) => row.symbol), ["B", "A"])
})

test("the sparkline is the observed prices, not a generated curve", () => {
  const ranked = rankPumpers([token("a", [{ hoursAgo: 24, usd: 1 }, { hoursAgo: 12, usd: 2 }, { hoursAgo: 0, usd: 4 }])], options())
  assert.deepEqual(ranked.items[0].sparkline, [1, 2, 4])
  assert.equal(ranked.items[0].peakMultiple, 4)
})

test("a cached ranking is reused until the book version or the range changes", () => {
  const cache = new RankCache()
  let builds = 0
  const key = rankCacheKey(options())
  const first = cache.get(key, 1, () => {
    builds += 1
    return rankPumpers([token("a", [{ hoursAgo: 24, usd: 1 }, { hoursAgo: 0, usd: 2 }])], options())
  })
  const second = cache.get(key, 1, () => {
    builds += 1
    return rankPumpers([], options())
  })
  assert.equal(first, second)
  assert.equal(builds, 1)
  cache.get(rankCacheKey(options({ start: NOW - 72 * HOUR })), 1, () => {
    builds += 1
    return rankPumpers([], options())
  })
  assert.equal(builds, 2)
})

test("ranking 2000 tokens stays a short calculation", () => {
  const tokens = Array.from({ length: 2000 }, (_, index) => token(String(index), [{ hoursAgo: 24, usd: 1 }, { hoursAgo: 0, usd: 1 + (index % 7) }]))
  const samples: number[] = []
  for (let run = 0; run < 20; run += 1) {
    const started = performance.now()
    rankPumpers(tokens, options())
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  const p50 = samples[Math.floor(samples.length * 0.5)]
  const p95 = samples[Math.floor(samples.length * 0.95)]
  console.log(`[PUMP] rank 2000 p50 ${p50.toFixed(2)}ms p95 ${p95.toFixed(2)}ms`)
  assert.ok(p95 < 200, `p95 ${p95}ms`)
  const cache = new RankCache()
  const key = rankCacheKey(options())
  const built = cache.get(key, 1, () => rankPumpers(tokens, options()))
  const hits: number[] = []
  for (let run = 0; run < 50; run += 1) {
    const started = performance.now()
    assert.equal(cache.get(key, 1, () => built), built)
    hits.push(performance.now() - started)
  }
  hits.sort((a, b) => a - b)
  const cacheP95 = hits[Math.floor(hits.length * 0.95)]
  console.log(`[PUMP] cached read p95 ${cacheP95.toFixed(3)}ms`)
  assert.ok(cacheP95 < 1)
  const started = performance.now()
  const movedTokens = tokens.map((entry, index) => index === 0 ? { ...entry, points: [entry.points[0], point(NOW, 20, { pair: entry.pair })] } : entry)
  const moved = rankPumpers(movedTokens, options())
  const updateMs = performance.now() - started
  console.log(`[PUMP] rank update ${updateMs.toFixed(2)}ms, new #1 ${moved.items[0].symbol}`)
  assert.equal(moved.items[0].symbol, "0")
  assert.ok(updateMs < 200)
})

test("block estimates move backward for older targets and never go negative", () => {
  assert.equal(blockForTime(1000, 1_000_000, 1_000_000 - 120_000, 12_000), 990)
  assert.equal(blockForTime(5, 0, -1_000_000, 12_000), 0)
})
