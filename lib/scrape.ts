export type PairRow = {
  name: string
  created_time: string
  exchange: string
  url: string
}

export type OutputFormat = "csv" | "json" | "txt"

export const OUTPUT_FORMATS: { id: OutputFormat; label: string; extension: string }[] = [
  { id: "csv", label: "CSV (.csv)", extension: "csv" },
  { id: "json", label: "JSON (.json)", extension: "json" },
  { id: "txt", label: "Text (.txt)", extension: "txt" },
]

export const MAX_HOURS = 72

const LISTING_API = "https://www.dextools.io/api/core"
const EXCHANGES_API = "https://www.dextools.io/shared/exchanges/v2"
const PAGE_URL = "https://www.dextools.io/app/ether/live-new-pairs"
const CHAIN = "ether"
const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const PAGE_SIZE = 100
const USER_AGENT = "dextools-weth-pairs/1.0"
const UNKNOWN_EXCHANGE = "Unknown DEX"
const COLUMNS = ["name", "created_time", "exchange", "url"] as const
const PAGE_DELAY_MS = 120

export class ListingError extends Error {}

type TokenSide = {
  address?: string
  name?: string
  symbol?: string
}

type Pool = {
  creationTime?: string
  exchange?: string
  address?: string
  mainToken?: TokenSide
  sideToken?: TokenSide
}

type ListingPage = {
  pools: Pool[]
  next?: { ts?: number }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestJson(url: string): Promise<unknown> {
  let delay = 400
  let lastError: unknown
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "X-API-Version": "1",
          Referer: PAGE_URL,
        },
        cache: "no-store",
      })
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300)
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 4) {
          await sleep(delay)
          delay *= 2
          continue
        }
        throw new ListingError(`DEXTools returned HTTP ${response.status}. ${detail}`)
      }
      return await response.json()
    } catch (error) {
      if (error instanceof ListingError) throw error
      lastError = error
      if (attempt === 4) break
      await sleep(delay)
      delay *= 2
    }
  }
  const message = lastError instanceof Error ? lastError.message : "Unknown network error"
  throw new ListingError(`Could not reach DEXTools. ${message}`)
}

function parseCreated(value: string): Date {
  const text = value.trim().replace(" ", "T")
  const normalized = text.endsWith("Z") ? text : `${text}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    throw new ListingError(`Unreadable creation time: ${value}`)
  }
  return date
}

function formatCreated(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ")
}

function isWeth(token: TokenSide | undefined): boolean {
  return (token?.address ?? "").toLowerCase() === WETH_ADDRESS
}

function pairName(pool: Pool): string {
  const baseSymbol = pool.mainToken?.symbol?.trim() || "?"
  const quoteSymbol = pool.sideToken?.symbol?.trim() || "?"
  const label = `${baseSymbol}/${quoteSymbol}`
  const tokenName = pool.mainToken?.name?.trim() ?? ""
  if (tokenName && tokenName.toLowerCase() !== baseSymbol.toLowerCase()) {
    return `${label} (${tokenName})`
  }
  return label
}

function pairUrl(address: string): string {
  return `https://www.dextools.io/app/${CHAIN}/pair-explorer/${encodeURIComponent(address)}`
}

function toRecord(pool: Pool, exchangeNames: Map<string, string>): PairRow | null {
  const address = pool.address?.trim() ?? ""
  const createdRaw = pool.creationTime?.trim() ?? ""
  if (!address || !createdRaw) return null
  if (!isWeth(pool.mainToken) && !isWeth(pool.sideToken)) return null
  const slug = (pool.exchange ?? "").trim().toLowerCase()
  return {
    name: pairName(pool),
    created_time: formatCreated(parseCreated(createdRaw)),
    exchange: (slug && exchangeNames.get(slug)) || UNKNOWN_EXCHANGE,
    url: pairUrl(address),
  }
}

