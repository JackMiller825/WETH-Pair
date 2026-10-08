"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { buildIntelligence } from "@/lib/narrative/engine"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { DataGate, PageFrame } from "@/components/trends/widgets"

export function TokensView() {
  const { snapshot, error, loading } = useSnapshot()
  const [query, setQuery] = useState("")
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, "7d") : null), [snapshot])
  const tokens = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = intel?.tokens ?? []
    if (!needle) return rows.slice(0, 50)
    return rows.filter((token) => `${token.symbol} ${token.tokenName} ${token.concepts.map((concept) => concept.label).join(" ")}`.toLowerCase().includes(needle)).slice(0, 50)
  }, [intel, query])

  return (
    <PageFrame title="Token explorer" lede="Search the published WETH launches by name, ticker, or matched concept. Open a token for the name investigation.">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ticker, or concept" className="h-9 max-w-md rounded-lg border border-input bg-transparent px-3 text-sm" />
      <DataGate loading={loading} error={error} ready={Boolean(intel)}>
        <ul className="flex flex-col text-sm">
          {tokens.map((token) => (
            <li key={token.tokenAddress} className="flex flex-col gap-1 border-t border-foreground/10 py-3">
              <Link href={`/tokens/${token.tokenAddress}`} className="font-medium hover:underline">{token.symbol} · {token.tokenName}</Link>
              <p className="text-xs text-muted-foreground">{formatCreated(token.createdAt, "local")} · {token.concepts.map((concept) => concept.label).join(", ") || "No lexicon match"}</p>
            </li>
          ))}
        </ul>
      </DataGate>
    </PageFrame>
  )
}
