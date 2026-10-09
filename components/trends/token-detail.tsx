"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { readChainFacts } from "@/lib/analysis/chain"
import { buildTokenReport, type ChainFacts, type TokenReport } from "@/lib/analysis/report"
import { buildIntelligence } from "@/lib/narrative/engine"
import { eventsOf } from "@/lib/lp/monitor"
import { formatCreated } from "@/lib/types"
import { useSnapshot } from "@/components/trends/use-intel"
import { ProgressMeter } from "@/components/progress/history-panel"
import { safeHttpUrl } from "@/lib/http"
import { DataGate, PageFrame, money } from "@/components/trends/widgets"

const TABS = ["Overview", "Liquidity", "Deployer", "Narrative", "News", "Related", "Timeline", "Sources", "Contract"] as const

const STEPS = [
  "Loading the published pair record",
  "Reading liquidity and the LP burn",
  "Comparing the deployer with stored launches",
  "Comparing the name with fetched headlines",
  "Reading the contract from Ethereum",
  "Building the report",
]

export function TokenDetail({ address }: { address: string }) {
  const { snapshot, error, loading, reload } = useSnapshot()
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview")
  const [chain, setChain] = useState<ChainFacts | { error: string } | null>(null)
  const [chainState, setChainState] = useState<"waiting" | "running" | "done" | "failed">("waiting")
  const [chainAt, setChainAt] = useState<string | null>(null)
  const [chainTick, setChainTick] = useState(0)
  const intel = useMemo(() => (snapshot ? buildIntelligence(snapshot, "7d") : null), [snapshot])
  const token = intel?.tokens.find((item) => item.tokenAddress === address.toLowerCase())
  const report = useMemo(() => {
    if (!snapshot || !token || !intel) return null
    return buildTokenReport({
      token,
      rows: snapshot.rows,
      burns: eventsOf(snapshot),
      news: snapshot.news ?? [],
      tokens: intel.tokens,
      chain,
    })
  }, [snapshot, token, intel, chain])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setChainState("running")
    readChainFacts(token.tokenAddress)
      .then((facts) => {
        if (cancelled) return
        setChain(facts)
        setChainState("done")
        setChainAt(new Date().toISOString())
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setChain({ error: caught instanceof Error ? caught.message : "Ethereum read failed" })
        setChainState("failed")
      })
    return () => {
      cancelled = true
    }
  }, [token?.tokenAddress, chainTick])

  const chainSettled = chainState === "done" || chainState === "failed"
  const step = !report ? 1 : chainSettled ? 6 : 5

  return (
    <PageFrame eyebrow="Full analysis" title={token ? `${token.tokenName} · $${token.symbol}` : "Token"} lede="This report uses the published pair list, fetched headlines, and a live Ethereum read. Missing holder, tax, and social figures stay missing. The scorecard is not investment advice.">
      <DataGate loading={loading} error={error} ready={Boolean(snapshot)}>
        <ProgressMeter label="Full analysis" value={report ? (chainSettled ? 100 : 70) : null} detail={chainState === "running" ? "Reading the contract from Ethereum. Published pair, liquidity, deployer, and headline sections are already available." : chainState === "failed" ? "The contract read failed. The published-record sections are still shown." : report ? "Published record and contract read are in the report." : "Loading the published pair record."} />
        <Progress step={step} chainState={chainState} />
        {token && report && snapshot ? (
          <>
            <div className="flex flex-wrap gap-2">
              {TABS.map((item) => (
                <button key={item} type="button" onClick={() => setTab(item)} className={`rounded-md px-2.5 py-1 text-xs ${tab === item ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground ring-1 ring-foreground/10"}`}>{item}</button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Snapshot {formatCreated(snapshot.generatedAt, "local")} · Contract read {chainAt ? formatCreated(chainAt, "local") : chainState}</p>
            <div className="flex flex-wrap gap-3 text-sm">
              <button type="button" className="text-primary" onClick={() => { setChain(null); setChainState("waiting"); setChainTick((value) => value + 1); reload() }}>Refresh analysis</button>
              <button type="button" className="text-primary" onClick={() => reload()}>Reload published news</button>
            </div>
            {tab === "Overview" ? <Overview report={report} /> : null}
            {tab === "Liquidity" ? <Liquidity report={report} /> : null}
            {tab === "Deployer" ? <Deployer report={report} /> : null}
            {tab === "Narrative" ? <Narrative report={report} /> : null}
            {tab === "News" ? <News report={report} /> : null}
            {tab === "Related" ? <Related report={report} /> : null}
            {tab === "Timeline" ? <Timeline report={report} /> : null}
            {tab === "Sources" ? <Sources report={report} /> : null}
            {tab === "Contract" ? <Contract report={report} chainState={chainState} /> : null}
          </>
        ) : <p className="text-sm text-muted-foreground">This token is not in the current published list. Full analysis does not invent a record for an unknown address.</p>}
      </DataGate>
    </PageFrame>
  )
}

function Progress({ step, chainState }: { step: number; chainState: string }) {
  const settled = chainState === "done" || chainState === "failed"
  return (
    <div className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10" aria-live="polite">
      <p className="font-medium">Step {Math.min(step, STEPS.length)} / {STEPS.length}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {STEPS.map((label, index) => {
          const complete = index < step - 1 || (settled && index >= 4)
          const running = !complete && index === step - 1
          return (
            <li key={label} className={complete ? "text-foreground" : "text-muted-foreground"}>
              {complete ? "Complete" : running ? "Running" : "Waiting"} — {label}
              {index === 4 && chainState === "failed" ? " · failed, the rest of the report is still shown" : ""}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Overview({ report }: { report: TokenReport }) {
  const token = report.token
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>Pair created {formatCreated(token.createdAt, "local")} · Liquidity {money(token.liquidity)} · Market cap {money(token.marketCap)}</p>
      <p>24h volume {money(token.volume24h)} · 24h makers {token.makers24h ?? "not in the pair record"} · 24h buy swaps {token.buys24h ?? "not in the pair record"}</p>
      <p className="break-all">Contract {token.tokenAddress}</p>
      <p className="break-all">Pair {token.address}</p>
      <div className="flex flex-wrap gap-3">
        <a href={token.url} target="_blank" rel="noreferrer" className="hover:underline">DEXTools</a>
        <a href={`https://etherscan.io/token/${token.tokenAddress}`} target="_blank" rel="noreferrer" className="hover:underline">Etherscan</a>
        {safeHttpUrl(token.website) ? <a href={safeHttpUrl(token.website)!} target="_blank" rel="noreferrer" className="hover:underline">Website</a> : <span className="text-muted-foreground">Website not listed</span>}
        {safeHttpUrl(token.twitter) ? <a href={safeHttpUrl(token.twitter)!} target="_blank" rel="noreferrer" className="hover:underline">X</a> : <span className="text-muted-foreground">X not listed</span>}
        {safeHttpUrl(token.telegram) ? <a href={safeHttpUrl(token.telegram)!} target="_blank" rel="noreferrer" className="hover:underline">Telegram</a> : <span className="text-muted-foreground">Telegram not listed</span>}
      </div>
      <h2 className="text-lg font-semibold">Primary findings</h2>
      <ul className="list-disc pl-5">
        {report.facts.filter((item) => item.label.startsWith("LP")).map((item) => <li key={item.label}>{item.label}: {item.value}</li>)}
        {report.interpretation.map((item) => <li key={item.label}>{item.value}{item.confidence ? ` Confidence ${item.confidence}%.` : ""}</li>)}
        <li>Deployer launches in this 7-day list, excluding this token: {report.deployerTokens.length}.</li>
      </ul>
      {report.scorecard.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold">Scorecard</h2>
          <ul className="mt-1 flex flex-col gap-1">
            {report.scorecard.map((item) => <li key={item.name}>{item.name} {item.score}/100 — {item.reason}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function Liquidity({ report }: { report: TokenReport }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {report.facts.filter((item) => item.label.startsWith("LP") || item.label === "Pair created").map((item) => <p key={item.label}>{item.label}: {item.value} <span className="text-muted-foreground">· {item.source}</span></p>)}
      {report.calculated.map((item) => <p key={item.label}>{item.label}: {item.value}</p>)}
      <p className="text-muted-foreground">{report.liquidityNote}</p>
      <p className="text-muted-foreground">Initial liquidity additions, lock providers, and removal history are not reconstructed beyond the recorded burn.</p>
    </div>
  )
}

function Deployer({ report }: { report: TokenReport }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="break-all">Deployer {report.deployerAddress || "Not in the pair record"}</p>
      <p>Other WETH pairs from this deployer in the stored 7-day list: {report.deployerTokens.length}. This is not a lifetime count.</p>
      {report.deployerTokens.length === 0 ? <p className="text-muted-foreground">No other stored pair uses this deployer.</p> : (
        <ul>
          {report.deployerTokens.map((item) => (
            <li key={item.tokenAddress}><Link href={`/tokens/${item.tokenAddress}`} className="hover:underline">{item.symbol} · {item.tokenName}</Link> · {formatCreated(item.createdAt, "local")} · LP {item.lpStatus}</li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground">Funding wallets and exchange transfers are not traced. A shared deployer is a recorded fact. It is not labeled as a confirmed cluster of other wallets.</p>
    </div>
  )
}

function Narrative({ report }: { report: TokenReport }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>{report.token.description || "No description was published on the pair record."}</p>
      {report.token.concepts.length === 0 ? <p>No lexicon entry matches this name. The narrative origin stays unknown.</p> : report.token.concepts.map((concept) => (
        <p key={concept.id}><Link href={`/trends/${concept.id}`} className="hover:underline">{concept.label}</Link> · matched in the {concept.via} · {concept.generic ? "generic word, low weight" : "specific entity"}</p>
      ))}
      {report.interpretation.map((item) => <p key={item.label}>{item.label}: {item.value}</p>)}
    </div>
  )
}

function News({ report }: { report: TokenReport }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {report.news.length === 0 ? <p>No fetched headline is a reliable origin for this launch.</p> : report.news.map((link) => (
        <p key={`${link.token.tokenAddress}-${link.score}`}>{link.level} · {link.score}/100 · {link.reasons.join(" ")}</p>
      ))}
      {report.rejectedNews.map((link) => <p key={link.reasons[0]} className="text-muted-foreground">{link.reasons[0]}</p>)}
    </div>
  )
}

function Related({ report }: { report: TokenReport }) {
  return report.related.length === 0
    ? <p className="text-sm text-muted-foreground">No other stored token shares a specific entity with this name.</p>
    : <ul className="flex flex-col gap-1 text-sm">{report.related.map((item) => <li key={item.tokenAddress}><Link href={`/tokens/${item.tokenAddress}`} className="hover:underline">{item.symbol} · {item.tokenName}</Link> · {item.reason}</li>)}</ul>
}

function Timeline({ report }: { report: TokenReport }) {
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {report.timeline.map((item) => <li key={`${item.at}-${item.label}`}>{formatCreated(item.at, "local")} — {item.label} <span className="text-muted-foreground">· {item.kind} · {item.source}</span></li>)}
    </ol>
  )
}

function Sources({ report }: { report: TokenReport }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>Facts, calculations, and interpretation are listed separately above. An interpretation does not upgrade a missing field into a fact.</p>
      {report.unavailable.map((item) => <p key={item} className="text-muted-foreground">{item}</p>)}
      {report.failed.map((item) => <p key={item}>{item}</p>)}
    </div>
  )
}

function Contract({ report, chainState }: { report: TokenReport; chainState: string }) {
  const chain = report.chain
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>Verified source: not available from this host. Etherscan source is not fetched, so taxes, mint paths, and admin control flow are not claimed.</p>
      <p>Contract read: {chainState}</p>
      {chain ? (
        <>
          <p>Bytecode size: {chain.bytecodeBytes == null ? "not returned" : `${chain.bytecodeBytes} bytes`}</p>
          <p>decimals(): {chain.decimals ?? "call returned nothing"}</p>
          <p className="break-all">totalSupply(): {chain.totalSupply ?? "call returned nothing"}</p>
          <p className="break-all">owner(): {chain.owner ?? "call returned nothing. That does not prove the contract has no admin."}</p>
          {chain.owner && /^0x0{40}$/.test(chain.owner) ? <p>owner() returned the zero address. That can mean ownership was renounced, and only for a contract that implements owner().</p> : null}
        </>
      ) : <p className="text-muted-foreground">{report.failed[0] ?? "The Ethereum read has not finished."}</p>}
    </div>
  )
}
