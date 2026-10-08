import { normalizeText } from "@/lib/narrative/text"
import type { NewsItem } from "@/lib/narrative/types"

/** Public feeds only. Each adapter can fail without discarding the others. */
const FEEDS: { source: string; kind: NewsItem["kind"]; url: string }[] = [
  { source: "CoinDesk", kind: "news", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", kind: "news", url: "https://cointelegraph.com/rss" },
  { source: "The Block", kind: "news", url: "https://www.theblock.co/rss.xml" },
  { source: "Decrypt", kind: "news", url: "https://decrypt.co/feed" },
  { source: "Bitcoin Magazine", kind: "news", url: "https://bitcoinmagazine.com/feed" },
  { source: "TechCrunch", kind: "news", url: "https://techcrunch.com/feed/" },
  { source: "Reddit r/CryptoCurrency", kind: "reddit", url: "https://www.reddit.com/r/CryptoCurrency/new/.rss" },
  { source: "Reddit r/ethereum", kind: "reddit", url: "https://www.reddit.com/r/ethereum/new/.rss" },
]

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ITEMS = 120

export async function fetchNews(now = Date.now()): Promise<NewsItem[]> {
  const batches = await Promise.all(FEEDS.map((feed) => loadFeed(feed, now)))
  const seen = new Set<string>()
  const items: NewsItem[] = []
  for (const item of batches.flat().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))) {
    const key = item.url || normalizeText(item.title)
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
    if (items.length >= MAX_ITEMS) break
  }
  return items
}

async function loadFeed(feed: { source: string; kind: NewsItem["kind"]; url: string }, now: number): Promise<NewsItem[]> {
  try {
    const response = await fetch(feed.url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": "weth-live-pairs/1.0" },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      console.warn(`News feed ${feed.source} returned HTTP ${response.status}`)
      return []
    }
    return parseRss(await response.text(), feed, now)
  } catch (error) {
    console.warn(`News feed ${feed.source} failed: ${error instanceof Error ? error.message : "unknown error"}`)
    return []
  }
}

function parseRss(xml: string, feed: { source: string; kind: NewsItem["kind"] }, now: number): NewsItem[] {
  const chunks = xml.split(/<item\b|<entry\b/i).slice(1)
  const items: NewsItem[] = []
  for (const chunk of chunks) {
    const title = decode(tag(chunk, "title"))
    const url = decode(tag(chunk, "link") || attr(chunk, "link", "href"))
    const published = tag(chunk, "pubDate") || tag(chunk, "published") || tag(chunk, "updated")
    const at = Date.parse(published)
    if (!title || !url || !Number.isFinite(at) || now - at > MAX_AGE_MS || at > now + 5 * 60 * 1000) continue
    items.push({
      id: `${feed.source}:${url}`,
      title,
      url,
      source: feed.source,
      kind: feed.kind,
      publishedAt: new Date(at).toISOString(),
    })
  }
  return items
}

function tag(chunk: string, name: string): string {
  const match = chunk.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))
  if (!match) return ""
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim()
}

function attr(chunk: string, name: string, attribute: string): string {
  const match = chunk.match(new RegExp(`<${name}[^>]*${attribute}="([^"]+)"`, "i"))
  return match?.[1] ?? ""
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim()
}
