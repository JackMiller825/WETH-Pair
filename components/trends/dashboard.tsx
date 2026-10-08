"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { buildIntelligence } from "@/lib/narrative/engine"
import type { WindowId } from "@/lib/narrative/types"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { LpWatchSummary } from "@/components/lp/watch-view"
import { DataGate, PageFrame, Section, TrendCard, WindowPicker, growthLabel } from "@/components/trends/widgets"
import { DIRECTION_LABEL } from "@/lib/narrative/types"

export function Dashboard() {
  const { snapshot, error, loading } = useSnapshot()
  const [windowId, setWindowId] = useState<WindowId>("1h")
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, windowId) : null), [snapshot, windowId])
  const topName = intel?.concepts.find((trend) => trend.count >= 2)
  const topTicker = intel?.tickers[0]
  const emerging = intel?.emerging[0]

  return (
    <PageFrame title="What is being named right now" lede="Names, tickers, and shared narratives from newly launched Ethereum/WETH pairs. Counts come from the published pair list. A reason is shown only when a fetched headline supports it.">
      <WindowPicker value={windowId} onChange={setWindowId} />
      <LpWatchSummary />
      <DataGate loading={loading} error={error} ready={Boolean(intel)}>
        {intel && snapshot ? (
          <>
            <p className="text-xs text-muted-foreground">Published {formatCreated(snapshot.generatedAt, "local")}. Windows end at that time, because newer launches are not in this list yet. {intel.total} unique tokens in the last {intel.windowLabel.toLowerCase()}.</p>
            <section className="grid gap-3 md:grid-cols-2">
              <Answer title="What names are creators using?" body={topName ? `${topName.name}: ${topName.count} tokens, ${growthLabel(topName)}, ${DIRECTION_LABEL[topName.direction]}.` : "No repeated name concept in this window."} href={topName ? `/trends/${topName.slug}` : "/trends"} />
              <Answer title="What tickers are showing up?" body={topTicker ? `${topTicker.name}: ${topTicker.count} tickers. ${topTicker.narrative}` : "No repeated ticker pattern in this window."} href={topTicker ? `/trends/${topTicker.slug}` : "/trends"} />
              <Answer title="What is just starting?" body={emerging ? `${emerging.name}: ${emerging.count} launches after ${emerging.previousCount} in the previous day. Early score ${emerging.earlyScore}/100.` : "No new name cleared the emerging bar (2–12 launches, almost none in the previous 24 hours)."} href={emerging ? `/trends/${emerging.slug}` : "/trends"} />
              <Answer title="Why, and is it early or crowded?" body={topName ? `${topName.origin.summary} Status: ${topName.lifecycle}.` : "Origin currently unknown."} href={topName ? `/trends/${topName.slug}` : "/trends"} />
            </section>
            <Section title="Current hot trends">
              <div className="grid gap-3 md:grid-cols-2">{intel.hot.length ? intel.hot.map((trend) => <TrendCard key={trend.id} trend={trend} />) : <p className="text-sm text-muted-foreground">No trend is hot in this window.</p>}</div>
            </Section>
            <Section title="Emerging narratives">
              <p className="text-sm text-muted-foreground">Last 20 minutes compared with the 24 hours before that. This section does not wait for a name to become popular.</p>
              <div className="grid gap-3 md:grid-cols-2">{intel.emerging.length ? intel.emerging.map((trend) => <TrendCard key={trend.id} trend={trend} />) : <p className="text-sm text-muted-foreground">No emerging narrative in the latest 20 minutes.</p>}</div>
            </Section>
          </>
        ) : null}
      </DataGate>
    </PageFrame>
  )
}

function Answer({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <Link href={href} className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 hover:ring-foreground/25">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
    </Link>
  )
}
