"use client"

import { useState } from "react"
import { Download, ExternalLink, Flame, Loader2, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { formatCount, formatUsd } from "@/lib/format"
import {
  EMPTY_DETAIL,
  MAX_HOURS,
  OUTPUT_FORMATS,
  canBurnLp,
  filenameFor,
  formatPercent,
  renderFile,
  type OutputFormat,
  type PairDetail,
  type PairRecord,
  type PairRow,
} from "@/lib/types"

const PERIODS = [
  { id: "1", label: "Last 1 hour", hours: 1 },
  { id: "8", label: "Last 8 hours", hours: 8 },
  { id: "24", label: "Last 24 hours", hours: 24 },
  { id: "48", label: "Last 48 hours", hours: 48 },
  { id: "custom", label: "Custom", hours: null },
] as const

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
  return rows.map((row) => ({ ...row, ...(details.get(row.address.toLowerCase()) ?? EMPTY_DETAIL) }))
}

function liquidityOf(record: PairRecord): number | null {
  return record.liquidity ?? record.listingLiquidity
}

function LpBadge({ record }: { record: PairRecord }) {
  if (record.lpStatus === "burnt") {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-emerald-300">
        <Flame className="size-4" />
        {formatPercent(record.lpBurntPercent)}
      </span>
    )
  }
  if (record.lpStatus === "locked") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sky-300">
        <Lock className="size-4" />
        {record.lpLockedPercent > 0 ? formatPercent(record.lpLockedPercent) : "-"}
      </span>
    )
  }
  return <span className="text-muted-foreground">-</span>
}

