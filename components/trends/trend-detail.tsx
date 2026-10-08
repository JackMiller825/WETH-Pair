"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { buildIntelligence, findTrend, historySeries, launchBuckets } from "@/lib/narrative/engine"
import { SCORE_NOTES, TREND_SCORE_WEIGHTS, statusLabel } from "@/lib/narrative/score"
import { DIRECTION_LABEL } from "@/lib/narrative/types"
import { formatCount, formatUsd } from "@/lib/format"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { DataGate, LaunchChart, PageFrame, Section, Sparkline, Stat, WindowPicker, growthLabel, money, when } from "@/components/trends/widgets"

export function TrendDetail({ slug }: { slug: string }) {
  const { snapshot, error, loading } = useSnapshot()
  const [windowId, setWindowId] = useState("6h")
  const focused = useMemo(() => (snapshot ? buildIntelligence(snapshot, windowId) : null), [snapshot, windowId])
  const widest = useMemo(() => (snapshot ? buildIntelligence(snapshot, "7d") : null), [snapshot])
  const trend = (focused && findTrend(focused, slug)) || (widest && findTrend(widest, slug))
  const usingFallback = Boolean(focused && trend && !findTrend(focused, slug))

  return (
    <PageFrame eyebrow="Trend detail" title={trend?.name ?? "Trend"} lede="Launch counts come from pair creation times. An origin is shown only when a fetched headline shares the name.">
      <WindowPicker value={windowId} onChange={setWindowId} />
      <DataGate loading={loading} error={error} ready={Boolean(snapshot)}>
        {snapshot && trend && focused ? (
          <>
            {usingFallback ? <p className="text-sm text-muted-foreground">No launches in the last {focused.windowLabel.toLowerCase()}. Showing the 7-day view.</p> : null}
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm">{statusLabel(trend.score, trend.lifecycle)} · {DIRECTION_LABEL[trend.direction]}</p>
                <p className="text-xs text-muted-foreground">Trend score {trend.score}/100 · Early trend score {trend.earlyScore}/100</p>
              </div>
              <p className="text-xs text-muted-foreground">As of {formatCreated(snapshot.generatedAt, "local")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Launches" value={String(trend.count)} />
              <Stat label="Share of window" value={`${Math.round(trend.share * 100)}%`} />
              <Stat label="Growth vs previous window" value={growthLabel(trend)} />
              <Stat label="Launches per hour" value={trend.perHour.toFixed(2)} />
              <Stat label="First launch" value={when(trend.firstAt)} />
              <Stat label="Latest launch" value={when(trend.lastAt)} />
              <Stat label="Unique deployers" value={`${trend.deployers} of ${trend.tokensWithDeployer} with a deployer on record`} />
              <Stat label="Total liquidity" value={money(trend.liquidity)} />
              <Stat label="Combined 24h volume" value={money(trend.volume24h)} />
              <Stat label="Combined 24h makers" value={trend.makers24h === null ? "Not in the pair record" : formatCount(trend.makers24h)} />
              <Stat label="Average market cap" value={money(trend.marketCapAvg)} />
              <Stat label="Best performer" value={trend.best ? `${trend.best.symbol} · ${formatUsd(trend.best.marketCap)}` : "—"} />
            </div>
            <Section title="Why it is trending">
              <p className="text-sm leading-6">{trend.narrative}</p>
              <p className="text-sm font-medium">{trend.origin.label}{trend.origin.confidence ? ` · ${trend.origin.confidence}%` : ""}</p>
              <ul className="list-disc pl-5 text-sm leading-6 text-muted-foreground">
                {trend.origin.evidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </Section>
            <Section title="Related news">
              {trend.origin.sources.length === 0 ? <p className="text-sm text-muted-foreground">No fetched headline matched this name.</p> : (
                <ul className="flex flex-col gap-2 text-sm">
                  {trend.origin.sources.map((item) => (
                    <li key={item.id}>
                      <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">{item.title}</a>
                      <span className="text-muted-foreground"> · {item.source} · {formatCreated(item.publishedAt, "local")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Popular tickers">
              <p className="text-sm text-muted-foreground">{trend.tickers.map((item) => `${item.ticker} (${item.count})`).join(", ") || "No ticker text."}</p>
            </Section>
            <Section title="Timeline">
              <LaunchChart buckets={launchBuckets(trend.tokens, trend.tokens.reduce((min, token) => Math.min(min, Date.parse(token.createdAt)), Date.parse(snapshot.generatedAt)), Date.parse(snapshot.generatedAt) + 60_000)} />
              <Sparkline points={historySeries(snapshot.history, trend.id).map((point) => ({ at: point.at, value: point.liquidity }))} label="Liquidity of the trailing 24h cohort at each publish" />
              <Sparkline points={historySeries(snapshot.history, trend.id).map((point) => ({ at: point.at, value: point.volume }))} label="Combined 24h volume at each publish" />
              <Sparkline points={historySeries(snapshot.history, trend.id).map((point) => ({ at: point.at, value: point.makers }))} label="Combined 24h makers at each publish" />
            </Section>
            <Section title="Related tokens">
              <TokenList tokens={trend.tokens} />
            </Section>
            <Section title="How the score is calculated">
              <ul className="grid gap-2 text-sm sm:grid-cols-2">
                <li>Launch velocity {trend.parts.launchVelocity} · weight {Math.round(TREND_SCORE_WEIGHTS.launchVelocity * 100)}%</li>
                <li>News relevance {trend.parts.newsRelevance} · weight {Math.round(TREND_SCORE_WEIGHTS.newsRelevance * 100)}%</li>
                <li>Token activity {trend.parts.tokenActivity} · weight {Math.round(TREND_SCORE_WEIGHTS.tokenActivity * 100)}%</li>
                <li>Liquidity activity {trend.parts.liquidityActivity} · weight {Math.round(TREND_SCORE_WEIGHTS.liquidityActivity * 100)}%</li>
                <li>Discussion {trend.parts.discussion === null ? "not collected" : trend.parts.discussion} · weight {Math.round(TREND_SCORE_WEIGHTS.discussion * 100)}%</li>
              </ul>
              <ul className="list-disc pl-5 text-sm leading-6 text-muted-foreground">
                {SCORE_NOTES.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </Section>
          </>
        ) : <p className="text-sm text-muted-foreground">This trend is not in the current pair list.</p>}
      </DataGate>
    </PageFrame>
  )
}

function TokenList({ tokens }: { tokens: { tokenAddress: string; symbol: string; tokenName: string; createdAt: string; liquidity: number | null; marketCap: number | null }[] }) {
  const shown = [...tokens].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25)
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {shown.map((token) => (
        <li key={token.tokenAddress} className="flex flex-wrap justify-between gap-2 border-t border-foreground/10 py-2">
          <Link href={`/tokens/${token.tokenAddress}`} className="font-medium hover:underline">{token.symbol} · {token.tokenName}</Link>
          <span className="text-muted-foreground">{formatCreated(token.createdAt, "local")} · liq {money(token.liquidity)} · mcap {money(token.marketCap)}</span>
        </li>
      ))}
    </ul>
  )
}
