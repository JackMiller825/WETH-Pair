import { conceptById } from "@/lib/narrative/lexicon"
import { matchConcepts, normalizeText, tickerOf, type ConceptHit } from "@/lib/narrative/text"
import type { NewsItem, Origin, OriginLabel, TokenAnalysis, TokenRef } from "@/lib/narrative/types"
import { isInsideRange } from "@/lib/time-range"

export const CORRELATION_WEIGHTS = {
  name: 25,
  ticker: 15,
  signature: 20,
  timing: 15,
  evidence: 15,
  cluster: 10,
} as const

const CLUSTER_GAP_MS = 6 * 60 * 60 * 1000
const REACTION_MS = 48 * 60 * 60 * 1000

export type EvidenceLevel =
  | "Confirmed"
  | "Highly Likely"
  | "Likely"
  | "Possible"
  | "Weak Connection"
  | "No Reliable Connection"

export type NewsSource = {
  source: string
  url: string
  title: string
  publishedAt: string
  kind: NewsItem["kind"]
}

export type NewsEvent = {
  id: string
  title: string
  normalizedTitle: string
  summary: string
  publishedAt: string
  firstSeenAt: string
  entities: string[]
  people: string[]
  organizations: string[]
  products: string[]
  keywords: string[]
  specificIds: string[]
  genericIds: string[]
  category: string
  sources: NewsSource[]
  importanceScore: number
}

export type ScoreParts = {
  name: number
  ticker: number
  signature: number
  timing: number
  evidence: number
  cluster: number
  total: number
}

export type TokenLink = {
  token: TokenAnalysis
  level: EvidenceLevel
  score: number
  parts: ScoreParts
  minutesAfter: number | null
  direction: "after" | "before"
  reasons: string[]
}

export type EventAnalysis = {
  event: NewsEvent
  links: TokenLink[]
  causedBy: TokenLink[]
  afterLaunch: TokenLink[]
  best: TokenRef | null
  deployers: number
  liquidity: number | null
  volume24h: number | null
  wave: { active: boolean; before: number; after: number; note: string }
  origin: Origin
}

export function buildNewsEvents(news: NewsItem[]): NewsEvent[] {
  const articles = news
    .map((item) => ({ item, at: Date.parse(item.publishedAt), hits: matchConcepts(item.title, "", null) }))
    .filter((item) => Number.isFinite(item.at))
    .sort((a, b) => a.at - b.at)

  const parent = articles.map((_, index) => index)
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])))
  const join = (left: number, right: number) => {
    const a = find(left)
    const b = find(right)
    if (a !== b) parent[b] = a
  }

  for (let i = 0; i < articles.length; i += 1) {
    for (let j = i + 1; j < articles.length; j += 1) {
      if (articles[j].at - articles[i].at > CLUSTER_GAP_MS) break
      if (sameEvent(articles[i].hits, articles[j].hits, articles[i].item.title, articles[j].item.title)) join(i, j)
    }
  }

  const groups = new Map<number, typeof articles>()
  articles.forEach((article, index) => {
    const key = find(index)
    const list = groups.get(key) ?? []
    list.push(article)
    groups.set(key, list)
  })

  return [...groups.values()].map(toEvent).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

export function analyzeEvents(news: NewsItem[], tokens: TokenAnalysis[]): EventAnalysis[] {
  return buildNewsEvents(news)
    .map((event) => analyzeEvent(event, tokens))
    .filter((item) => item.causedBy.length > 0 || item.event.specificIds.length > 0)
    .sort((a, b) => b.causedBy.length - a.causedBy.length || b.event.importanceScore - a.event.importanceScore)
}

