"use client"

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowUpRight, Flame, Minimize2, Newspaper, Plus, TrendingUp, X, Zap, type LucideIcon } from "lucide-react"
import { useClock } from "@/components/shell/clock"
import { ActivityCard, activityStatus, useActivityList } from "@/components/shell/live-activity"
import { Popover } from "@/components/shell/popover"
import { addColumn, BOARD_COLUMNS, BOARD_COLUMNS_KEY, columnById, columnsFrom, FEED_WINDOW_KEY, FEED_WINDOWS, feedWindowById, inFeedWindow, LEGACY_BOARD_COLUMNS_KEY, placePumpers, removeColumn, type BoardColumnId, type FeedWindowId } from "@/lib/activity/board"
import { TopPumpers } from "@/components/shell/top-pumpers"
import { filterActivity, type ActivityItem } from "@/lib/activity/store"
import { buildIntelligence } from "@/lib/narrative/engine"
import { analyzeEvents, eventInWindow, type EventAnalysis } from "@/lib/narrative/events"
import { DIRECTION_LABEL, type SnapshotFile, type Trend } from "@/lib/narrative/types"
import { ActivityMetricHeader, MarketPulse, type SeriesMode } from "@/components/shell/activity-metric"
import { useMarket } from "@/components/shell/market-widgets"
import { activityStore } from "@/lib/activity/client"
import { activityRatio, activitySeries, activityState, canonicalActivityKey, chartRange, CHART_RANGES, cohortBurnRate, earliestTimes, launchScore, performanceDistribution, recordConditionHistory, reserveChange, stillTrading, typicalHour, windowStats, type WindowStat } from "@/lib/activity/pulse"
import { pumpHub } from "@/lib/pump/client"
import { LOCAL_ZONE, resolveZone, TIME_ZONES, type PairRecord } from "@/lib/types"
import { formatAge } from "@/lib/market/format"
import type { MonitorMode } from "@/components/lp/monitor-context"

const PAGE = 100

class ColumnBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return <p className="px-3 py-3 text-sm text-muted-foreground">Loading this column.</p>
  }
}

const COLUMN_ICON: Record<BoardColumnId, LucideIcon> = {
  news: Newspaper,
  trends: TrendingUp,
  pumpers: ArrowUpRight,
  pairs: Zap,
  burns: Flame,
}

function readColumns(): BoardColumnId[] {
  if (typeof localStorage === "undefined") return columnsFrom(null)
  const saved = localStorage.getItem(BOARD_COLUMNS_KEY)
  if (saved != null) return columnsFrom(saved)
  const legacy = localStorage.getItem(LEGACY_BOARD_COLUMNS_KEY)
  return legacy == null ? columnsFrom(null) : placePumpers(columnsFrom(legacy))
}

type BoardWindow = {
  at: string
  trends: Trend[]
  launches: number
  news: EventAnalysis[]
  generic: EventAnalysis[]
}

function notable(item: EventAnalysis): boolean {
  return item.event.specificIds.length > 0 && (item.causedBy.some((link) => rank(link.level) >= 2) || item.afterLaunch.length > 0)
}

function rank(level: string): number {
  if (level === "Confirmed") return 5
  if (level === "Highly Likely") return 4
  if (level === "Likely") return 3
  if (level === "Possible") return 2
  if (level === "Weak Connection") return 1
  return 0
}

/** Same 24 hour lists as the News → Tokens and Trends pages. Runs only while the board is open. */
function loadWindow(snapshot: SnapshotFile): BoardWindow {
  const trends = buildIntelligence(snapshot, "24h")
  const wide = buildIntelligence(snapshot, "7d")
  const now = Date.parse(snapshot.generatedAt)
  const events = analyzeEvents(snapshot.news ?? [], wide.tokens).filter((item) => eventInWindow(item, "24h", now))
  return {
    at: snapshot.generatedAt,
    trends: trends.concepts.filter((trend) => trend.count >= 2).sort((a, b) => b.score - a.score),
    launches: trends.total,
    news: events.filter(notable),
    generic: events.filter((item) => !notable(item)),
  }
}

