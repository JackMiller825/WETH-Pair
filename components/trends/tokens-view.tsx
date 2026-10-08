"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { buildIntelligence } from "@/lib/narrative/engine"
import { formatUsd } from "@/lib/format"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { DataGate, PageFrame } from "@/components/trends/widgets"
import type { TokenAnalysis } from "@/lib/narrative/types"

export function TokensView() {
  const { snapshot, error, loading } = useSnapshot()
  const [query, setQuery] = useState("")
  const [preview, setPreview] = useState<TokenAnalysis | null>(null)
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, "7d") : null), [snapshot])
  const tokens = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = intel?.tokens ?? []
    if (!needle) return rows.slice(0, 50)
    return rows.filter((token) => `${token.symbol} ${token.tokenName} ${token.tokenAddress} ${token.deployer ?? ""} ${token.concepts.map((concept) => concept.label).join(" ")}`.toLowerCase().includes(needle)).slice(0, 50)
  }, [intel, query])

  return (
    <PageFrame eyebrow="Token intelligence" title="Token explorer" lede="Search and investigate any discovered token, contract, deployer, or WETH pair.">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ticker, contract, or concept" className="h-9 w-full max-w-xl rounded-lg border border-input bg-card px-3 text-sm" />
      <DataGate loading={loading} error={error} ready={Boolean(intel)}>
        <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr>{["Token", "Launched", "Liquidity", "Market cap", "Narrative", ""].map((label) => <th key={label || "open"} className="px-3 py-2 font-medium">{label}</th>)}</tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.tokenAddress} className="border-t border-foreground/10 hover:bg-muted/50">
                  <td className="px-3 py-2"><button type="button" className="text-left hover:underline" onClick={() => setPreview(token)}>{token.symbol} · {token.tokenName}</button></td>
                  <td className="px-3 py-2">{formatCreated(token.createdAt, "local")}</td>
                  <td className="px-3 py-2">{formatUsd(token.liquidity)}</td>
                  <td className="px-3 py-2">{formatUsd(token.marketCap)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{token.concepts.map((concept) => concept.label).join(", ") || "No lexicon match"}</td>
                  <td className="px-3 py-2"><button type="button" className="text-primary" onClick={() => setPreview(token)}>Quick view</button> <Link href={`/tokens/${token.tokenAddress}`} className="text-primary">Full analysis</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Showing {tokens.length} of {intel?.tokens.length ?? 0}. The list stops at 50 so the page stays quick.</p>
      </DataGate>
      {preview ? (
        <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col gap-3 overflow-auto border-l border-foreground/10 bg-popover p-5" role="dialog" aria-label={`${preview.symbol} preview`}>
          <button type="button" className="self-end text-xs text-muted-foreground" onClick={() => setPreview(null)}>Close</button>
          <h2 className="text-xl font-semibold">{preview.symbol} / WETH</h2>
          <p className="text-sm text-muted-foreground">{preview.tokenName}</p>
          <p className="text-sm">Launched {formatCreated(preview.createdAt, "local")}</p>
          <p className="text-sm">Liquidity {formatUsd(preview.liquidity)}</p>
          <p className="text-sm">Market cap {formatUsd(preview.marketCap)}</p>
          <p className="text-sm">Narrative {preview.concepts.map((concept) => concept.label).join(" + ") || "No lexicon match"}</p>
          <p className="text-sm break-all">Creator {preview.deployer || "not in the pair record"}</p>
          <Link href={`/tokens/${preview.tokenAddress}`} className="text-sm text-primary">Full analysis</Link>
          <a href={preview.url} target="_blank" rel="noreferrer" className="text-sm text-primary">DEXTools</a>
          <a href={`https://etherscan.io/token/${preview.tokenAddress}`} target="_blank" rel="noreferrer" className="text-sm text-primary">Etherscan</a>
        </aside>
      ) : null}
    </PageFrame>
  )
}
