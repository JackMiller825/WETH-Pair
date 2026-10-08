"use client"

import { useMemo } from "react"
import Link from "next/link"
import { buildIntelligence, explainToken } from "@/lib/narrative/engine"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { DataGate, PageFrame, Section, money } from "@/components/trends/widgets"

export function TokenDetail({ address }: { address: string }) {
  const { snapshot, error, loading } = useSnapshot()
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, "7d") : null), [snapshot])
  const token = intel?.tokens.find((item) => item.tokenAddress === address.toLowerCase())
  const explained = useMemo(() => (token && intel ? explainToken(token, intel.tokens, snapshot?.news ?? []) : null), [token, intel, snapshot])

  return (
    <PageFrame title={token ? `${token.tokenName}` : "Token"} lede="Why this name is a classification of the words that are actually in the name, ticker, description, and links. Missing fields were not in the DEXTools pair record.">
      <DataGate loading={loading} error={error} ready={Boolean(snapshot)}>
        {token && explained ? (
          <>
            <p className="text-sm text-muted-foreground">${token.symbol} · launched {formatCreated(token.createdAt, "local")}{token.tokenCreatedAt ? ` · token created ${formatCreated(token.tokenCreatedAt, "local")}` : ""}</p>
            <div className="flex flex-wrap gap-3 text-sm">
              <a href={token.url} target="_blank" rel="noreferrer" className="hover:underline">DEXTools pair</a>
              {token.website ? <a href={token.website} target="_blank" rel="noreferrer" className="hover:underline">Website</a> : <span className="text-muted-foreground">Website not listed</span>}
              {token.twitter ? <a href={token.twitter} target="_blank" rel="noreferrer" className="hover:underline">X / Twitter</a> : <span className="text-muted-foreground">X not listed</span>}
              {token.telegram ? <a href={token.telegram} target="_blank" rel="noreferrer" className="hover:underline">Telegram</a> : <span className="text-muted-foreground">Telegram not listed</span>}
            </div>
            <p className="text-sm">{token.description || "No description was published on the DEXTools token record."}</p>
            <p className="text-sm text-muted-foreground">Deployer: {token.deployer || "not in the pair record"} · Liquidity {money(token.liquidity)} · Market cap {money(token.marketCap)} · 24h volume {money(token.volume24h)} · 24h makers {token.makers24h ?? "not in the pair record"} · 24h buy swaps {token.buys24h ?? "not in the pair record"}</p>
            <Section title="Why this name?">
              {token.concepts.length === 0 ? <p className="text-sm">No lexicon entry matches this name or ticker. It is treated as an original or unrecognized concept.</p> : (
                <ul className="flex flex-col gap-2 text-sm">
                  {token.concepts.map((concept) => (
                    <li key={concept.id}>
                      <Link href={`/trends/${concept.id}`} className="font-medium hover:underline">{concept.label}</Link>
                      <span className="text-muted-foreground"> · {confidenceWord(concept.confidence)} · matched in the {concept.via} · {Math.round(concept.confidence * 100)}% name-match confidence</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm font-medium">{explained.origin.label}{explained.origin.confidence ? ` · ${explained.origin.confidence}%` : ""}</p>
              <p className="text-sm leading-6">{explained.origin.summary}</p>
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {explained.origin.evidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </Section>
            <Section title="Related news">
              {explained.origin.sources.length === 0 ? <p className="text-sm text-muted-foreground">No fetched headline matched this name.</p> : explained.origin.sources.map((item) => (
                <p key={item.id} className="text-sm"><a href={item.url} className="hover:underline" target="_blank" rel="noreferrer">{item.title}</a> <span className="text-muted-foreground">· {item.source}</span></p>
              ))}
            </Section>
            <Section title="Related tokens">
              {explained.related.length === 0 ? <p className="text-sm text-muted-foreground">No other token in this list shares these matches.</p> : (
                <ul className="flex flex-col gap-1 text-sm">
                  {explained.related.map((item) => (
                    <li key={item.tokenAddress}><Link href={`/tokens/${item.tokenAddress}`} className="hover:underline">{item.symbol} · {item.tokenName}</Link></li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        ) : <p className="text-sm text-muted-foreground">This token is not in the current published list.</p>}
      </DataGate>
    </PageFrame>
  )
}

function confidenceWord(value: number): string {
  if (value >= 0.8) return "High confidence"
  if (value >= 0.6) return "Medium confidence"
  return "Low confidence"
}
