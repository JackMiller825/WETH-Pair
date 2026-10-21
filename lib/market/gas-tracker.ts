import { defaultFetch, type FetchLike } from "@/lib/market/types"

export type GasTrackerRow = {
  rank: number
  address: string
  name: string
  fee3Usd: string
  fee3Eth: string
  share3: number
  share3Text: string
  gas3: string | null
  fee24Usd: string
  fee24Eth: string
  share24: number
  share24Text: string
  gas24: string | null
}

export type GasTrackerFile = {
  fetchedAt: string
  block: number | null
  guzzlers: GasTrackerRow[]
  spenders: GasTrackerRow[]
}

const PAGE = "https://etherscan.io/gastracker"
const TABLE = "https://etherscan.io/datasourceHandler"
let memory: { at: number; file: GasTrackerFile } | null = null

const COLUMNS = ["rank", "address", "txfee_3h", "gasused_3h", "txfee_24h", "gasused_24h", "analytics"] as const

function decode(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#10;|&#13;/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function between(html: string, startId: string, endId: string): string {
  const marker = `id="${startId}"`
  const start = html.indexOf(marker)
  if (start < 0) return ""
  const end = html.indexOf(`id="${endId}"`, start + marker.length)
  return html.slice(start, end > start ? end : html.length)
}

function blockOf(html: string): number | null {
  const match = html.match(/Last updated at Block[\s\S]{0,240}?\/block\/(\d+)/i)
  if (!match) return null
  const block = Number(match[1])
  return Number.isFinite(block) ? block : null
}

function feeOf(cell: string): { usd: string; eth: string } {
  const text = decode(cell)
  return {
    usd: text.match(/\$[\d,]+(?:\.\d+)?/)?.[0] ?? "—",
    eth: text.match(/\(([^)]*\bEth)\)/i)?.[1]?.trim() ?? "",
  }
}

function shareOf(cell: string): { text: string; value: number; gas: string | null } {
  const text = decode(cell)
  const pct = text.match(/(\d+(?:\.\d+)?)%/)
  const gas = cell.match(/Gas Units Used\s*:\s*([\d,]+)/i)?.[1] ?? null
  return { text: pct ? `${pct[1]}%` : "—", value: pct ? Number(pct[1]) : 0, gas }
}

