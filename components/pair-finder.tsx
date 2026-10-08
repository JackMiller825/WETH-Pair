"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Download,
  ExternalLink,
  Flame,
  Loader2,
  Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AddressCell } from "@/components/address-cell"
import { AlertStack } from "@/components/alert-stack"
import { Pager } from "@/components/pager"
import { ResultsToolbar } from "@/components/results-toolbar"
import { HistoryPanel } from "@/components/progress/history-panel"
import { WatchPanel } from "@/components/watch-panel"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  formatAmount,
  formatCount,
  formatExactPercent,
  formatPrice,
  formatUsd,
} from "@/lib/format"
import {
  EMPTY_DETAIL,
  LOCAL_ZONE,
  MAX_HOURS,
  OUTPUT_FORMATS,
  TIME_ZONES,
  canBurnLp,
  filenameFor,
  formatCreated,
  normalizeLp,
  renderFile,
  zoneDescription,
  type OutputFormat,
  type PairDetail,
  type PairRecord,
  type PairRow,
} from "@/lib/types"
import {
  createAudioContext,
  playAlertTone,
  requestNotifications,
  sendDesktopNotification,
  type NotificationState,
} from "@/lib/alerts"
import {
  WATCH_INTERVAL_MS,
  seedBurnt,
  takeNewBurnt,
  toAlert,
  type WatchAlert,
} from "@/lib/watch"
import {
  ALL_EXCHANGES,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  applyView,
  exchangeOptions,
  isFiltered,
  liquidityOf,
  type Filters,
  type SortKey,
  type SortState,
} from "@/lib/view"

const PERIODS = [
  { id: "5m", label: "Last 5 minutes", hours: 5 / 60 },
  { id: "15m", label: "Last 15 minutes", hours: 15 / 60 },
  { id: "30m", label: "Last 30 minutes", hours: 0.5 },
  { id: "1", label: "Last 1 hour", hours: 1 },
  { id: "3", label: "Last 3 hours", hours: 3 },
  { id: "6", label: "Last 6 hours", hours: 6 },
  { id: "12", label: "Last 12 hours", hours: 12 },
  { id: "24", label: "Last 24 hours", hours: 24 },
  { id: "72", label: "Last 3 days", hours: 72 },
  { id: "168", label: "Last 7 days", hours: 168 },
  { id: "custom", label: "Custom", hours: null },
] as const

const PAGE_SIZES = [10, 25, 50, 100]
const DEFAULT_PAGE_SIZE: Record<Mode, number> = { all: 25, burnt: 10 }
const BATCH_SIZE = 20
const PARALLEL_BATCHES = 3

type Mode = "all" | "burnt"

type Run = {
  mode: Mode
  hours: number
  scanned: number
  records: PairRecord[]
  checked: number
  failed: number
  publishedAt: string | null
  coverage?: {
    backfill: import("@/lib/history/plan").BackfillState | null
    oldestPair: number | null
    stored: number
    requestedMs: number
  }
}

type Progress = { label: string; done: number; total: number }

const MIME: Record<OutputFormat, string> = {
  csv: "text/csv;charset=utf-8",
  json: "application/json;charset=utf-8",
  txt: "text/plain;charset=utf-8",
}

