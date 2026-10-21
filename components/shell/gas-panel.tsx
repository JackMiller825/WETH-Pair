"use client"

import { useEffect, useState } from "react"
import { LineChart } from "lucide-react"
import { MarketChart } from "@/components/shell/market-chart"
import { formatGwei } from "@/lib/market/format"
import { GAS_RANGES, loadGasSeries, type GasPoint } from "@/lib/market/gas-history"
import { loadGasTracker, type GasTrackerFile, type GasTrackerRow } from "@/lib/market/gas-tracker"

const historyCache = new Map<string, GasPoint[]>()

function useGasTracker(): { board: GasTrackerFile | null; error: string | null } {
  const [board, setBoard] = useState<GasTrackerFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancel = false
    async function pull() {
      try {
        const next = await loadGasTracker()
        if (!cancel) {
          setBoard(next)
          setError(null)
        }
      } catch (caught) {
        if (!cancel) setError(caught instanceof Error ? caught.message : "The gas tracker could not be read")
      }
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 30_000)
    return () => {
      cancel = true
      window.clearInterval(timer)
    }
  }, [])
  return { board, error }
}

function AddressCell({ name, address }: { name: string; address: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex max-w-[16rem] items-center gap-1.5">
      <a href={`https://etherscan.io/address/${address}`} target="_blank" rel="noreferrer" className="truncate text-foreground hover:underline" title={`${name}\n${address}`}>{name}</a>
      <button
        type="button"
        aria-label={`Copy ${address}`}
        onClick={() => {
          void navigator.clipboard.writeText(address).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          })
        }}
        className="shrink-0 text-[10px] text-primary hover:underline"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  )
}

function UsageTable({ rows, kind }: { rows: GasTrackerRow[]; kind: "guzzlers" | "spenders" }) {
  const used = kind === "guzzlers"
  const peak = Math.max(...rows.map((row) => row.share3), 0)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-xs">
        <thead className="text-[10px] tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="py-1 pr-2 font-medium">Rank</th>
            <th className="py-1 pr-2 font-medium">Address</th>
            <th className="py-1 pr-2 text-right font-medium">Fees Last 3hrs</th>
            <th className="py-1 pr-3 text-right font-medium">{used ? "% Used 3hrs" : "% Spent 3hrs"}</th>
            <th className="py-1 pr-2 text-right font-medium">Fees Last 24hrs</th>
            <th className="py-1 pr-2 text-right font-medium">{used ? "% Used 24hrs" : "% Spent 24hrs"}</th>
            <th className="py-1 text-right font-medium">Analytics</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/10">
          {rows.map((row) => (
            <tr key={row.address}>
              <td className="py-1.5 pr-2 tabular-nums">{row.rank}</td>
              <td className="py-1.5 pr-2"><AddressCell name={row.name} address={row.address} /></td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{row.fee3Usd}{row.fee3Eth ? <span className="text-muted-foreground"> ({row.fee3Eth})</span> : null}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums" title={row.gas3 ? `Gas units used: ${row.gas3}` : undefined}>
                {row.share3Text}
                <span className="mt-1 block h-0.5 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-sky-500" style={{ width: `${peak > 0 ? (row.share3 / peak) * 100 : 0}%` }} /></span>
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{row.fee24Usd}{row.fee24Eth ? <span className="text-muted-foreground"> ({row.fee24Eth})</span> : null}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums" title={row.gas24 ? `Gas units used: ${row.gas24}` : undefined}>{row.share24Text}</td>
              <td className="py-1.5 text-right"><a href={`https://etherscan.io/address/${row.address}#analytics-txfees`} target="_blank" rel="noreferrer" aria-label={`${row.name} analytics`} className="inline-flex text-primary hover:underline"><LineChart size={14} aria-hidden /></a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function GasUsage({ kind }: { kind: "guzzlers" | "spenders" }) {
  const { board, error } = useGasTracker()
  const rows = kind === "guzzlers" ? board?.guzzlers ?? [] : board?.spenders ?? []
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">
        {kind === "guzzlers" ? "Contracts that consume gas." : "Accounts that pay the gas."} Names, fees, and percentages are Etherscan&apos;s gas tracker{board?.block != null ? ` at block ${board.block.toLocaleString("en-US")}` : ""}. Copy copies the address.
      </p>
      {error ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{error}</p> : null}
      {rows.length > 0 ? <UsageTable rows={rows} kind={kind} /> : <p className="py-4 text-xs text-muted-foreground">{error ? "No rows yet." : "Loading the gas tracker…"}</p>}
    </div>
  )
}

export function GasHistory() {
  const [range, setRange] = useState("1h")
  const [active, setActive] = useState("1h")
  const [points, setPoints] = useState<GasPoint[] | null>(historyCache.get("1h") ?? null)
  const [error, setError] = useState<string | null>(null)
  if (range !== active) {
    setActive(range)
    setPoints(historyCache.get(range) ?? null)
    setError(null)
  }
  useEffect(() => {
    if (historyCache.has(range)) return
    let cancel = false
    loadGasSeries(range)
      .then((rows) => {
        historyCache.set(range, rows)
        if (!cancel) {
          setPoints(rows)
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (!cancel) setError(caught instanceof Error ? caught.message : "Gas history failed")
      })
    return () => {
      cancel = true
    }
  }, [range])
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Gas history range">
        {GAS_RANGES.map((item) => (
          <button key={item.id} type="button" aria-pressed={range === item.id} onClick={() => setRange(item.id)} className={`rounded px-1.5 py-0.5 text-[11px] uppercase ${range === item.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{item.label}</button>
        ))}
      </div>
      {error ? <p className="text-xs text-amber-600 dark:text-amber-400">{error}</p> : null}
      {points ? (
        <MarketChart
          lines={[
            { id: "standard", label: "Standard", color: "#94a3b8", values: points.map((point) => point.standard) },
            { id: "fast", label: "Fast", color: "#38bdf8", values: points.map((point) => point.fast) },
            { id: "rapid", label: "Rapid", color: "#f87171", values: points.map((point) => point.rapid) },
          ]}
          formatValue={(value) => formatGwei(value)}
          formatTime={(index) => new Date(points[index].at).toLocaleString()}
        />
      ) : error ? null : <p className="py-6 text-center text-xs text-muted-foreground">Loading fee history…</p>}
    </div>
  )
}