function BurntCard({ record }: { record: PairRecord }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{record.name}</p>
          <p className="text-xs text-muted-foreground">
            {record.exchange} · <span className="font-mono">{record.created_time}</span>
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
          <span className="text-sm font-bold text-foreground">{formatPercent(record.lpBurntPercent)}</span>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Market cap</dt>
          <dd className="font-medium">{formatUsd(record.marketCap)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Holders</dt>
          <dd className="font-medium">{formatCount(record.holders)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total Tx</dt>
          <dd className="font-medium">{formatCount(record.totalTx)}</dd>
        </div>
      </dl>
    </div>
  )
}

export function PairFinder() {
  const [periodId, setPeriodId] = useState("24")
  const [customHours, setCustomHours] = useState("12")
  const [format, setFormat] = useState<OutputFormat>("csv")
  const [running, setRunning] = useState<Mode | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [fullRun, setFullRun] = useState<Run | null>(null)

  const selectedPeriod = PERIODS.find((period) => period.id === periodId) ?? PERIODS[2]
  const hours = selectedPeriod.hours ?? Number(customHours)
  const hoursValid = Number.isFinite(hours) && hours > 0 && hours <= MAX_HOURS
  const busy = running !== null

  function fileFor(target: Run) {
    const suffix = target.mode === "burnt" ? "_lp_burnt" : ""
    return {
      filename: filenameFor(target.hours, format, suffix),
      contents: renderFile(target.records, format),
    }
  }

  async function execute(mode: Mode) {
    if (!hoursValid) {
      setError(`Enter a period from 1 to ${MAX_HOURS} hours.`)
      return
    }
    setError(null)

    if (mode === "burnt" && fullRun && fullRun.hours === hours) {
      setRun({
        ...fullRun,
        mode: "burnt",
        records: fullRun.records.filter((record) => record.lpStatus === "burnt"),
      })
      return
    }

    setRunning(mode)
    setProgress({ label: "Reading the live new pairs feed", done: 0, total: 0 })
    try {
      const listing = await postJson<{ rows: PairRow[]; scanned: number }>("/api/pairs", { hours })
      const targets = mode === "burnt" ? listing.rows.filter((row) => canBurnLp(row.exchange)) : listing.rows

      setProgress({
        label: mode === "burnt" ? "Checking LP status" : "Loading market data",
        done: 0,
        total: targets.length,
      })
      const details =
        targets.length > 0
          ? await loadDetails(targets, (done) =>
              setProgress((current) => (current ? { ...current, done } : current)),
            )
          : new Map<string, PairDetail>()

      const checkedRows = mode === "burnt" ? targets : listing.rows
      const records = merge(checkedRows, details)
      const failed = records.filter((record) => record.lpStatus === "unknown").length
      const finished: Run = {
        mode,
        hours,
        scanned: listing.scanned,
        records: mode === "burnt" ? records.filter((record) => record.lpStatus === "burnt") : records,
        checked: targets.length,
        failed,
      }

      if (mode === "all") {
        setFullRun({ ...finished, records })
        const { filename, contents } = {
          filename: filenameFor(hours, format),
          contents: renderFile(records, format),
        }
        downloadFile(filename, contents, format)
      }
      setRun(finished)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The pair list could not be loaded.")
    } finally {
      setRunning(null)
      setProgress(null)
    }
  }

  const download = run ? fileFor(run) : null

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Run a search</CardTitle>
          <CardDescription>
            Pairs that include WETH on Ethereum, created inside the window you pick. Times are UTC.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
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
          </div>

          {selectedPeriod.id === "custom" ? (
            <div className="flex max-w-xs flex-col gap-2">
              <Label htmlFor="custom-hours">Hours</Label>
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
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {progress
                ? progress.total > 0
                  ? `${progress.label}: ${progress.done} of ${progress.total}`
                  : `${progress.label}...`
                : "Start saves every pair with its market data. Find LP Burnt Token shows only pairs whose liquidity is burnt."}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle>
              {run
                ? run.mode === "burnt"
                  ? `${run.records.length} LP burnt ${run.records.length === 1 ? "token" : "tokens"}`
                  : `${run.records.length} pairs`
                : "Results"}
            </CardTitle>
            <CardDescription>
              {run
                ? run.mode === "burnt"
                  ? `Last ${run.hours} hour${run.hours === 1 ? "" : "s"}. ${run.checked} pools with LP tokens checked out of ${run.scanned.toLocaleString()} new pools scanned.`
                  : `Last ${run.hours} hour${run.hours === 1 ? "" : "s"}. ${run.scanned.toLocaleString()} new pools scanned.`
                : "Nothing fetched yet. Choose a period and a file type, then press Start or Find LP Burnt Token."}
            </CardDescription>
          </div>
          {download ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadFile(download.filename, download.contents, format)}
            >
              <Download />
              {download.filename}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {run && run.failed > 0 ? (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
              {run.failed} {run.failed === 1 ? "pair" : "pairs"} could not be checked because DEXTools did not
              return data for {run.failed === 1 ? "it" : "them"}. Run the search again to retry.
            </p>
          ) : null}

          {run && run.mode === "burnt" && run.records.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No LP burnt tokens were found in this window. Uniswap V3 and V4 pools hold liquidity as positions
              rather than LP tokens, so only V2-style pools can be burnt.
            </p>
          ) : null}

          {run && run.mode === "burnt" && run.records.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {run.records.map((record) => (
                <BurntCard key={record.address} record={record} />
              ))}
            </div>
          ) : null}

          {run && run.mode === "all" && run.records.length === 0 ? (
            <p className="text-sm text-muted-foreground">No WETH pairs were created in this window.</p>
          ) : null}

          {run && run.mode === "all" && run.records.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead className="text-right">Market cap</TableHead>
                  <TableHead className="text-right">Liquidity</TableHead>
                  <TableHead className="text-right">Holders</TableHead>
                  <TableHead className="text-right">Total Tx</TableHead>
                  <TableHead>LP</TableHead>
                  <TableHead>Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.records.map((record) => (
                  <TableRow key={record.address}>
                    <TableCell className="font-medium whitespace-nowrap">{record.name}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{record.created_time}</TableCell>
                    <TableCell className="whitespace-nowrap">{record.exchange}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatUsd(record.marketCap)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatUsd(liquidityOf(record))}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatCount(record.holders)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatCount(record.totalTx)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <LpBadge record={record} />
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
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