function downloadFile(filename: string, contents: string, format: OutputFormat) {
  const blob = new Blob([contents], { type: MIME[format] })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

type PublishedSnapshot = {
  generatedAt?: string
  rows?: PairRecord[]
  backfill?: import("@/lib/history/plan").BackfillState
}

async function loadPublishedWindow(start: number, end: number): Promise<{
  rows: PairRecord[]
  publishedAt: string | null
  backfill: import("@/lib/history/plan").BackfillState | null
  oldestPair: number | null
  stored: number
}> {
  const response = await fetch(`/data/snapshot.json?ts=${Date.now()}`, { cache: "no-store" })
  if (!response.ok) throw new Error("The pair list could not be loaded.")
  const payload = (await response.json()) as PublishedSnapshot
  const rows = Array.isArray(payload.rows) ? payload.rows : []
  const times = rows.map((row) => Date.parse(row.created_at)).filter(Number.isFinite)
  return {
    rows: rows.filter((row) => {
      const created = Date.parse(row.created_at)
      return Number.isFinite(created) && created >= start && created <= end
    }),
    publishedAt: typeof payload.generatedAt === "string" ? payload.generatedAt : null,
    backfill: payload.backfill ?? null,
    oldestPair: times.length ? Math.min(...times) : null,
    stored: rows.length,
  }
}

function windowBounds(hours: number, startText: string, endText: string): { start: number; end: number } | { error: string } {
  if (startText && endText) {
    const start = Date.parse(startText)
    const end = Date.parse(endText)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: "The custom start and end could not be read." }
    if (start >= end) return { error: "The start must be before the end." }
    if (end - start > 30 * 24 * 60 * 60 * 1000) return { error: "A custom range cannot be longer than 30 days." }
    return { start, end }
  }
  return { start: Date.now() - hours * 60 * 60 * 1000, end: Date.now() }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || "The request failed.")
  return payload
}

async function loadDetails(
  rows: PairRow[],
  onProgress: (done: number) => void,
): Promise<Map<string, PairDetail>> {
  const details = new Map<string, PairDetail>()
  const batches: string[][] = []
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    batches.push(rows.slice(start, start + BATCH_SIZE).map((row) => row.address))
  }
  let next = 0
  let done = 0
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++]
      try {
        const payload = await postJson<{ details: Record<string, PairDetail> }>("/api/pairs/details", {
          addresses: batch,
        })
        for (const [address, detail] of Object.entries(payload.details)) {
          details.set(address.toLowerCase(), detail)
        }
      } catch {
        // Pairs missing from the map are reported as "could not be checked".
      }
      done += batch.length
      onProgress(done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_BATCHES, batches.length) }, worker))
  return details
}

function merge(rows: PairRow[], details: Map<string, PairDetail>): PairRecord[] {
  return rows.map((row) => normalizeLp({ ...row, ...(details.get(row.address.toLowerCase()) ?? EMPTY_DETAIL) }))
}