export function analyzeEvent(event: NewsEvent, tokens: TokenAnalysis[]): EventAnalysis {
  const published = Date.parse(event.publishedAt)
  const preliminary = tokens.map((token) => scoreToken(event, token, published, 0))
  const causedBy = preliminary.filter((link) => link.direction === "after" && link.level !== "No Reliable Connection")
  const cluster = clusterPoints(causedBy.length)
  const links = preliminary.map((link) => {
    if (link.direction !== "after" || link.level === "No Reliable Connection") return link
    const parts = { ...link.parts, cluster, total: Math.min(100, link.parts.total - link.parts.cluster + cluster) }
    return { ...link, parts, score: parts.total, level: levelFor(parts.total, event.specificIds.length > 0, link.reasons.some((reason) => reason.startsWith("Confirmed"))) }
  })
  const causal = links.filter((link) => link.direction === "after" && link.level !== "No Reliable Connection")
  const afterLaunch = links.filter((link) => link.direction === "before" && sharesEntity(event, link.token))
  const ordered = [...causal].sort((a, b) => a.token.createdAt.localeCompare(b.token.createdAt))
  return {
    event,
    links,
    causedBy: ordered,
    afterLaunch,
    best: bestOf(ordered.map((link) => link.token)),
    deployers: deployerCount(ordered),
    liquidity: sum(ordered.map((link) => link.token.liquidity)),
    volume24h: sum(ordered.map((link) => link.token.volume24h)),
    wave: waveFor(event, tokens, published),
    origin: originFrom(event, ordered),
  }
}

export function eventInWindow(analysis: EventAnalysis, range: string, now: number): boolean {
  if (isInsideRange(analysis.event.publishedAt, range, now)) return true
  return analysis.causedBy.some((link) => isInsideRange(link.token.createdAt, range, now))
}

function sameEvent(left: ConceptHit[], right: ConceptHit[], leftTitle: string, rightTitle: string): boolean {
  const specific = new Set(left.filter((hit) => !hit.generic).map((hit) => hit.id))
  if ([...specific].some((id) => right.some((hit) => hit.id === id && !hit.generic))) return true
  const words = rareWords(leftTitle)
  const other = new Set(rareWords(rightTitle))
  let shared = 0
  for (const word of words) if (other.has(word)) shared += 1
  return shared >= 3
}

function rareWords(title: string): string[] {
  return normalizeText(title).split(" ").filter((word) => word.length >= 5 && !GENERIC_WORDS.has(word))
}

const GENERIC_WORDS = new Set(["about", "after", "could", "first", "their", "there", "these", "those", "which", "would", "token", "price", "market", "crypto"])

function toEvent(group: { item: NewsItem; at: number; hits: ConceptHit[] }[]): NewsEvent {
  const ordered = [...group].sort((a, b) => a.at - b.at)
  const hits = new Map<string, ConceptHit>()
  for (const article of ordered) {
    for (const hit of article.hits) if (!hits.has(hit.id)) hits.set(hit.id, hit)
  }
  const concepts = [...hits.values()]
  const specific = concepts.filter((hit) => !hit.generic)
  const generic = concepts.filter((hit) => hit.generic)
  const keywords = concepts.flatMap((hit) => signatureOf(hit.id))
  const sources = ordered.map((article) => ({
    source: article.item.source,
    url: article.item.url,
    title: article.item.title,
    publishedAt: article.item.publishedAt,
    kind: article.item.kind,
  }))
  const people = concepts.filter((hit) => hit.group === "person").map((hit) => hit.label)
  const organizations = concepts.filter((hit) => hit.group === "company").map((hit) => hit.label)
  const products = concepts.filter((hit) => hit.group === "technology" || hit.group === "meme").map((hit) => hit.label)
  return {
    id: eventId(sources.map((source) => source.url)),
    title: ordered[0].item.title,
    normalizedTitle: normalizeText(ordered[0].item.title),
    summary: [...new Set(ordered.map((article) => article.item.title))].slice(0, 3).join(" · "),
    publishedAt: new Date(ordered[0].at).toISOString(),
    firstSeenAt: new Date(ordered[0].at).toISOString(),
    entities: concepts.map((hit) => hit.label),
    people,
    organizations,
    products,
    keywords: [...new Set(keywords)],
    specificIds: specific.map((hit) => hit.id),
    genericIds: generic.map((hit) => hit.id),
    category: specific[0]?.group ?? generic[0]?.group ?? "general",
    sources,
    importanceScore: Math.min(100, sources.length * 12 + specific.length * 18 + Math.min(generic.length, 2) * 4),
  }
}

