import { CONCEPTS, FAMILY_ROOTS, conceptById } from "@/lib/narrative/lexicon"
import {
  combineScore,
  directionOf,
  discussionScore,
  earlyScore,
  lifecycleOf,
  liquidityScore,
  tokenActivityScore,
  velocityScore,
} from "@/lib/narrative/score"
import {
  initials,
  matchConcepts,
  nameWords,
  normalizeText,
  parseIdentity,
  slugify,
  tickerOf,
  type ConceptHit,
} from "@/lib/narrative/text"
import type {
  Bucket,
  HistoryPoint,
  Intelligence,
  NewsCorrelation,
  NewsItem,
  Origin,
  ScoreParts,
  SnapshotFile,
  TokenAnalysis,
  TokenRef,
  Trend,
  TrendKind,
  WindowId,
} from "@/lib/narrative/types"
import { windowById } from "@/lib/narrative/types"
import { isInsidePrevious, isInsideRange } from "@/lib/time-range"
import type { PairRecord } from "@/lib/types"

const EMERGING_RECENT_MS = 20 * 60 * 1000
const EMERGING_BASELINE_MS = 24 * 60 * 60 * 1000

export function buildIntelligence(snapshot: SnapshotFile, windowId: WindowId | string, now = Date.parse(snapshot.generatedAt)): Intelligence {
  const selected = windowById(windowId)
  const news = snapshot.news ?? []
  const discussionAvailable = news.some((item) => item.kind === "reddit")
  const tokens = analyzeRows(snapshot.rows)
  const current = tokens.filter((token) => isInsideRange(token.createdAt, windowId, now))
  const previous = tokens.filter((token) => isInsidePrevious(token.createdAt, windowId, now))
  const recent = tokens.filter((token) => inRange(token.createdAt, now - EMERGING_RECENT_MS, now))
  const baseline = tokens.filter((token) => inRange(token.createdAt, now - EMERGING_RECENT_MS - EMERGING_BASELINE_MS, now - EMERGING_RECENT_MS))

  const concepts = rank(conceptTrends(current, previous, news, discussionAvailable, selected.ms))
  const words = rank(wordTrends(current, previous, news, discussionAvailable, selected.ms)).slice(0, 40)
  const tickers = rank(tickerTrends(current, previous, news, discussionAvailable, selected.ms))
  const combinations = rank(combinationTrends(current, previous, news, discussionAvailable, selected.ms))
  const clusters = rank(clusterTrends(current, previous, news, discussionAvailable, selected.ms))
  const families = rank(familyTrends(current, previous, news, discussionAvailable, selected.ms))
  const emerging = emergingTrends(recent, baseline, news, discussionAvailable)
  const hot = [...concepts, ...clusters, ...combinations].filter((trend) => trend.score >= 70 || trend.lifecycle === "exploding" || trend.lifecycle === "hot").slice(0, 12)
  const cooling = [...concepts, ...clusters, ...words].filter((trend) => trend.lifecycle === "cooling" || trend.lifecycle === "saturated" || trend.lifecycle === "dead").slice(0, 12)

  return {
    generatedAt: snapshot.generatedAt,
    windowId: selected.id,
    windowLabel: selected.label,
    total: current.length,
    previousTotal: previous.length,
    tokens,
    concepts,
    words,
    tickers,
    combinations,
    clusters,
    families,
    emerging,
    hot,
    cooling,
    newsLinks: correlateNews(news, current),
    discussionAvailable,
  }
}

export function findTrend(intel: Intelligence, slug: string): Trend | null {
  const lists = [intel.concepts, intel.words, intel.tickers, intel.combinations, intel.clusters, intel.families, intel.emerging, intel.hot, intel.cooling]
  for (const list of lists) {
    const found = list.find((trend) => trend.slug === slug)
    if (found) return found
  }
  return null
}

export function allTrendSlugs(intel: Intelligence): string[] {
  const slugs = new Set<string>()
  for (const list of [intel.concepts, intel.words, intel.tickers, intel.combinations, intel.clusters, intel.families, intel.emerging]) {
    for (const trend of list) slugs.add(trend.slug)
  }
  return [...slugs]
}

