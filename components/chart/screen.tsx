"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLpMonitor } from "@/components/lp/monitor-context"
import { analyze, type ChartReport } from "@/lib/chart/analyze"
import { chartPath } from "@/lib/chart/path"
import { loadV2Trades } from "@/lib/chart/load"
import { classifyStructure } from "@/lib/chart/structure"
import { appendOutcome, calibration, commonMistake, drillPairs, submitReview, VERDICT_LABEL, VERDICTS, type ChartReview, type ReviewOutcome, type VerdictId } from "@/lib/chart/training"
import { pumpHub } from "@/lib/pump/client"
import type { PairRecord } from "@/lib/types"

const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const REVIEW_KEY = "weth-chart-reviews-v1"
const TOUR_KEY = "weth-chart-tour-hidden"
const STAGES = ["Structure", "Flow", "Buyers", "Liquidity", "Wallets", "Execution"] as const
const TABS = [...STAGES, "Timeline", "Training"] as const
const MARKS = [
  ["Launch", 0],
  ["+1m", 60_000],
  ["+3m", 180_000],
  ["+5m", 300_000],
  ["+10m", 600_000],
  ["+15m", 900_000],
  ["+30m", 1_800_000],
  ["+1h", 3_600_000],
  ["+3h", 10_800_000],
  ["+6h", 21_600_000],
  ["+24h", 86_400_000],
] as const