function stored(key: string, fallback: string): string {
  if (typeof localStorage === "undefined") return fallback
  return localStorage.getItem(key) || fallback
}

function pairAndBurnTimes(snapshot: SnapshotFile | null, list: readonly ActivityItem[]): { pairs: number[]; burns: number[] } {
  const pairs: { key: string; at: number }[] = []
  const burns: { key: string; at: number }[] = []
  for (const row of snapshot?.rows ?? []) {
    if (typeof row?.address !== "string" || typeof row.created_at !== "string") continue
    pairs.push({ key: canonicalActivityKey("pair", row.address), at: Date.parse(row.created_at) })
  }
  for (const event of snapshot?.lpBurns ?? []) {
    const at = event?.burnAt ?? event?.detectedAt
    if (typeof event?.id !== "string" || typeof at !== "string") continue
    burns.push({ key: canonicalActivityKey("burn", event.id), at: Date.parse(at) })
  }
  for (const item of list) {
    const at = Date.parse(item.occurredAt)
    if (item.type === "new-pair" && item.pairAddress) pairs.push({ key: canonicalActivityKey("pair", item.pairAddress), at })
    if (item.type === "lp-burn" && item.activityId) burns.push({ key: canonicalActivityKey("burn", item.activityId), at })
  }
  return { pairs: earliestTimes(pairs), burns: earliestTimes(burns) }
}

function multiplesOf(rows: readonly PairRecord[], now: number): number[] {
  const book = pumpHub().book
  const start = now - 6 * 60 * 60 * 1000
  const out: number[] = []
  for (const row of rows) {
    const created = Date.parse(row.created_at)
    if (created < start || created > now) continue
    const prices = book.points(row.address).filter((point) => point.priceUsd > 0 && point.at >= created && point.at <= now)
    if (prices.length < 2) continue
    out.push(prices[prices.length - 1].priceUsd / prices[0].priceUsd)
  }
  return out
}

function tradeMarks(rows: readonly PairRecord[]): { createdAt: number; lastTradeAt: number | null }[] {
  const book = pumpHub().book
  const out: { createdAt: number; lastTradeAt: number | null }[] = []
  for (const row of rows) {
    const created = Date.parse(row.created_at)
    if (!Number.isFinite(created)) continue
    const points = book.points(row.address)
    out.push({ createdAt: created, lastTradeAt: points.length === 0 ? null : points[points.length - 1].at })
  }
  return out
}

function ago(now: number | null, at: string): string {
  const ms = now == null ? NaN : now - Date.parse(at)
  if (!Number.isFinite(ms)) return "—"
  return ms < 1000 ? "now" : `${formatAge(Math.max(0, ms))} ago`
}