export function launchBuckets(tokens: TokenRef[], start: number, end: number): Bucket[] {
  const span = Math.max(end - start, 60_000)
  const step = span <= 60 * 60_000 ? 5 * 60_000 : span <= 6 * 3600_000 ? 30 * 60_000 : span <= 24 * 3600_000 ? 3600_000 : 6 * 3600_000
  const buckets: Bucket[] = []
  for (let at = start; at < end; at += step) {
    const next = Math.min(end, at + step)
    buckets.push({
      at: new Date(at).toISOString(),
      launches: tokens.filter((token) => inRange(token.createdAt, at, next)).length,
    })
  }
  return buckets
}

export function historySeries(history: HistoryPoint[] | undefined, trendId: string): { at: string; liquidity: number; volume: number; makers: number; launches: number }[] {
  return (history ?? [])
    .filter((point) => point.narratives[trendId])
    .map((point) => {
      const row = point.narratives[trendId]
      return {
        at: point.at,
        liquidity: row.liquidity24h,
        volume: row.volume24h,
        makers: row.makers24h,
        launches: row.launches1h,
      }
    })
}

export function explainToken(token: TokenAnalysis, tokens: TokenAnalysis[], news: NewsItem[]): { origin: Origin; related: TokenRef[] } {
  const ids = token.concepts.map((concept) => concept.id)
  const related = tokens.filter((item) => item.tokenAddress !== token.tokenAddress && item.concepts.some((concept) => ids.includes(concept.id)))
  return {
    origin: originFor(token.concepts.map((concept) => concept.label), token.concepts.some((concept) => !concept.generic), [token, ...related], news),
    related: related.map(toRef).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12),
  }
}

