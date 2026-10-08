import { plainNumber } from "@/lib/format"

export type LpStatus = "burnt" | "locked" | "unverified" | "none" | "unknown"

export type PairRow = {
  name: string
  created_at: string
  exchange: string
  address: string
  tokenAddress: string
  url: string
  price: number | null
  remaining: number | null
  remainingUnit: string
  listingLiquidity: number | null
}

export type PairDetail = {
  marketCap: number | null
  liquidity: number | null
  holders: number | null
  totalTx: number | null
  lpStatus: LpStatus
  lpBurntPercent: number
  lpLockedPercent: number
  lpUnlockAt: string | null
  /** DEXTools 24h pool volume in USD, when the pair record includes it. */
  volume24h?: number | null
  /** Unique makers reported by DEXTools for the last 24h. This is not a buyer-only count. */
  makers24h?: number | null
  /** Buy swaps reported by DEXTools for the last 24h. */
  buys24h?: number | null
  deployer?: string | null
  description?: string | null
  website?: string | null
  twitter?: string | null
  telegram?: string | null
  tokenCreatedAt?: string | null
  symbol?: string | null
  tokenName?: string | null
  lpSupply?: number | null
  lpBurnedTokens?: number | null
  creationBlock?: number | null
  lpBurnTx?: string | null
  lpBurnAt?: string | null
  lpBurnBlock?: number | null
  lpBurnFrom?: string | null
}

export type PairRecord = PairRow & PairDetail

export type OutputFormat = "csv" | "json" | "txt"

export const OUTPUT_FORMATS: { id: OutputFormat; label: string; extension: string }[] = [
  { id: "csv", label: "CSV (.csv)", extension: "csv" },
  { id: "json", label: "JSON (.json)", extension: "json" },
  { id: "txt", label: "Text (.txt)", extension: "txt" },
]

export const MAX_HOURS = 72
/** Longest lookback the collector will fetch. The pair search UI still caps at MAX_HOURS. */
export const COLLECTION_MAX_HOURS = 168

export const EMPTY_DETAIL: PairDetail = {
  marketCap: null,
  liquidity: null,
  holders: null,
  totalTx: null,
  lpStatus: "unknown",
  lpBurntPercent: 0,
  lpLockedPercent: 0,
  lpUnlockAt: null,
}

export const UNKNOWN_EXCHANGE = "Unknown DEX"

/**
 * Only pools that issue fungible LP tokens can be burnt. Concentrated-liquidity pools
 * (Uniswap V3/V4 and forks) hold positions instead. The DEXTools pair page also only shows
 * the burnt flame when it recognises the exchange, so pools on an unknown DEX never count.
 */
export function canBurnLp(exchange: string): boolean {
  return exchange !== UNKNOWN_EXCHANGE && !/\bv[34]\b/i.test(exchange)
}

/**
 * Applies the pair page's own rule so the flame appears only where DEXTools shows it. LP tokens
 * sitting at the burn address on a pool DEXTools cannot verify are reported as "unverified", with
 * the exact burnt percentage kept.
 */
export function normalizeLp<T extends PairRow & PairDetail>(record: T): T {
  if (record.lpStatus === "burnt" && !canBurnLp(record.exchange)) {
    return { ...record, lpStatus: "unverified" }
  }
  return record
}

export const LOCAL_ZONE = "local"

export const TIME_ZONES: { id: string; label: string }[] = [
  { id: LOCAL_ZONE, label: "This device" },
  { id: "UTC", label: "UTC" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "America/Sao_Paulo", label: "Sao Paulo" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/Moscow", label: "Moscow" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Kolkata", label: "India" },
  { id: "Asia/Bangkok", label: "Bangkok" },
  { id: "Asia/Shanghai", label: "China" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Seoul", label: "Seoul" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Australia/Sydney", label: "Sydney" },
]

