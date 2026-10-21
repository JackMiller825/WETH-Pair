"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Flame, Minimize2, Newspaper, Plus, TrendingUp, X, Zap, type LucideIcon } from "lucide-react"
import { useClock } from "@/components/shell/clock"
import { ActivityCard, activityStatus, useActivityList } from "@/components/shell/live-activity"
import { Popover } from "@/components/shell/popover"
import { addColumn, BOARD_COLUMNS_KEY, columnById, columnsFrom, removeColumn, type BoardColumnId } from "@/lib/activity/board"
import { filterActivity, type ActivityItem } from "@/lib/activity/store"
import { buildIntelligence } from "@/lib/narrative/engine"
import { analyzeEvents, eventInWindow, type EventAnalysis } from "@/lib/narrative/events"
import { DIRECTION_LABEL, type SnapshotFile, type Trend } from "@/lib/narrative/types"
import { formatAge } from "@/lib/market/format"
import type { MonitorMode } from "@/components/lp/monitor-context"

const PAGE = 100

const COLUMN_ICON: Record<BoardColumnId, LucideIcon> = {
  news: Newspaper,
  trends: TrendingUp,
  pairs: Zap,
  burns: Flame,
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
  const [columns, setColumns] = useState<BoardColumnId[]>(() => columnsFrom(typeof localStorage === "undefined" ? null : localStorage.getItem(BOARD_COLUMNS_KEY)))
  const [openedAt] = useState(() => Date.now())
  const [windowData, setWindowData] = useState<BoardWindow | null>(null)
  const [windowError, setWindowError] = useState<string | null>(null)
  const builtAt = useRef<string | null>(null)
  const status = activityStatus(mode)
  const missing = (["news", "trends", "pairs", "burns"] as const).filter((id) => !columns.includes(id))
  const needsWindow = columns.some((id) => id === "news" || id === "trends")

  function onColumns(next: BoardColumnId[]) {
    setColumns(next)
    localStorage.setItem(BOARD_COLUMNS_KEY, JSON.stringify(next))
  }

  useEffect(() => {
    if (openedOn.current == null) openedOn.current = pathname
    else if (openedOn.current !== pathname) onClose()
  }, [pathname, onClose])

  useEffect(() => {
    closeButton.current?.focus()
  }, [])

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
    if (!needsWindow || !snapshot || builtAt.current === snapshot.generatedAt) return
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
  }, [needsWindow, snapshot])

  return (
    <div ref={root} className="fixed inset-x-0 bottom-0 z-20 flex flex-col bg-background" role="region" aria-label="Live activity, full screen">
      <div className="flex flex-wrap items-center gap-2 border-b border-foreground/10 px-4 py-2">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Live activity</h2>
        <span className="inline-flex items-center gap-1.5 text-xs" role="status">
          <span aria-hidden className={`size-1.5 rounded-full ${status.dot} ${status.pulse ? "live-dot" : ""}`} />
          {status.text}
        </span>
        <div className="ml-auto flex items-center gap-2">
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
      <div className="flex min-h-0 flex-1 divide-x divide-foreground/10 overflow-x-auto">
        {columns.map((id) => (
          <BoardColumn
            key={id}
            id={id}
            list={list}
            readyAt={openedAt}
            now={now}
            windowData={windowData}
            windowError={windowError}
            canRemove={columns.length > 1}
            onRemove={() => onColumns(removeColumn(columns, id))}
          />
        ))}
      </div>
    </div>
  )
}

function BoardColumn({
  id,
  list,
  readyAt,
  now,
  windowData,
  windowError,
  canRemove,
  onRemove,
}: {
  id: BoardColumnId
  list: ActivityItem[]
  readyAt: number
  now: number | null
  windowData: BoardWindow | null
  windowError: string | null
  canRemove: boolean
  onRemove: () => void
}) {
  const column = columnById(id)
  const Icon = COLUMN_ICON[id]
  const live = id === "pairs" || id === "burns" ? filterActivity(list, id === "pairs" ? "pairs" : "burns") : []
  const count = id === "news" ? (windowData ? windowData.news.length + windowData.generic.length : null) : id === "trends" ? windowData?.trends.length ?? null : live.length
  return (
    <section aria-labelledby={`board-${id}`} className="flex h-full min-w-72 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-foreground/10 px-3 py-2">
        <Icon size={14} aria-hidden className="shrink-0 text-muted-foreground" />
        <h3 id={`board-${id}`} className="truncate text-sm font-medium">{column.label}</h3>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{column.detail}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{count ?? "…"}</span>
        <button type="button" onClick={onRemove} disabled={!canRemove} aria-label={`Remove ${column.label} column`} title={canRemove ? `Remove ${column.label}` : "At least one column stays open"} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
          <X size={14} aria-hidden />
        </button>
      </header>
      {id === "pairs" || id === "burns" ? (
        <LiveColumn items={live} readyAt={readyAt} waiting={list.length === 0} empty={id === "pairs" ? "No new pairs yet." : "No LP burns yet."} />
      ) : (
        <WindowColumn id={id} now={now} data={windowData} error={windowError} />
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

function WindowColumn({ id, now, data, error }: { id: "news" | "trends"; now: number | null; data: BoardWindow | null; error: string | null }) {
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
  const visible = generic ? [...data.news, ...data.generic] : data.news
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