async function fetchExchangeNames(): Promise<Map<string, string>> {
  const query = new URLSearchParams({ allowUnknowns: "false", chain: CHAIN })
  const payload = (await requestJson(`${EXCHANGES_API}?${query}`)) as {
    data?: { exchanges?: { slug?: string; name?: string }[] }[]
  }
  const names = new Map<string, string>()
  for (const block of payload.data ?? []) {
    for (const item of block.exchanges ?? []) {
      const slug = item.slug?.trim().toLowerCase()
      const name = item.name?.trim()
      if (slug && name) names.set(slug, name)
    }
  }
  if (names.size === 0) {
    throw new ListingError("DEXTools exchange list was empty.")
  }
  return names
}

async function fetchPage(cursor: number | null): Promise<ListingPage> {
  const path =
    cursor === null
      ? `/pool/listing/liveNew/latest?chain=${CHAIN}&limit=${PAGE_SIZE}`
      : `/pool/listing/liveNew?ts=${cursor}&chain=${CHAIN}&limit=${PAGE_SIZE}`
  const payload = (await requestJson(LISTING_API + path)) as { data?: ListingPage }
  if (!payload.data || !Array.isArray(payload.data.pools)) {
    throw new ListingError("DEXTools listing response did not include a pools list.")
  }
  return payload.data
}

export function periodLabel(hours: number): string {
  return `${Number(hours.toFixed(2)).toString().replace(/\.0$/, "")}h`
}

export function filenameFor(hours: number, format: OutputFormat): string {
  const extension = OUTPUT_FORMATS.find((item) => item.id === format)?.extension ?? format
  return `weth_pairs_${periodLabel(hours)}.${extension}`
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

export function renderFile(rows: PairRow[], format: OutputFormat): string {
  if (format === "json") return `${JSON.stringify(rows, null, 2)}\n`
  if (format === "csv") {
    const lines = [COLUMNS.join(",")]
    for (const row of rows) lines.push(COLUMNS.map((key) => csvCell(row[key])).join(","))
    return `${lines.join("\n")}\n`
  }
  const lines = [COLUMNS.join("\t")]
  for (const row of rows) lines.push(COLUMNS.map((key) => row[key]).join("\t"))
  return `${lines.join("\n")}\n`
}

export async function collectWethPairs(hours: number): Promise<{ rows: PairRow[]; scanned: number }> {
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
    throw new ListingError(`Choose a period between 1 and ${MAX_HOURS} hours.`)
  }

  const cutoff = Date.now() - hours * 60 * 60 * 1000
  const maxPages = Math.min(50, Math.ceil(hours * 1.6) + 2)
  const matches: PairRow[] = []
  const seen = new Set<string>()
  let scanned = 0
  let cursor: number | null = null
  let previousCursor: number | null = null

  const exchangeNames = await fetchExchangeNames()

  for (let page = 0; page < maxPages; page++) {
    const data = await fetchPage(cursor)
    if (data.pools.length === 0) break

    let oldestOnPage = Number.POSITIVE_INFINITY
    for (const pool of data.pools) {
      scanned += 1
      const createdRaw = pool.creationTime?.trim()
      const created = createdRaw ? parseCreated(createdRaw).getTime() : null
      if (created !== null && created < oldestOnPage) oldestOnPage = created
      if (created !== null && created < cutoff) continue
      const record = toRecord(pool, exchangeNames)
      if (!record) continue
      const key = pool.address!.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      matches.push(record)
    }

    const nextTs = data.next?.ts
    if (oldestOnPage < cutoff || nextTs === undefined || nextTs === null) break
    if (previousCursor !== null && nextTs >= previousCursor) break
    previousCursor = nextTs
    cursor = nextTs
    if (page < maxPages - 1) await sleep(PAGE_DELAY_MS)
  }

  matches.sort((a, b) => (a.created_time < b.created_time ? 1 : -1))
  return { rows: matches, scanned }
}
