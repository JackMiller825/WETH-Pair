"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { buildIntelligence } from "@/lib/narrative/engine"
import { analyzeEvents } from "@/lib/narrative/events"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { DataGate, PageFrame, money } from "@/components/trends/widgets"

export function NewsEventView() {
  const { snapshot, error, loading } = useSnapshot()
  const [eventId, setEventId] = useState<string | null>(null)
  useEffect(() => {
    setEventId(new URLSearchParams(window.location.search).get("id"))
  }, [])
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, "7d") : null), [snapshot])
  const analysis = useMemo(() => {
    if (!snapshot || !intel || !eventId) return null
    return analyzeEvents(snapshot.news ?? [], intel.tokens).find((item) => item.event.id === eventId) ?? null
  }, [snapshot, intel, eventId])

  return (
    <PageFrame eyebrow="Event analysis" title={analysis?.event.title ?? "News event"} lede="One event can contain several articles. Token links are scored separately, and a launch that happened first is not explained by a later headline.">
      <DataGate loading={loading} error={error} ready={Boolean(snapshot)}>
        {!eventId ? <p className="text-sm text-muted-foreground">Open an event from News → Tokens.</p> : null}
        {eventId && !analysis ? <p className="text-sm text-muted-foreground">This event is not in the current published headlines.</p> : null}
        {analysis ? (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">Published {formatCreated(analysis.event.publishedAt, "local")}</p>
              <p className="text-sm">{analysis.event.summary}</p>
              <p className="text-sm">Entities: {analysis.event.entities.join(", ") || "none matched the lexicon"}</p>
              <p className="text-sm">People: {analysis.event.people.join(", ") || "none"} · Organizations: {analysis.event.organizations.join(", ") || "none"} · Products: {analysis.event.products.join(", ") || "none"}</p>
              <ul className="flex flex-col gap-1 text-sm">
                {analysis.event.sources.map((source) => (
                  <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer" className="hover:underline">{source.title}</a> <span className="text-muted-foreground">· {source.source} · {formatCreated(source.publishedAt, "local")}</span></li>
                ))}
              </ul>
            </section>
            <section className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p>Related launches {analysis.causedBy.length}</p>
              <p>First 5 minutes {countWithin(analysis, 5)}</p>
              <p>First 15 minutes {countWithin(analysis, 15)}</p>
              <p>First hour {countWithin(analysis, 60)}</p>
              <p>{analysis.causedBy.some((link) => link.token.deployer) ? `Unique deployers ${analysis.deployers}` : "Deployer addresses are not in these pair records"}</p>
              <p>Combined liquidity {money(analysis.liquidity)}</p>
              <p>Combined 24h volume {money(analysis.volume24h)}</p>
              <p>{analysis.wave.active ? analysis.wave.note : analysis.wave.note}</p>
            </section>
            <section>
              <h2 className="text-xl font-semibold">Timeline</h2>
              <ol className="mt-2 flex flex-col gap-2 text-sm">
                <li>{formatCreated(analysis.event.publishedAt, "local")} — News published</li>
                {analysis.causedBy.map((link) => (
                  <li key={link.token.tokenAddress}>{formatCreated(link.token.createdAt, "local")} — {link.token.symbol} · {link.level} · score {link.score}/100</li>
                ))}
              </ol>
            </section>
            <section className="overflow-x-auto">
              <h2 className="mb-2 text-xl font-semibold">Related tokens</h2>
              {analysis.causedBy.length === 0 ? <p className="text-sm text-muted-foreground">No token launched after this event with a reliable connection.</p> : (
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>{["Token", "Launched", "Score", "Level", "Evidence"].map((label) => <th key={label} className="px-2 py-2 font-medium">{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {analysis.causedBy.map((link) => (
                      <tr key={link.token.tokenAddress} className="border-t border-foreground/10 align-top">
                        <td className="px-2 py-2"><Link href={`/tokens/${link.token.tokenAddress}`} className="hover:underline">{link.token.symbol}</Link></td>
                        <td className="px-2 py-2">{link.minutesAfter == null ? "—" : `${link.minutesAfter}m later`}</td>
                        <td className="px-2 py-2">{link.score}/100</td>
                        <td className="px-2 py-2">{link.level}</td>
                        <td className="px-2 py-2 text-muted-foreground">{link.reasons.join(" ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            {analysis.afterLaunch.length > 0 ? (
              <section>
                <h2 className="text-xl font-semibold">Launched before this event</h2>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {analysis.afterLaunch.map((link) => (
                    <li key={link.token.tokenAddress}>{link.token.symbol} · {formatCreated(link.token.createdAt, "local")} · {link.reasons[0]}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </DataGate>
    </PageFrame>
  )
}

function countWithin(item: { causedBy: { minutesAfter: number | null }[] }, minutes: number): number {
  return item.causedBy.filter((link) => link.minutesAfter != null && link.minutesAfter <= minutes).length
}