function analyzeRows(rows: PairRecord[]): TokenAnalysis[] {
  const byToken = new Map<string, TokenAnalysis>()
  for (const row of rows) {
    const analysis = analyzeRow(row)
    const key = analysis.tokenAddress || analysis.address
    const previous = byToken.get(key)
    if (!previous || analysis.createdAt < previous.createdAt) byToken.set(key, analysis)
  }
  return [...byToken.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function analyzeRow(row: PairRecord): TokenAnalysis {
  const identity = parseIdentity(row)
  const concepts = matchConcepts(identity.tokenName, identity.symbol, row.description ?? null)
  const primaryIds = concepts.filter((concept) => !concept.generic).map((concept) => concept.id)
  const createdAt = row.tokenCreatedAt || row.created_at
  return {
    ...toRefFrom(row, identity.symbol, identity.tokenName, createdAt),
    concepts,
    primaryIds,
    tickerPatterns: tickerPatterns(identity.symbol, identity.tokenName, concepts),
    words: nameWords(identity.tokenName),
    deployer: row.deployer ?? null,
    description: row.description ?? null,
    website: row.website ?? null,
    twitter: row.twitter ?? null,
    telegram: row.telegram ?? null,
    tokenCreatedAt: row.tokenCreatedAt ?? null,
    buys24h: row.buys24h ?? null,
  }
}

function xPattern(ticker: string, fragments: string[]): boolean {
  const besideKnown = (remainder: string) => fragments.some((fragment) => fragment.length >= 3 && remainder.includes(fragment))
  return (ticker.startsWith("X") && besideKnown(ticker.slice(1))) || (ticker.endsWith("X") && besideKnown(ticker.slice(0, -1)))
}

function tickerPatterns(symbol: string, tokenName: string, hits: ConceptHit[]): string[] {
  const ticker = tickerOf(symbol)
  if (!ticker) return []
  const fragments: string[] = []
  for (const concept of CONCEPTS) {
    if (!hits.some((hit) => hit.id === concept.id)) continue
    for (const fragment of concept.ticker) {
      const frag = fragment.toUpperCase()
      if (ticker === frag || ticker.startsWith(frag) || ticker.endsWith(frag) || (frag.length >= 4 && ticker.includes(frag))) {
        fragments.push(frag)
      }
    }
  }
  const ordered = [...new Set(fragments)].sort((a, b) => ticker.indexOf(a) - ticker.indexOf(b))
  const patterns: string[] = []
  if (ordered.length >= 2) patterns.push(ordered.join(" + "))
  if (/\d/.test(ticker)) patterns.push("Number-based")
  if (xPattern(ticker, ordered)) patterns.push("X-related")
  const acronym = initials(tokenName)
  if (acronym.length >= 2 && acronym === ticker) patterns.push("Acronym")
  return patterns
}

function conceptTrends(current: TokenAnalysis[], previous: TokenAnalysis[], news: NewsItem[], discussionAvailable: boolean, windowMs: number): Trend[] {
  return CONCEPTS.map((concept) => {
    const now = current.filter((token) => token.concepts.some((hit) => hit.id === concept.id))
    const before = previous.filter((token) => token.concepts.some((hit) => hit.id === concept.id))
    if (now.length === 0 && before.length === 0) return null
    return makeTrend({
      id: concept.id,
      slug: concept.id,
      name: concept.label,
      kind: "concept",
      keywords: [concept.label],
      current: now,
      previous: before,
      total: current.length,
      news,
      discussionAvailable,
      windowMs,
      specific: concept.generic !== true,
      narrative: `${concept.label} appears in the token name or ticker.`,
    })
  }).filter((trend): trend is Trend => trend !== null && trend.count > 0)
}

function wordTrends(current: TokenAnalysis[], previous: TokenAnalysis[], news: NewsItem[], discussionAvailable: boolean, windowMs: number): Trend[] {
  const words = new Set<string>()
  for (const token of [...current, ...previous]) for (const word of token.words) words.add(word)
  const trends: Trend[] = []
  for (const word of words) {
    const now = current.filter((token) => token.words.includes(word))
    const before = previous.filter((token) => token.words.includes(word))
    if (now.length < 2) continue
    trends.push(makeTrend({
      id: `word:${word}`,
      slug: `word-${slugify(word)}`,
      name: word.toUpperCase(),
      kind: "word",
      keywords: [word],
      current: now,
      previous: before,
      total: current.length,
      news,
      discussionAvailable,
      windowMs,
      specific: word.length >= 4,
      narrative: `The word “${word.toUpperCase()}” appears in the token name.`,
    }))
  }
  return trends
}

function tickerTrends(current: TokenAnalysis[], previous: TokenAnalysis[], news: NewsItem[], discussionAvailable: boolean, windowMs: number): Trend[] {
  const patterns = new Set<string>()
  for (const token of [...current, ...previous]) for (const pattern of token.tickerPatterns) patterns.add(pattern)
  return [...patterns].flatMap((pattern) => {
    const now = current.filter((token) => token.tickerPatterns.includes(pattern))
    const before = previous.filter((token) => token.tickerPatterns.includes(pattern))
    if (now.length < 2) return []
    return [makeTrend({
      id: `ticker:${pattern}`,
      slug: `ticker-${slugify(pattern)}`,
      name: pattern,
      kind: "ticker",
      keywords: pattern.split(" + ").map((part) => part.toLowerCase()),
      current: now,
      previous: before,
      total: current.length,
      news,
      discussionAvailable,
      windowMs,
      specific: !pattern.includes("Number") && !pattern.includes("X-related") && !pattern.includes("Acronym"),
      narrative: `Tickers follow the pattern ${pattern}. This describes the ticker text, not a confirmed motive.`,
    })]
  })
}

function combinationTrends(current: TokenAnalysis[], previous: TokenAnalysis[], news: NewsItem[], discussionAvailable: boolean, windowMs: number): Trend[] {
  const pairs = new Map<string, { name: string; ids: string[]; specific: boolean }>()
  for (const token of current) {
    const concepts = token.concepts.filter((concept) => concept.group !== "culture")
    for (let i = 0; i < concepts.length; i++) {
      for (let j = i + 1; j < concepts.length; j++) {
        const ids = [concepts[i].id, concepts[j].id].sort()
        const key = ids.join("+")
        if (!pairs.has(key)) {
          pairs.set(key, {
            name: `${concepts[i].label} + ${concepts[j].label}`,
            ids,
            specific: !concepts[i].generic || !concepts[j].generic,
          })
        }
      }
    }
  }
  const trends: Trend[] = []
  for (const [key, pair] of pairs) {
    const hasBoth = (token: TokenAnalysis) => pair.ids.every((id) => token.concepts.some((concept) => concept.id === id))
    const now = current.filter(hasBoth)
    const before = previous.filter(hasBoth)
    if (now.length < 2) continue
    trends.push(makeTrend({
      id: `combo:${key}`,
      slug: `combo-${pair.ids.join("-")}`,
      name: pair.name,
      kind: "combination",
      keywords: pair.ids.map((id) => conceptById(id)?.label ?? id),
      current: now,
      previous: before,
      total: current.length,
      news,
      discussionAvailable,
      windowMs,
      specific: pair.specific,
      narrative: `These tokens combine ${pair.name} in the same name or ticker. A shared pairing is not proof that the tokens are related.`,
    }))
  }
  return trends
}

function clusterTrends(current: TokenAnalysis[], previous: TokenAnalysis[], news: NewsItem[], discussionAvailable: boolean, windowMs: number): Trend[] {
  const groups = new Map<string, TokenAnalysis[]>()
  for (const token of current) {
    if (token.primaryIds.length < 2) continue
    const key = [...token.primaryIds].sort().join("+")
    const list = groups.get(key) ?? []
    list.push(token)
    groups.set(key, list)
  }
  const trends: Trend[] = []
  for (const [key, now] of groups) {
    if (now.length < 2) continue
    const ids = key.split("+")
    const before = previous.filter((token) => [...token.primaryIds].sort().join("+") === key)
    const labels = ids.map((id) => conceptById(id)?.label ?? id)
    trends.push(makeTrend({
      id: `cluster:${key}`,
      slug: ids.join("-"),
      name: labels.join(" + "),
      kind: "cluster",
      keywords: labels,
      current: now,
      previous: before,
      total: current.length,
      news,
      discussionAvailable,
      windowMs,
      specific: true,
      narrative: `These tokens share the same specific name matches: ${labels.join(", ")}.`,
    }))
  }
  return trends
}

function familyTrends(current: TokenAnalysis[], previous: TokenAnalysis[], news: NewsItem[], discussionAvailable: boolean, windowMs: number): Trend[] {
  const trends: Trend[] = []
  for (const id of FAMILY_ROOTS) {
    const concept = conceptById(id)
    if (!concept) continue
    const root = concept.ticker[0]?.toUpperCase() ?? concept.label.toUpperCase()
    const isDerivative = (token: TokenAnalysis) => {
      const matched = token.concepts.some((hit) => hit.id === id)
      if (!matched) return false
      const symbol = tickerOf(token.symbol)
      const name = normalizeText(token.tokenName)
      return symbol !== root || name !== normalizeText(concept.label)
    }
    const now = current.filter(isDerivative)
    const before = previous.filter(isDerivative)
    if (now.length < 2) continue
    trends.push(makeTrend({
      id: `family:${id}`,
      slug: `family-${id}`,
      name: `${concept.label} naming derivatives`,
      kind: "family",
      keywords: [concept.label],
      current: now,
      previous: before,
      total: current.length,
      news,
      discussionAvailable,
      windowMs,
      specific: true,
      narrative: `Possible naming derivatives of ${concept.label}. These names share that root. This is not evidence that one token copied another.`,
    }))
  }
  return trends
}

function emergingTrends(recent: TokenAnalysis[], baseline: TokenAnalysis[], news: NewsItem[], discussionAvailable: boolean): Trend[] {
  const trends = [
    ...conceptTrends(recent, baseline, news, discussionAvailable, EMERGING_RECENT_MS),
    ...wordTrends(recent, baseline, news, discussionAvailable, EMERGING_RECENT_MS),
  ]
  return rank(trends.filter((trend) => trend.earlyScore >= 60 && trend.previousCount <= 1 && trend.count >= 2 && trend.count <= 12)).slice(0, 12)
}

function makeTrend(input: {
  id: string
  slug: string
  name: string
  kind: TrendKind
  keywords: string[]
  current: TokenAnalysis[]
  previous: TokenAnalysis[]
  total: number
  news: NewsItem[]
  discussionAvailable: boolean
  windowMs: number
  specific: boolean
  narrative: string
}): Trend {
  const tokens = [...input.current].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const hours = input.windowMs / 3_600_000
  const perHour = hours > 0 ? tokens.length / hours : tokens.length
  const direction = directionOf(tokens.length, input.previous.length)
  const origin = originFor(input.keywords, input.specific, tokens, input.news)
  const liquidity = sumKnown(tokens.map((token) => token.liquidity))
  const volume24h = sumKnown(tokens.map((token) => token.volume24h))
  const makers24h = sumKnown(tokens.map((token) => token.makers24h))
  const marketCaps = tokens.map((token) => token.marketCap).filter((value): value is number => value !== null)
  const parts: ScoreParts = {
    launchVelocity: velocityScore(tokens.length, input.previous.length, perHour),
    newsRelevance: newsRelevance(origin.label),
    tokenActivity: tokenActivityScore(tokens.length, makers24h),
    liquidityActivity: liquidityScore(liquidity),
    discussion: input.discussionAvailable ? discussionScore(origin.sources.filter((item) => item.kind === "reddit").length) : null,
  }
  const score = combineScore(parts, input.discussionAvailable)
  const early = earlyScore(tokens.length, input.previous.length)
  const share = input.total > 0 ? tokens.length / input.total : 0
  const deployers = new Set(tokens.map((token) => token.deployer).filter((value): value is string => Boolean(value)))
  return {
    id: input.id,
    slug: input.slug,
    name: input.name,
    kind: input.kind,
    count: tokens.length,
    previousCount: input.previous.length,
    share,
    firstAt: tokens[0]?.createdAt ?? null,
    lastAt: tokens[tokens.length - 1]?.createdAt ?? null,
    perHour,
    growth: input.previous.length === 0 ? null : (tokens.length - input.previous.length) / input.previous.length,
    direction,
    lifecycle: lifecycleOf({
      current: tokens.length,
      previous: input.previous.length,
      share,
      direction,
      score,
      early,
      liquidityFading: liquidityIsFading(tokens),
    }),
    score,
    earlyScore: early,
    parts,
    tickers: topTickers(tokens),
    tokens: tokens.map(toRef),
    origin,
    keywords: input.keywords,
    liquidity,
    volume24h,
    makers24h,
    marketCapAvg: marketCaps.length ? marketCaps.reduce((sum, value) => sum + value, 0) / marketCaps.length : null,
    best: bestToken(tokens),
    deployers: deployers.size,
    tokensWithDeployer: tokens.filter((token) => token.deployer).length,
    narrative: `${input.narrative} ${origin.summary}`.trim(),
  }
}

function originFor(keywords: string[], specific: boolean, tokens: TokenAnalysis[], news: NewsItem[]): Origin {
  const first = tokens.map((token) => Date.parse(token.createdAt)).filter(Number.isFinite).sort((a, b) => a - b)[0]
  const matches = news
    .map((item) => ({ item, at: Date.parse(item.publishedAt) }))
    .filter((item) => Number.isFinite(item.at) && headlineMatches(item.item.title, keywords))
    .filter((item) => first === undefined || item.at <= first)
    .sort((a, b) => b.at - a.at)

  const confirmed = matches.find((item) => tokens.some((token) => sameStory(token, item.item)))
  if (confirmed) {
    return {
      label: "Confirmed Origin",
      summary: `A matched token links to or describes the same story: “${confirmed.item.title}”.`,
      confidence: 90,
      evidence: [
        `${confirmed.item.source} published “${confirmed.item.title}”.`,
        "A token website, social link, or description points at that same story.",
      ],
      sources: [confirmed.item],
    }
  }

  const before = matches[0]
  if (before && specific && first !== undefined && first - before.at <= 48 * 3_600_000 && tokens.length >= 1) {
    const minutes = Math.round((first - before.at) / 60_000)
    return {
      label: "Highly Likely",
      summary: `${before.item.source} used this name before the first matched launch. That timing makes a connection highly likely. It is not confirmed.`,
      confidence: Math.min(88, 70 + Math.min(tokens.length, 8)),
      evidence: [
        `${tokens.length} token${tokens.length === 1 ? "" : "s"} match ${keywords.join(", ")}.`,
        `${before.item.source} published “${before.item.title}” ${minutes} minutes before the first matched token.`,
      ],
      sources: matches.slice(0, 3).map((item) => item.item),
    }
  }

  const loose = news
    .map((item) => ({ item, at: Date.parse(item.publishedAt) }))
    .filter((item) => Number.isFinite(item.at) && headlineMatches(item.item.title, keywords))
    .filter((item) => first === undefined || (item.at <= first && first - item.at <= 7 * 24 * 3_600_000))
    .sort((a, b) => b.at - a.at)

  if (loose[0]) {
    return {
      label: "Possible Connection",
      summary: `A fetched headline shares a keyword with these names. Origin is a possible connection, not a confirmed cause.`,
      confidence: 40,
      evidence: [
        `${tokens.length} token${tokens.length === 1 ? "" : "s"} match ${keywords.join(", ")}.`,
        `${loose[0].item.source} published “${loose[0].item.title}”.`,
        specific ? "The shared name is specific, but the timing or token count is too thin for a stronger label." : "The shared keyword is generic, so the same word can appear for unrelated reasons.",
      ],
      sources: loose.slice(0, 3).map((item) => item.item),
    }
  }

  return {
    label: "Unknown",
    summary: "Origin currently unknown.",
    confidence: 0,
    evidence: tokens.length
      ? [`${tokens.length} token${tokens.length === 1 ? "" : "s"} match ${keywords.join(", ")}.`, "No fetched headline supports a specific trigger."]
      : ["No fetched headline supports a specific trigger."],
    sources: [],
  }
}

function correlateNews(news: NewsItem[], tokens: TokenAnalysis[]): NewsCorrelation[] {
  const links: NewsCorrelation[] = []
  for (const item of news) {
    const published = Date.parse(item.publishedAt)
    if (!Number.isFinite(published)) continue
    const hits = matchConcepts(item.title, "", null)
    const concepts = hits.map((concept) => concept.label)
    if (concepts.length === 0) continue
    const related = tokens.filter((token) => {
      const created = Date.parse(token.createdAt)
      if (!Number.isFinite(created) || created < published || created - published > 48 * 3_600_000) return false
      return token.concepts.some((concept) => concepts.includes(concept.label))
    })
    if (related.length === 0) continue
    const ordered = [...related].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const first = Date.parse(ordered[0].createdAt)
    const deployers = new Set(ordered.map((token) => token.deployer).filter((value): value is string => Boolean(value)))
    links.push({
      news: item,
      tokens: ordered.map(toRef),
      firstTokenAt: ordered[0].createdAt,
      minutesToFirst: Number.isFinite(first) ? Math.round((first - published) / 60_000) : null,
      deployers: deployers.size,
      liquidity: sumKnown(ordered.map((token) => token.liquidity)),
      volume24h: sumKnown(ordered.map((token) => token.volume24h)),
      best: bestToken(ordered),
      origin: originFor(concepts, hits.some((concept) => !concept.generic), ordered, [item]),
      concepts,
    })
  }
  return links.sort((a, b) => b.tokens.length - a.tokens.length || (a.minutesToFirst ?? 1e9) - (b.minutesToFirst ?? 1e9)).slice(0, 40)
}

function headlineMatches(title: string, keywords: string[]): boolean {
  const normalized = normalizeText(title)
  return keywords.some((keyword) => {
    const phrase = normalizeText(keyword)
    if (phrase.length <= 2) return ` ${normalized} `.includes(` ${phrase} `)
    return ` ${normalized} `.includes(` ${phrase} `) || normalized.includes(phrase)
  })
}

function sameStory(token: TokenAnalysis, item: NewsItem): boolean {
  const links = [token.website, token.twitter, token.telegram].filter((value): value is string => Boolean(value))
  for (const link of links) {
    if (link === item.url) return true
    try {
      const left = new URL(link)
      const right = new URL(item.url)
      const host = (value: string) => value.replace(/^www\./, "")
      if (host(left.hostname) === host(right.hostname) && left.pathname.length > 1 && left.pathname === right.pathname) return true
    } catch {
      // Ignore values that are not URLs.
    }
  }
  if (!token.description) return false
  const words = normalizeText(item.title).split(" ").filter((word) => word.length >= 5)
  const description = normalizeText(token.description)
  const hits = words.filter((word) => description.includes(word))
  return words.length >= 3 && hits.length >= Math.min(3, words.length)
}

function newsRelevance(label: Origin["label"]): number {
  if (label === "Confirmed Origin") return 95
  if (label === "Highly Likely") return 78
  if (label === "Possible Connection") return 42
  return 0
}

function liquidityIsFading(tokens: TokenAnalysis[]): boolean {
  if (tokens.length < 4) return false
  const ordered = [...tokens].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const mid = Math.floor(ordered.length / 2)
  const older = average(ordered.slice(0, mid).map((token) => token.liquidity))
  const newer = average(ordered.slice(mid).map((token) => token.liquidity))
  return older !== null && newer !== null && newer < older * 0.8
}

function topTickers(tokens: TokenAnalysis[]): { ticker: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const token of tokens) {
    const ticker = tickerOf(token.symbol)
    if (!ticker) continue
    counts.set(ticker, (counts.get(ticker) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([ticker, count]) => ({ ticker, count }))
}

function bestToken(tokens: TokenAnalysis[]): TokenRef | null {
  const ranked = [...tokens].sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1) || (b.liquidity ?? -1) - (a.liquidity ?? -1))
  const best = ranked[0]
  if (!best || (best.marketCap === null && best.liquidity === null)) return tokens[0] ? toRef(tokens[0]) : null
  return toRef(best)
}

function sumKnown(values: (number | null)[]): number | null {
  const numbers = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (numbers.length === 0) return null
  return numbers.reduce((sum, value) => sum + value, 0)
}

function average(values: (number | null)[]): number | null {
  const total = sumKnown(values)
  const count = values.filter((value) => value !== null && Number.isFinite(value)).length
  if (total === null || count === 0) return null
  return total / count
}

function inRange(iso: string, start: number, end: number): boolean {
  const time = Date.parse(iso)
  return Number.isFinite(time) && time >= start && time < end
}

function toRef(token: TokenAnalysis): TokenRef {
  return {
    address: token.address,
    tokenAddress: token.tokenAddress,
    symbol: token.symbol,
    tokenName: token.tokenName,
    createdAt: token.createdAt,
    liquidity: token.liquidity,
    marketCap: token.marketCap,
    volume24h: token.volume24h,
    makers24h: token.makers24h,
    url: token.url,
  }
}

function toRefFrom(row: PairRecord, symbol: string, tokenName: string, createdAt: string): TokenRef {
  return {
    address: row.address,
    tokenAddress: (row.tokenAddress || row.address).toLowerCase(),
    symbol,
    tokenName,
    createdAt,
    liquidity: row.liquidity ?? row.listingLiquidity ?? null,
    marketCap: row.marketCap,
    volume24h: row.volume24h ?? null,
    makers24h: row.makers24h ?? null,
    url: row.url,
  }
}

function rank(trends: Trend[]): Trend[] {
  return [...trends].sort((a, b) => b.score - a.score || b.count - a.count || a.name.localeCompare(b.name))
}

export function captureHistory(rows: PairRecord[], at: string): HistoryPoint {
  const snapshot: SnapshotFile = { generatedAt: at, hours: 168, scanned: rows.length, rows, news: [], history: [] }
  const day = buildIntelligence(snapshot, "24h", Date.parse(at))
  const hour = buildIntelligence(snapshot, "1h", Date.parse(at))
  const hourCounts = new Map([...hour.concepts, ...hour.clusters].map((trend) => [trend.id, trend.count]))
  const narratives: HistoryPoint["narratives"] = {}
  for (const trend of [...day.concepts, ...day.clusters].slice(0, 80)) {
    narratives[trend.id] = {
      launches1h: hourCounts.get(trend.id) ?? 0,
      liquidity24h: trend.liquidity ?? 0,
      volume24h: trend.volume24h ?? 0,
      makers24h: trend.makers24h ?? 0,
      deployers24h: trend.deployers,
    }
  }
  return { at, narratives }
}