export function resolveZone(zone: string): string {
  if (zone !== LOCAL_ZONE) return zone
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

/** Formats a UTC instant as `YYYY-MM-DD HH:MM:SS` in the given zone. */
export function formatCreated(iso: string, zone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveZone(zone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`
}

export function zoneDescription(zone: string): string {
  const resolved = resolveZone(zone)
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone: resolved, timeZoneName: "longOffset" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  const label = offset === "GMT" ? "UTC+00:00" : offset.replace("GMT", "UTC")
  return resolved === "UTC" ? "UTC" : `${label} (${resolved.replaceAll("_", " ")})`
}

export function periodLabel(hours: number): string {
  return `${Number(hours.toFixed(2)).toString().replace(/\.0$/, "")}h`
}

export function filenameFor(hours: number, format: OutputFormat, suffix = ""): string {
  const extension = OUTPUT_FORMATS.find((item) => item.id === format)?.extension ?? format
  return `weth_pairs_${periodLabel(hours)}${suffix}.${extension}`
}

export function lpLabel(record: Pick<PairRecord, "lpStatus">): string {
  if (record.lpStatus === "burnt") return "Burnt"
  if (record.lpStatus === "locked") return "Locked"
  if (record.lpStatus === "unverified") return "Unverified"
  if (record.lpStatus === "unknown") return "Unknown"
  return "None"
}

export function formatPercent(value: number): string {
  if (value > 0 && value < 1) return "<1%"
  return `${Math.round(value)}%`
}

const FILE_COLUMNS = [
  "name",
  "created_time",
  "exchange",
  "price_usd",
  "market_cap_usd",
  "liquidity_usd",
  "remaining",
  "remaining_unit",
  "holders",
  "total_tx",
  "lp_status",
  "lp_burnt_percent",
  "lp_locked_percent",
  "lp_unlock_time",
  "token_address",
  "pair_address",
  "url",
] as const

type FileRow = Record<(typeof FILE_COLUMNS)[number], string | number | null>

function percentText(value: number): number {
  return Number(value.toFixed(4))
}

function toFileRow(record: PairRecord, zone: string): FileRow {
  const liquidity = record.liquidity ?? record.listingLiquidity
  const known = record.lpStatus !== "unknown"
  return {
    name: record.name,
    created_time: formatCreated(record.created_at, zone),
    exchange: record.exchange,
    price_usd: record.price === null ? null : plainNumber(record.price),
    market_cap_usd: record.marketCap === null ? null : Math.round(record.marketCap),
    liquidity_usd: liquidity === null ? null : Math.round(liquidity),
    remaining: record.remaining === null ? null : plainNumber(record.remaining),
    remaining_unit: record.remaining === null ? null : record.remainingUnit,
    holders: record.holders,
    total_tx: record.totalTx,
    lp_status: lpLabel(record),
    lp_burnt_percent: known ? percentText(record.lpBurntPercent) : null,
    lp_locked_percent: known ? percentText(record.lpLockedPercent) : null,
    lp_unlock_time: record.lpUnlockAt ? formatCreated(record.lpUnlockAt, zone) : null,
    token_address: record.tokenAddress,
    pair_address: record.address,
    url: record.url,
  }
}

function csvCell(value: string | number | null): string {
  if (value === null) return ""
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function renderFile(records: PairRecord[], format: OutputFormat, zone: string): string {
  const rows = records.map((record) => toFileRow(record, zone))
  if (format === "json") return `${JSON.stringify(rows, null, 2)}\n`
  if (format === "csv") {
    const lines = [FILE_COLUMNS.join(",")]
    for (const row of rows) lines.push(FILE_COLUMNS.map((key) => csvCell(row[key])).join(","))
    return `${lines.join("\n")}\n`
  }
  const lines = [FILE_COLUMNS.join("\t")]
  for (const row of rows) lines.push(FILE_COLUMNS.map((key) => (row[key] === null ? "" : String(row[key]))).join("\t"))
  return `${lines.join("\n")}\n`
}
