"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { buildIntelligence } from "@/lib/narrative/engine"
import { burnTimeMs } from "@/lib/lp/burn-logic"
import { eventsOf } from "@/lib/lp/monitor"
import { DIRECTION_LABEL, type WindowId } from "@/lib/narrative/types"
import { isInsidePrevious, isInsideRange } from "@/lib/time-range"
import { formatUsd } from "@/lib/format"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { HistoryPanel } from "@/components/progress/history-panel"
import { comparisonReady } from "@/lib/history/plan"
import { rangeById } from "@/lib/time-range"
import { LpWatchSummary } from "@/components/lp/watch-view"
import { DataGate, EmptyState, PageFrame, Section, TrendCard, WindowPicker, growthLabel } from "@/components/trends/widgets"

export function Dashboard() {
  const { snapshot, error, loading } = useSnapshot()
  const [windowId, setWindowId] = useState<WindowId | string>("1h")
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, windowId) : null), [snapshot, windowId])
  const pulse = useMemo(() => (snapshot ? pulseFor(snapshot.rows, eventsOf(snapshot), windowId, snapshot.generatedAt) : null), [snapshot, windowId])
  const topName = intel?.concepts.find((trend) => trend.count >= 2)
  const topTicker = intel?.tickers[0]
  const emerging = intel?.emerging[0]
  const fastest = intel?.concepts.filter((trend) => trend.count >= 2).sort((a, b) => (b.growth ?? -1) - (a.growth ?? -1))[0]

  return (
    <PageFrame eyebrow="Name and ticker intelligence" title="What is being named right now?" lede="Discover which names, tickers, memes, people, and narratives are appearing across newly launched WETH pairs." updated={snapshot ? `Dataset updated ${formatCreated(snapshot.generatedAt, "local")}` : undefined}>
      <WindowPicker value={windowId} onChange={setWindowId} />
      <DataGate loading={loading} error={error} ready={Boolean(intel && pulse)}>
        {intel && pulse && snapshot ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Kpi href="/pairs" label="New WETH pairs" value={String(pulse.pairs)} detail={`Last ${intel.windowLabel.toLowerCase()} · ${signed(pulse.pairChange)}`} />
              <Kpi href="/lp-burns" label="LP burned" value={String(pulse.burned)} detail={`Last ${intel.windowLabel.toLowerCase()} · ${signed(pulse.burnChange)}`} />
              <Kpi href={topName ? `/trends/${topName.slug}` : "/trends"} label="Hot narrative" value={topName?.name ?? "None yet"} detail={topName ? `Trend score ${topName.score}` : "No repeated name"} />
              <Kpi href={fastest ? `/trends/${fastest.slug}` : "/trends"} label="Fastest rising" value={fastest?.name ?? "None yet"} detail={fastest ? `${fastest.previousCount} → ${fastest.count} launches` : "No acceleration yet"} />
              <Kpi href="/pairs" label="Total liquidity" value={formatUsd(pulse.liquidity)} detail="Across pairs in this window" />
            </section>
            <HistoryPanel
              backfill={snapshot.backfill}
              oldestPair={oldestTime(snapshot.rows.map((row) => row.created_at))}
              pairCount={snapshot.rows.length}
              oldestBurn={oldestTime(eventsOf(snapshot).map((event) => event.burnAt ?? ""))}
              burnCount={eventsOf(snapshot).length}
              requestedMs={rangeById(windowId).ms}
              now={Date.parse(snapshot.generatedAt)}
            />
            {comparisonReady(oldestTime(snapshot.rows.map((row) => row.created_at)), windowId, Date.parse(snapshot.generatedAt)) ? null : <p className="text-sm text-muted-foreground">Comparison unavailable: the stored history does not cover the previous window of the same length. A 7-day comparison needs 14 days of pairs.</p>}
            <LpWatchSummary />
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Insight kicker="Top name pattern" title={topName?.name ?? "No repeated name"} body={topName ? `${topName.count} launches · ${growthLabel(topName)} vs previous window` : `${pulse.pairs} pairs were checked. No name appeared often enough.`} meta={topName ? DIRECTION_LABEL[topName.direction] : "Observed data only"} href={topName ? `/trends/${topName.slug}` : "/trends"} />
              <Insight kicker="Top ticker pattern" title={topTicker?.name ?? "No repeated ticker"} body={topTicker ? `${topTicker.count} tickers · ${topTicker.narrative}` : "No ticker construction repeated in this window."} meta={topTicker ? DIRECTION_LABEL[topTicker.direction] : "Try a longer range"} href={topTicker ? `/trends/${topTicker.slug}` : "/trends"} />
              <Insight kicker="Emerging narrative" title={emerging?.name ?? "No emerging narrative"} body={emerging ? `${emerging.count} launches after ${emerging.previousCount} in the previous day. Early score ${emerging.earlyScore}/100.` : "Launches are not clustering yet. A narrative appears when several new names share a concept."} meta={emerging ? "Last 20 minutes" : "Waiting for a cluster"} href={emerging ? `/trends/${emerging.slug}` : "/trends"} />
              <Insight kicker="Why it is showing" title={topName ? topName.origin.label : "Origin unknown"} body={topName?.origin.summary ?? "Origin currently unknown."} meta="Interpretation, not a chain fact" href={topName ? `/trends/${topName.slug}` : "/news"} />
            </section>
            <div className="grid gap-6 xl:grid-cols-2">
              <Section title="Hot now">
                {intel.hot.length ? <div className="grid gap-3">{intel.hot.map((trend) => <TrendCard key={trend.id} trend={trend} />)}</div> : (
                  <EmptyState title="No hot trend detected yet" body={`${pulse.pairs} WETH pairs were analyzed during this period, but no naming pattern appeared often enough to qualify as hot.`}>
                    <div className="flex flex-wrap gap-2">{["3h", "6h", "24h"].map((id) => <button key={id} type="button" className="rounded-md bg-muted px-2 py-1 text-xs" onClick={() => setWindowId(id)}>{id}</button>)}</div>
                  </EmptyState>
                )}
              </Section>
              <Section title="Emerging narratives">
                <p className="text-sm text-muted-foreground">Last 20 minutes compared with the previous day. This does not wait for a name to become popular.</p>
                {intel.emerging.length ? <div className="grid gap-3">{intel.emerging.map((trend) => <TrendCard key={trend.id} trend={trend} />)}</div> : (
                  <EmptyState title="No emerging narrative detected" body="The current launch activity is fragmented across unrelated names and tickers. A narrative is highlighted when several launches cluster around the same concept." />
                )}
              </Section>
            </div>
            <Section title="Latest launches in this window">
              <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                    <tr>{["Token", "Age", "Liquidity", "Market cap", "LP"].map((label) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {pulse.latest.map((row) => (
                      <tr key={row.address} className="border-t border-foreground/10 hover:bg-muted/50">
                        <td className="px-3 py-2"><Link href={`/tokens/${row.tokenAddress}`} className="hover:underline">{row.name}</Link></td>
                        <td className="px-3 py-2">{formatCreated(row.created_at, "local")}</td>
                        <td className="px-3 py-2">{formatUsd(row.liquidity ?? row.listingLiquidity)}</td>
                        <td className="px-3 py-2">{formatUsd(row.marketCap)}</td>
                        <td className="px-3 py-2">{row.lpStatus === "burnt" ? "Burned" : row.lpStatus === "locked" ? "Locked" : row.lpStatus === "none" ? "Not burned" : "Unknown"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        ) : null}
      </DataGate>
    </PageFrame>
  )
}

function oldestTime(values: string[]): number | null {
  const times = values.map((value) => Date.parse(value)).filter(Number.isFinite)
  return times.length ? Math.min(...times) : null
}

function pulseFor(rows: { created_at: string; lpStatus: string; liquidity: number | null; listingLiquidity: number | null; marketCap: number | null; name: string; address: string; tokenAddress: string }[], events: { burnAt?: string | null }[], windowId: string, generatedAt: string) {
  const end = Date.parse(generatedAt)
  const current = rows.filter((row) => isInsideRange(row.created_at, windowId, end))
  const previous = rows.filter((row) => isInsidePrevious(row.created_at, windowId, end))
  const burned = events.filter((event) => {
    const at = burnTimeMs(event)
    return at != null && isInsideRange(at, windowId, end)
  }).length
  const burnedBefore = events.filter((event) => {
    const at = burnTimeMs(event)
    return at != null && isInsidePrevious(at, windowId, end)
  }).length
  const liquidity = current.reduce((sum, row) => sum + (row.liquidity ?? row.listingLiquidity ?? 0), 0)
  return {
    pairs: current.length,
    pairChange: change(current.length, previous.length),
    burned,
    burnChange: change(burned, burnedBefore),
    liquidity,
    latest: [...current].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8),
  }
}

function change(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0
  return (current - previous) / previous
}

function signed(value: number | null): string {
  if (value === null) return "New"
  const percent = Math.round(value * 100)
  return `${percent > 0 ? "+" : ""}${percent}%`
}

function Kpi({ href, label, value, detail }: { href: string; label: string; value: string; detail: string }) {
  return (
    <Link href={href} className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10 transition hover:-translate-y-0.5 hover:ring-primary/40">
      <p className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Link>
  )
}

function Insight({ kicker, title, body, meta, href }: { kicker: string; title: string; body: string; meta: string; href: string }) {
  return (
    <Link href={href} className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition hover:ring-primary/40">
      <p className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">{kicker}</p>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      <p className="text-xs">{meta}</p>
      <p className="text-sm text-primary">Open</p>
    </Link>
  )
}
