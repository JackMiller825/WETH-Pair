"use client"

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { Flame, Lock, Newspaper, TrendingUp, Zap, type LucideIcon } from "lucide-react"
import { useClock } from "@/components/shell/clock"
import { Tip } from "@/components/shell/tip"
import { activityStore, startActivity } from "@/lib/activity/client"
import type { MetricSlot } from "@/lib/activity/metrics"
import { ACTIVITY_FILTERS, filterActivity, type ActivityFilter, type ActivityItem, type ActivityType } from "@/lib/activity/store"
import { DEFINITIONS, SOURCE_LABEL } from "@/lib/market/copy"
import { formatAge, formatWeth } from "@/lib/market/format"
import type { MonitorMode } from "@/components/lp/monitor-context"
import type { SnapshotFile } from "@/lib/narrative/types"

const FILTER_KEY = "weth-activity-filter"
const PAGE = 100
const EMPTY: ActivityItem[] = []

const TYPE_META: Record<ActivityType, { label: string; icon: LucideIcon; tone: string; action: string }> = {
  "new-pair": { label: "New pair", icon: Zap, tone: "text-primary", action: "View" },
  "lp-burn": { label: "LP burn", icon: Flame, tone: "text-orange-600 dark:text-orange-400", action: "Investigate" },
  "lp-lock": { label: "LP lock", icon: Lock, tone: "text-sky-600 dark:text-sky-400", action: "View" },
  trend: { label: "Trend rising", icon: TrendingUp, tone: "tone-up", action: "Open trend" },
  news: { label: "News match", icon: Newspaper, tone: "text-muted-foreground", action: "Open news" },
}

function statusOf(mode: MonitorMode): { text: string; dot: string; pulse: boolean } {
  if (mode === "realtime") return { text: "Live", dot: "bg-emerald-500", pulse: true }
  if (mode === "error") return { text: "Reconnecting", dot: "bg-destructive", pulse: false }
  if (mode === "paused") return { text: "Paused", dot: "bg-amber-500", pulse: false }
  return { text: "Polling", dot: "bg-amber-500", pulse: false }
}

/** The panel mounts only on the client, after the shell reads its own settings, so storage is available. */
function readFilter(): ActivityFilter {
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(FILTER_KEY)
  return ACTIVITY_FILTERS.some((item) => item.id === saved) ? (saved as ActivityFilter) : "all"
}

function useActivityList(): ActivityItem[] {
  const store = activityStore()
  return useSyncExternalStore(store.subscribe, store.getList, () => EMPTY)
}

