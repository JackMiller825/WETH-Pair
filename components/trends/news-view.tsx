"use client"

import Link from "next/link"
import { useMemo } from "react"
import { buildIntelligence } from "@/lib/narrative/engine"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { DataGate, PageFrame, money } from "@/components/trends/widgets"

export function NewsView() {
  const { snapshot, error, loading } = useSnapshot()
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, "24h") : null), [snapshot])
  return (
    <PageFrame title="News → token launches" lede="Headlines are collected from CoinDesk, Cointelegraph, The Block, and two Reddit feeds when the site is published. A token is listed only if it launched after the headline and shares a name. That is a timing correlation, not proof the headline caused the token.">
      <DataGate loading={loading} error={error} ready={Boolean(intel)}>
        {intel && snapshot ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">{snapshot.news?.length ?? 0} headlines checked at {formatCreated(snapshot.generatedAt, "local")}. Reddit discussion scoring is {intel.discussionAvailable ? "available" : "unavailable for this publish"}.</p>
            {intel.newsLinks.length === 0 ? <p className="text-sm text-muted-foreground">No headline was followed by a matching token launch.</p> : intel.newsLinks.map((link) => (
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