function signatureOf(id: string): string[] {
  const concept = conceptById(id)
  if (!concept) return []
  return [...concept.aliases, ...concept.ticker.map((item) => item.toLowerCase())]
}

function eventId(urls: string[]): string {
  const text = [...urls].sort().join("|")
  let hash = 0
  for (const char of text) hash = Math.imul(hash, 31) + char.charCodeAt(0)
  return `evt-${(hash >>> 0).toString(16)}`
}

function scoreToken(event: NewsEvent, token: TokenAnalysis, published: number, cluster: number): TokenLink {
  const created = Date.parse(token.createdAt)
  const direction = Number.isFinite(created) && created < published ? "before" : "after"
  const specific = event.specificIds.filter((id) => token.concepts.some((hit) => hit.id === id))
  const generic = event.genericIds.filter((id) => token.concepts.some((hit) => hit.id === id))
  const hasSpecific = specific.length > 0
  const reasons: string[] = []
  let name = 0
  let tickerPoints = 0
  let signature = 0
  let timing = 0
  let evidence = 0

  if (event.specificIds.length > 0 && !hasSpecific) {
    reasons.push("The event names a specific entity that this token does not share. A generic word in the same headline is not enough.")
  } else if (hasSpecific && token.concepts.some((hit) => specific.includes(hit.id) && (hit.via === "name" || hit.via === "description"))) {
    name = CORRELATION_WEIGHTS.name
    reasons.push(`Specific entity ${labelList(specific)} appears in the token name or description.`)
  } else if (!hasSpecific && generic.length > 0) {
    name = 8
    reasons.push(`Only a generic word is shared: ${labelList(generic)}. That alone is weak evidence.`)
  }

  const tickerText = tickerOf(token.symbol)
  const fragments = event.specificIds.flatMap((id) => conceptById(id)?.ticker ?? []).map((item) => item.toUpperCase())
  if (fragments.some((fragment) => fragment.length >= 4 && tickerText.includes(fragment))) {
    tickerPoints = CORRELATION_WEIGHTS.ticker
    reasons.push(`Ticker ${tickerText} contains a specific entity fragment.`)
  }

  const described = normalizeText(token.description ?? "")
  if (hasSpecific && described && event.keywords.some((keyword) => keyword.length >= 4 && !isGenericKeyword(keyword) && described.includes(keyword))) {
    signature = CORRELATION_WEIGHTS.signature
    reasons.push("The token description repeats a specific phrase from the event signature.")
  }

  const overlap = name > 0 || tickerPoints > 0 || signature > 0
  let minutesAfter: number | null = null
  if (direction === "before" && overlap) {
    reasons.push("News occurred after token launch. This event cannot explain the initial launch.")
  } else if (overlap && Number.isFinite(created)) {
    minutesAfter = Math.round((created - published) / 60_000)
    if (minutesAfter <= 15) timing = CORRELATION_WEIGHTS.timing
    else if (minutesAfter <= 60) timing = 12
    else if (minutesAfter <= 6 * 60) timing = 8
    else if (minutesAfter <= REACTION_MS / 60_000) timing = 4
    reasons.push(`Launched ${minutesAfter} minutes after the earliest source.`)
  }

  if (hasSpecific && linksStory(token, event)) {
    evidence = CORRELATION_WEIGHTS.evidence
    reasons.unshift("Confirmed: a token link or description points at this same story.")
  }

  const parts = { name, ticker: tickerPoints, signature, timing, evidence, cluster, total: Math.min(100, name + tickerPoints + signature + timing + evidence + cluster) }
  if (direction === "before" || parts.total === 0) {
    return { token, level: "No Reliable Connection", score: 0, parts: { ...parts, total: 0 }, minutesAfter, direction, reasons }
  }
  return { token, level: levelFor(parts.total, hasSpecific, reasons.some((reason) => reason.startsWith("Confirmed"))), score: parts.total, parts, minutesAfter, direction, reasons }
}

function isGenericKeyword(keyword: string): boolean {
  return ["ai", "eth", "dog", "cat", "moon", "pepe", "meme", "bot"].includes(keyword)
}