function LpCell({ record, zone }: { record: PairRecord; zone: string }) {
  const burnt = record.lpBurntPercent
  const details: string[] = []
  if (record.lpStatus === "burnt" || record.lpStatus === "locked" || record.lpStatus === "unverified") {
    details.push(`Burnt ${formatExactPercent(burnt)}`)
  }
  if (record.lpStatus === "burnt" && record.lpLockedPercent > 0) {
    details.push(`Locked ${formatExactPercent(record.lpLockedPercent)}`)
  }
  if (record.lpStatus === "locked" && record.lpLockedPercent > 0) {
    details.push(`Locked ${formatExactPercent(record.lpLockedPercent)}`)
  }
  if (record.lpUnlockAt && (record.lpStatus === "locked" || record.lpStatus === "burnt")) {
    details.push(`Unlocks ${formatCreated(record.lpUnlockAt, zone)}`)
  }

  let head: React.ReactNode = <span className="text-muted-foreground">-</span>
  if (record.lpStatus === "burnt") {
    head = (
      <span className="inline-flex items-center gap-1.5 font-medium text-emerald-300">
        <Flame className="size-4" />
        Burnt
      </span>
    )
  } else if (record.lpStatus === "locked") {
    head = (
      <span className="inline-flex items-center gap-1.5 font-medium text-sky-300">
        <Lock className="size-4" />
        Locked
      </span>
    )
  } else if (record.lpStatus === "unverified") {
    head = (
      <span
        className="inline-flex items-center gap-1.5 font-medium text-amber-300"
        title="LP tokens sit at the burn address, but DEXTools does not recognise this exchange, so its page does not show the pool as burnt."
      >
        <Flame className="size-4" />
        Unverified
      </span>
    )
  } else if (record.lpStatus === "unknown") {
    head = <span className="text-muted-foreground">Unknown</span>
  }

  return (
    <div className="flex flex-col gap-0.5">
      {head}
      {details.length > 0 ? (
        <span className="text-xs text-muted-foreground">{details.join(" · ")}</span>
      ) : null}
    </div>
  )
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string
  sortKey: SortKey
  sort: SortState
  onSort: (key: SortKey) => void
  align?: "left" | "right"
}) {
  const active = sort.key === sortKey
  const Icon = !active ? ArrowUpDown : sort.direction === "desc" ? ArrowDown : ArrowUp
  return (
    <TableHead
      aria-sort={!active ? "none" : sort.direction === "desc" ? "descending" : "ascending"}
      className={align === "right" ? "text-right" : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 rounded-sm font-medium whitespace-nowrap transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-foreground" : ""}`}
      >
        {label}
        <Icon className={`size-3.5 ${active ? "" : "opacity-50"}`} />
      </button>
    </TableHead>
  )
}

function BurntCard({ record, zone, isNew }: { record: PairRecord; zone: string; isNew: boolean }) {
  return (
    <div
      className={`flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ${
        isNew ? "ring-2 ring-emerald-400/60" : "ring-foreground/10"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <span className="truncate">{record.name}</span>
            {isNew ? <Badge className="bg-emerald-400/20 text-emerald-300">NEW</Badge> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {record.exchange} · <span className="font-mono">{formatCreated(record.created_at, zone)}</span>
          </p>
        </div>
        <a
          href={record.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${record.name} on DEXTools`}
          className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
        >
          <ExternalLink className="size-4" />
        </a>
      </div>

      <div className="flex items-stretch justify-between gap-4 rounded-lg bg-background/60 px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-[0.68rem] font-medium tracking-[0.14em] text-sky-200/70 uppercase">
            Liquidity
          </span>
          <span className="text-2xl font-bold tracking-tight">{formatUsd(liquidityOf(record))}</span>
        </div>
        <div
          className="flex min-w-14 flex-col items-center justify-center gap-0.5 text-emerald-300"
          title="LP burnt"
        >
          <Flame className="size-5" strokeWidth={1.5} />
          <span className="text-sm font-bold text-foreground">{formatExactPercent(record.lpBurntPercent)}</span>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-x-3 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Price</dt>
          <dd className="font-medium">{formatPrice(record.price)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Market cap</dt>
          <dd className="font-medium">{formatUsd(record.marketCap)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Remaining</dt>
          <dd className="font-medium">
            {record.remaining === null ? "-" : `${formatAmount(record.remaining)} ${record.remainingUnit}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Holders</dt>
          <dd className="font-medium">{formatCount(record.holders)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total Tx</dt>
          <dd className="font-medium">{formatCount(record.totalTx)}</dd>
        </div>
        {record.lpLockedPercent > 0 ? (
          <div>
            <dt className="text-xs text-muted-foreground">Also locked</dt>
            <dd className="font-medium">{formatExactPercent(record.lpLockedPercent)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Token</span>
          <AddressCell address={record.tokenAddress} label="token address" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Pair</span>
          <AddressCell address={record.address} label="pair address" />
        </div>
      </div>
    </div>
  )
}

export function PairFinder() {
  const [periodId, setPeriodId] = useState("24")
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")
  const [customHours, setCustomHours] = useState("12")
  const [format, setFormat] = useState<OutputFormat>("csv")
  const [zone, setZone] = useState(LOCAL_ZONE)
  const [running, setRunning] = useState<Mode | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [fullRun, setFullRun] = useState<Run | null>(null)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const [watchEpoch, setWatchEpoch] = useState(0)
  const [watching, setWatching] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [nextAt, setNextAt] = useState<number | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [watchFailed, setWatchFailed] = useState(false)
  const [sound, setSound] = useState(true)
  const [desktop, setDesktop] = useState<NotificationState>("default")
  const [alerts, setAlerts] = useState<WatchAlert[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const audioRef = useRef<AudioContext | null>(null)
  const busyRef = useRef(false)
  const runRef = useRef<Run | null>(null)
  const fullRunRef = useRef<Run | null>(null)
  const soundRef = useRef(true)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const baseTitle = useRef<string | null>(null)
  const [pageSizes, setPageSizes] = useState(DEFAULT_PAGE_SIZE)
  const resultsRef = useRef<HTMLDivElement>(null)

  const selectedPeriod = PERIODS.find((period) => period.id === periodId) ?? PERIODS[2]
  const selectedHours = selectedPeriod.hours ?? Number(customHours)
  const datedCustom = selectedPeriod.id === "custom" && Boolean(customStart && customEnd)
  const hoursValid = datedCustom || (Number.isFinite(selectedHours) && selectedHours > 0 && selectedHours <= MAX_HOURS)
  const busy = running !== null || refreshing

  const exchanges = useMemo(() => (run ? exchangeOptions(run.records) : []), [run])
  const activeFilters = useMemo<Filters>(
    () =>
      exchanges.some((item) => item.name === filters.exchange)
        ? filters
        : { ...filters, exchange: ALL_EXCHANGES },
    [exchanges, filters],
  )
  const rows = useMemo(
    () => (run ? applyView(run.records, activeFilters, sort) : []),
    [run, activeFilters, sort],
  )
  const filtered = isFiltered(activeFilters)

  function fileFor(target: Run) {
    const suffix = target.mode === "burnt" ? "_lp_burnt" : ""
    return {
      filename: filenameFor(target.hours, format, suffix),
      contents: renderFile(rows, format, zone),
    }
  }

  function showRun(next: Run) {
    setRun(next)
    setPage(1)
  }

  function changeFilters(next: Filters) {
    setFilters(next)
    setPage(1)
  }

  function changeSort(next: SortState) {
    setSort(next)
    setPage(1)
  }

  function sortByColumn(key: SortKey) {
    changeSort(
      sort.key === key
        ? { key, direction: sort.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" },
    )
  }

  function changePage(next: number) {
    setPage(next)
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  function selectHours(value: number) {
    const preset = PERIODS.find((period) => period.hours === value)
    if (preset) {
      setPeriodId(preset.id)
    } else {
      setPeriodId("custom")
      setCustomHours(String(value))
    }
  }

  function backToAll() {
    if (!run || busy) return
    if (fullRun && fullRun.hours === run.hours) {
      showRun(fullRun)
      return
    }
    selectHours(run.hours)
    void execute("all", run.hours)
  }

  async function fetchRun(
    mode: Mode,
    hours: number,
    onProgress?: (progress: Progress) => void,
  ): Promise<{ finished: Run; records: PairRecord[] }> {
    onProgress?.({ label: "Reading the published pair history", done: 0, total: 0 })
    const bounds = windowBounds(hours, customStart, customEnd)
    if ("error" in bounds) throw new Error(bounds.error)
    if (process.env.NEXT_PUBLIC_PAGES === "1") {
      const listing = await loadPublishedWindow(bounds.start, bounds.end)
      const targets = mode === "burnt" ? listing.rows.filter((row) => canBurnLp(row.exchange)) : listing.rows
      const records = mode === "burnt" ? targets.filter((row) => row.lpStatus === "burnt") : targets
      const finished: Run = {
        mode,
        hours,
        scanned: listing.stored,
        records,
        checked: targets.length,
        failed: records.filter((record) => record.lpStatus === "unknown").length,
        publishedAt: listing.publishedAt,
        coverage: {
          backfill: listing.backfill,
          oldestPair: listing.oldestPair,
          stored: listing.stored,
          requestedMs: bounds.end - bounds.start,
        },
      }
      return { finished, records }
    }

    const listing = await postJson<{ rows: PairRow[]; scanned: number }>("/api/pairs", { hours })
    const targets = mode === "burnt" ? listing.rows.filter((row) => canBurnLp(row.exchange)) : listing.rows

    onProgress?.({
      label: mode === "burnt" ? "Checking LP status" : "Loading market data",
      done: 0,
      total: targets.length,
    })
    const details =
      targets.length > 0
        ? await loadDetails(targets, (done) =>
            onProgress?.({
              label: mode === "burnt" ? "Checking LP status" : "Loading market data",
              done,
              total: targets.length,
            }),
          )
        : new Map<string, PairDetail>()

    const records = merge(targets, details)
    const finished: Run = {
      mode,
      hours,
      scanned: listing.scanned,
      records: mode === "burnt" ? records.filter((record) => record.lpStatus === "burnt") : records,
      checked: targets.length,
      failed: records.filter((record) => record.lpStatus === "unknown").length,
      publishedAt: null,
    }
    return { finished, records }
  }

  async function execute(mode: Mode, hoursOverride?: number): Promise<Run | null> {
    const hours = hoursOverride ?? selectedHours
    const dated = Boolean(customStart && customEnd)
    if (!dated && (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS)) {
      setError(`Enter a period from 1 to ${MAX_HOURS} hours, or a custom start and end.`)
      return null
    }
    setError(null)

    if (mode === "burnt" && fullRun && fullRun.hours === hours) {
      const cached: Run = {
        ...fullRun,
        mode: "burnt",
        checked: fullRun.records.filter((record) => canBurnLp(record.exchange)).length,
        records: fullRun.records.filter((record) => record.lpStatus === "burnt"),
      }
      showRun(cached)
      armWatch()
      return cached
    }

    busyRef.current = true
    setRunning(mode)
    try {
      const { finished, records } = await fetchRun(mode, hours, setProgress)
      if (mode === "all") setFullRun({ ...finished, records })
      else setFullRun(null)
      seedBurnt(records, seenRef.current)
      setFilters(DEFAULT_FILTERS)
      showRun(finished)
      armWatch()
      return finished
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The pair list could not be loaded.")
      return null
    } finally {
      busyRef.current = false
      setRunning(null)
      setProgress(null)
    }
  }

  function raiseAlerts(found: PairRecord[]) {
    const now = Date.now()
    setAlerts((current) => [...found.map((record) => toAlert(record, now)), ...current])
    if (soundRef.current) playAlertTone(audioRef.current)
    found.slice(0, 3).forEach((record) => {
      sendDesktopNotification(
        `New LP burnt token: ${record.name}`,
        `${record.exchange} · Liquidity ${formatUsd(record.liquidity ?? record.listingLiquidity)} · Burnt ${formatExactPercent(record.lpBurntPercent)}`,
        record.address.toLowerCase(),
      )
    })
    if (found.length > 3) {
      sendDesktopNotification(
        `${found.length - 3} more new LP burnt tokens`,
        "Open the page to see them all.",
        "watch-summary",
      )
    }
  }

  function burntRun(finished: Run, records: PairRecord[]): Run {
    return {
      mode: "burnt",
      hours: finished.hours,
      scanned: finished.scanned,
      checked: records.filter((record) => canBurnLp(record.exchange)).length,
      failed: records.filter((record) => canBurnLp(record.exchange) && record.lpStatus === "unknown").length,
      records: records.filter((record) => record.lpStatus === "burnt"),
      publishedAt: finished.publishedAt,
    }
  }

  async function refresh() {
    const current = runRef.current
    if (!current || busyRef.current) return
    busyRef.current = true
    setRefreshing(true)
    try {
      const { finished, records } = await fetchRun("all", current.hours)
      const found = takeNewBurnt(records, seenRef.current)
      const allRun: Run = { ...finished, mode: "all", records }
      setFullRun(allRun)
      setRun(current.mode === "burnt" ? burntRun(finished, records) : allRun)
      setLastUpdated(Date.now())
      setWatchFailed(false)
      if (found.length > 0) raiseAlerts(found)
    } catch {
      setWatchFailed(true)
    } finally {
      busyRef.current = false
      setRefreshing(false)
    }
  }

  function armWatch() {
    const current = runRef.current
    const full = fullRunRef.current
    if (current) seedBurnt(current.records, seenRef.current)
    if (full) seedBurnt(full.records, seenRef.current)
    if (!audioRef.current) audioRef.current = createAudioContext()
    void requestNotifications().then(setDesktop)
    setLastUpdated(Date.now())
    setWatchFailed(false)
    setNextAt(Date.now() + WATCH_INTERVAL_MS)
    setWatchEpoch((epoch) => epoch + 1)
    setWatching(true)
  }

  async function startWatching() {
    if (!audioRef.current) audioRef.current = createAudioContext()
    void requestNotifications().then(setDesktop)
    if (!runRef.current) {
      await execute("burnt")
      return
    }
    armWatch()
  }

  function stopWatching() {
    setWatching(false)
    setNextAt(null)
  }

  function testAlert() {
    const now = Date.now()
    setAlerts((current) => [
      {
        id: `test-${now}`,
        address: `test-${now}`,
        name: "TEST(Example Token)",
        exchange: "Uniswap V2",
        url: "https://www.dextools.io/app/ether/live-new-pairs",
        liquidity: 8790,
        marketCap: 12450,
        burntPercent: 100,
        foundAt: now,
        test: true,
      },
      ...current,
    ])
    if (soundRef.current) playAlertTone(audioRef.current)
    sendDesktopNotification("Test alert", "This is how a new LP burnt token will be announced.", `test-${now}`)
  }

  useEffect(() => {
    runRef.current = run
    fullRunRef.current = fullRun
    refreshRef.current = refresh
    soundRef.current = sound
  })

  useEffect(() => {
    if (!watching) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (cancelled) return
      const started = Date.now()
      await refreshRef.current()
      if (cancelled) return
      const wait = Math.max(0, WATCH_INTERVAL_MS - (Date.now() - started))
      setNextAt(Date.now() + wait)
      timer = setTimeout(tick, wait)
    }
    timer = setTimeout(tick, WATCH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [watching, watchEpoch])

  useEffect(() => {
    if (baseTitle.current === null) baseTitle.current = document.title
    document.title =
      alerts.length > 0 ? `(${alerts.length}) New LP burnt token | ${baseTitle.current}` : baseTitle.current
    return () => {
      if (baseTitle.current) document.title = baseTitle.current
    }
  }, [alerts.length])

  const newAddresses = useMemo(
    () => new Set(alerts.filter((alert) => !alert.test).map((alert) => alert.address)),
    [alerts],
  )

  const download = run ? fileFor(run) : null
  const pageSize = run ? pageSizes[run.mode] : DEFAULT_PAGE_SIZE.all
  const lastPage = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, lastPage)
  const visible = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const pager = run ? (
    <Pager
      idPrefix={run.mode}
      total={rows.length}
      page={currentPage}
      pageSize={pageSize}
      pageSizes={PAGE_SIZES}
      onPageChange={changePage}
      onPageSizeChange={(size) => {
        setPageSizes((current) => ({ ...current, [run.mode]: size }))
        setPage(1)
      }}
    />
  ) : null

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Run a search</CardTitle>
          <CardDescription>
            Pairs that include WETH on Ethereum, created inside the window you pick. Times follow the time zone you choose.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="period">Time period</Label>
              <Select
                value={periodId}
                onValueChange={(value) => {
                  if (value) setPeriodId(value)
                }}
              >
                <SelectTrigger id="period" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((period) => (
                    <SelectItem key={period.id} value={period.id}>
                      {period.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="format">Output file</Label>
              <Select
                value={format}
                onValueChange={(value) => {
                  if (value === "csv" || value === "json" || value === "txt") setFormat(value)
                }}
              >
                <SelectTrigger id="format" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_FORMATS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="zone">Time zone</Label>
              <Select
                value={zone}
                onValueChange={(value) => {
                  if (value) setZone(value)
                }}
              >
                <SelectTrigger id="zone" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_ZONES.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedPeriod.id === "custom" ? (
            <div className="flex max-w-xl flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="custom-start">Start</Label>
                  <Input id="custom-start" type="datetime-local" value={customStart} onChange={(event) => setCustomStart(event.target.value)} disabled={busy} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="custom-end">End</Label>
                  <Input id="custom-end" type="datetime-local" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} disabled={busy} />
                </div>
              </div>
              <div className="flex max-w-xs flex-col gap-2">
              <Label htmlFor="custom-hours">Or last N hours</Label>
              <Input
                id="custom-hours"
                type="number"
                min={1}
                max={MAX_HOURS}
                step={1}
                value={customHours}
                onChange={(event) => setCustomHours(event.target.value)}
                disabled={busy}
              />
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {progress
                ? progress.total > 0
                  ? `${progress.label}: ${progress.done} of ${progress.total}`
                  : `${progress.label}...`
                : "Start lists every pair with its market data. Find LP Burnt Token lists only pairs whose liquidity is burnt."}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-10 px-4"
                onClick={() => execute("burnt")}
                disabled={busy || !hoursValid}
              >
                {running === "burnt" ? <Loader2 className="animate-spin" /> : <Flame />}
                {running === "burnt" ? "Searching" : "Find LP Burnt Token"}
              </Button>
              <Button
                type="button"
                size="lg"
                className="h-10 px-5 sm:min-w-32"
                onClick={() => execute("all")}
                disabled={busy || !hoursValid}
              >
                {running === "all" ? <Loader2 className="animate-spin" /> : null}
                {running === "all" ? "Fetching" : "Start"}
              </Button>
            </div>
          </div>

          {progress && progress.total > 0 ? (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }}
              />
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <WatchPanel
            watching={watching}
            refreshing={refreshing}
            nextAt={nextAt}
            lastUpdated={lastUpdated}
            failed={watchFailed}
            sound={sound}
            desktop={desktop}
            disabled={running !== null || (!watching && !hoursValid && !run)}
            onToggle={() => (watching ? stopWatching() : void startWatching())}
            onSoundChange={setSound}
            onTest={testAlert}
            intervalSeconds={WATCH_INTERVAL_MS / 1000}
          />
        </CardContent>
      </Card>

      {run?.coverage ? <HistoryPanel backfill={run.coverage.backfill} oldestPair={run.coverage.oldestPair} pairCount={run.coverage.stored} oldestBurn={null} burnCount={0} requestedMs={run.coverage.requestedMs} now={Date.now()} /> : null}
      <Card ref={resultsRef} className="scroll-mt-4">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle>
              {run
                ? run.mode === "burnt"
                  ? `${filtered ? `${rows.length} of ${run.records.length}` : run.records.length} LP burnt ${run.records.length === 1 ? "token" : "tokens"}`
                  : `${filtered ? `${rows.length} of ${run.records.length}` : run.records.length} pairs`
                : "Results"}
            </CardTitle>
            <CardDescription>
              {run
                ? run.mode === "burnt"
                  ? `Last ${run.hours} hour${run.hours === 1 ? "" : "s"}. ${run.checked} pools with LP tokens checked out of ${run.scanned.toLocaleString()} new pools scanned. Times in ${zoneDescription(zone)}.${run.publishedAt ? ` Updated ${formatCreated(run.publishedAt, zone)}.` : ""}`
                  : `Last ${run.hours} hour${run.hours === 1 ? "" : "s"}. ${run.scanned.toLocaleString()} new pools scanned. Times in ${zoneDescription(zone)}.${run.publishedAt ? ` Updated ${formatCreated(run.publishedAt, zone)}.` : ""}`
                : "Nothing fetched yet. Choose a period, then press Start or Find LP Burnt Token. Press the download button to save the file."}
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {run && run.mode === "burnt" ? (
              <Button type="button" variant="ghost" onClick={backToAll} disabled={busy}>
                {running === "all" ? <Loader2 className="animate-spin" /> : <ArrowLeft />}
                Back to all pairs
              </Button>
            ) : null}
            {download ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => downloadFile(download.filename, download.contents, format)}
              >
                <Download />
                {download.filename}
                {filtered ? ` (${rows.length} of ${run?.records.length})` : ""}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {run && run.failed > 0 ? (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
              {run.failed} {run.failed === 1 ? "pair" : "pairs"} could not be checked because DEXTools did not
              return data for {run.failed === 1 ? "it" : "them"}. Run the search again to retry.
            </p>
          ) : null}

          {run && run.records.length > 0 ? (
            <ResultsToolbar
              filters={activeFilters}
              sort={sort}
              exchanges={exchanges}
              onFiltersChange={changeFilters}
              onSortChange={changeSort}
            />
          ) : null}

          {run && run.records.length > 0 && rows.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              <p>No {run.mode === "burnt" ? "LP burnt tokens" : "pairs"} match these filters.</p>
              <Button type="button" variant="outline" onClick={() => changeFilters(DEFAULT_FILTERS)}>
                Clear filters
              </Button>
            </div>
          ) : null}

          {run && run.mode === "burnt" && run.records.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No LP burnt tokens were found in this window. Uniswap V3 and V4 pools hold liquidity as positions
              rather than LP tokens, so only V2-style pools can be burnt.
            </p>
          ) : null}

          {run && run.mode === "burnt" && rows.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visible.map((record) => (
                  <BurntCard key={record.address} record={record} zone={zone} isNew={newAddresses.has(record.address.toLowerCase())} />
                ))}
              </div>
              {pager}
            </>
          ) : null}

          {run && run.mode === "all" && run.records.length === 0 ? (
            <p className="text-sm text-muted-foreground">No WETH pairs were created in this window.</p>
          ) : null}

          {run && run.mode === "all" && rows.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <SortableHead label="Created" sortKey="created" sort={sort} onSort={sortByColumn} />
                    <TableHead>Exchange</TableHead>
                    <SortableHead label="Price" sortKey="price" sort={sort} onSort={sortByColumn} align="right" />
                    <SortableHead label="Market cap" sortKey="marketCap" sort={sort} onSort={sortByColumn} align="right" />
                    <SortableHead label="Total liquidity" sortKey="liquidity" sort={sort} onSort={sortByColumn} align="right" />
                    <SortableHead label="Remaining" sortKey="remaining" sort={sort} onSort={sortByColumn} align="right" />
                    <SortableHead label="Holders" sortKey="holders" sort={sort} onSort={sortByColumn} align="right" />
                    <SortableHead label="Total Tx" sortKey="totalTx" sort={sort} onSort={sortByColumn} align="right" />
                    <SortableHead label="LP status" sortKey="lp" sort={sort} onSort={sortByColumn} />
                    <TableHead>Token address</TableHead>
                    <TableHead>Pair address</TableHead>
                    <TableHead>Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((record) => (
                    <TableRow key={record.address}>
                      <TableCell className="font-medium whitespace-nowrap">
                        <Link href={`/tokens/${record.tokenAddress.toLowerCase()}`} className="hover:underline">{record.name}</Link>
                        {newAddresses.has(record.address.toLowerCase()) ? (
                          <Badge className="ml-2 bg-emerald-400/20 text-emerald-300">NEW</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{formatCreated(record.created_at, zone)}</TableCell>
                      <TableCell className="whitespace-nowrap">{record.exchange}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatPrice(record.price)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatUsd(record.marketCap)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatUsd(liquidityOf(record))}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {record.remaining === null ? "-" : `${formatAmount(record.remaining)} ${record.remainingUnit}`}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatCount(record.holders)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatCount(record.totalTx)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <LpCell record={record} zone={zone} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <AddressCell address={record.tokenAddress} label="token address" />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <AddressCell address={record.address} label="pair address" />
                      </TableCell>
                      <TableCell>
                        <a
                          href={record.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          Open
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {pager}
            </>
          ) : null}
        </CardContent>
      </Card>
      <AlertStack
        alerts={alerts}
        onDismiss={(id) => setAlerts((current) => current.filter((alert) => alert.id !== id))}
        onDismissAll={() => setAlerts([])}
      />
    </div>
  )
}