function readReviews(): ChartReview[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REVIEW_KEY) || "[]") as ChartReview[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeReviews(reviews: ChartReview[]) {
  window.localStorage.setItem(REVIEW_KEY, JSON.stringify(reviews))
}

function ageLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d`
}

function wethText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Unknown"
  return `${value >= 0 ? "" : "−"}${Math.abs(value).toFixed(2)} WETH`
}

function isV2(exchange: string): boolean {
  return !/\bv[34]\b/i.test(exchange)
}

function ChartLine({ points }: { points: { at: number; value: number }[] }) {
  if (points.length < 2) return <p className="text-sm text-muted-foreground">Not enough observations for a line.</p>
  const min = Math.min(...points.map((point) => point.value))
  const max = Math.max(...points.map((point) => point.value))
  const span = max - min || 1
  const start = points[0].at
  const width = points[points.length - 1].at - start || 1
  const d = points.map((point, index) => `${index === 0 ? "M" : "L"}${((point.at - start) / width) * 100} ${32 - ((point.value - min) / span) * 28}`).join(" ")
  return (
    <svg viewBox="0 0 100 36" className="h-40 w-full" role="img" aria-label="Price">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function ChartScreen() {
  const params = useSearchParams()
  const pair = params.get("pair")?.toLowerCase() ?? ""
  const withPair = params.get("with")?.toLowerCase() ?? ""
  const set = params.get("set") ?? ""
  const blind = params.get("blind") === "1"
  const drill = params.get("drill") === "1"
  const { snapshot } = useLpMonitor()
  const [version, setVersion] = useState(0)
  const [reviews, setReviews] = useState<ChartReview[]>([])
  const [tour, setTour] = useState(false)

  useEffect(() => {
    const hub = pumpHub()
    hub.start()
    setReviews(readReviews())
    setTour(window.localStorage.getItem(TOUR_KEY) !== "1")
    return hub.subscribe(() => setVersion(hub.version()))
  }, [])

  const rows = snapshot?.rows ?? []
  if (set) {
    const addresses = set.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)
    return <CompareSet rows={rows} addresses={addresses} version={version} />
  }
  if (!pair) return <ChartHome rows={rows} reviews={reviews} version={version} tour={tour} onHideTour={() => { window.localStorage.setItem(TOUR_KEY, "1"); setTour(false) }} />
  return (
    <main className="page-wrap flex w-full flex-col gap-4 py-4">
      {tour ? <Tour onSkip={() => setTour(false)} onHide={() => { window.localStorage.setItem(TOUR_KEY, "1"); setTour(false) }} /> : null}
      <div className={`grid gap-4 ${withPair ? "xl:grid-cols-2" : ""}`}>
        <PairStudy address={pair} rows={rows} version={version} blind={blind} drill={drill} reviews={reviews} onReviews={setReviews} />
        {withPair ? <PairStudy address={withPair} rows={rows} version={version} blind={false} drill={false} reviews={reviews} onReviews={setReviews} /> : null}
      </div>
    </main>
  )
}

function Tour({ onSkip, onHide }: { onSkip: () => void; onHide: () => void }) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-sm font-semibold">60-second analysis</h2>
      <ol className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
        <li>0–10s Read the chart structure.</li>
        <li>10–20s Check actual buy and sell flow.</li>
        <li>20–30s Check buyer participation. Unknown stays unknown.</li>
        <li>30–40s Inspect liquidity and pooled WETH.</li>
        <li>40–50s Inspect whales and the deployer.</li>
        <li>50–60s Review execution notes and make your own verdict.</li>
      </ol>
      <div className="mt-3 flex gap-3 text-sm">
        <button type="button" className="text-primary" onClick={onSkip}>Skip tutorial</button>
        <button type="button" className="text-muted-foreground" onClick={onHide}>Don&apos;t show again</button>
      </div>
    </section>
  )
}

function ChartHome({ rows, reviews, version, tour, onHideTour }: { rows: readonly PairRecord[]; reviews: ChartReview[]; version: number; tour: boolean; onHideTour: () => void }) {
  const day = new Date().toISOString().slice(0, 10)
  const drill = drillPairs(rows, day, 10)
  const band = calibration(reviews)
  const mistake = commonMistake(reviews)
  const book = pumpHub().book
  void version
  const examples = new Map<string, string[]>()
  for (const row of rows) {
    const points = book.points(row.address)
    if (points.length < 4) continue
    const pattern = classifyStructure(points.map((point) => ({ at: point.at, price: point.priceWeth })), null)
    const list = examples.get(pattern.label) ?? []
    if (list.length < 3) examples.set(pattern.label, [...list, row.address])
  }
  return (
    <main className="page-wrap flex w-full flex-col gap-5 py-6">
      {tour ? <Tour onSkip={onHideTour} onHide={onHideTour} /> : null}
      <header>
        <p className="text-[11px] font-medium tracking-[0.18em] text-primary uppercase">Chart intelligence</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Read a launch in about a minute</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Open a pair, look at structure, flow, reserves, and the gaps where wallet data is unknown, then save your own verdict. Later outcomes are appended. They do not rewrite what you wrote.</p>
      </header>
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Reviews saved here" value={String(reviews.length)} />
        <Stat label="Confidence calibration" value={band.label} />
        <Stat label="Today's drill" value={`${reviews.filter((review) => new Date(review.submittedAt).toISOString().slice(0, 10) === day).length} / 10`} />
      </section>
      {mistake ? <p className="text-sm text-muted-foreground">{mistake}</p> : null}
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="text-sm font-semibold">Daily 10 chart drill</h2>
        <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {drill.map((address, index) => {
            const row = rows.find((item) => item.address.toLowerCase() === address)
            return <li key={address}><Link className="text-primary hover:underline" href={`${chartPath(address)}&blind=1&drill=1`}>{index + 1}. {row?.symbol || address.slice(0, 10)}</Link></li>
          })}
        </ol>
        {drill.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">The published pair list is empty.</p> : null}
      </section>
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="text-sm font-semibold">Pattern library</h2>
        <p className="mt-1 text-xs text-muted-foreground">Grouped from reserve observations already stored in this browser. A label is the price-structure reading, not a forecast.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {[...examples.entries()].map(([label, addresses]) => (
            <div key={label}>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{addresses.map((address) => rows.find((row) => row.address.toLowerCase() === address)?.symbol || address.slice(0, 8)).join(" · ")}</p>
            </div>
          ))}
          {examples.size === 0 ? <p className="text-sm text-muted-foreground">No pair has four stored price observations yet. Open a V2 pair and the reserve read fills this library.</p> : null}
        </div>
      </section>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>
}

function CompareSet({ rows, addresses, version }: { rows: readonly PairRecord[]; addresses: string[]; version: number }) {
  void version
  const book = pumpHub().book
  return (
    <main className="page-wrap py-6">
      <h1 className="text-2xl font-semibold">Compare</h1>
      <p className="mt-1 text-sm text-muted-foreground">Structure and reserves from stored observations. Swap flow is unknown until you open each pair.</p>
      <div className="mt-4 overflow-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="py-2">Pair</th><th>Structure</th><th>Confidence</th><th>Reserve change</th><th>Flow</th></tr></thead>
          <tbody>
            {addresses.map((address) => {
              const row = rows.find((item) => item.address.toLowerCase() === address)
              const points = book.points(address)
              const report = row ? reportFor(row, points.map((point) => ({ at: point.at, price: point.priceWeth, reserveWeth: point.reserveWeth })), [], "none", null, Date.now()) : null
              return (
                <tr key={address} className="border-t border-foreground/10">
                  <td className="py-2"><Link href={chartPath(address)} className="text-primary hover:underline">{row?.symbol || address.slice(0, 10)}</Link></td>
                  <td>{report?.pattern.label ?? "Not in the published list"}</td>
                  <td>{report ? `${report.confidence}%` : "—"}</td>
                  <td>{report?.liquidity.change == null ? "Unknown" : `${Math.round(report.liquidity.change * 100)}%`}</td>
                  <td>Unknown until opened</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </main>
  )
}

function reportFor(row: PairRecord, samples: { at: number; price: number; reserveWeth: number | null }[], trades: { id: string; at: number; block: number; side: "buy" | "sell"; weth: number; token: number; priceWeth: number; sender: string | null; recipient: string | null; trader: string | null }[], flowRead: "decoded" | "none", cutoff: number | null, now: number): ChartReport {
  const createdAt = Date.parse(row.created_at)
  const burnAt = row.lpBurnAt ? Date.parse(row.lpBurnAt) : Number.NaN
  const showBurn = cutoff == null || (Number.isFinite(burnAt) && burnAt <= cutoff)
  return analyze({
    createdAt: Number.isFinite(createdAt) ? createdAt : now,
    now,
    cutoff,
    samples,
    trades,
    burns: showBurn && Number.isFinite(burnAt) ? [{ at: burnAt, percent: row.lpBurntPercent }] : [],
    lpStatus: showBurn ? row.lpStatus : "unknown",
    lpBurnPercent: showBurn ? row.lpBurntPercent : null,
    buys24h: row.buys24h ?? null,
    makers24h: row.makers24h ?? null,
    holders: row.holders,
    holdersObservedAt: null,
    liquidityUsd: row.liquidity,
    deployer: row.deployer ?? null,
    flowRead,
  })
}

function PairStudy({ address, rows, version, blind, drill, reviews, onReviews }: { address: string; rows: readonly PairRecord[]; version: number; blind: boolean; drill: boolean; reviews: ChartReview[]; onReviews: (reviews: ChartReview[]) => void }) {
  const row = rows.find((item) => item.address.toLowerCase() === address)
  const [trades, setTrades] = useState<Awaited<ReturnType<typeof loadV2Trades>>["trades"]>([])
  const [note, setNote] = useState("Swap flow has not been read yet.")
  const [flowRead, setFlowRead] = useState<"decoded" | "none">("none")
  const [tab, setTab] = useState<(typeof TABS)[number]>("Structure")
  const [stage, setStage] = useState<number | null>(null)
  const [cutoff, setCutoff] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [revealed, setRevealed] = useState(!blind)
  const [verdict, setVerdict] = useState<VerdictId>("insufficient")
  const [confidence, setConfidence] = useState(50)
  const [notes, setNotes] = useState("")
  const [fresh, setFresh] = useState<number | null>(null)

  const creationBlock = row?.creationBlock ?? null
  const exchange = row?.exchange ?? ""
  const token = row?.tokenAddress ?? ""
  const born = row?.created_at ?? ""
  useEffect(() => {
    if (!row || !isV2(exchange) || creationBlock == null) {
      setFlowRead("none")
      setNote(row ? "This exchange does not use the V2 swap shape, so buy and sell WETH stay unknown." : "This pair is not in the published list.")
      return
    }
    const openedAt = Date.parse(born)
    if (!Number.isFinite(openedAt)) return
    const controller = new AbortController()
    setNote("Reading V2 swaps for this pair.")
    pumpHub().startBackfill([row], openedAt)
    void loadV2Trades(address, token, creationBlock, openedAt, token.toLowerCase() > WETH, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setTrades(result.trades)
      setNote(result.note)
      setFlowRead(result.read === "decoded" ? "decoded" : "none")
      setFresh(Date.now())
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setTrades([])
      setFlowRead("none")
      setNote(error instanceof Error ? error.message : "Swap read failed")
    })
    return () => {
      controller.abort()
      pumpHub().stopBackfill()
    }
  }, [address, born, creationBlock, exchange, token])

  useEffect(() => {
    if (stage == null) return
    const timer = window.setInterval(() => {
      setStage((current) => {
        if (current == null) return current
        const next = current + 1
        if (next >= STAGES.length) return null
        setTab(STAGES[next])
        return next
      })
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [stage])

  useEffect(() => {
    if (!playing || !row) return
    const createdAt = Date.parse(row.created_at)
    const timer = window.setInterval(() => {
      setCutoff((current) => {
        const base = current ?? createdAt
        const next = base + speed * 1000
        if (next >= Date.now()) {
          setPlaying(false)
          return null
        }
        return next
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [playing, speed, row])

  const points = pumpHub().book.points(address)
  void version
  const now = Date.now()
  const report = row ? reportFor(row, points.map((point) => ({ at: point.at, price: point.priceWeth, reserveWeth: point.reserveWeth })), trades, flowRead, cutoff, now) : null
  const createdAt = row ? Date.parse(row.created_at) : now
  const visible = revealed && !blind || revealed

  function saveReview() {
    if (!report || !row) return
    const review: ChartReview = {
      id: `${row.address}:${cutoff ?? now}`,
      pair: row.address.toLowerCase(),
      submittedAt: Date.now(),
      cutoff: cutoff ?? now,
      verdict,
      confidence,
      notes,
      engineVerdict: report.verdict,
      engineConfidence: report.confidence,
      outcomes: [],
    }
    const next = submitReview(reviews, review)
    writeReviews(next)
    onReviews(next)
    setRevealed(true)
  }

  function attach(horizon: ReviewOutcome["horizon"], priceChange: number | null) {
    if (!row) return
    const id = reviews.find((review) => review.pair === row.address.toLowerCase())?.id
    if (!id) return
    const next = appendOutcome(reviews, id, { horizon, priceChange, reserveChange: report?.liquidity.change ?? null, recordedAt: Date.now() })
    writeReviews(next)
    onReviews(next)
  }

  if (!row || !report) return <p className="text-sm text-muted-foreground">This pair is not in the published seven-day list.</p>

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-[0.16em] text-primary uppercase">{row.exchange}</p>
          <h1 className="text-2xl font-semibold">{row.symbol || row.name} / WETH</h1>
          <p className="text-sm text-muted-foreground">{report.stage} · age {ageLabel(report.ageMs)} · LP {row.lpStatus}{row.lpBurntPercent ? ` ${row.lpBurntPercent}%` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={`/tokens/${row.tokenAddress}`} className="rounded-md bg-card px-2 py-1 ring-1 ring-foreground/10">Token page</Link>
          <button type="button" className="rounded-md bg-primary px-2 py-1 text-primary-foreground" onClick={() => { setStage(0); setTab("Structure") }}>Start 60s review</button>
          <Link href={`${chartPath(row.address)}&blind=1`} className="rounded-md bg-card px-2 py-1 ring-1 ring-foreground/10">Blind review</Link>
        </div>
      </header>
      <p className="text-xs text-muted-foreground">{note}{fresh ? ` · swaps read ${Math.max(0, Math.round((Date.now() - fresh) / 1000))}s ago` : ""}</p>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className={`rounded-xl bg-card p-3 ring-1 ${stage === 0 ? "ring-primary" : "ring-foreground/10"}`}>
          <ChartLine points={points.filter((point) => cutoff == null || point.at <= cutoff).map((point) => ({ at: point.at, value: point.priceWeth }))} />
          <ChartLine points={points.filter((point) => cutoff == null || point.at <= cutoff).map((point) => ({ at: point.at, value: point.reserveWeth }))} />
          <p className="text-[11px] text-muted-foreground">Top line is price in WETH. Bottom line is pooled WETH. Default overlays stay on these two series.</p>
        </div>
        <Scorecard report={report} hidden={!visible} />
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)} className={`rounded-md px-2.5 py-1 text-xs ${tab === item ? "bg-primary text-primary-foreground" : "bg-card ring-1 ring-foreground/10"}`}>{item}</button>
        ))}
      </div>
      {tab === "Structure" ? <StructurePane report={report} /> : null}
      {tab === "Flow" ? <FlowPane report={report} /> : null}
      {tab === "Buyers" ? <UnknownPane title="Buyers" reason={report.buyers.reason} extra={report.buyers.makers24h != null ? `DEXTools makers in the last 24h: ${report.buyers.makers24h}. Buys in the last 24h: ${report.buyers.buys24h ?? "unknown"}.` : "24-hour maker and buy figures stay hidden until the pair is at least a day old."} /> : null}
      {tab === "Liquidity" ? <LiquidityPane report={report} /> : null}
      {tab === "Wallets" ? <UnknownPane title="Wallets" reason={`${report.wallets.reason} Deployer address: ${report.wallets.deployer || "not in the pair record"}. Holdings are unknown.`} extra="" /> : null}
      {tab === "Execution" ? <ExecutionPane report={report} /> : null}
      {tab === "Timeline" ? <TimelinePane report={report} createdAt={createdAt} cutoff={cutoff} playing={playing} speed={speed} onCutoff={setCutoff} onPlaying={setPlaying} onSpeed={setSpeed} /> : null}
      {tab === "Training" ? (
        <TrainingPane
          report={report}
          revealed={visible}
          drill={drill}
          verdict={verdict}
          confidence={confidence}
          notes={notes}
          onVerdict={setVerdict}
          onConfidence={setConfidence}
          onNotes={setNotes}
          onSave={saveReview}
          onOutcome={attach}
        />
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <List title="Strength evidence" items={report.strengths} empty="No measured strength in the available data." />
        <List title="Early warnings" items={[...report.warnings, ...report.concerns]} empty="No measured warning in the available data." />
      </div>
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="text-sm font-semibold">What changed</h2>
        {report.changed.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No measured change across this window.</p> : <ul className="mt-2 list-disc pl-5 text-sm">{report.changed.map((item) => <li key={item}>{item}</li>)}</ul>}
      </section>
      <section className="grid gap-3 md:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold">Data quality</h2>
          <ul className="mt-2 text-sm">{report.quality.map((item) => <li key={item.label}>{item.label}: {item.state}</li>)}</ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Safety gate</h2>
          <p className="mt-1 text-xs text-muted-foreground">Kept separate from the chart score.</p>
          <ul className="mt-2 text-sm">{report.safety.map((item) => <li key={item.label}>{item.label}: {item.value}</li>)}</ul>
        </div>
      </section>
      <div className="flex gap-3 text-sm">
        <button type="button" className="text-primary" onClick={() => download(`${row.symbol || "chart"}-intelligence.json`, JSON.stringify(report, null, 2), "application/json")}>Export JSON</button>
        <button type="button" className="text-primary" onClick={() => download(`${row.symbol || "chart"}-flow.csv`, ["bucket,buyWeth,sellWeth,netWeth", ...report.flow.buckets.map((bucket) => `${bucket.start},${bucket.buyWeth},${bucket.sellWeth},${bucket.netWeth}`)].join("\n"), "text/csv")}>Export flow CSV</button>
      </div>
    </section>
  )
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function Scorecard({ report, hidden }: { report: ChartReport; hidden: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <aside className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-sm font-semibold">60-second scorecard</h2>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {report.parts.map((part) => (
          <li key={part.id}>
            <button type="button" className="flex w-full justify-between" onClick={() => setOpen(open === part.id ? null : part.id)}>
              <span>{part.label}</span>
              <span className="tabular-nums">{part.points == null ? "Unknown" : `${part.points}/${part.weight}`}</span>
            </button>
            {open === part.id ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {part.positives.map((item) => <p key={item}>+ {item}</p>)}
                {part.negatives.map((item) => <p key={item}>− {item}</p>)}
                {part.positives.length + part.negatives.length === 0 ? <p>No extra evidence for this part.</p> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm">Overall {hidden ? "hidden until you submit" : report.total == null ? "Unknown" : `${report.total}/100`}</p>
      <p className="text-sm">Confidence {report.confidence}%</p>
      <p className="mt-1 text-xs text-muted-foreground">{report.confidenceReasons.join(" ") || "Confidence uses age, samples, and whether flow was decoded."}</p>
      <p className="mt-2 text-sm font-medium">{hidden ? "Verdict hidden" : report.verdictLabel}</p>
      {!hidden ? <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">{report.evidence.map((item) => <li key={item}>{item}</li>)}</ul> : null}
    </aside>
  )
}

function StructurePane({ report }: { report: ChartReport }) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-sm font-semibold">{report.pattern.label}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Pattern confidence {Math.round(report.pattern.confidence * 100)}%.{report.pattern.confidence < 0.5 ? " A short or thin series stays low." : " This is still a description, not a forecast."}</p>
      <ul className="mt-2 list-disc pl-5 text-sm">{report.pattern.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {report.windows.map((window) => <span key={window.id} className="rounded-md bg-muted px-2 py-1">{window.label}: {window.state === "ready" ? "old enough" : "Insufficient history"}</span>)}
      </div>
    </section>
  )
}

function FlowPane({ report }: { report: ChartReport }) {
  if (!report.flow.known) return <UnknownPane title="Trade flow" reason={report.flow.reason} extra="" />
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-sm">Buys {wethText(report.flow.buyWeth)} across {report.flow.buyCount} swaps. Sells {wethText(report.flow.sellWeth)} across {report.flow.sellCount} swaps.</p>
      <p className="mt-1 text-lg font-semibold">Net {wethText(report.flow.netWeth)}</p>
      <p className="mt-2 text-sm text-muted-foreground">Median buy {wethText(report.flow.medianBuy)} · median sell {wethText(report.flow.medianSell)}</p>
      <p className="text-sm text-muted-foreground">Buy cadence {report.flow.buyerPace}. Sell cadence {report.flow.sellerPace}. Buy size {report.flow.buySizePace}. Sell size {report.flow.sellSizePace}.</p>
      <div className="mt-3 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th>Bucket</th><th>Buys</th><th>Sells</th><th>Net</th></tr></thead>
          <tbody>
            {report.flow.buckets.map((bucket) => (
              <tr key={bucket.start} className="border-t border-foreground/10">
                <td className="py-1">{new Date(bucket.start).toLocaleTimeString()}</td>
                <td>{bucket.buyWeth.toFixed(2)}</td>
                <td>{bucket.sellWeth.toFixed(2)}</td>
                <td>{(Math.abs(bucket.netWeth) < 0.005 ? 0 : bucket.netWeth).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function LiquidityPane({ report }: { report: ChartReport }) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-sm">Start pooled WETH {wethText(report.liquidity.startWeth)}. Latest {wethText(report.liquidity.endWeth)}.</p>
      <p className="mt-1 text-sm">Reserve change {report.liquidity.change == null ? "Unknown" : `${Math.round(report.liquidity.change * 100)}%`}.</p>
      <p className="mt-2 text-sm">{report.liquidity.divergence ?? "No opposite move between price and pooled WETH in this window."}</p>
      {!report.flow.known ? <p className="mt-2 text-sm text-muted-foreground">Large-trade response stays unknown until swaps are decoded.</p> : report.liquidity.impacts.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No decoded trade reached 20% of pooled WETH.</p> : <ul className="mt-2 list-disc pl-5 text-sm">{report.liquidity.impacts.map((item) => <li key={item}>{item}</li>)}</ul>}
      <p className="mt-2 text-xs text-muted-foreground">USD liquidity on the safety gate can move because ETH's dollar price moved. It is not the same as pooled WETH.</p>
    </section>
  )
}

function ExecutionPane({ report }: { report: ChartReport }) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-sm">Raw swaps {report.execution.raw}. Repetitive size group {report.execution.repetitive}. Estimated independent traders {report.execution.independent == null ? "Unknown" : report.execution.independent}.</p>
      <p className="mt-2 text-sm text-muted-foreground">{report.execution.note}</p>
    </section>
  )
}

function UnknownPane({ title, reason, extra }: { title: string; reason: string; extra: string }) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-sm font-semibold">{title}: Unknown</h2>
      <p className="mt-2 text-sm">{reason}</p>
      {extra ? <p className="mt-2 text-sm text-muted-foreground">{extra}</p> : null}
    </section>
  )
}

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-sm font-semibold">{title}</h2>
      {items.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{empty}</p> : <ul className="mt-2 list-disc pl-5 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul>}
    </section>
  )
}

function TimelinePane({ report, createdAt, cutoff, playing, speed, onCutoff, onPlaying, onSpeed }: { report: ChartReport; createdAt: number; cutoff: number | null; playing: boolean; speed: number; onCutoff: (value: number | null) => void; onPlaying: (value: boolean) => void; onSpeed: (value: number) => void }) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-sm font-semibold">Replay</h2>
      <p className="mt-1 text-xs text-muted-foreground">A mark hides every price, swap, and burn after that moment. {cutoff == null ? "Showing the latest reading." : `Cutoff ${new Date(cutoff).toLocaleString()}.`}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {MARKS.map(([label, offset]) => {
          const at = createdAt + offset
          const disabled = offset > 0 && at > Date.now()
          return <button key={label} type="button" disabled={disabled} className="rounded-md bg-muted px-2 py-1 text-xs disabled:opacity-40" onClick={() => onCutoff(offset === 0 ? createdAt : at)}>{label}</button>
        })}
        <button type="button" className="rounded-md bg-muted px-2 py-1 text-xs" onClick={() => onCutoff(null)}>Latest</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="text-primary" onClick={() => onPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
        {[1, 5, 10, 30, 60].map((value) => <button key={value} type="button" className={speed === value ? "font-semibold" : "text-muted-foreground"} onClick={() => onSpeed(value)}>{value}x</button>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Windows: {report.windows.filter((window) => window.state === "ready").map((window) => window.label).join(", ") || "none yet"}.</p>
    </section>
  )
}

function TrainingPane({ report, revealed, drill, verdict, confidence, notes, onVerdict, onConfidence, onNotes, onSave, onOutcome }: { report: ChartReport; revealed: boolean; drill: boolean; verdict: VerdictId; confidence: number; notes: string; onVerdict: (value: VerdictId) => void; onConfidence: (value: number) => void; onNotes: (value: string) => void; onSave: () => void; onOutcome: (horizon: ReviewOutcome["horizon"], priceChange: number | null) => void }) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-sm font-semibold">{drill ? "Drill review" : "Your verdict"}</h2>
      <p className="mt-1 text-xs text-muted-foreground">Week focus rotates with practice: structure, then flow, then wallets, then blind reviews. The saved verdict stays as you wrote it.</p>
      <label className="mt-3 flex flex-col gap-1 text-sm">Verdict
        <select value={verdict} onChange={(event) => onVerdict(event.target.value as VerdictId)} className="rounded-md bg-muted px-2 py-1">
          {VERDICTS.map((item) => <option key={item} value={item}>{VERDICT_LABEL[item]}</option>)}
        </select>
      </label>
      <label className="mt-3 flex flex-col gap-1 text-sm">Confidence {confidence}
        <input type="range" min={0} max={100} value={confidence} onChange={(event) => onConfidence(Number(event.target.value))} />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-sm">Why?
        <textarea value={notes} onChange={(event) => onNotes(event.target.value)} className="min-h-20 rounded-md bg-muted px-2 py-1" />
      </label>
      <button type="button" className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={onSave}>Save review</button>
      {revealed ? <p className="mt-3 text-sm">Engine reading after you saved: {report.verdictLabel}, confidence {report.confidence}%.</p> : <p className="mt-3 text-sm text-muted-foreground">The engine verdict stays hidden until you save.</p>}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {(["15m", "1h", "6h", "24h"] as const).map((horizon) => (
          <button key={horizon} type="button" className="rounded-md bg-muted px-2 py-1" onClick={() => onOutcome(horizon, null)}>Record {horizon} outcome later</button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">An outcome records the time and the reserve change visible then. It does not grade you only on whether price rose.</p>
    </section>
  )
}
