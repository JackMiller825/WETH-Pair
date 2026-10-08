import assert from "node:assert/strict"
import test from "node:test"
import { analyzeEvents, buildNewsEvents, eventInWindow } from "./events"
import { matchConcepts } from "./text"
import type { NewsItem, TokenAnalysis } from "./types"

const day = Date.parse("2026-10-08T10:00:00.000Z")

function at(minutesFromTen: number): string {
  return new Date(day + minutesFromTen * 60 * 1000).toISOString()
}

function news(title: string, minutesFromTen: number, url = `https://example.com/${title}`): NewsItem {
  return { id: url, title, url, source: "Example", kind: "news", publishedAt: at(minutesFromTen) }
}

function token(name: string, symbol: string, minutesFromTen: number, description: string | null = null): TokenAnalysis {
  const concepts = matchConcepts(name, symbol, description)
  return {
    address: `pair-${symbol}`,
    tokenAddress: `token-${symbol}`,
    symbol,
    tokenName: name,
    createdAt: at(minutesFromTen),
    liquidity: 1000,
    marketCap: 2000,
    volume24h: null,
    makers24h: null,
    url: "https://www.dextools.io",
    concepts,
    primaryIds: concepts.filter((hit) => !hit.generic).map((hit) => hit.id),
    tickerPatterns: [],
    words: [],
    deployer: "0xdeployer",
    description,
    website: null,
    twitter: null,
    telegram: null,
    tokenCreatedAt: null,
    buys24h: null,
  }
}

test("the same Tesla story from three publications is one event", () => {
  const events = buildNewsEvents([
    news("Tesla announces new robotics system", 0, "https://reuters.example/tesla"),
    news("Tesla reveals robotics update", 20, "https://bloomberg.example/tesla"),
    news("Tesla expands robotics project", 40, "https://tech.example/tesla"),
  ])
  assert.equal(events.length, 1)
  assert.equal(events[0].sources.length, 3)
  assert.ok(events[0].organizations.includes("Tesla") || events[0].entities.includes("Tesla"))
})

test("A: a specific token launched 7 minutes after the story scores as a real connection", () => {
  const [analysis] = analyzeEvents(
    [news("Tesla unveils a new car platform", 0)],
    [token("Tesla Bot", "TESLABOT", 7)],
  )
  const link = analysis.causedBy[0]
  assert.ok(link)
  assert.ok(link.score >= 50)
  assert.ok(link.level === "Likely" || link.level === "Highly Likely" || link.level === "Confirmed")
  assert.equal(link.minutesAfter, 7)
})

test("B: a token launched before the story is not given that story as its origin", () => {
  const [analysis] = analyzeEvents(
    [news("Tesla unveils a new car platform", 0)],
    [token("Tesla Bot", "TESLABOT", -30)],
  )
  assert.equal(analysis.causedBy.length, 0)
  assert.match(analysis.afterLaunch[0].reasons.join(" "), /cannot explain the initial launch/)
})

test("C: a generic AI overlap stays weak or possible, never confirmed", () => {
  const [analysis] = analyzeEvents(
    [news("AI startups raise new funding", 0)],
    [token("AI Dog", "AIDOG", 7)],
  )
  const link = analysis.causedBy[0]
  assert.ok(link)
  assert.ok(link.level === "Weak Connection" || link.level === "Possible")
  assert.notEqual(link.level, "Confirmed")
  assert.notEqual(link.level, "Highly Likely")
  assert.notEqual(link.level, "Likely")
})

test("a specific story does not inherit a connection from a generic word in the same headline", () => {
  const [analysis] = analyzeEvents(
    [news("Vitalik Buterin discusses AI research", 0)],
    [token("AI Dog", "AIDOG", 7)],
  )
  assert.equal(analysis.causedBy.length, 0)
})

test("a later launch with no shared name is not a connection", () => {
  const [analysis] = analyzeEvents(
    [news("Exchange volumes rise across the market", 0)],
    [token("Plain Token", "PLAIN", 7)],
  )
  assert.equal(analysis, undefined)
})

test("a short window uses token launch time, not a hidden 24 hour query", () => {
  const [analysis] = analyzeEvents(
    [news("Tesla unveils a new car platform", 0)],
    [token("Tesla Bot", "TESLABOT", 7)],
  )
  assert.equal(eventInWindow(analysis, "15m", Date.parse(at(10))), true)
  assert.equal(eventInWindow(analysis, "15m", Date.parse(at(180))), false)
})

test("D: a specific phrase in the headline, name, ticker, and description is a strong connection", () => {
  const headline = "Tesla unveils Optimus robot project"
  const [analysis] = analyzeEvents(
    [news(headline, 0, "https://example.com/optimus")],
    [token("Optimus", "OPTIMUS", 10, "Tesla unveils the Optimus robot for factories")],
  )
  const link = analysis.causedBy[0]
  assert.ok(link.score >= 70)
  assert.ok(link.level === "Confirmed" || link.level === "Highly Likely")
})
