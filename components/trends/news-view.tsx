"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { buildIntelligence } from "@/lib/narrative/engine"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { DataGate, PageFrame, WindowPicker, money } from "@/components/trends/widgets"

export function NewsView() {
  const { snapshot, error, loading } = useSnapshot()
  const [windowId, setWindowId] = useState("24h")
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, windowId) : null), [snapshot, windowId])
  return (
    <PageFrame eyebrow="News intelligence" title="News → tokens" lede="See when a headline is followed by new WETH launches that share its name. A match is timing plus a shared name, not proof the headline caused the token.">
      <WindowPicker value={windowId} onChange={setWindowId} />
      <DataGate loading={loading} error={error} ready={Boolean(intel)}>
        {intel && snapshot ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">{snapshot.news?.length ?? 0} headlines checked at {formatCreated(snapshot.generatedAt, "local")}. Reddit discussion scoring is {intel.discussionAvailable ? "available" : "unavailable for this publish"}.</p>
            {intel.newsLinks.length === 0 ? <p className="rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">{snapshot.news?.length ?? 0} headlines were checked. None was followed by a token whose name matched the story.</p> : intel.newsLinks.map((link) => (
              <article key={link.news.id} className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                <p className="text-xs text-muted-foreground">{formatCreated(link.news.publishedAt, "local")} · {link.news.source}</p>
                <a href={link.news.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{link.news.title}</a>
                <p className="text-sm text-muted-foreground">
                  {link.minutesToFirst === null ? "Timing unavailable." : `First matching token ${link.minutesToFirst} minutes later.`} {link.tokens.length} tokens · {link.deployers} deployers on record · liquidity {money(link.liquidity)} · 24h volume {money(link.volume24h)}.
                </p>
                <p className="text-sm">{link.origin.label}. {link.origin.summary}</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {link.tokens.slice(0, 8).map((token) => (
                    <li key={token.tokenAddress}>
                      <span className="text-muted-foreground">{formatCreated(token.createdAt, "local")} — </span>
                      <Link href={`/tokens/${token.tokenAddress}`} className="hover:underline">{token.symbol} · {token.tokenName}</Link>
                    </li>
                  ))}
                </ul>
                {link.best ? <p className="text-xs text-muted-foreground">Highest market cap in this set: {link.best.symbol}.</p> : null}
              </article>
            ))}
          </div>
        ) : null}
      </DataGate>
    </PageFrame>
  )
}
