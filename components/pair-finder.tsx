"use client"

import { useState } from "react"
import { Download, Loader2 } from "lucide-react"
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
import { MAX_HOURS, OUTPUT_FORMATS, type OutputFormat, type PairRow } from "@/lib/scrape"

const PERIODS = [
  { id: "1", label: "Last 1 hour", hours: 1 },
  { id: "8", label: "Last 8 hours", hours: 8 },
  { id: "24", label: "Last 24 hours", hours: 24 },
  { id: "48", label: "Last 48 hours", hours: 48 },
  { id: "custom", label: "Custom", hours: null },
] as const

type RunResult = {
  filename: string
  count: number
  scanned: number
  hours: number
  rows: PairRow[]
  file: string
  format: OutputFormat
}

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

export function PairFinder() {
  const [periodId, setPeriodId] = useState("24")
  const [customHours, setCustomHours] = useState("12")
  const [format, setFormat] = useState<OutputFormat>("csv")
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)

  const selectedPeriod = PERIODS.find((period) => period.id === periodId) ?? PERIODS[2]
  const hours = selectedPeriod.hours ?? Number(customHours)
  const hoursValid = Number.isFinite(hours) && hours > 0 && hours <= MAX_HOURS

  async function start() {
    if (!hoursValid) {
      setError(`Enter a period from 1 to ${MAX_HOURS} hours.`)
      return
    }
    setRunning(true)
    setError(null)
    try {
      const response = await fetch("/api/pairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours, format }),
      })
      const payload = (await response.json()) as RunResult & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || "The pair list could not be loaded.")
      }
      setResult(payload)
      downloadFile(payload.filename, payload.file, payload.format)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The pair list could not be loaded.")
    } finally {
      setRunning(false)
    }
  }

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
                disabled={running}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {running
                ? "Reading the live new pairs feed. Longer windows take more time."
                : "Start downloads the file and shows the pairs here."}
            </p>
            <Button
              type="button"
              size="lg"
              className="h-10 px-5 sm:min-w-32"
              onClick={start}
              disabled={running || !hoursValid}
            >
              {running ? <Loader2 className="animate-spin" /> : null}
              {running ? "Fetching" : "Start"}
            </Button>
          </div>

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
            <CardTitle>{result ? `${result.count} pairs` : "Results"}</CardTitle>
            <CardDescription>
              {result
                ? `Last ${result.hours} hour${result.hours === 1 ? "" : "s"}. ${result.scanned.toLocaleString()} new pools scanned.`
                : "Nothing fetched yet. Choose a period and a file type, then press Start."}
            </CardDescription>
          </div>
          {result ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadFile(result.filename, result.file, result.format)}
            >
              <Download />
              {result.filename}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {result && result.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No WETH pairs were created in this window.</p>
          ) : null}
          {result && result.rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead>Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => (
                  <TableRow key={row.url}>
                    <TableCell className="font-medium whitespace-nowrap">{row.name}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{row.created_time}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.exchange}</TableCell>
                    <TableCell>
                      <a
                        href={row.url}
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