export function LiveActivity({ snapshot, mode }: { snapshot: SnapshotFile | null; mode: MonitorMode }) {
  const list = useActivityList()
  const [filter, setFilter] = useState<ActivityFilter>(readFilter)
  const [limit, setLimit] = useState(PAGE)
  const [held, setHeld] = useState<Set<string> | null>(null)
  const [readyAt, setReadyAt] = useState<number | null>(null)
  const scroller = useRef<HTMLElement>(null)
  const status = statusOf(mode)

  useEffect(() => startActivity(), [])

  useEffect(() => {
    if (!snapshot) return
    const run = () => {
      activityStore().ingestSnapshot(snapshot)
      setReadyAt((value) => value ?? Date.now() + 500)
    }
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 1500 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(run, 50)
    return () => window.clearTimeout(id)
  }, [snapshot])

  const filtered = useMemo(() => filterActivity(list, filter), [list, filter])
  const shown = useMemo(() => (held ? filtered.filter((item) => held.has(item.activityId)) : filtered), [filtered, held])
  const waiting = held ? filtered.length - shown.length : 0

  function onScroll() {
    const top = scroller.current?.scrollTop ?? 0
    if (top > 48 && !held) setHeld(new Set(filtered.map((item) => item.activityId)))
    else if (top <= 4 && held) setHeld(null)
  }

  function showNew() {
    setHeld(null)
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" })
  }

  function choose(next: ActivityFilter) {
    setFilter(next)
    setHeld(null)
    setLimit(PAGE)
    localStorage.setItem(FILTER_KEY, next)
    scroller.current?.scrollTo({ top: 0 })
  }

  return (
    <aside ref={scroller} onScroll={onScroll} aria-labelledby="live-activity-title" className="sticky top-[5.75rem] hidden h-[calc(100vh-5.75rem)] w-80 shrink-0 overflow-y-auto border-l border-foreground/10 xl:block">
      <div className="sticky top-0 z-10 border-b border-foreground/10 bg-background/95 px-4 pt-4 pb-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <h2 id="live-activity-title" className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Live activity</h2>
          <span className="inline-flex items-center gap-1.5 text-xs" role="status">
            <span aria-hidden className={`size-1.5 rounded-full ${status.dot} ${status.pulse ? "live-dot" : ""}`} />
            {status.text}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1" role="radiogroup" aria-label="Filter activity">
          {ACTIVITY_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={filter === item.id}
              onClick={() => choose(item.id)}
              className={`rounded px-2 py-0.5 text-[11px] ${filter === item.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {waiting > 0 ? (
          <button type="button" onClick={showNew} className="mt-2 w-full rounded-md bg-primary/15 px-2 py-1 text-xs text-primary hover:bg-primary/25">
            {waiting} new event{waiting === 1 ? "" : "s"} ↑
          </button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-2 px-3 py-3" aria-live="off">
        {shown.slice(0, limit).map((item) => (
          <ActivityCard key={item.activityId} item={item} highlight={readyAt != null && item.receivedAt > readyAt} />
        ))}
        {shown.length === 0 ? <li className="px-1 text-sm text-muted-foreground">{list.length === 0 ? "Activity appears after the dataset loads." : "No activity of this type yet."}</li> : null}
      </ul>
      {shown.length > limit ? (
        <div className="px-3 pb-4">
          <button type="button" onClick={() => setLimit((value) => value + PAGE)} className="w-full rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            Show {Math.min(PAGE, shown.length - limit)} more
          </button>
        </div>
      ) : null}
    </aside>
  )
}

function ago(now: number | null, at: string): string {
  const ms = now == null ? NaN : now - Date.parse(at)
  if (!Number.isFinite(ms)) return "—"
  return ms < 1000 ? "now" : `${formatAge(Math.max(0, ms))} ago`
}

/** Step for relative times: every second for the first minute, then every 15 seconds. */
function stepFor(at: string): number {
  const age = Date.now() - Date.parse(at)
  return Number.isFinite(age) && age < 60_000 ? 1000 : 15_000
}

const ActivityCard = memo(function ActivityCard({ item, highlight }: { item: ActivityItem; highlight: boolean }) {
  const now = useClock(stepFor(item.occurredAt))
  const meta = TYPE_META[item.type]
  const Icon = meta.icon
  const token = item.type === "new-pair" || item.type === "lp-burn" || item.type === "lp-lock"
  const external = !item.href.startsWith("/")
  const time = new Date(item.occurredAt)
  return (
    <li className={`rounded-lg bg-card/60 px-3 py-2.5 ring-1 ring-foreground/10 ${highlight ? "activity-arrive" : ""}`}>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className={`inline-flex items-center gap-1 font-semibold tracking-wide uppercase ${meta.tone}`}>
          <Icon size={12} aria-hidden />
          {meta.label}
        </span>
        <time dateTime={item.occurredAt} title={time.toLocaleString()} className="text-muted-foreground tabular-nums">{ago(now, item.occurredAt)}</time>
      </div>
      {token ? <TokenBody item={item} now={now} /> : (
        <>
          <p className="mt-1.5 line-clamp-2 text-sm font-medium">{item.title}</p>
          {item.detail ? <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p> : null}
        </>
      )}
      <div className="mt-2 flex items-center justify-end">
        {external ? (
          <a href={item.href} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">{meta.action} →</a>
        ) : (
          <Link href={item.href} className="text-xs text-primary hover:underline">{meta.action} →</Link>
        )}
      </div>
    </li>
  )
})

function TokenBody({ item, now }: { item: ActivityItem; now: number | null }) {
  const store = activityStore()
  const metrics = useSyncExternalStore(
    store.subscribe,
    () => store.metricsFor(item.pairAddress, item.tokenAddress),
    () => store.metricsFor(null, null),
  )
  const short = item.tokenAddress ? `${item.tokenAddress.slice(0, 6)}…${item.tokenAddress.slice(-4)}` : "Unknown token"
  const symbol = item.symbol || short
  const pairAge = item.pairCreatedAt && now != null ? now - Date.parse(item.pairCreatedAt) : NaN
  return (
    <>
      <p className="mt-1.5 truncate text-sm font-semibold" title={`${symbol} / WETH`}>{symbol} <span className="font-normal text-muted-foreground">/ WETH</span></p>
      <p className="truncate text-xs text-muted-foreground">{item.symbol ? `$${item.symbol.replace(/^\$/, "")}` : "Identity loading…"}{item.name && item.name !== item.symbol ? ` · ${item.name}` : ""}</p>
      {item.type === "lp-burn" ? (
        <p className="mt-1.5 flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">LP burned</span>
          <span className="font-semibold tabular-nums">{item.lpBurnPercent == null ? "N/A" : `${Number(item.lpBurnPercent.toFixed(2))}%`}</span>
        </p>
      ) : null}
      <dl className="mt-2 grid grid-cols-3 gap-1 rounded-md bg-muted/50 px-2 py-1.5">
        <Metric label="TX" tip={DEFINITIONS.totalTx} slot={metrics.totalTx} format={(value) => value.toLocaleString("en-US")} align="left" />
        <Metric label="WETH" tip={DEFINITIONS.pooledWeth} slot={metrics.pooledWeth} format={formatWeth} align="center" />
        <Metric label="Holders" tip={DEFINITIONS.holders} slot={metrics.holders} format={(value) => value.toLocaleString("en-US")} align="right" />
      </dl>
      <p className="mt-1.5 text-[11px] text-muted-foreground">Pair age {Number.isFinite(pairAge) ? formatAge(Math.max(0, pairAge)) : "—"}{item.exchange ? ` · ${item.exchange}` : ""}</p>
    </>
  )
}

function Metric({ label, tip, slot, format, align }: { label: string; tip: string; slot: MetricSlot<number>; format: (value: number) => string; align: "left" | "center" | "right" }) {
  const metric = slot.metric
  const source = metric ? `Source: ${SOURCE_LABEL[metric.source] ?? metric.source}${metric.block != null ? `, block ${metric.block.toLocaleString("en-US")}` : ""}` : null
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase"><Tip label={label} text={tip} align={align} /></dt>
      <dd className="h-5 text-sm font-semibold tabular-nums">
        {metric ? (
          <span key={metric.value} className="value-bump inline-block" title={source ?? undefined}>{format(metric.value)}</span>
        ) : slot.status === "loading" ? (
          <span className="inline-flex animate-pulse gap-0.5 pt-2" aria-label="Loading"><span className="size-1 rounded-full bg-muted-foreground/60" /><span className="size-1 rounded-full bg-muted-foreground/60" /><span className="size-1 rounded-full bg-muted-foreground/60" /></span>
        ) : (
          <span className="text-muted-foreground" title={slot.error ?? "Not available"}>N/A</span>
        )}
      </dd>
    </div>
  )
}
