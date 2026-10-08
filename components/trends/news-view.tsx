"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { buildIntelligence } from "@/lib/narrative/engine"
import { analyzeEvents, eventInWindow, type EventAnalysis } from "@/lib/narrative/events"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { DataGate, PageFrame, WindowPicker, money } from "@/components/trends/widgets"

export function NewsView() {
  const { snapshot, error, loading } = useSnapshot()
  const [windowId, setWindowId] = useState("24h")
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, "7d") : null), [snapshot])
  const board = useMemo(() => {
    if (!snapshot || !intel) return []
    const now = Date.parse(snapshot.generatedAt)
    return analyzeEvents(snapshot.news ?? [], intel.tokens).filter((item) => eventInWindow(item, windowId, now))
  }, [snapshot, intel, windowId])
  const notable = board.filter((item) => item.event.specificIds.length > 0 && (item.causedBy.some((link) => rank(link.level) >= 2) || item.afterLaunch.length > 0))
  const genericOnly = board.filter((item) => !notable.includes(item))
  const strong = notable.filter((item) => item.causedBy.some((link) => rank(link.level) >= 3))
  const related = board.reduce((sum, item) => sum + item.causedBy.length, 0)
  const waves = board.filter((item) => item.wave.active)

  return (
    <PageFrame
      eyebrow="News → token intelligence"
      title="News → tokens"
      lede="Headlines are grouped into one event, then compared with WETH launches. A shared generic word is not treated as proof. A token launched before the headline is not given that headline as its origin."
      updated={snapshot ? `News feed updated ${formatCreated(snapshot.generatedAt, "local")}` : undefined}
    >
      <WindowPicker value={windowId} onChange={setWindowId} />
      <DataGate loading={loading} error={error} ready={Boolean(intel)}>
        {intel && snapshot ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Events in this range" value={String(board.length)} />
              <Stat label="Strong correlations" value={String(strong.length)} />
              <Stat label="Related token links" value={String(related)} />
              <Stat label="Launch waves" value={String(waves.length)} />
            </div>
            <p className="text-xs text-muted-foreground">
              {snapshot.news?.length ?? 0} articles were fetched. The same story from several publications is one event. Latest article time {latestArticle(snapshot.news ?? [])}. Matching uses the lexicon and phrase overlap. There is no separate embedding model.
            </p>
            {notable.length === 0 ? (
              <p className="rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">No event in this range has a specific match or a connection above a generic word. A shorter range only hides older events. It does not change how a match is scored.</p>
            ) : notable.map((item) => <EventCard key={item.event.id} item={item} />)}
            {genericOnly.length > 0 ? (
              <details className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
                <summary className="cursor-pointer">{genericOnly.length} generic-word overlaps are listed separately. A shared word such as Bitcoin, Ethereum, or AI is not treated as a strong connection.</summary>
                <div className="mt-3 flex flex-col gap-3">
                  {genericOnly.map((item) => <EventCard key={item.event.id} item={item} />)}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </DataGate>
    </PageFrame>
  )
}

function EventCard({ item }: { item: EventAnalysis }) {
  const first = item.causedBy[0]
  const best = [...item.causedBy].sort((a, b) => b.score - a.score)[0]
  return (
    <article className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{item.wave.active ? "Launch wave" : "Event"}</span>
        <span>{formatCreated(item.event.publishedAt, "local")}</span>
        <span>{item.event.sources.length} source{item.event.sources.length === 1 ? "" : "s"}</span>
      </div>
      <h2 className="text-lg font-semibold">{item.event.title}</h2>
      <p className="text-sm text-muted-foreground">{item.event.entities.join(" · ") || "No named entity in the lexicon"}</p>
      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <p>Related launches {item.causedBy.length}</p>
        <p>{first?.minutesAfter == null ? "No launch after the event" : `First token ${first.minutesAfter}m after news`}</p>
        <p>{best ? `News score ${best.score}/100 · ${best.level}` : "No reliable connection"}</p>
        <p>Liquidity {money(item.liquidity)}</p>
      </div>
      {item.wave.active ? <p className="text-sm">{item.wave.note}</p> : null}
      {item.afterLaunch.length > 0 ? <p className="text-sm text-muted-foreground">{item.afterLaunch.length} earlier {item.afterLaunch.length === 1 ? "token shares" : "tokens share"} an entity. Those launches came before this event, so the event is not their origin.</p> : null}
      <Link href={`/news-events/?id=${item.event.id}`} className="text-sm text-primary">View event analysis</Link>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  )
}

function latestArticle(news: { publishedAt: string }[]): string {
  const latest = news.map((item) => Date.parse(item.publishedAt)).filter(Number.isFinite).sort((a, b) => b - a)[0]
  return latest ? formatCreated(new Date(latest).toISOString(), "local") : "not available"
}

function rank(level: string): number {
  if (level === "Confirmed") return 5
  if (level === "Highly Likely") return 4
  if (level === "Likely") return 3
  if (level === "Possible") return 2
  if (level === "Weak Connection") return 1
  return 0
}
