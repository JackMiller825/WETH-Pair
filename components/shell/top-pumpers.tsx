"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { Popover } from "@/components/shell/popover"
import { Tip } from "@/components/shell/tip"
import { activityStore } from "@/lib/activity/client"
import { formatCompact, rankActivity, swapsInWindow, type ActivityRank, type ActivitySort } from "@/lib/activity/pulse"
import { formatAge, formatAgo, formatWeth } from "@/lib/market/format"
import { formatCount, formatPrice, formatUsd } from "@/lib/format"
import { formatMultiple, formatPumpPercent, PUMP_TOOLTIP } from "@/lib/pump/price"
import { pumpHub } from "@/lib/pump/client"
import { rankPumpers, type Movement, type PumpRow, type RankMode, type RankOptions, type SortKey, type TokenCandidate } from "@/lib/pump/rank"
import { parseRange } from "@/lib/time-range"
import type { SnapshotFile } from "@/lib/narrative/types"
import type { PairRecord } from "@/lib/types"

const RANGES = ["15m", "30m", "1h", "3h", "6h", "12h", "24h"] as const
const LIMITS = [10, 25, 50, 100] as const
const BARS = "▁▂▃▄▅▆▇█"
const VIEWS: { id: "pump" | ActivitySort; label: string }[] = [
  { id: "pump", label: "Pump" },
  { id: "tx", label: "Transactions" },
  { id: "volume", label: "Volume" },
  { id: "weth", label: "Pooled WETH" },
  { id: "holders", label: "Holders" },
]

const TX_TOOLTIP = "Number of tracked swap transactions for this pair during the selected period. Buys and sells are included when the log is a swap. It is not every Ethereum transaction that touched the token contract."
const SORTS: { id: SortKey; label: string }[] = [
  { id: "multiple", label: "Pump multiple" },
  { id: "percent", label: "Pump %" },
  { id: "peak", label: "Peak multiple" },
  { id: "volume", label: "Volume" },
  { id: "liquidity", label: "Liquidity" },
  { id: "weth", label: "Pooled WETH" },
  { id: "tx", label: "Transactions" },
  { id: "holders", label: "Holders" },
]

type Filters = {
  range: string
  custom: { start: number; end: number } | null
  mode: RankMode
  limit: number
  sort: SortKey
  pumpsOnly: boolean
  hideLow: boolean
  movement: Movement
  view: "pump" | ActivitySort
  minWeth: string
  minTx: string
  minHolders: string
  minLiquidity: string
  minAgeHours: string
}

const INITIAL: Filters = {
  range: "24h",
  custom: null,
  mode: "launch",
  limit: 10,
  sort: "multiple",
  pumpsOnly: true,
  hideLow: true,
  movement: "all",
  view: "pump",
  minWeth: "",
  minTx: "",
  minHolders: "",
  minLiquidity: "",
  minAgeHours: "",
}

function amount(value: string): number | null {
  const parsed = Number(value)
  return value.trim() === "" || !Number.isFinite(parsed) || parsed < 0 ? null : parsed
}

function ticker(symbol: string): string {
  const text = String(symbol ?? "").trim()
  return text.startsWith("$") ? text : `$${text}`
}

function bars(prices: readonly number[]): string {
  if (prices.length === 0) return ""
  let min = prices[0]
  let max = prices[0]
  for (const price of prices) {
    if (price < min) min = price
    if (price > max) max = price
  }
  if (max === min) return BARS[3].repeat(Math.min(prices.length, 16))
  return prices.map((price) => BARS[Math.min(BARS.length - 1, Math.round(((price - min) / (max - min)) * (BARS.length - 1)))]).join("")
}

function coverageLabel(ms: number): string {
  const hours = ms / 3_600_000
  if (hours >= 48) return `${Math.round(hours / 24)}d`
  if (hours >= 1) return `${Math.round(hours)}h`
  return `${Math.max(1, Math.round(ms / 60_000))}m`
}

