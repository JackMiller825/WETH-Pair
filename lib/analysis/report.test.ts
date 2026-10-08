import assert from "node:assert/strict"
import test from "node:test"
import { buildTokenReport } from "./report"
import { matchConcepts } from "../narrative/text"
import type { NewsItem, TokenAnalysis } from "../narrative/types"
import type { LpBurnEvent } from "../lp/monitor"
import type { PairRecord } from "../types"

function token(name: string, symbol: string, createdAt: string, description: string | null = null): TokenAnalysis {
  const concepts = matchConcepts(name, symbol, description)
  return {
    address: "0xpair",
    tokenAddress: "0x" + "ab".repeat(20),
    symbol,
    tokenName: name,
    createdAt,
    liquidity: 42000,
    marketCap: null,
    volume24h: null,
    makers24h: null,
    url: "https://www.dextools.io",
    concepts,
    primaryIds: [],
    tickerPatterns: [],
    words: [],
    deployer: "0x" + "cd".repeat(20),
    description,
    website: null,
    twitter: null,
    telegram: null,
    tokenCreatedAt: null,
    buys24h: null,
  }
}

test("a missing website and a failed contract read still produce a report", () => {
  const created = "2026-10-08T10:00:00.000Z"
  const row = token("Plain Token", "PLAIN", created)
  const report = buildTokenReport({
    token: row,
    rows: [],
    burns: [],
    news: [],
    tokens: [row],
    chain: { error: "Etherscan unavailable" },
  })
  assert.equal(report.token.website, null)
  assert.equal(report.facts[0].value.includes("Plain Token"), true)
  assert.ok(report.failed.some((item) => item.includes("Etherscan")))
  assert.ok(report.unavailable.some((item) => item.includes("Holder")))
})

test("an LP burn later than pair creation stays a separate timeline fact", () => {
  const created = "2026-10-08T10:00:00.000Z"
  const burned = "2026-10-08T10:07:00.000Z"
  const row = token("Later Burn", "LATER", created)
  const record = {
    name: "LATER",
    created_at: created,
    exchange: "Uniswap V2",
    address: "0xpair",
    tokenAddress: row.tokenAddress,
    url: row.url,
    price: null,
    remaining: null,
    remainingUnit: "ETH",
    listingLiquidity: 1000,
    marketCap: null,
    liquidity: 1000,
    holders: null,
    totalTx: null,
    lpStatus: "burnt",
    lpBurntPercent: 99.8,
    lpLockedPercent: 0,
    lpUnlockAt: null,
    lpBurnAt: burned,
    lpSource: "ethereum-transfer",
  } satisfies PairRecord
  const burn = {
    id: "1",
    chainId: 1,
    pair: "0xpair",
    tokenAddress: row.tokenAddress,
    symbol: "LATER",
    tokenName: "Later Burn",
    exchange: "Uniswap V2",
    createdAt: created,
    detectedAt: burned,
    burnAt: burned,
    kind: "newly-burned",
    lpBurntPercent: 99.8,
    lpSupply: 100,
    lpBurnedTokens: 99.8,
    lpRemaining: 0.2,
    liquidity: 1000,
    marketCap: null,
    volume24h: null,
    buys24h: null,
    deployer: row.deployer,
    url: row.url,
    burnTx: "0x" + "11".repeat(32),
    burnBlock: 1,
    burnFrom: null,
    source: "ethereum-transfer",
    percentKnown: true,
  } satisfies LpBurnEvent
  const report = buildTokenReport({ token: row, rows: [record], burns: [burn], news: [], tokens: [row] })
  assert.deepEqual(report.timeline.map((item) => item.label.startsWith("Pair") || item.label.startsWith("LP")), [true, true])
  assert.ok(report.calculated.some((item) => item.value === "420 seconds"))
  assert.equal(report.facts.find((item) => item.label === "LP burned")?.value, "99.8%")
})

test("news published after launch is not treated as the origin", () => {
  const row = token("Tesla Bot", "TESLABOT", "2026-10-08T09:30:00.000Z")
  const story: NewsItem = {
    id: "story",
    title: "Tesla unveils a new car platform",
    url: "https://example.com/tesla",
    source: "Example",
    kind: "news",
    publishedAt: "2026-10-08T10:00:00.000Z",
  }
  const report = buildTokenReport({ token: row, rows: [], burns: [], news: [story], tokens: [row] })
  assert.equal(report.news.length, 0)
  assert.ok(report.rejectedNews.length > 0)
  assert.match(report.interpretation[0].value, /Unknown|cannot explain|No reliable/i)
})