export function ActivityBoard({ snapshot, mode, onClose }: { snapshot: SnapshotFile | null; mode: MonitorMode; onClose: () => void }) {
  const list = useActivityList()
  const now = useClock(15_000)
  const pathname = usePathname()
  const openedOn = useRef<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [columns, setColumns] = useState<BoardColumnId[]>(readColumns)
  const [feedWindow, setFeedWindow] = useState<FeedWindowId>(() => (typeof localStorage === "undefined" ? "all" : feedWindowById(localStorage.getItem(FEED_WINDOW_KEY) ?? "all").id))
  const [chartRangeId, setChartRangeId] = useState(() => stored("weth-activity-chart-range", "24h"))
  const [seriesMode, setSeriesMode] = useState<SeriesMode>(() => (stored("weth-activity-series", "pairs") as SeriesMode))
  const [chartOpen, setChartOpen] = useState(() => ({ pairs: stored("weth-chart-pairs", "") === "1", burns: stored("weth-chart-burns", "") === "1" }))
  const [zoneId, setZoneId] = useState(() => stored("weth-display-zone", LOCAL_ZONE))
  const [rest, setRest] = useState(false)
  const [baselines, setBaselines] = useState<{ pairs: number | null; burns: number | null } | null>(null)
  const market = useMarket()
  const [openedAt] = useState(() => Date.now())
  const [windowData, setWindowData] = useState<BoardWindow | null>(null)
  const [windowError, setWindowError] = useState<string | null>(null)
  const builtAt = useRef<string | null>(null)
  const status = activityStatus(mode)
  const missing = BOARD_COLUMNS.map((column) => column.id).filter((id) => !columns.includes(id))
  const needsWindow = columns.some((id) => id === "news" || id === "trends")
  const zone = resolveZone(zoneId)
  const pulse = useMemo(() => {
    if (now == null) return null
    try {
    const times = pairAndBurnTimes(snapshot, list)
    const pairStats = windowStats(times.pairs, now)
    const burnStats = windowStats(times.burns, now)
    const range = chartRange(chartRangeId)
    let tx1h = 0
    let txPrevious = 0
    const seen = new Set<string>()
    for (const swap of activityStore().timedSwaps()) {
      if (swap.bulk) continue
      const key = `${swap.pair}:${swap.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const age = now - swap.seenAt
      if (age >= 0 && age <= 60 * 60 * 1000) tx1h += 1
      else if (age > 60 * 60 * 1000 && age <= 2 * 60 * 60 * 1000) txPrevious += 1
    }
    const rows = snapshot?.rows ?? []
    const recent = rows.filter((row) => {
      const created = Date.parse(row.created_at)
      return created >= now - 6 * 60 * 60 * 1000 && created <= now
    })
    const burned = new Set<string>()
    for (const event of snapshot?.lpBurns ?? []) {
      if (typeof event?.pair === "string") burned.add(event.pair.toLowerCase())
    }
    const cohort = cohortBurnRate(rows.flatMap((row) => {
      if (!row || typeof row.address !== "string" || typeof row.created_at !== "string") return []
      return [{ createdAt: Date.parse(row.created_at), burned: row.lpStatus === "burnt" || burned.has(row.address.toLowerCase()) }]
    }), now, 60 * 60 * 1000)
    const samples = recent.map((row) => pumpHub().book.points(row.address).map((point) => ({ at: point.at, weth: point.reserveWeth })))
    const netWeth = reserveChange(samples, now - 60 * 60 * 1000, now)
    const distribution = performanceDistribution(multiplesOf(recent, now))
    const gas = market.gas.data?.standard.gwei ?? null
    const pairBaseline = baselines?.pairs ?? null
    const burnBaseline = baselines?.burns ?? null
    const marks = tradeMarks(recent)
    const survival = {
      m15: stillTrading(marks, now, 15 * 60 * 1000, 6 * 60 * 60 * 1000),
      m30: stillTrading(marks, now, 30 * 60 * 1000, 6 * 60 * 60 * 1000),
      h1: stillTrading(marks, now, 60 * 60 * 1000, 6 * 60 * 60 * 1000),
      h3: stillTrading(marks, now, 3 * 60 * 60 * 1000, 6 * 60 * 60 * 1000),
    }
    const score = launchScore({
      pairs1h: pairStats[0].current,
      pairsPrevious: pairStats[0].previous,
      pairsBaseline: pairBaseline,
      burns1h: burnStats[0].current,
      burnsPrevious: burnStats[0].previous,
      burnsBaseline: burnBaseline,
      tx1h,
      txPrevious,
      txBaseline: null,
      netWeth,
      medianMultiple: distribution?.median ?? null,
      above12Share: distribution?.above12 ?? null,
      gasGwei: gas,
      eth1h: market.eth.data?.change1h ?? null,
      eth24h: market.eth.data?.change24h ?? null,
    })
    const age = snapshot ? now - Date.parse(snapshot.generatedAt) : null
    return {
      times,
      pairStats,
      burnStats,
      range,
      tx1h,
      txPrevious,
      netWeth,
      cohort,
      distribution,
      gas,
      score,
      age,
      ratio: activityRatio(pairStats[0].current, burnStats[0].current),
      pairBaseline,
      burnBaseline,
      survival,
      pairLevel: activityState(pairStats[0].current, pairStats[0].previous, pairBaseline),
      burnLevel: activityState(burnStats[0].current, burnStats[0].previous, burnBaseline),
    }
    } catch {
      return null
    }
  }, [snapshot, list, now, zone, chartRangeId, market.gas.data, market.eth.data, baselines])

  function onColumns(next: BoardColumnId[]) {
    setColumns(next)
    localStorage.setItem(BOARD_COLUMNS_KEY, JSON.stringify(next))
  }

  useEffect(() => {
    if (localStorage.getItem(BOARD_COLUMNS_KEY) == null) localStorage.setItem(BOARD_COLUMNS_KEY, JSON.stringify(columns))
  }, [columns])

  useEffect(() => {
    if (openedOn.current == null) openedOn.current = pathname
    else if (openedOn.current !== pathname) onClose()
  }, [pathname, onClose])

  useEffect(() => {
    closeButton.current?.focus()
  }, [])

  useEffect(() => {
    if (!pulse || now == null) return
    recordConditionHistory(now, {
      score: pulse.score.score,
      pairs: pulse.pairStats[0].current,
      burns: pulse.burnStats[0].current,
      tx: pulse.tx1h,
      gas: pulse.gas,
    })
  }, [pulse, now])

  useEffect(() => {
    const header = document.querySelector("header")
    const place = () => {
      const height = header?.getBoundingClientRect().height ?? 0
      root.current?.style.setProperty("top", `${height}px`)
    }
    place()
    const observer = typeof ResizeObserver === "undefined" || !header ? null : new ResizeObserver(place)
    observer?.observe(header as Element)
    window.addEventListener("resize", place)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", place)
    }
  }, [])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || document.querySelector("[role=dialog]")) return
      onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => {
    let cancel = false
    const timer = window.setTimeout(() => {
      if (cancel) return
      setRest(true)
      if (now == null) return
      try {
        const times = pairAndBurnTimes(snapshot, list)
        setBaselines({ pairs: typicalHour(times.pairs, now, zone), burns: typicalHour(times.burns, now, zone) })
      } catch {
        setBaselines({ pairs: null, burns: null })
      }
    }, 32)
    return () => {
      cancel = true
      window.clearTimeout(timer)
    }
  }, [snapshot, list, now, zone])

  useEffect(() => {
    if (!rest || !needsWindow || !snapshot || builtAt.current === snapshot.generatedAt) return
    let cancel = false
    const timer = window.setTimeout(() => {
      if (cancel) return
      try {
        builtAt.current = snapshot.generatedAt
        setWindowData(loadWindow(snapshot))
        setWindowError(null)
      } catch (error) {
        setWindowError(error instanceof Error ? error.message : "The 24 hour window could not be built")
      }
    }, 50)
    return () => {
      cancel = true
      window.clearTimeout(timer)
    }
  }, [rest, needsWindow, snapshot])

  return (
    <div ref={root} className="fixed inset-x-0 bottom-0 z-20 flex flex-col bg-background" role="region" aria-label="Live activity, full screen">
      <div className="flex flex-wrap items-center gap-2 border-b border-foreground/10 px-4 py-2">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Live activity</h2>
        <span className="inline-flex items-center gap-1.5 text-xs" role="status">
          <span aria-hidden className={`size-1.5 rounded-full ${status.dot} ${status.pulse ? "live-dot" : ""}`} />
          {status.text}
        </span>
        <div className="flex flex-1 flex-wrap items-center gap-1" role="group" aria-label="Live feed interval">
          {FEED_WINDOWS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={feedWindow === item.id}
              onClick={() => {
                setFeedWindow(item.id)
                localStorage.setItem(FEED_WINDOW_KEY, item.id)
              }}
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium uppercase ${feedWindow === item.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {missing.length > 0 ? (
            <Popover label="Add column" className="inline-flex h-8 items-center gap-1 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" trigger={<><Plus size={14} aria-hidden /> Add column</>} panelClassName="w-52 p-1.5">
              {(close) => (
                <ul>
                  {missing.map((id) => {
                    const column = columnById(id)
                    return (
                      <li key={id}>
                        <button type="button" className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onColumns(addColumn(columns, id)); close() }}>
                          {column.label} <span className="text-muted-foreground">({column.detail})</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Popover>
          ) : (
            <span className="px-2 text-xs text-muted-foreground">All columns open</span>
          )}
          <button ref={closeButton} type="button" onClick={onClose} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            <Minimize2 size={14} aria-hidden /> Exit full screen
          </button>
        </div>
      </div>
      {pulse ? (
        <ColumnBoundary>
        <MarketPulse
          pairs={pulse.pairStats[0]}
          burns={pulse.burnStats[0]}
          tx={pulse.tx1h}
          txPrevious={pulse.txPrevious}
          netWeth={pulse.netWeth}
          gas={pulse.gas}
          gasLabel={pulse.score?.gasLabel ?? null}
          eth1h={market.eth.data?.change1h ?? null}
          score={pulse.score}
          fresh={pulse.age == null ? "—" : `${formatAge(Math.max(0, pulse.age))} ago`}
          stale={pulse.age != null && pulse.age > 15 * 60 * 1000}
          zone={zoneId}
          onZone={(next) => {
            setZoneId(next)
            localStorage.setItem("weth-display-zone", next)
          }}
          zones={TIME_ZONES}
          pairTimes={pulse.times.pairs}
          now={now ?? openedAt}
          recordedHour={Math.floor((now ?? openedAt) / 3_600_000)}
          typicalPairs={pulse.pairBaseline}
          typicalBurns={pulse.burnBaseline}
          survival={pulse.survival}
          ratio={pulse.ratio}
          cohort={pulse.cohort}
          distribution={pulse.distribution}
        />
        </ColumnBoundary>
      ) : null}
      <div className="flex min-h-0 flex-1 divide-x divide-foreground/10 overflow-x-auto">
        {columns.map((id) => (
          <ColumnBoundary key={id}>
          <BoardColumn
            id={id}
            list={list}
            readyAt={openedAt}
            now={now}
            windowData={windowData}
            windowError={windowError}
            snapshot={snapshot}
            feedSpanMs={feedWindowById(feedWindow).ms}
            pulse={pulse}
            zone={zone}
            chartRangeId={chartRangeId}
            seriesMode={seriesMode}
            chartOpen={chartOpen}
            rest={rest}
            onChartRange={(id) => {
              setChartRangeId(id)
              localStorage.setItem("weth-activity-chart-range", id)
            }}
            onSeries={(mode) => {
              setSeriesMode(mode)
              localStorage.setItem("weth-activity-series", mode)
            }}
            onToggleChart={(id) => {
              setChartOpen((current) => {
                const next = { ...current, [id]: !current[id] }
                localStorage.setItem(id === "pairs" ? "weth-chart-pairs" : "weth-chart-burns", next[id] ? "1" : "0")
                return next
              })
            }}
            canRemove={columns.length > 1}
            onRemove={() => onColumns(removeColumn(columns, id))}
          />
          </ColumnBoundary>
        ))}
      </div>
    </div>
  )
}

function chartBuckets(times: readonly number[] | undefined, now: number | null, rangeId: string) {
  if (now == null || !times) return []
  try {
    const range = chartRange(rangeId)
    return activitySeries(times, now, range.ms, range.bucketMs)
  } catch {
    return []
  }
}

function BoardColumn({
  id,
  list,
  readyAt,
  now,
  windowData,
  windowError,
  snapshot,
  feedSpanMs,
  canRemove,
  onRemove,
  pulse,
  zone,
  chartRangeId,
  seriesMode,
  chartOpen,
  rest,
  onChartRange,
  onSeries,
  onToggleChart,
}: {
  id: BoardColumnId
  list: ActivityItem[]
  readyAt: number
  now: number | null
  windowData: BoardWindow | null
  windowError: string | null
  snapshot: SnapshotFile | null
  feedSpanMs: number | null
  canRemove: boolean
  onRemove: () => void
  pulse: { pairStats: WindowStat[]; burnStats: WindowStat[]; times: { pairs: number[]; burns: number[] }; pairLevel: ReturnType<typeof activityState>; burnLevel: ReturnType<typeof activityState> } | null
  zone: string
  chartRangeId: string
  seriesMode: SeriesMode
  chartOpen: { pairs: boolean; burns: boolean }
  rest: boolean
  onChartRange: (id: string) => void
  onSeries: (mode: SeriesMode) => void
  onToggleChart: (id: "pairs" | "burns") => void
}) {
  const column = columnById(id)
  const Icon = COLUMN_ICON[id]
  const spanLabel = FEED_WINDOWS.find((item) => item.ms === feedSpanMs)?.label ?? "All"
  const live = id === "pairs" || id === "burns" ? filterActivity(list, id === "pairs" ? "pairs" : "burns").filter((item) => now == null || inFeedWindow(item.occurredAt, now, feedSpanMs)) : []
  const count = id === "news" ? (windowData ? windowData.news.length + windowData.generic.length : null) : id === "trends" ? windowData?.trends.length ?? null : id === "pumpers" ? null : live.length
  return (
    <section aria-labelledby={`board-${id}`} className={`flex h-full flex-col ${id === "pumpers" ? "min-w-[22rem] flex-[1.3]" : "min-w-72 flex-1"}`}>
      <header className="flex items-center gap-2 border-b border-foreground/10 px-3 py-2">
        <Icon size={14} aria-hidden className="shrink-0 text-muted-foreground" />
        <h3 id={`board-${id}`} className="truncate text-sm font-medium">{column.label}</h3>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{column.detail}</span>
        {count == null ? <span className="ml-auto" /> : <span className="ml-auto text-xs text-muted-foreground tabular-nums">{count}</span>}
        <button type="button" onClick={onRemove} disabled={!canRemove} aria-label={`Remove ${column.label} column`} title={canRemove ? `Remove ${column.label}` : "At least one column stays open"} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
          <X size={14} aria-hidden />
        </button>
      </header>
      {now != null && pulse && (id === "pairs" || id === "burns") ? (
        <ActivityMetricHeader
          title={id === "pairs" ? "Pairs" : "LP burns"}
          stats={id === "pairs" ? pulse.pairStats : pulse.burnStats}
          level={id === "pairs" ? pulse.pairLevel : pulse.burnLevel}
          open={rest && chartOpen[id]}
          onToggle={() => onToggleChart(id)}
          range={chartRangeId}
          ranges={CHART_RANGES}
          onRange={onChartRange}
          series={seriesMode}
          onSeries={onSeries}
          pairBuckets={rest && chartOpen[id] ? chartBuckets(pulse.times.pairs, now, chartRangeId) : []}
          burnBuckets={rest && chartOpen[id] ? chartBuckets(pulse.times.burns, now, chartRangeId) : []}
          zone={zone}
        />
      ) : null}
      {id === "pairs" || id === "burns" ? (
        <LiveColumn items={live} readyAt={readyAt} waiting={list.length === 0} empty={feedSpanMs == null ? (id === "pairs" ? "No new pairs yet." : "No LP burns yet.") : id === "pairs" ? `No new pairs in the last ${spanLabel}.` : `No LP burns in the last ${spanLabel}.`} />
      ) : !rest ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">Loading this column.</p>
      ) : id === "pumpers" ? (
        <TopPumpers snapshot={snapshot} />
      ) : (
        <WindowColumn id={id} now={now} data={windowData} error={windowError} feedSpanMs={feedSpanMs} />
      )}
    </section>
  )
}

function LiveColumn({ items, readyAt, waiting, empty }: { items: ActivityItem[]; readyAt: number; waiting: boolean; empty: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [limit, setLimit] = useState(PAGE)
  const [held, setHeld] = useState<Set<string> | null>(null)
  const shown = held ? items.filter((item) => held.has(item.activityId)) : items
  const fresh = held ? items.length - shown.length : 0

  function onScroll() {
    const top = scroller.current?.scrollTop ?? 0
    if (top > 48 && !held) setHeld(new Set(items.map((item) => item.activityId)))
    else if (top <= 4 && held) setHeld(null)
  }

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      {fresh > 0 ? (
        <div className="sticky top-0 z-10 px-3 pt-2">
          <button type="button" onClick={() => { setHeld(null); scroller.current?.scrollTo({ top: 0, behavior: "smooth" }) }} className="w-full rounded-md bg-primary/15 px-2 py-1 text-xs text-primary hover:bg-primary/25">
            {fresh} new event{fresh === 1 ? "" : "s"} ↑
          </button>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2 px-3 py-3">
        {shown.slice(0, limit).map((item) => (
          <ActivityCard key={item.activityId} item={item} highlight={item.receivedAt > readyAt} />
        ))}
        {shown.length === 0 ? <li className="px-1 text-sm text-muted-foreground">{waiting ? "Activity appears after the dataset loads." : empty}</li> : null}
      </ul>
      {shown.length > limit ? (
        <div className="px-3 pb-4">
          <button type="button" onClick={() => setLimit((value) => value + PAGE)} className="w-full rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            Show {Math.min(PAGE, shown.length - limit)} more
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Shown only if the full board throws. Same screen: counts, recent pairs, and recent burns. No error page. */
export function SafeBoard({ snapshot, onClose }: { snapshot: SnapshotFile | null; onClose: () => void }) {
  const now = Date.now()
  let pairStats: WindowStat[] = []
  let burnStats: WindowStat[] = []
  const pairRows: { key: string; label: string; at: number; href: string }[] = []
  const burnRows: { key: string; label: string; at: number; href: string; percent: string }[] = []
  try {
    const times = pairAndBurnTimes(snapshot, [])
    pairStats = windowStats(times.pairs, now)
    burnStats = windowStats(times.burns, now)
    for (const row of snapshot?.rows ?? []) {
      if (!row || typeof row.created_at !== "string" || typeof row.address !== "string") continue
      const at = Date.parse(row.created_at)
      if (!Number.isFinite(at)) continue
      const name = row.symbol || row.tokenName || row.name || "Token"
      const href = typeof row.tokenAddress === "string" && row.tokenAddress.startsWith("0x") ? `/tokens/${row.tokenAddress}` : "#"
      pairRows.push({ key: row.address, label: `${name} / WETH`, at, href })
    }
    for (const event of snapshot?.lpBurns ?? []) {
      const atText = event?.burnAt || event?.detectedAt
      if (!event || typeof atText !== "string") continue
      const at = Date.parse(atText)
      if (!Number.isFinite(at)) continue
      const name = event.symbol || event.tokenName || "Token"
      const href = typeof event.tokenAddress === "string" && event.tokenAddress.startsWith("0x") ? `/tokens/${event.tokenAddress}` : "#"
      const percent = event.percentKnown === false || typeof event.lpBurntPercent !== "number" ? "" : `${Math.round(event.lpBurntPercent)}%`
      burnRows.push({ key: typeof event.id === "string" ? event.id : `${event.pair}:${at}`, label: `${name} / WETH`, at, href, percent })
    }
  } catch {
    // Counts collected before the failure stay on screen.
  }
  pairRows.sort((a, b) => b.at - a.at)
  burnRows.sort((a, b) => b.at - a.at)
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col bg-background" role="region" aria-label="Live activity, full screen">
      <div className="flex items-center gap-3 border-b border-foreground/10 px-4 py-2">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Live activity</h2>
        <button type="button" onClick={onClose} className="ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <Minimize2 size={14} aria-hidden /> Exit full screen
        </button>
      </div>
      <div className="flex flex-wrap gap-4 border-b border-foreground/10 px-4 py-2">
        <CountLine title="Pairs" stats={pairStats} />
        <CountLine title="LP burns" stats={burnStats} />
      </div>
      <div className="grid min-h-0 flex-1 md:grid-cols-2">
        <CountList title="Pairs" rows={pairRows.slice(0, 24)} now={now} />
        <CountList title="LP burns" rows={burnRows.slice(0, 24)} now={now} />
      </div>
    </div>
  )
}

function CountLine({ title, stats }: { title: string; stats: WindowStat[] }) {
  return (
    <div>
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">{title}</p>
      <p className="text-xs tabular-nums">
        {stats.map((item) => (
          <span key={item.id} className="mr-3"><span className="text-muted-foreground">{item.label}</span> {item.current}</span>
        ))}
      </p>
    </div>
  )
}

function CountList({ title, rows, now }: { title: string; rows: { key: string; label: string; at: number; href: string; percent?: string }[]; now: number }) {
  return (
    <section className="min-h-0 overflow-y-auto border-foreground/10 md:border-r" aria-label={title}>
      <h3 className="sticky top-0 bg-background px-4 py-2 text-sm font-medium">{title}</h3>
      <ul className="flex flex-col gap-2 px-4 pb-4">
        {rows.map((item) => (
          <li key={`${item.key}:${item.at}`} className="rounded-lg bg-card/60 px-3 py-2 text-sm ring-1 ring-foreground/10">
            <a href={item.href} className="font-medium hover:underline">{item.label}</a>
            <p className="text-xs text-muted-foreground">{item.percent ? `${item.percent} · ` : ""}{formatAge(Math.max(0, now - item.at))} ago</p>
          </li>
        ))}
        {rows.length === 0 ? <li className="text-sm text-muted-foreground">Loading this column.</li> : null}
      </ul>
    </section>
  )
}

function WindowColumn({ id, now, data, error, feedSpanMs }: { id: "news" | "trends"; now: number | null; data: BoardWindow | null; error: string | null; feedSpanMs: number | null }) {
  const [generic, setGeneric] = useState(false)
  if (error) return <p className="px-3 py-3 text-sm text-muted-foreground">{error}</p>
  if (!data) return <p className="px-3 py-3 text-sm text-muted-foreground">Loading the 24 hour window…</p>
  if (id === "trends") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-3 pt-3 text-[11px] text-muted-foreground">{data.launches.toLocaleString("en-US")} launches in 24 hours. Names that appeared at least twice.</p>
        <ul className="flex flex-col gap-2 px-3 py-3">
          {data.trends.map((trend) => (
            <li key={trend.id} className="rounded-lg bg-card/60 px-3 py-2.5 ring-1 ring-foreground/10">
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{DIRECTION_LABEL[trend.direction]}</p>
              <p className="mt-1 truncate text-sm font-semibold">{trend.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{trend.count} in 24h · {trend.previousCount} the 24h before</p>
              <div className="mt-2 flex justify-end">
                <Link href={`/trends/${trend.slug}`} className="text-xs text-primary hover:underline">Open trend →</Link>
              </div>
            </li>
          ))}
          {data.trends.length === 0 ? <li className="px-1 text-sm text-muted-foreground">No name appeared at least twice in the last 24 hours.</li> : null}
        </ul>
      </div>
    )
  }
  const inWindow = (at: string) => now == null || inFeedWindow(at, now, feedSpanMs)
  const visible = (generic ? [...data.news, ...data.generic] : data.news).filter((item) => inWindow(item.event.publishedAt))
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ul className="flex flex-col gap-2 px-3 py-3">
        {visible.map((item) => {
          const best = [...item.causedBy].sort((a, b) => b.score - a.score)[0]
          return (
            <li key={item.event.id} className="rounded-lg bg-card/60 px-3 py-2.5 ring-1 ring-foreground/10">
              <time dateTime={item.event.publishedAt} className="text-[11px] text-muted-foreground tabular-nums">{ago(now, item.event.publishedAt)}</time>
              <p className="mt-1 line-clamp-3 text-sm font-medium">{item.event.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.causedBy.length} related launch{item.causedBy.length === 1 ? "" : "es"}{best ? ` · top ${best.token.symbol}` : ""}</p>
              <div className="mt-2 flex justify-end">
                <Link href={`/news-events/?id=${encodeURIComponent(item.event.id)}`} className="text-xs text-primary hover:underline">View event →</Link>
              </div>
            </li>
          )
        })}
        {visible.length === 0 ? <li className="px-1 text-sm text-muted-foreground">No news matched tokens in the last 24 hours.</li> : null}
      </ul>
      {data.generic.length > 0 ? (
        <div className="px-3 pb-4">
          <button type="button" onClick={() => setGeneric((value) => !value)} className="w-full rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            {generic ? "Hide" : "Show"} {data.generic.length} generic-word overlap{data.generic.length === 1 ? "" : "s"}
          </button>
        </div>
      ) : null}
    </div>
  )
}
