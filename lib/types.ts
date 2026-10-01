export type LpStatus = "burnt" | "locked" | "none" | "unknown"

export type PairRow = {
  name: string
  created_time: string
  exchange: string
  address: string
  url: string
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
}

export type PairRecord = PairRow & PairDetail

export type OutputFormat = "csv" | "json" | "txt"

export const OUTPUT_FORMATS: { id: OutputFormat; label: string; extension: string }[] = [
  { id: "csv", label: "CSV (.csv)", extension: "csv" },
  { id: "json", label: "JSON (.json)", extension: "json" },
  { id: "txt", label: "Text (.txt)", extension: "txt" },
]

export const MAX_HOURS = 72

export const EMPTY_DETAIL: PairDetail = {
  marketCap: null,
  liquidity: null,
  holders: null,
  totalTx: null,
  lpStatus: "unknown",
  lpBurntPercent: 0,
  lpLockedPercent: 0,
}

/**
 * Concentrated-liquidity pools (Uniswap V3/V4 and forks) hold positions as NFTs or in a
 * singleton contract, so they have no fungible LP token that could be burnt.
 */
export function canBurnLp(exchange: string): boolean {
  return !/\bv[34]\b/i.test(exchange)
}

export function periodLabel(hours: number): string {
  return `${Number(hours.toFixed(2)).toString().replace(/\.0$/, "")}h`
}

export function filenameFor(hours: number, format: OutputFormat, suffix = ""): string {
  const extension = OUTPUT_FORMATS.find((item) => item.id === format)?.extension ?? format
  return `weth_pairs_${periodLabel(hours)}${suffix}.${extension}`
}

export function lpLabel(record: Pick<PairRecord, "lpStatus" | "lpBurntPercent" | "lpLockedPercent">): string {
  if (record.lpStatus === "burnt") return `Burnt ${formatPercent(record.lpBurntPercent)}`
  if (record.lpStatus === "locked") {
    return record.lpLockedPercent > 0 ? `Locked ${formatPercent(record.lpLockedPercent)}` : "Locked"
  }
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
  "market_cap_usd",
  "liquidity_usd",
  "holders",
  "total_tx",
  "lp_status",
  "url",
] as const

type FileRow = Record<(typeof FILE_COLUMNS)[number], string | number | null>

function toFileRow(record: PairRecord): FileRow {
  const liquidity = record.liquidity ?? record.listingLiquidity
  return {
    name: record.name,
    created_time: record.created_time,
    exchange: record.exchange,
    market_cap_usd: record.marketCap === null ? null : Math.round(record.marketCap),
    liquidity_usd: liquidity === null ? null : Math.round(liquidity),
    holders: record.holders,
    total_tx: record.totalTx,
    lp_status: lpLabel(record),
    url: record.url,
  }
}

function csvCell(value: string | number | null): string {
  if (value === null) return ""
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function renderFile(records: PairRecord[], format: OutputFormat): string {
  const rows = records.map(toFileRow)
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
