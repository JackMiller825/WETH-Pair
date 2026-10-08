"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { DIRECTION_LABEL, LIFECYCLE_LABEL, WINDOWS, type Bucket, type Trend, type WindowId } from "@/lib/narrative/types"
import { statusLabel } from "@/lib/narrative/score"
import { formatCreated } from "@/lib/types"
import { formatUsd } from "@/lib/format"

export function growthLabel(trend: Pick<Trend, "growth" | "count" | "previousCount">): string {
  if (trend.previousCount === 0 && trend.count > 0) return "New"
  if (trend.growth === null) return "—"
  const percent = Math.round(trend.growth * 100)
  return `${percent > 0 ? "+" : ""}${percent}%`
}

export function WindowPicker({ value, onChange }: { value: WindowId; onChange: (value: WindowId) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {WINDOWS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={`rounded-full px-3 py-1 text-xs ${value === item.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function PageFrame({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Name and ticker trend intelligence</p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{lede}</p>
      </header>
      {children}
    </main>
  )
}

export function TrendCard({ trend }: { trend: Trend }) {
  return (
    <Link href={`/trends/${trend.slug}`} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 hover:ring-foreground/25">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{trend.name}</h3>
          <p className="text-xs text-muted-foreground">{DIRECTION_LABEL[trend.direction]} · {statusLabel(trend.score, trend.lifecycle)}</p>
        </div>
        <p className="text-right text-sm font-medium">{trend.score}<span className="text-muted-foreground">/100</span></p>
      </div>
      <p className="text-sm text-muted-foreground">{trend.count} tokens · {growthLabel(trend)} · {Math.round(trend.share * 100)}% of launches</p>
      <p className="line-clamp-3 text-sm leading-6">{trend.origin.summary}</p>
      <p className="text-xs text-muted-foreground">{trend.origin.label}{trend.origin.label === "Unknown" ? "" : ` · ${trend.origin.confidence}%`}</p>
    </Link>
  )
}

export function TrendTable({ trends }: { trends: Trend[] }) {
  if (trends.length === 0) return <p className="text-sm text-muted-foreground">Nothing cleared the minimum count in this window.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">Trend</th>
            <th className="py-2 pr-3 font-medium">Tokens</th>
            <th className="py-2 pr-3 font-medium">Share</th>
            <th className="py-2 pr-3 font-medium">Growth</th>
            <th className="py-2 pr-3 font-medium">Direction</th>
            <th className="py-2 pr-3 font-medium">Score</th>
            <th className="py-2 font-medium">Origin</th>
          </tr>
        </thead>
        <tbody>
          {trends.map((trend) => (
            <tr key={trend.id} className="border-t border-foreground/10">
              <td className="py-2 pr-3"><Link href={`/trends/${trend.slug}`} className="font-medium hover:underline">{trend.name}</Link></td>
              <td className="py-2 pr-3">{trend.count}</td>
              <td className="py-2 pr-3">{Math.round(trend.share * 100)}%</td>
              <td className="py-2 pr-3">{growthLabel(trend)}</td>
              <td className="py-2 pr-3">{DIRECTION_LABEL[trend.direction]}</td>
              <td className="py-2 pr-3">{trend.score}</td>
              <td className="py-2 text-muted-foreground">{trend.origin.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Sparkline({ points, label }: { points: { at: string; value: number }[]; label: string }) {
  if (points.length < 2) return <p className="text-xs text-muted-foreground">{label} needs at least two points. Liquidity and volume history fills in after later publishes.</p>
  const width = 320
  const height = 88
  const max = Math.max(...points.map((point) => point.value), 1)
  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width
    const y = height - 8 - (point.value / max) * (height - 16)
    return { x, y, point }
  })
  const d = coords.map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(" ")
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" />
        {coords.map((coord) => (
          <circle key={coord.point.at} cx={coord.x} cy={coord.y} r="2.5">
            <title>{`${formatCreated(coord.point.at, "UTC")} · ${coord.point.value}`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  )
}

export function LaunchChart({ buckets }: { buckets: Bucket[] }) {
  return <Sparkline points={buckets.map((bucket) => ({ at: bucket.at, value: bucket.launches }))} label="Launches" />
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card px-3 py-2 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

export function money(value: number | null): string {
  return value === null ? "Not in the pair record" : formatUsd(value)
}

export function when(value: string | null): string {
  return value ? formatCreated(value, "local") : "—"
}

export function DataGate({ loading, error, ready, children }: { loading: boolean; error: string | null; ready: boolean; children: ReactNode }) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading the published pair list…</p>
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!ready) return <p className="text-sm text-muted-foreground">The published pair list is empty.</p>
  return children
}

export function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function lifecycleText(trend: Trend): string {
  return `${LIFECYCLE_LABEL[trend.lifecycle]} · ${DIRECTION_LABEL[trend.direction]}`
}
