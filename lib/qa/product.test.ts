import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { buildTokenReport } from "../analysis/report"
import { safeHttpUrl } from "../http"
import { buildIntelligence } from "../narrative/engine"
import { analyzeEvents, buildNewsEvents } from "../narrative/events"
import { combineScore, velocityScore } from "../narrative/score"
import { matchConcepts } from "../narrative/text"
import type { NewsItem, SnapshotFile, TokenAnalysis } from "../narrative/types"
import { EMPTY_DETAIL, type PairRecord } from "../types"
import { applyView, slicePage, type SortState } from "../view"
import { searchBounds, type WatchConfig, DEFAULT_CONFIG } from "../lp/monitor"

const now = Date.parse("2026-10-08T12:00:00.000Z")

function at(ms: number): string {
  return new Date(ms).toISOString()
}

function news(title: string, when: number, url?: string): NewsItem {
  return { id: url ?? title, title, url: url ?? `https://example.com/${encodeURIComponent(title)}`, source: "Example", kind: "news", publishedAt: at(when) }
}

function token(name: string, symbol: string, when: number): TokenAnalysis {
  const concepts = matchConcepts(name, symbol, null)
  return {
    address: `pair-${symbol}`,
    tokenAddress: `token-${symbol}`.padEnd(42, "0").slice(0, 42),
    symbol,
    tokenName: name,
    createdAt: at(when),
    liquidity: 1000,
    marketCap: null,
    volume24h: null,
    makers24h: null,
    url: "https://www.dextools.io",
    concepts,
    primaryIds: concepts.filter((hit) => !hit.generic).map((hit) => hit.id),
    tickerPatterns: [],
    words: [],
    deployer: null,
    description: null,
    website: null,
    twitter: null,
    telegram: null,
    tokenCreatedAt: null,
    buys24h: null,
  }
}

let pairSeq = 0

function pair(name: string, when: number, extra: Partial<PairRecord> = {}): PairRecord {
  pairSeq += 1
  return {
    name,
    created_at: at(when),
    exchange: "Uniswap V2",
    address: `0x${pairSeq.toString(16).padStart(40, "a")}`,
    tokenAddress: `0x${pairSeq.toString(16).padStart(40, "b")}`,
    url: "https://www.dextools.io/app/ether/pair-explorer/example",
    price: 1,
    remaining: null,
    remainingUnit: "",
    listingLiquidity: 1000,
    ...EMPTY_DETAIL,
    ...extra,
  }
}

test("journey: a new pair in the last hour is visible, and an 8-day-old pair is not", () => {
  const rows = [
    pair("SIPEPE(Sipepe)", now - 10 * 60 * 1000),
    pair("OLD(Old Token)", now - 8 * 24 * 60 * 60 * 1000),
  ]
  const snapshot: SnapshotFile = { generatedAt: at(now), hours: 168, scanned: rows.length, rows, news: [] }
  const hour = buildIntelligence(snapshot, "1h", now)
  const week = buildIntelligence(snapshot, "7d", now)
  assert.equal(hour.total, 1)
  assert.equal(week.total, 1)
  assert.equal(hour.tokens[0].symbol, "SIPEPE")
  const report = buildTokenReport({ token: hour.tokens[0], rows, burns: [], news: [], tokens: hour.tokens })
  assert.match(report.facts.find((fact) => fact.label === "Token")?.value ?? "", /SIPEPE/)
})

test("journey: news before a specific launch correlates, and news after does not explain the origin", () => {
  const story = news("Tesla unveils a new car platform", now)
  const after = analyzeEvents([story], [token("Tesla Bot", "TESLABOT", now + 7 * 60 * 1000)])
  assert.ok(after[0].causedBy[0].score >= 50)
  const before = analyzeEvents([story], [token("Tesla Bot", "TESLABOT", now - 60 * 60 * 1000)])
  assert.equal(before[0].causedBy.length, 0)
  const generic = analyzeEvents([news("AI startups raise new funding", now)], [token("AI Dog", "AIDOG", now + 7 * 60 * 1000)])
  assert.ok(generic[0].causedBy.length === 0 || generic[0].causedBy[0].level === "Weak Connection" || generic[0].causedBy[0].level === "Possible")
})

test("five articles about one Tesla story stay one event", () => {
  const events = buildNewsEvents([
    news("Tesla announces new robotics system", now, "https://a.example/1"),
    news("Tesla reveals robotics update", now + 60_000, "https://b.example/2"),
    news("Tesla expands robotics project", now + 120_000, "https://c.example/3"),
    news("Tesla robotics plan draws coverage", now + 180_000, "https://d.example/4"),
    news("Tesla robotics announcement continues", now + 240_000, "https://e.example/5"),
  ])
  assert.equal(events.length, 1)
  assert.equal(events[0].sources.length, 5)
})

test("the same inputs produce the same trend score", () => {
  const parts = { launchVelocity: 80, newsRelevance: 10, tokenActivity: 20, liquidityActivity: 15, discussion: null }
  assert.equal(combineScore(parts, false), combineScore(parts, false))
  assert.equal(velocityScore(4, 1, 2), velocityScore(4, 1, 2))
})

test("related meme names share a concept and an unrelated name does not", () => {
  const pepe = matchConcepts("Sipepe", "SIPEPE", null).some((hit) => hit.id === "pepe")
  const other = matchConcepts("Sipepe", "SIPEPE", null).map((hit) => hit.id)
  const cat = matchConcepts("Plain Cat", "CAT", null).map((hit) => hit.id)
  assert.equal(pepe, true)
  assert.ok(!cat.includes("pepe"))
  assert.ok(other.includes("pepe"))
})