function levelFor(total: number, specific: boolean, confirmed: boolean): EvidenceLevel {
  if (confirmed && specific) return "Confirmed"
  if (!specific) {
    if (total >= 20) return "Possible"
    if (total > 0) return "Weak Connection"
    return "No Reliable Connection"
  }
  if (total >= 70) return "Highly Likely"
  if (total >= 45) return "Likely"
  if (total >= 25) return "Possible"
  if (total > 0) return "Weak Connection"
  return "No Reliable Connection"
}

function deployerCount(links: TokenLink[]): number {
  return new Set(links.map((link) => link.token.deployer).filter((value): value is string => Boolean(value))).size
}

function clusterPoints(count: number): number {
  if (count >= 5) return CORRELATION_WEIGHTS.cluster
  if (count >= 3) return 6
  return 0
}

function sharesEntity(event: NewsEvent, token: TokenAnalysis): boolean {
  return token.concepts.some((hit) => event.specificIds.includes(hit.id) || event.genericIds.includes(hit.id))
}

function labelList(ids: string[]): string {
  return ids.map((id) => conceptById(id)?.label ?? id).join(", ")
}

function linksStory(token: TokenAnalysis, event: NewsEvent): boolean {
  const urls = new Set(event.sources.map((source) => source.url))
  for (const link of [token.website, token.twitter, token.telegram]) {
    if (link && urls.has(link)) return true
  }
  if (!token.description) return false
  const words = rareWords(event.title)
  const description = normalizeText(token.description)
  const hits = words.filter((word) => description.includes(word))
  return words.length >= 3 && hits.length >= Math.min(3, words.length)
}

function waveFor(event: NewsEvent, tokens: TokenAnalysis[], published: number): EventAnalysis["wave"] {
  const matched = (start: number, end: number) => tokens.filter((token) => {
    const at = Date.parse(token.createdAt)
    if (!Number.isFinite(at) || at < start || at >= end) return false
    return event.specificIds.some((id) => token.concepts.some((hit) => hit.id === id))
  }).length
  const before = matched(published - 60 * 60 * 1000, published)
  const after = matched(published, published + 30 * 60 * 1000)
  const active = event.specificIds.length > 0 && after >= 5 && after >= Math.max(3, before * 3)
  return {
    active,
    before,
    after,
    note: active
      ? `${after} specific-name launches in the 30 minutes after the event, against ${before} in the previous hour.`
      : "No launch wave. A generic keyword burst is not counted.",
  }
}

function originFrom(event: NewsEvent, links: TokenLink[]): Origin {
  const best = [...links].sort((a, b) => b.score - a.score)[0]
  const label: OriginLabel = !best
    ? "Unknown"
    : best.level === "Confirmed"
      ? "Confirmed Origin"
      : best.level === "Highly Likely"
        ? "Highly Likely"
        : "Possible Connection"
  return {
    label,
    summary: best ? `${best.level}. ${best.reasons[0] ?? ""}` : "No token launched after this event with a reliable connection.",
    confidence: best?.score ?? 0,
    evidence: best?.reasons ?? ["No supporting token evidence."],
    sources: event.sources.map((source) => ({
      id: source.url,
      title: source.title,
      url: source.url,
      source: source.source,
      kind: source.kind,
      publishedAt: source.publishedAt,
    })),
  }
}

function bestOf(tokens: TokenAnalysis[]): TokenRef | null {
  const ranked = [...tokens].sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1) || (b.liquidity ?? -1) - (a.liquidity ?? -1))
  const best = ranked[0]
  if (!best) return null
  return {
    address: best.address,
    tokenAddress: best.tokenAddress,
    symbol: best.symbol,
    tokenName: best.tokenName,
    createdAt: best.createdAt,
    liquidity: best.liquidity,
    marketCap: best.marketCap,
    volume24h: best.volume24h,
    makers24h: best.makers24h,
    url: best.url,
  }
}

function sum(values: (number | null)[]): number | null {
  const numbers = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (numbers.length === 0) return null
  return numbers.reduce((total, value) => total + value, 0)
}