function candidates(rows: readonly PairRecord[], version: number): TokenCandidate[] {
  void version
  const book = pumpHub().book
  const out: TokenCandidate[] = []
  for (const row of rows) {
    const points = book.points(row.address)
    if (points.length === 0) continue
    const createdAt = Date.parse(row.created_at)
    out.push({
      pair: row.address,
      token: row.tokenAddress,
      name: row.tokenName || row.name,
      symbol: row.symbol || row.name,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      url: row.url,
      points,
      pooledWeth: points[points.length - 1]?.reserveWeth ?? row.remaining,
      liquidityUsd: row.liquidity,
      volumeUsd: row.volume24h ?? null,
      totalTx: row.totalTx,
      holders: row.holders,
      lpBurnPercent: row.lpBurntPercent,
    })
  }
  return out
}

export function TopPumpers({ snapshot }: { snapshot: SnapshotFile | null }) {
  const version = useSyncExternalStore(pumpHub().subscribe, () => pumpHub().version(), () => 0)
  const [filters, setFilters] = useState<Filters>(INITIAL)
  const [now, setNow] = useState(() => Date.now())
  const [customText, setCustomText] = useState("4")
  const [customUnit, setCustomUnit] = useState<"m" | "h" | "d">("h")
  const [fromText, setFromText] = useState("")
  const [toText, setToText] = useState("")
  const [customError, setCustomError] = useState<string | null>(null)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!snapshot) return
    pumpHub().startBackfill(snapshot.rows, Date.parse(snapshot.generatedAt))
    return () => pumpHub().stopBackfill()
  }, [snapshot])

  const end = filters.custom?.end ?? Math.floor(now / 5000) * 5000
  const parsedRange = parseRange(filters.range)
  const start = filters.custom?.start ?? end - (parsedRange.ok ? parsedRange.ms : 24 * 60 * 60 * 1000)
  const label = filters.custom ? "Custom" : filters.range.toUpperCase()
  const tokens = useMemo(() => candidates(snapshot?.rows ?? [], version), [snapshot, version])
  const storeRev = useSyncExternalStore(activityStore().subscribe, activityStore().revision, () => 0)
  const activity = useMemo(() => {
    if (filters.view === "pump" || !snapshot || storeRev < 0) return [] as ActivityRank[]
    const counts = swapsInWindow(activityStore().timedSwaps(), start, end)
    const rows = snapshot.rows.map((row) => {
      const key = row.address.toLowerCase()
      return {
        pair: key,
        token: row.tokenAddress,
        name: row.tokenName || row.name,
        symbol: row.symbol || row.name,
        url: row.url,
        tx: counts.get(key) ?? 0,
        buys: filters.range === "24h" ? row.buys24h ?? null : null,
        sells: null as number | null,
        traders: null as number | null,
        pooledWeth: row.remaining != null && /^w?eth$/i.test(row.remainingUnit) ? row.remaining : null,
        holders: row.holders,
        volumeUsd: row.volume24h ?? null,
        percent: null as number | null,
      }
    })
    const usable = filters.view === "tx" ? rows.filter((row) => row.tx > 0) : rows
    return rankActivity(usable, filters.view, filters.limit)
  }, [filters.view, filters.range, filters.limit, snapshot, start, end, storeRev])
  const options = useMemo<RankOptions>(() => ({
    start,
    end,
    mode: filters.mode,
    limit: filters.limit,
    pumpsOnly: filters.pumpsOnly,
    hideLowConfidence: filters.hideLow,
    minLiquidityUsd: amount(filters.minLiquidity),
    minWeth: amount(filters.minWeth),
    minTx: amount(filters.minTx),
    minHolders: amount(filters.minHolders),
    minAgeMs: amount(filters.minAgeHours) == null ? null : (amount(filters.minAgeHours) as number) * 3_600_000,
    movement: filters.movement,
    sort: filters.sort,
    coverageOldest: version < 0 ? null : pumpHub().book.oldest(),
  }), [start, end, filters, version])
  const ranked = useMemo(() => {
    try {
      return rankPumpers(tokens, options)
    } catch {
      return { items: [], hiddenLowConfidence: [], analyzed: tokens.length, excludedYoung: 0, excludedInsufficient: 0, excludedFlat: 0, excludedFiltered: 0, coverage: { requestedMs: Math.max(0, options.end - options.start), availableMs: null, complete: false } }
    }
  }, [tokens, options])
  const signature = ranked.items.map((row) => `${row.pair}:${row.rank}`).join("|")
  const [track, setTrack] = useState<{ signature: string; prior: Map<string, number> | null; moves: Map<string, number | "new">; at: number }>({ signature: "", prior: null, moves: new Map(), at: 0 })
  if (track.signature !== signature) {
    const moves = new Map<string, number | "new">()
    if (track.prior) {
      for (const row of ranked.items) {
        const before = track.prior.get(row.pair)
        if (before == null) moves.set(row.pair, "new")
        else if (before !== row.rank) moves.set(row.pair, before - row.rank)
      }
    }
    setTrack({ signature, prior: new Map(ranked.items.map((row) => [row.pair, row.rank])), moves, at: now })
  }

  function setRange(range: string) {
    setFilters((current) => ({ ...current, range, custom: null }))
    setCustomError(null)
  }

  function applyLast() {
    const parsed = parseRange(`${customText}${customUnit}`)
    if (!parsed.ok) {
      setCustomError(parsed.error)
      return
    }
    setCustomError(null)
    setFilters((current) => ({ ...current, range: parsed.id, custom: null }))
  }

  function applySpan() {
    const from = Date.parse(fromText)
    const to = Date.parse(toText)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      setCustomError("Choose a start and a later end.")
      return
    }
    setCustomError(null)
    setFilters((current) => ({ ...current, custom: { start: from, end: to } }))
  }

  const criteria = [
    filters.pumpsOnly ? "Above 1.00x" : "All returns",
    filters.hideLow ? "Hiding low confidence" : "Including low confidence",
    filters.movement === "rising" ? "Still rising" : filters.movement === "retracing" ? "Retracing" : null,
    amount(filters.minWeth) == null ? null : `Min ${filters.minWeth} WETH`,
    amount(filters.minTx) == null ? null : `Min ${filters.minTx} tx`,
    amount(filters.minHolders) == null ? null : `Min ${filters.minHolders} holders`,
    amount(filters.minLiquidity) == null ? null : `Min ${formatUsd(amount(filters.minLiquidity))} liquidity`,
    amount(filters.minAgeHours) == null ? null : `Min age ${filters.minAgeHours}h`,
  ].filter((item): item is string => item != null)
  const requested = ranked.coverage.requestedMs
  const available = ranked.coverage.availableMs
  const percent = available == null || requested === 0 ? 0 : Math.max(0, Math.min(100, Math.round((available / requested) * 100)))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-foreground/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <Tip label={<span className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Top Pumpers</span>} text={PUMP_TOOLTIP} />
          <span className="ml-auto rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-primary tabular-nums">{label}</span>
          {track.at > 0 ? <span className="text-[10px] text-muted-foreground tabular-nums">Updated {formatAgo(Math.max(0, now - track.at))}</span> : null}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Time interval">
          {RANGES.map((range) => (
            <button key={range} type="button" aria-pressed={filters.custom == null && filters.range === range} onClick={() => setRange(range)} className={`rounded px-1.5 py-0.5 text-[11px] font-medium uppercase ${filters.custom == null && filters.range === range ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {range}
            </button>
          ))}
          <Popover label="Custom interval" className={`px-1.5 py-0.5 text-[11px] font-medium ${filters.custom || !RANGES.includes(filters.range as (typeof RANGES)[number]) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} trigger={<span>Custom</span>} panelClassName="w-64 p-3">
            {() => (
              <div className="flex flex-col gap-2 text-xs">
                <p className="font-medium text-foreground">Last</p>
                <div className="flex gap-1">
                  <input value={customText} onChange={(event) => setCustomText(event.target.value)} inputMode="numeric" aria-label="Custom length" className="w-16 rounded-md bg-muted px-2 py-1" />
                  <select value={customUnit} onChange={(event) => setCustomUnit(event.target.value as "m" | "h" | "d")} aria-label="Custom unit" className="rounded-md bg-muted px-2 py-1">
                    <option value="m">minutes</option>
                    <option value="h">hours</option>
                    <option value="d">days</option>
                  </select>
                  <button type="button" onClick={applyLast} className="rounded-md bg-primary px-2 py-1 text-primary-foreground">Apply</button>
                </div>
                <div className="flex gap-1">
                  {(["3d", "7d"] as const).map((range) => (
                    <button key={range} type="button" onClick={() => setRange(range)} className="rounded bg-muted px-2 py-1 uppercase">{range}</button>
                  ))}
                </div>
                <p className="font-medium text-foreground">From and to</p>
                <input type="datetime-local" value={fromText} onChange={(event) => setFromText(event.target.value)} aria-label="Interval start" className="rounded-md bg-muted px-2 py-1" />
                <input type="datetime-local" value={toText} onChange={(event) => setToText(event.target.value)} aria-label="Interval end" className="rounded-md bg-muted px-2 py-1" />
                <button type="button" onClick={applySpan} className="rounded-md bg-primary px-2 py-1 text-primary-foreground">Apply range</button>
                {customError ? <p className="text-muted-foreground">{customError}</p> : null}
              </div>
            )}
          </Popover>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Sort by">
          {VIEWS.map((view) => (
            <button key={view.id} type="button" aria-pressed={filters.view === view.id} onClick={() => setFilters((current) => ({ ...current, view: view.id }))} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${filters.view === view.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {view.label}
            </button>
          ))}
        </div>
        {filters.view === "pump" ? (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Ranking mode">
          <button type="button" aria-pressed={filters.mode === "window"} onClick={() => setFilters((current) => ({ ...current, mode: "window" }))} className={`rounded px-1.5 py-0.5 text-[11px] ${filters.mode === "window" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>Window return</button>
          <button type="button" aria-pressed={filters.mode === "launch"} onClick={() => setFilters((current) => ({ ...current, mode: "launch" }))} className={`rounded px-1.5 py-0.5 text-[11px] ${filters.mode === "launch" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>New launch</button>
          <Popover label="Ranking filters" className="ml-auto px-1.5 py-0.5 text-[11px] text-muted-foreground" trigger={<span>Filters</span>} panelClassName="w-60 p-3">
            {() => (
              <div className="flex flex-col gap-2 text-xs">
                <label className="flex flex-col gap-1">Sort
                  <select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as SortKey }))} className="rounded-md bg-muted px-2 py-1">
                    {SORTS.map((sort) => <option key={sort.id} value={sort.id}>{sort.label}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">Rows
                  <select value={filters.limit} onChange={(event) => setFilters((current) => ({ ...current, limit: Number(event.target.value) }))} className="rounded-md bg-muted px-2 py-1">
                    {LIMITS.map((limit) => <option key={limit} value={limit}>Top {limit}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={filters.pumpsOnly} onChange={(event) => setFilters((current) => ({ ...current, pumpsOnly: event.target.checked }))} /> Only above 1.00x</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={filters.hideLow} onChange={(event) => setFilters((current) => ({ ...current, hideLow: event.target.checked }))} /> Hide low confidence</label>
                <div className="flex gap-1" role="group" aria-label="Recent movement">
                  {([["all", "All"], ["rising", "Still rising"], ["retracing", "Retracing"]] as const).map(([id, text]) => (
                    <button key={id} type="button" aria-pressed={filters.movement === id} onClick={() => setFilters((current) => ({ ...current, movement: id }))} className={`rounded px-1.5 py-0.5 ${filters.movement === id ? "bg-foreground text-background" : "bg-muted"}`}>{text}</button>
                  ))}
                </div>
                <FilterField label="Minimum pooled WETH" value={filters.minWeth} onChange={(minWeth) => setFilters((current) => ({ ...current, minWeth }))} />
                <FilterField label="Minimum transactions" value={filters.minTx} onChange={(minTx) => setFilters((current) => ({ ...current, minTx }))} />
                <FilterField label="Minimum holders" value={filters.minHolders} onChange={(minHolders) => setFilters((current) => ({ ...current, minHolders }))} />
                <FilterField label="Minimum liquidity USD" value={filters.minLiquidity} onChange={(minLiquidity) => setFilters((current) => ({ ...current, minLiquidity }))} />
                <FilterField label="Minimum age, hours" value={filters.minAgeHours} onChange={(minAgeHours) => setFilters((current) => ({ ...current, minAgeHours }))} />
              </div>
            )}
          </Popover>
        </div>
        ) : (
          <p className="text-[10px] leading-4 text-muted-foreground">{filters.view === "tx" ? TX_TOOLTIP : "Volume is the published 24 hour figure. Pooled WETH and holders are the latest values, not recomputed for the interval."} Swap coverage is partial when this session has not observed the whole range. Lifetime totals are not used for the transaction rank.</p>
        )}
        <p className="text-[10px] leading-4 text-muted-foreground">{filters.view === "pump" ? criteria.join(" · ") : `Sorted by ${VIEWS.find((view) => view.id === filters.view)?.label}`} · Top {filters.limit}</p>
      </div>
      {filters.view === "pump" && filters.mode === "window" && !ranked.coverage.complete ? (
        <div className="border-b border-foreground/10 px-3 py-2 text-[11px] text-muted-foreground">
          <p>Historical price coverage: {available == null ? "0" : coverageLabel(available)} / {coverageLabel(requested)}</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Indexed price history">
            <div className="h-full bg-primary/70" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1">Building remaining history. Results are currently partial.</p>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {snapshot == null ? <p className="px-3 py-3 text-sm text-muted-foreground">The pair list is still loading. The last ranking stays once it has loaded.</p> : filters.view !== "pump" ? (
          activity.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">{filters.view === "tx" ? "No timed swaps in this period yet. Older logs loaded in one batch are not assigned to the interval." : "No tokens have that figure yet."}</p>
          ) : (
            <ol className="flex flex-col gap-2 px-3 py-3">
              {activity.map((row) => <ActivityCard key={row.pair} row={row} rangeLabel={label} />)}
            </ol>
          )
        ) : ranked.analyzed === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">Reading current pool reserves. Rankings appear as each price arrives.</p>
        ) : ranked.items.length === 0 ? (
          <div className="flex flex-col gap-2 px-3 py-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No qualifying pumpers in this period</p>
            <p>{ranked.analyzed.toLocaleString("en-US")} tokens were analyzed, but none currently meet the ranking and quality criteria.</p>
            {ranked.excludedYoung > 0 ? <p>{ranked.excludedYoung.toLocaleString("en-US")} launched inside this interval, so a full-window return is not available. New launch ranks those from the first reliable price.</p> : null}
            <div className="flex flex-wrap gap-1">
              {(["6h", "12h", "24h"] as const).map((range) => (
                <button key={range} type="button" onClick={() => setRange(range)} className="rounded bg-muted px-2 py-1 text-xs uppercase">{range}</button>
              ))}
              {filters.mode === "window" ? <button type="button" onClick={() => setFilters((current) => ({ ...current, mode: "launch" }))} className="rounded bg-muted px-2 py-1 text-xs">New launch</button> : null}
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-2 px-3 py-3">
            {ranked.items.length >= 3 ? <p className="px-1 text-[11px]"><Link href={`/chart/?set=${ranked.items.slice(0, 3).map((row) => row.pair).join(",")}`} className="text-primary hover:underline">Compare top 3</Link></p> : null}
            {ranked.items.map((row) => <PumpCard key={row.pair} row={row} now={now} label={label} move={track.moves.get(row.pair) ?? null} />)}
          </ol>
        )}
        {ranked.hiddenLowConfidence.length > 0 ? (
          <div className="px-3 pb-3 text-[11px] text-muted-foreground">
            <p>{ranked.hiddenLowConfidence.length.toLocaleString("en-US")} low-confidence result{ranked.hiddenLowConfidence.length === 1 ? "" : "s"} hidden. {ranked.hiddenLowConfidence[0].confidenceReason}</p>
            <button type="button" onClick={() => setFilters((current) => ({ ...current, hideLow: false }))} className="mt-1 rounded bg-muted px-2 py-1">Show low confidence</button>
          </div>
        ) : null}
        {filters.limit < 100 && ranked.items.length >= filters.limit ? (
          <div className="px-3 pb-4">
            <button type="button" onClick={() => setFilters((current) => ({ ...current, limit: LIMITS.find((limit) => limit > current.limit) ?? 100 }))} className="w-full rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              View top {LIMITS.find((limit) => limit > filters.limit) ?? 100}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PumpDetail({ row, now }: { row: PumpRow; now: number }) {
  const fields: { label: string; value: string }[] = [
    { label: "Current return", value: `${formatMultiple(row.multiple)} (${formatPumpPercent(row.percent)})` },
    { label: "Peak return", value: row.peakMultiple == null ? "—" : formatMultiple(row.peakMultiple) },
    { label: "From peak", value: row.retracementPercent == null ? "—" : formatPumpPercent(row.retracementPercent) },
    { label: "Current price", value: formatPrice(row.currentPriceUsd) },
    { label: row.sinceLaunch ? "Since launch" : "Reference", value: formatPrice(row.referencePriceUsd) },
    { label: "Confidence", value: row.confidence },
    { label: "Liquidity", value: formatUsd(row.liquidityUsd) },
    { label: "Volume", value: formatUsd(row.volumeUsd) },
    { label: "Transactions", value: formatCount(row.totalTx) },
    { label: "Pooled WETH", value: formatWeth(row.pooledWeth) },
    { label: "Holders", value: formatCount(row.holders) },
    { label: "LP burn", value: typeof row.lpBurnPercent === "number" && Number.isFinite(row.lpBurnPercent) ? `${row.lpBurnPercent.toFixed(1)}%` : "—" },
    { label: "Age", value: formatAge(Math.max(0, now - row.createdAt)) },
  ]
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="font-medium break-words text-foreground">{row.name}</p>
      <dl className="grid grid-cols-[7.25rem_minmax(0,1fr)] gap-x-3 gap-y-1">
        {fields.map((field) => (
          <div key={field.label} className="contents">
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="text-right break-words text-foreground tabular-nums">{field.value}</dd>
          </div>
        ))}
      </dl>
      {row.confidenceReason ? <p className="break-words text-muted-foreground">{row.confidenceReason}</p> : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-foreground/10 pt-2">
        <Link href={`/tokens/${row.token}`} className="text-primary hover:underline">Full analysis</Link>
        <Link href={`/chart/?pair=${encodeURIComponent(row.pair.toLowerCase())}`} className="text-primary hover:underline">Analyze chart</Link>
        <a href={row.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">DEXTools</a>
        <a href={`https://etherscan.io/token/${row.token}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">Etherscan</a>
      </div>
    </div>
  )
}

function ActivityCard({ row, rangeLabel }: { row: ActivityRank; rangeLabel: string }) {
  const ratio = row.buys != null && row.sells != null && row.sells > 0 ? row.buys / row.sells : null
  return (
    <li className="rounded-lg bg-card/60 px-3 py-2.5 ring-1 ring-foreground/10">
      <div className="flex items-baseline gap-2">
        <span className={`text-xs font-semibold tabular-nums ${row.rank <= 3 ? "text-primary" : "text-muted-foreground"}`}>#{row.rank}</span>
        <Link href={`/tokens/${row.token}`} className="truncate text-sm font-semibold hover:underline">{ticker(row.symbol)}</Link>
        <Link href={`/chart/?pair=${encodeURIComponent(row.pair)}`} className="text-[11px] text-primary hover:underline">Analyze chart</Link>
        <span className="ml-auto text-sm font-semibold tabular-nums">TX {formatCompact(row.tx)}</span>
      </div>
      <p className="truncate text-[11px] text-muted-foreground">{row.name}</p>
      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums" title={TX_TOOLTIP}>
        {rangeLabel} swaps {formatCompact(row.tx)}
        {row.buys != null ? ` · 24h buys ${formatCompact(row.buys)}` : ""}
        {row.sells != null ? ` · sells ${formatCompact(row.sells)}` : " · buy and sell sides are not separated"}
        {ratio != null ? ` · B/S ${ratio.toFixed(2)}` : ""}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
        WETH {formatWeth(row.pooledWeth)} · Holders {formatCount(row.holders)}
        {row.volumeUsd != null ? ` · Vol ${formatUsd(row.volumeUsd)}` : ""}
        {row.percent != null ? ` · ${row.percent >= 0 ? "+" : ""}${row.percent.toFixed(0)}%` : ""}
        {row.traders == null ? " · unique traders not in the swap log" : ` · traders ${formatCompact(row.traders)}${row.density != null ? ` · ${row.density.toFixed(2)} tx/trader` : ""}`}
      </p>
    </li>
  )
}

function FilterField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1">{label}
      <input value={value} onChange={(event) => onChange(event.target.value)} inputMode="decimal" className="rounded-md bg-muted px-2 py-1" />
    </label>
  )
}

function PumpCard({ row, now, label, move }: { row: PumpRow; now: number; label: string; move: number | "new" | null }) {
  const fresh = move === "new" || (typeof move === "number" && move !== 0)
  return (
    <li className={`rounded-lg bg-card/60 px-3 py-2.5 ring-1 ring-foreground/10 ${fresh ? "rank-enter" : ""}`}>
      <div className="flex items-baseline gap-2">
        <span className={`text-xs font-semibold tabular-nums ${row.rank <= 3 ? "text-primary" : "text-muted-foreground"}`}>#{row.rank}</span>
        <Link href={`/tokens/${row.token}`} className="truncate text-sm font-semibold hover:underline">{ticker(row.symbol)}</Link>
        <Link href={`/chart/?pair=${encodeURIComponent(row.pair)}`} className="text-[11px] text-primary hover:underline">Analyze chart</Link>
        {move === "new" ? <span className="rounded bg-primary/15 px-1 text-[10px] font-semibold tracking-wide text-primary">NEW</span> : null}
        {typeof move === "number" && move > 0 ? <span className="text-[10px] text-muted-foreground tabular-nums">↑{move}</span> : null}
        {typeof move === "number" && move < 0 ? <span className="text-[10px] text-muted-foreground tabular-nums">↓{Math.abs(move)}</span> : null}
        {move === 0 ? <span className="text-[10px] text-muted-foreground">→</span> : null}
        <span className="ml-auto text-sm font-semibold tabular-nums">{formatMultiple(row.multiple)}</span>
        <span className={`text-xs tabular-nums ${row.percent >= 0 ? "tone-up" : "tone-down"}`}>{formatPumpPercent(row.percent)}</span>
      </div>
      <p className="truncate text-[11px] text-muted-foreground">{row.name}</p>
      <p className="mt-1 font-mono text-[11px] tracking-tight text-muted-foreground" aria-hidden>{bars(row.sparkline)}</p>
      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
        {formatPrice(row.currentPriceUsd)}
        <span className="px-1">·</span>
        {row.sinceLaunch ? "Since launch" : label} {formatPrice(row.referencePriceUsd)}
        <span className="px-1">·</span>
        {formatAge(Math.max(0, now - row.createdAt))}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
        WETH {formatWeth(row.pooledWeth)} · TX {formatCount(row.totalTx)} · Holders {formatCount(row.holders)}
        {row.liquidityUsd != null ? ` · Liq ${formatUsd(row.liquidityUsd)}` : ""}
        {row.volumeUsd != null ? ` · Vol ${formatUsd(row.volumeUsd)}` : ""}
        {typeof row.lpBurnPercent === "number" && row.lpBurnPercent > 0 ? ` · LP ${row.lpBurnPercent.toFixed(1)}%` : ""}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className={`rounded px-1 py-0.5 text-[10px] font-medium tracking-wide uppercase ${row.confidence === "high" ? "bg-primary/15 text-primary" : row.confidence === "low" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>{row.confidence}</span>
        {row.recent === "rising" ? <span className="text-[10px] text-muted-foreground">Still rising</span> : row.recent === "retracing" ? <span className="text-[10px] text-muted-foreground">Retracing</span> : null}
        <Popover floating label={`${row.symbol} price detail`} className="ml-auto px-1.5 py-0.5 text-[11px] text-muted-foreground" trigger={<span>Details</span>}>
          {() => <PumpDetail row={row} now={now} />}
        </Popover>
      </div>
    </li>
  )
}