test("full analysis keeps a contract failure partial and does not invent social data", () => {
  const row = pair("<script>alert(1)</script>(BAD)", now - 60_000, {
    website: "javascript:alert(1)",
    twitter: null,
    telegram: null,
    deployer: "0xdeployer",
    lpStatus: "locked",
    lpBurntPercent: 0,
    lpLockedPercent: 40,
  })
  const sibling = pair("OTHER(Other)", now - 2 * 60 * 60 * 1000, { deployer: "0xdeployer", tokenAddress: "0x" + "c".repeat(40) })
  const analysis = token(row.name, "BAD", now - 60_000)
  analysis.tokenAddress = row.tokenAddress
  analysis.deployer = "0xdeployer"
  const report = buildTokenReport({
    token: analysis,
    rows: [row, sibling],
    burns: [],
    news: [],
    tokens: [analysis],
    chain: { error: "Etherscan timeout" },
  })
  assert.match(report.failed.join(" "), /Etherscan timeout/)
  assert.ok(report.facts.length > 0)
  assert.match(report.unavailable.join(" "), /not fetched/)
  assert.equal(report.deployerTokens.length, 1)
  assert.match(report.liquidityNote, /not counted as burned/)
  assert.equal(safeHttpUrl(row.website), null)
  assert.equal(safeHttpUrl("https://example.com/token"), "https://example.com/token")
  assert.match(report.facts.find((fact) => fact.label === "Token")?.value ?? "", /script/)
})

test("search matches ticker, contract, pair, and deployer without mixing exchanges", () => {
  const rows = [
    pair("ALPHA(Alpha)", now, { symbol: "ALPHA", tokenAddress: "0x" + "1".repeat(40), address: "0x" + "2".repeat(40), deployer: "0x" + "3".repeat(40), exchange: "Uniswap V2" }),
    pair("BETA(Beta)", now, { symbol: "BETA", exchange: "SushiSwap", liquidity: 50_000, volume24h: 20_000, lpStatus: "burnt", lpBurntPercent: 99 }),
  ]
  const sort: SortState = { key: "created", direction: "desc" }
  assert.equal(applyView(rows, { name: "alpha", exchange: "all" }, sort).length, 1)
  assert.equal(applyView(rows, { name: "0x" + "1".repeat(40), exchange: "all" }, sort).length, 1)
  assert.equal(applyView(rows, { name: "0x" + "3".repeat(40), exchange: "all" }, sort).length, 1)
  assert.equal(applyView(rows, { name: "BETA", exchange: "Uniswap V2" }, sort).length, 0)
  assert.equal(applyView(rows, { name: "", exchange: "SushiSwap" }, sort)[0].symbol, "BETA")
})

test("sorting puts missing numbers last and pagination does not skip or repeat rows", () => {
  const rows = [
    pair("A", now, { liquidity: null, listingLiquidity: null }),
    pair("B", now - 1000, { liquidity: 5 }),
    pair("C", now - 2000, { liquidity: 50 }),
  ]
  const sorted = applyView(rows, { name: "", exchange: "all" }, { key: "liquidity", direction: "asc" })
  assert.equal(sorted.at(-1)?.liquidity ?? sorted.at(-1)?.listingLiquidity, null)
  const source = Array.from({ length: 25 }, (_, index) => pair(`N${index}`, now - index))
  const pages = [1, 2, 3].flatMap((page) => slicePage(source, page, 10))
  assert.equal(pages.length, 25)
  assert.equal(new Set(pages.map((row) => row.name)).size, 25)
  assert.equal(slicePage(source, 99, 10).length, 5)
  assert.equal(slicePage([], 1, 10).length, 0)
})

test("a custom range that is inverted or longer than 30 days is rejected and is not replaced with 24h", () => {
  const config: WatchConfig = { ...DEFAULT_CONFIG, windowId: "custom", customStart: "2026-10-08T00:00", customEnd: "2026-10-01T00:00" }
  const inverted = searchBounds(config, now)
  assert.ok("error" in inverted)
  const huge = searchBounds({ ...config, customStart: "2026-08-01T00:00", customEnd: "2026-10-08T00:00" }, now)
  assert.ok("error" in huge)
  const dated = searchBounds({ ...config, customStart: "2026-10-01T00:00:00.000Z", customEnd: "2026-10-08T00:00:00.000Z" }, now)
  assert.ok(!("error" in dated))
  if (!("error" in dated)) assert.ok(dated.end - dated.start > 24 * 60 * 60 * 1000)
})

test("ten thousand rows can be filtered and sorted inside a second", () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => pair(`T${index}`, now - index * 1000, { liquidity: index % 7 === 0 ? null : index }))
  const started = Date.now()
  const visible = slicePage(applyView(rows, { name: "t1", exchange: "all" }, { key: "liquidity", direction: "desc" }), 1, 100)
  const elapsed = Date.now() - started
  assert.ok(visible.length > 0)
  assert.ok(elapsed < 1000, `filter took ${elapsed}ms`)
})

test("the main column stays wide and token websites cannot use a script URL", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8")
  assert.match(css, /max-width:\s*2200px/)
  assert.equal(safeHttpUrl("javascript:alert(1)"), null)
  assert.doesNotMatch(readFileSync(new URL("../../components/shell/app-shell.tsx", import.meta.url), "utf8"), /max-w-6xl|max-w-5xl|max-w-4xl/)
})