function rowsIn(html: string): GasTrackerRow[] {
  const rows: GasTrackerRow[] = []
  const trs = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
  for (const tr of trs) {
    const address = tr.match(/data-clipboard-text=['"](0x[0-9a-fA-F]{40})['"]/i)?.[1] ?? tr.match(/data-full-address=['"](0x[0-9a-fA-F]{40})['"]/i)?.[1]
    if (!address) continue
    const name = decode(tr.match(/<a href=['"]\/address\/0x[0-9a-fA-F]{40}['"][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "") || address
    const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1])
    const fee3 = feeOf(cells[2] ?? "")
    const share3 = shareOf(cells[3] ?? "")
    const fee24 = feeOf(cells[4] ?? "")
    const share24 = shareOf(cells[5] ?? "")
    rows.push({
      rank: rows.length + 1,
      address,
      name,
      fee3Usd: fee3.usd,
      fee3Eth: fee3.eth,
      share3: share3.value,
      share3Text: share3.text,
      gas3: share3.gas,
      fee24Usd: fee24.usd,
      fee24Eth: fee24.eth,
      share24: share24.value,
      share24Text: share24.text,
      gas24: share24.gas,
    })
  }
  return rows
}

/** Etherscan's gas tracker tables, with the published name, fees, and percentages. */
export function parseGasTracker(html: string): Omit<GasTrackerFile, "fetchedAt"> {
  const guzzlersHtml = between(html, "gasguzzler", "gasspender")
  const spendersHtml = between(html, "gasspender", "historicaldata")
  return {
    block: blockOf(guzzlersHtml) ?? blockOf(html),
    guzzlers: rowsIn(guzzlersHtml),
    spenders: rowsIn(spendersHtml),
  }
}

function rowFromCells(index: number, addressHtml: string, fee3Html: string, share3Html: string, fee24Html: string, share24Html: string): GasTrackerRow | null {
  const address = addressHtml.match(/data-clipboard-text=['"](0x[0-9a-fA-F]{40})['"]/i)?.[1] ?? addressHtml.match(/data-full-address=['"](0x[0-9a-fA-F]{40})['"]/i)?.[1]
  if (!address) return null
  const name = decode(addressHtml.match(/<a href=['"]\/address\/0x[0-9a-fA-F]{40}['"][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "") || address
  const fee3 = feeOf(fee3Html)
  const share3 = shareOf(share3Html)
  const fee24 = feeOf(fee24Html)
  const share24 = shareOf(share24Html)
  return {
    rank: index + 1,
    address,
    name,
    fee3Usd: fee3.usd,
    fee3Eth: fee3.eth,
    share3: share3.value,
    share3Text: share3.text,
    gas3: share3.gas,
    fee24Usd: fee24.usd,
    fee24Eth: fee24.eth,
    share24: share24.value,
    share24Text: share24.text,
    gas24: share24.gas,
  }
}

/** DataTables JSON from Etherscan, where each cell is the same HTML the page shows. */
export function rowsFromTrackerPayload(payload: unknown): GasTrackerRow[] {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null
  if (!Array.isArray(data)) return []
  const rows: GasTrackerRow[] = []
  for (const item of data) {
    if (!item || typeof item !== "object") continue
    const cell = item as Record<string, unknown>
    const row = rowFromCells(rows.length, String(cell.address ?? ""), String(cell.txfee_3h ?? ""), String(cell.gasused_3h ?? ""), String(cell.txfee_24h ?? ""), String(cell.gasused_24h ?? ""))
    if (row) rows.push(row)
  }
  return rows
}

function tableBody(): string {
  const params = new URLSearchParams()
  params.set("draw", "1")
  params.set("start", "0")
  params.set("length", "50")
  params.set("search[value]", "")
  params.set("search[regex]", "false")
  params.set("order[0][column]", "3")
  params.set("order[0][dir]", "desc")
  COLUMNS.forEach((name, index) => {
    const orderable = name === "rank" || name === "address" || name === "analytics" ? "false" : "true"
    params.set(`columns[${index}][data]`, name)
    params.set(`columns[${index}][name]`, "")
    params.set(`columns[${index}][searchable]`, orderable)
    params.set(`columns[${index}][orderable]`, orderable)
    params.set(`columns[${index}][search][value]`, "")
    params.set(`columns[${index}][search][regex]`, "false")
  })
  return params.toString()
}

async function readTable(fetcher: FetchLike, kind: "gasguzzler" | "gasspender"): Promise<GasTrackerRow[]> {
  const response = await fetcher(`${TABLE}?q=${kind}`, {
    method: "POST",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      referer: PAGE,
      "user-agent": "Mozilla/5.0",
      "x-requested-with": "XMLHttpRequest",
    },
    body: tableBody(),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const rows = rowsFromTrackerPayload(await response.json())
  if (rows.length < 10) throw new Error(`The ${kind} table was incomplete`)
  return rows
}

async function readBlock(fetcher: FetchLike): Promise<number | null> {
  try {
    const response = await fetcher(PAGE, {
      headers: { accept: "text/html", referer: PAGE, "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    })
    if (!response.ok) return null
    return parseGasTracker(await response.text()).block
  } catch {
    return null
  }
}

export function gasTrackerFile(value: unknown): GasTrackerFile | null {
  if (!value || typeof value !== "object") return null
  const body = value as Partial<GasTrackerFile>
  if (typeof body.fetchedAt !== "string" || !Array.isArray(body.guzzlers) || !Array.isArray(body.spenders)) return null
  if (body.guzzlers.length < 1 || body.spenders.length < 1) return null
  return body as GasTrackerFile
}

/** Read the live gas tracker page. A recent result is reused for 20 seconds. */
export async function fetchGasTracker(fetcher: FetchLike = defaultFetch, now = Date.now()): Promise<GasTrackerFile> {
  if (memory && now - memory.at < 20_000) return memory.file
  const [guzzlers, spenders, block] = await Promise.all([readTable(fetcher, "gasguzzler"), readTable(fetcher, "gasspender"), readBlock(fetcher)])
  const file: GasTrackerFile = { fetchedAt: new Date(now).toISOString(), block, guzzlers, spenders }
  memory = { at: now, file }
  return file
}

/** Published table on GitHub Pages, or the live page through the dev server. */
export async function loadGasTracker(fetcher: FetchLike = defaultFetch): Promise<GasTrackerFile> {
  const pages = process.env.NEXT_PUBLIC_PAGES === "1"
  const url = pages ? `/data/gas-tracker.json?t=${Math.floor(Date.now() / 30_000)}` : "/api/gas-tracker"
  const response = await fetcher(url, { cache: "no-store" })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const file = gasTrackerFile(await response.json())
  if (!file) throw new Error("The gas tracker file was empty")
  return file
}
