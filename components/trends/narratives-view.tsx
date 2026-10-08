"use client"

import { useMemo, useState } from "react"
import { buildIntelligence } from "@/lib/narrative/engine"
import { useSnapshot } from "@/components/trends/use-intel"
import { DataGate, PageFrame, TrendTable, WindowPicker } from "@/components/trends/widgets"

export function NarrativesView() {
  const { snapshot, error, loading } = useSnapshot()
  const [windowId, setWindowId] = useState("6h")
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, windowId) : null), [snapshot, windowId])
  return (
    <PageFrame eyebrow="Narrative intelligence" title="Shared narratives" lede="Group related token launches into shared memes, people, events, and market narratives. A cluster means the names overlap.">
      <WindowPicker value={windowId} onChange={setWindowId} />
      <DataGate loading={loading} error={error} ready={Boolean(intel)}>
        {intel ? <TrendTable trends={intel.clusters} analyzed={intel.total} /> : null}
      </DataGate>
    </PageFrame>
  )
}
