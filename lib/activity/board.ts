/** Columns of the full-screen Live Activity board. The first visit opens all five, in this order. */
export const BOARD_COLUMNS = [
  { id: "news", label: "News → Tokens", detail: "24h" },
  { id: "trends", label: "Trends", detail: "24h" },
  { id: "pumpers", label: "Top Pumpers", detail: "Ranked" },
  { id: "pairs", label: "Pairs", detail: "Live" },
  { id: "burns", label: "LP Burns", detail: "Live" },
] as const

export type BoardColumnId = (typeof BOARD_COLUMNS)[number]["id"]

export const DEFAULT_BOARD_COLUMNS: BoardColumnId[] = ["news", "trends", "pumpers", "pairs", "burns"]

/** Current layout. A saved list is used as stored, including one that has no Top Pumpers column. */
export const BOARD_COLUMNS_KEY = "weth-activity-columns-v2"

/** Layouts saved before Top Pumpers existed. Read once, then rewritten under the current key. */
export const LEGACY_BOARD_COLUMNS_KEY = "weth-activity-columns"

const KNOWN = new Set<string>(BOARD_COLUMNS.map((column) => column.id))

export function columnById(id: BoardColumnId): (typeof BOARD_COLUMNS)[number] {
  return BOARD_COLUMNS.find((column) => column.id === id) as (typeof BOARD_COLUMNS)[number]
}

/** Saved layout, dropping anything this version does not know. An empty or broken value returns the default. */
export function columnsFrom(raw: string | null): BoardColumnId[] {
  if (!raw) return [...DEFAULT_BOARD_COLUMNS]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_BOARD_COLUMNS]
    const seen = new Set<string>()
    const columns: BoardColumnId[] = []
    for (const id of parsed) {
      if (typeof id !== "string" || !KNOWN.has(id) || seen.has(id)) continue
      seen.add(id)
      columns.push(id as BoardColumnId)
    }
    return columns.length > 0 ? columns : [...DEFAULT_BOARD_COLUMNS]
  } catch {
    return [...DEFAULT_BOARD_COLUMNS]
  }
}

/** Puts Top Pumpers before Pairs, or after Trends when Pairs is closed. A layout that already has it is unchanged. */
export function placePumpers(columns: readonly BoardColumnId[]): BoardColumnId[] {
  if (columns.includes("pumpers")) return [...columns]
  const next = [...columns]
  const pairs = next.indexOf("pairs")
  const trends = next.indexOf("trends")
  const at = pairs >= 0 ? pairs : trends >= 0 ? trends + 1 : next.length
  next.splice(at, 0, "pumpers")
  return next
}

export function addColumn(columns: readonly BoardColumnId[], id: BoardColumnId): BoardColumnId[] {
  return columns.includes(id) ? [...columns] : [...columns, id]
}

/** The last open column stays, so the board is never blank. */
export function removeColumn(columns: readonly BoardColumnId[], id: BoardColumnId): BoardColumnId[] {
  if (columns.length <= 1) return [...columns]
  const next = columns.filter((column) => column !== id)
  return next.length > 0 ? next : [...columns]
}
