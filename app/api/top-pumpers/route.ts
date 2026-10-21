import { readFile } from "node:fs/promises"
import path from "node:path"
import { PriceBook } from "@/lib/pump/book"
import type { PricePoint } from "@/lib/pump/price"
import { rankPumpers, type Movement, type RankMode, type SortKey, type TokenCandidate } from "@/lib/pump/rank"
import { parseRange } from "@/lib/time-range"
import type { PairRecord } from "@/lib/types"

export const dynamic = "force-dynamic"

const SORTS = new Set<SortKey>(["multiple", "percent", "peak", "volume", "liquidity", "weth", "tx", "holders"])
const MOVES = new Set<Movement>(["all", "rising", "retracing"])

async function readJson(name: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "public", "data", name), "utf8")) as unknown
  } catch {
    return null
  }
}

function numberParam(value: string | null): number | null {
  if (value == null || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const from = numberParam(params.get("from"))
  const to = numberParam(params.get("to"))
  const named = parseRange(params.get("range") ?? "24h")
  if (from == null && to == null && !named.ok) return Response.json({ error: named.error }, { status: 400, headers: { "cache-control": "no-store" } })
  const end = to ?? Date.now()
  const start = from ?? end - (named.ok ? named.ms : 0)
  if (!(end > start)) return Response.json({ error: "The interval end is before the start." }, { status: 400, headers: { "cache-control": "no-store" } })

  const mode: RankMode = params.get("mode") === "launch" ? "launch" : "window"
  const sortValue = params.get("sort")
  const sort: SortKey = sortValue && SORTS.has(sortValue as SortKey) ? (sortValue as SortKey) : "multiple"
  const moveValue = params.get("movement")
  const movement: Movement = moveValue && MOVES.has(moveValue as Movement) ? (moveValue as Movement) : "all"
  const limit = Math.min(100, Math.max(1, numberParam(params.get("limit")) ?? 20))
  const seed = await readJson("pumpers.json")
  const snapshot = await readJson("snapshot.json")
  const points = seed && typeof seed === "object" && Array.isArray((seed as { points?: unknown }).points) ? ((seed as { points: PricePoint[] }).points) : []
  const rows = snapshot && typeof snapshot === "object" && Array.isArray((snapshot as { rows?: unknown }).rows) ? ((snapshot as { rows: PairRecord[] }).rows) : []
  const book = new PriceBook()
  book.load(points)
  const byPair = new Map(rows.map((row) => [row.address.toLowerCase(), row]))
  const tokens: TokenCandidate[] = []
  const seen = new Set<string>()
  for (const point of points) {
    const pair = point.pair.toLowerCase()
    if (seen.has(pair)) continue
    seen.add(pair)
    const row = byPair.get(pair)
    const history = book.points(pair)
    const createdAt = row ? Date.parse(row.created_at) : history[0]?.at ?? start
    tokens.push({
      pair,
      token: row?.tokenAddress ?? point.token,
      name: row?.tokenName || row?.name || pair,
      symbol: row?.symbol || row?.name || pair.slice(0, 8),
      createdAt: Number.isFinite(createdAt) ? createdAt : start,
      url: row?.url ?? "",
      points: history,
      pooledWeth: history[history.length - 1]?.reserveWeth ?? row?.remaining ?? null,
      liquidityUsd: row?.liquidity ?? null,
      volumeUsd: row?.volume24h ?? null,
      totalTx: row?.totalTx ?? null,
      holders: row?.holders ?? null,
      lpBurnPercent: row?.lpBurntPercent ?? null,
    })
  }
  const ranked = rankPumpers(tokens, {
    start,
    end,
    mode,
    limit,
    pumpsOnly: params.get("pumpsOnly") !== "false",
    hideLowConfidence: params.get("confidence") !== "all",
    minLiquidityUsd: numberParam(params.get("minLiquidity")),
    minWeth: numberParam(params.get("minWeth")),
    minTx: numberParam(params.get("minTransactions")),
    minHolders: numberParam(params.get("minHolders")),
    minAgeMs: numberParam(params.get("minAge")) == null ? null : (numberParam(params.get("minAge")) as number) * 3_600_000,
    movement,
    sort,
    coverageOldest: book.oldest(),
  })
  return Response.json(
    {
      range: from != null ? "custom" : named.ok ? named.id : "custom",
      mode,
      coverage: { requestedSeconds: Math.round(ranked.coverage.requestedMs / 1000), availableSeconds: ranked.coverage.availableMs == null ? null : Math.round(ranked.coverage.availableMs / 1000), complete: ranked.coverage.complete },
      updatedAt: new Date(end).toISOString(),
      analyzed: ranked.analyzed,
      items: ranked.items,
    },
    { headers: { "cache-control": "no-store" } },
  )
}
