"use client"

import { useMemo, useState } from "react"
import { buildIntelligence } from "@/lib/narrative/engine"
import { conceptById } from "@/lib/narrative/lexicon"
import type { Trend } from "@/lib/narrative/types"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { DataGate, PageFrame, Section, TrendTable, WindowPicker } from "@/components/trends/widgets"

const ANCHORS = [
  ["hot", "Hot"],
  ["emerging", "Emerging"],
  ["names", "Names"],
  ["tickers", "Tickers"],
  ["words", "Words"],
  ["combinations", "Combinations"],
  ["families", "Derivatives"],
  ["people", "People"],
  ["memes", "Memes"],
  ["ai", "AI"],
  ["news", "News-driven"],
  ["cooling", "Cooling"],
]

export function TrendsView() {
  const { snapshot, error, loading } = useSnapshot()
  const [windowId, setWindowId] = useState("1h")
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, windowId) : null), [snapshot, windowId])

  return (
    <PageFrame eyebrow="Trend intelligence" title="What is being named right now?" lede="Discover names, tickers, and narratives that are appearing across newly launched WETH pairs.">
      <WindowPicker value={windowId} onChange={setWindowId} />
      <DataGate loading={loading} error={error} ready={Boolean(intel)}>
        {intel && snapshot ? (
          <>
            <p className="text-xs text-muted-foreground">As of {formatCreated(snapshot.generatedAt, "local")}. {intel.total} tokens in this window, {intel.previousTotal} in the previous one.</p>
            <nav className="flex flex-wrap gap-2 text-xs">
              {ANCHORS.map(([id, label]) => (
                <a key={id} href={`#${id}`} className="rounded-full bg-muted px-3 py-1 text-muted-foreground">{label}</a>
              ))}
            </nav>
            <Section id="hot" title="Current hot trends"><TrendTable trends={intel.hot} analyzed={intel.total} /></Section>
            <Section id="emerging" title="Emerging narratives">
              <p className="text-sm text-muted-foreground">Detected from the last 20 minutes against the previous 24 hours, independent of the filter above.</p>
              <TrendTable trends={intel.emerging} analyzed={intel.total} />
            </Section>
            <Section id="names" title="Trending names"><TrendTable trends={intel.concepts.filter((trend) => trend.count >= 2)} /></Section>
            <Section id="tickers" title="Trending tickers"><TrendTable trends={intel.tickers} /></Section>
            <Section id="words" title="Trending words"><TrendTable trends={intel.words} /></Section>
            <Section id="combinations" title="Trending combinations"><TrendTable trends={intel.combinations} /></Section>
            <Section id="families" title="Possible naming derivatives"><TrendTable trends={intel.families} /></Section>
            <Section id="people" title="Celebrity narratives"><TrendTable trends={byGroup(intel.concepts, "person")} /></Section>
            <Section id="memes" title="Meme narratives"><TrendTable trends={byGroup(intel.concepts, "meme")} /></Section>
            <Section id="ai" title="AI narratives"><TrendTable trends={intel.concepts.filter((trend) => trend.count >= 2 && ["ai", "agi", "superintelligence", "robot", "openai", "xai"].includes(trend.id))} /></Section>
            <Section id="news" title="News-driven narratives"><TrendTable trends={intel.concepts.filter((trend) => trend.count >= 2 && trend.origin.label !== "Unknown")} /></Section>
            <Section id="cooling" title="Cooling trends"><TrendTable trends={intel.cooling} /></Section>
          </>
        ) : null}
      </DataGate>
    </PageFrame>
  )
}

function byGroup(trends: Trend[], group: string): Trend[] {
  return trends.filter((trend) => trend.count >= 2 && conceptById(trend.id)?.group === group)
}
