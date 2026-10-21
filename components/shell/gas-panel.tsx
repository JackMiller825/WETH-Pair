"use client"

import { useEffect, useState } from "react"
import { MarketChart } from "@/components/shell/market-chart"
import { formatUsd } from "@/lib/format"
import { formatGwei } from "@/lib/market/format"
import { GAS_RANGES, loadGasSeries, type GasPoint } from "@/lib/market/gas-history"
import { scanUsage, weiToEth, type UsageProgress, type UsageRank } from "@/lib/market/gas-usage"

const historyCache = new Map<string, GasPoint[]>()
let usage: UsageProgress | null = null
let usageError: string | null = null
let usageTask: Promise<void> | null = null
const usageListeners = new Set<() => void>()

function emitUsage() {
  for (const listener of usageListeners) listener()
}

function ensureUsage() {
  if (usageTask) return
  usageTask = scanUsage((progress) => {
    usage = progress
    usageError = null
    emitUsage()
  }).catch((error: unknown) => {
    usageError = error instanceof Error ? error.message : "Gas usage failed"
    usageTask = null
    emitUsage()
  })
}

function useUsage(): { progress: UsageProgress | null; error: string | null } {
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = () => setTick((value) => value + 1)
    usageListeners.add(listener)
    ensureUsage()
    return () => {
      usageListeners.delete(listener)
    }
  }, [])
  return { progress: usage, error: usageError }
}

function short(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`
}

function AddressCell({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={`https://etherscan.io/address/${address}`} target="_blank" rel="noreferrer" className="font-mono text-foreground hover:underline" title={address}>{short(address)}</a>
      <button
        type="button"
        aria-label={`Copy ${address}`}
        onClick={() => {
          void navigator.clipboard.writeText(address).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          })
        }}
        className="text-[10px] text-primary hover:underline"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  )
}

function feeLabel(wei: bigint, ethUsd: number | null): string {
  const eth = weiToEth(wei)
  const usd = ethUsd != null && ethUsd > 0 ? formatUsd(eth * ethUsd) : null
  const ethText = `${eth >= 100 ? eth.toFixed(1) : eth >= 1 ? eth.toFixed(2) : eth.toFixed(4)} ETH`
  return usd ? `${usd} (${ethText})` : ethText
}

function UsageTable({ rows, kind, ethUsd }: { rows: UsageRank[]; kind: "guzzlers" | "spenders"; ethUsd: number | null }) {
  const used = kind === "guzzlers"
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-xs">
        <thead className="text-[10px] tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="py-1 pr-2 font-medium">Rank</th>
            <th className="py-1 pr-2 font-medium">Address</th>
            <th className="py-1 pr-2 text-right font-medium">Fees last 3h</th>
            <th className="py-1 pr-2 text-right font-medium">{used ? "% used 3h" : "% spent 3h"}</th>
            <th className="py-1 pr-2 text-right font-medium">Fees last 24h</th>
            <th className="py-1 pr-2 text-right font-medium">{used ? "% used 24h" : "% spent 24h"}</th>
            <th className="py-1 text-right font-medium">Analytics</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/10">
          {rows.map((row) => (
            <tr key={row.address}>
              <td className="py-1.5 pr-2 tabular-nums">{row.rank}</td>
              <td className="py-1.5 pr-2"><AddressCell address={row.address} /></td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{feeLabel(row.fee3, ethUsd)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{row.share3.toFixed(2)}%</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{feeLabel(row.fee24, ethUsd)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{row.share24.toFixed(2)}%</td>
              <td className="py-1.5 text-right"><a href={`https://etherscan.io/address/${row.address}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">View</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function GasUsage({ kind, ethUsd }: { kind: "guzzlers" | "spenders"; ethUsd: number | null }) {
  const { progress, error } = useUsage()
  const eth = ethUsd
  const rows = kind === "guzzlers" ? progress?.guzzlers ?? [] : progress?.spenders ?? []
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">
        {kind === "guzzlers" ? "Contracts that consumed gas." : "Accounts that paid the gas."} Fees are summed from sampled block receipts, denser over the last 3 hours and wider across 24 hours. The percentages are the share of that sample for each address.
        {progress ? ` ${progress.read} of ${progress.total} blocks.` : " Reading blocks…"}
      </p>
      {error ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{error}</p> : null}
      {rows.length > 0 ? <UsageTable rows={rows} kind={kind} ethUsd={eth} /> : <p className="py-4 text-xs text-muted-foreground">{error ? "No rows yet." : "The first blocks are loading."}</p>}
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
