"use client"

import { useMemo, useState } from "react"
import { buildIntelligence } from "@/lib/narrative/engine"
import type { WindowId } from "@/lib/narrative/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { DataGate, PageFrame, TrendTable, WindowPicker } from "@/components/trends/widgets"

export function NarrativesView() {
  const { snapshot, error, loading } = useSnapshot()
  const [windowId, setWindowId] = useState<WindowId>("6h")
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, windowId) : null), [snapshot, windowId])
  return (
    <PageFrame title="Narrative clusters" lede="Tokens that share the same specific name matches are grouped together. A cluster means the names overlap. It does not mean the deployers coordinated.">
      <WindowPicker value={windowId} onChange={setWindowId} />
      <DataGate loading={loading} error={error} ready={Boolean(intel)}>
        {intel ? <TrendTable trends={intel.clusters} /> : null}
      </DataGate>
    </PageFrame>
  )
}
