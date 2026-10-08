"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { DIRECTION_LABEL, LIFECYCLE_LABEL, WINDOWS, type Bucket, type Trend } from "@/lib/narrative/types"
import { statusLabel } from "@/lib/narrative/score"
import { formatCreated } from "@/lib/types"
import { formatUsd } from "@/lib/format"

export function growthLabel(trend: Pick<Trend, "growth" | "count" | "previousCount">): string {
  if (trend.previousCount === 0 && trend.count > 0) return "New"
  if (trend.growth === null) return "—"
  const percent = Math.round(trend.growth * 100)
  return `${percent > 0 ? "+" : ""}${percent}%`
}

const SHORT_WINDOW: Record<string, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "3h": "3h",
  "6h": "6h",
  "12h": "12h",
  "24h": "24h",
  "3d": "3d",
  "7d": "7d",
}

export function WindowPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const preset = WINDOWS.some((item) => item.id === value)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Time range</p>
      <div className="flex max-w-full flex-wrap gap-1 rounded-lg bg-card p-1 ring-1 ring-foreground/10">
        {WINDOWS.map((item) => (
          <button key={item.id} type="button" onClick={() => onChange(item.id)} className={`rounded-md px-2.5 py-1 text-xs ${value === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
            {SHORT_WINDOW[item.id] ?? item.label}
          </button>
        ))}
        <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); const hours = Number(new FormData(event.currentTarget).get("hours")); if (Number.isInteger(hours) && hours >= 1 && hours <= 168) onChange(`${hours}h`) }}>
          <input name="hours" inputMode="numeric" placeholder="Custom h" aria-label="Custom range in hours" className={`w-20 rounded-md bg-transparent px-2 py-1 text-xs outline-none ${preset ? "" : "text-primary"}`} />
          <button type="submit" className="rounded-md px-2 py-1 text-xs text-muted-foreground">Set</button>
        </form>
      </div>
    </div>
  )
}

export function PageFrame({ eyebrow = "WETH intelligence", title, lede, updated, children }: { eyebrow?: string; title: string; lede: string; updated?: string; children: ReactNode }) {
  return (
    <main className="page-wrap flex w-full flex-col gap-6 py-6 sm:py-8">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-[11px] font-medium tracking-[0.18em] text-primary uppercase">{eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{lede}</p>
        </div>
        {updated ? <p className="text-xs text-muted-foreground">{updated}</p> : null}
      </header>
      {children}
    </main>
  )
}

export function EmptyState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl bg-card px-4 py-5 ring-1 ring-foreground/10">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{body}</p>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  )
}

export function Hint({ label, text }: { label: string; text: string }) {
  return (
    <span className="group relative inline-flex items-center gap-1">
      <span>{label}</span>
      <span tabIndex={0} className="cursor-help text-[10px] text-muted-foreground" aria-label={text}>info</span>
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-56 rounded-md bg-popover p-2 text-left text-xs font-normal text-popover-foreground ring-1 ring-foreground/15 group-hover:block group-focus-within:block">{text}</span>
    </span>
  )
}

export function Meter({ label, value, hint }: { label: string; value: number; hint: string }) {
  const width = Math.max(0, Math.min(100, value))
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <Hint label={label} text={hint} />
        <span className="tabular-nums">{Math.round(value)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted" aria-hidden>
        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

export function TrendCard({ trend }: { trend: Trend }) {
  return (
    <Link href={`/trends/${trend.slug}`} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition hover:-translate-y-0.5 hover:ring-primary/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">{trend.kind}</p>
          <h3 className="text-lg font-semibold">{trend.name}</h3>
          <p className="text-xs text-muted-foreground">{DIRECTION_LABEL[trend.direction]} · {statusLabel(trend.score, trend.lifecycle)}</p>
        </div>
        <p className="text-right text-2xl font-semibold tabular-nums">{trend.score}<span className="text-sm text-muted-foreground">/100</span></p>
      </div>
      <p className="text-sm">{trend.count} launches · {growthLabel(trend)} vs previous window · {Math.round(trend.share * 100)}% of launches</p>
      <Meter label="Trend score" value={trend.score} hint="How quickly this name is spreading, from launch velocity, news overlap, activity, and liquidity. It is a score, not a prediction." />
      <Meter label="Launch velocity" value={trend.parts.launchVelocity} hint="Compares launches in this window with the previous window of the same length." />
      <div className="rounded-md bg-muted/60 p-2">
        <p className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Observed</p>
        <p className="text-sm">{trend.count} tokens · {trend.previousCount} in the previous window</p>
        <p className="mt-2 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Interpretation</p>
        <p className="text-sm leading-6">{trend.origin.summary}</p>
        <p className="text-xs text-muted-foreground">{trend.origin.label}{trend.origin.label === "Unknown" ? "" : ` · confidence ${trend.origin.confidence}%`}</p>
      </div>
      <p className="text-sm text-primary">View related tokens</p>
    </Link>
  )
}

export function TrendTable({ trends, analyzed }: { trends: Trend[]; analyzed?: number }) {
  if (trends.length === 0) {
    return <EmptyState title="No repeated pattern yet" body={analyzed != null ? `${analyzed} WETH pairs were checked in this period, and no naming pattern appeared often enough to list.` : "No naming pattern appeared often enough to list in this period."} />
  }
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
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
            <tr key={trend.id} className="border-t border-foreground/10 hover:bg-muted/50">
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

export function Stat({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">{hint ? <Hint label={label} text={hint} /> : label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </>
  )
  const className = "rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10"
  return href ? <Link href={href} className={`${className} transition hover:ring-primary/40`}>{body}</Link> : <div className={className}>{body}</div>
}

export function money(value: number | null): string {
  return value === null ? "Not in the pair record" : formatUsd(value)
}

export function when(value: string | null): string {
  return value ? formatCreated(value, "local") : "—"
}

export function DataGate({ loading, error, ready, children }: { loading: boolean; error: string | null; ready: boolean; children: ReactNode }) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Analyzing recently launched WETH pairs">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />)}
      </div>
    )
  }
  if (error) return <EmptyState title="The dataset could not be loaded" body={error} />
  if (!ready) return <EmptyState title="No pairs in this dataset" body="The published list is empty, so there is nothing to analyze yet." />
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
