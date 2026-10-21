"use client"

import { useState, useSyncExternalStore, type ReactNode } from "react"
import { ArrowDown, ArrowUp, Fuel, RefreshCw } from "lucide-react"
import { useClock } from "@/components/shell/clock"
import { Popover } from "@/components/shell/popover"
import { Tip } from "@/components/shell/tip"
import { marketClient, type MarketView, type Move } from "@/lib/market/client"
import { DEFINITIONS } from "@/lib/market/copy"
import { GAS_PERCENTILES } from "@/lib/market/gas"
import { changeTone, formatAgo, formatAge, formatChange, formatEthPrice, formatEthPriceCompact, formatGwei, spokenChange, spokenUsd, type Tone } from "@/lib/market/format"
import { GAS_STALE_MS, PRICE_STALE_MS, feedHealth } from "@/lib/market/service"
import { EMPTY_FEED, type FeedHealth, type FeedState, type GasTier } from "@/lib/market/types"
import { EthChart } from "@/components/shell/eth-chart"
import { GasHistory, GasUsage } from "@/components/shell/gas-panel"

const SERVER_VIEW: MarketView = { eth: { ...EMPTY_FEED }, gas: { ...EMPTY_FEED }, via: "browser", ethMove: null, gasMove: null }

export function useMarket(): MarketView {
  const client = marketClient()
  return useSyncExternalStore(client.subscribe, client.getView, () => SERVER_VIEW)
}

/** Feeds the gas widget each new head the LP monitor already receives. */
export function notifyMarketBlock() {
  marketClient().onBlock()
}

const ETH_PANEL = "w-[min(56rem,calc(100vw-1.5rem))] max-h-[min(48rem,calc(100vh-4.5rem))] overflow-y-auto max-lg:fixed max-lg:top-14 max-lg:right-3 max-lg:left-3 max-lg:w-auto"
const GAS_PANEL = "w-[min(54rem,calc(100vw-1.5rem))] max-h-[min(34rem,calc(100vh-5rem))] overflow-y-auto max-sm:fixed max-sm:top-14 max-sm:right-3 max-sm:left-3 max-sm:w-auto"

function toneClass(tone: Tone) {
  return tone === "up" ? "tone-up" : tone === "down" ? "tone-down" : "text-muted-foreground"
}

function ageOf<T extends { observedAt: string }>(state: FeedState<T>, now: number | null): number | null {
  if (!state.data || now == null) return null
  return Math.max(0, now - Date.parse(state.data.observedAt))
}

function MoveArrow({ move, now }: { move: Move | null; now: number | null }) {
  if (!move || now == null || now - move.at > 2000) return null
  const Icon = move.dir === "up" ? ArrowUp : ArrowDown
  return <Icon key={move.at} size={11} aria-hidden className={`tick-fade ${move.dir === "up" ? "tone-up" : "tone-down"}`} />
}

function HealthBadge({ health, age, fallbackText }: { health: FeedHealth; age: number | null; fallbackText: string }) {
  const map: Record<FeedHealth, { text: string; dot: string }> = {
    live: { text: "Live", dot: "bg-emerald-500" },
    refreshing: { text: "Refreshing…", dot: "bg-muted-foreground" },
    stale: { text: `${formatAge(age)} old`, dot: "bg-amber-500" },
    degraded: { text: fallbackText, dot: "bg-amber-500" },
    unavailable: { text: "Unavailable", dot: "bg-destructive" },
  }
  const entry = map[health]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span aria-hidden className={`size-1.5 rounded-full ${entry.dot} ${health === "live" ? "live-dot" : ""}`} />
      {health === "stale" ? "⚠ " : ""}
      {entry.text}
    </span>
  )
}

function Change({ label, value, hideLabelOnMobile = false, className = "" }: { label: string; value: number | null; hideLabelOnMobile?: boolean; className?: string }) {
  return (
    <span className={`items-baseline gap-1 text-xs ${className}`}>
      <span className={`text-[10px] font-medium text-muted-foreground ${hideLabelOnMobile ? "hidden sm:inline" : ""}`}>{label}</span>
      <span className={`tabular-nums ${toneClass(changeTone(value))}`}>{formatChange(value)}</span>
    </span>
  )
}

function EthIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="shrink-0 text-primary">
      <path fill="currentColor" d="M8 0 3 8.2l5 3 5-3L8 0Zm0 12.4-5-3L8 16l5-6.6-5 3Z" opacity="0.9" />
    </svg>
  )
}

function DetailRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  )
}

function ChangeDetail({ value }: { value: number | null }) {
  const tone = changeTone(value)
  return (
    <span className={`inline-flex items-center gap-1 ${toneClass(tone)}`}>
      {formatChange(value)}
      {tone === "up" ? <ArrowUp size={12} aria-hidden /> : tone === "down" ? <ArrowDown size={12} aria-hidden /> : null}
    </span>
  )
}

export function EthMarketWidget() {
  const view = useMarket()
  const now = useClock(1000)
  const state = view.eth
  const data = state.data
  const health = now == null ? "refreshing" : feedHealth(state, now, PRICE_STALE_MS)
  const age = ageOf(state, now)
  const spoken = data
    ? `Ethereum price ${spokenUsd(data.priceUsd)}, ${spokenChange(data.change24h, "24 hours")}.${health === "stale" ? ` Data is ${formatAge(age)} old.` : ""} Open details.`
    : `Ethereum price ${health === "unavailable" ? "unavailable" : "loading"}. Open details.`

  return (
    <Popover
      label={spoken}
      panelClassName={ETH_PANEL}
      trigger={
        <span className="flex h-8 items-center gap-1.5 rounded-md bg-card px-2 ring-1 ring-foreground/10 hover:ring-foreground/25 sm:gap-2 sm:px-2.5">
          <EthIcon />
          <span className="hidden text-[10px] font-medium tracking-wide text-muted-foreground min-[1700px]:inline">ETH</span>
          <span key={data?.priceUsd ?? "none"} className="value-bump text-sm font-semibold tabular-nums">
            <span className="sm:hidden">{formatEthPriceCompact(data?.priceUsd)}</span>
            <span className="hidden sm:inline">{formatEthPrice(data?.priceUsd)}</span>
          </span>
          <MoveArrow move={view.ethMove} now={now} />
          {data ? (
            <>
              <Change label="1H" value={data.change1h} className="hidden min-[1700px]:inline-flex" />
              <Change label="24H" value={data.change24h} hideLabelOnMobile className="inline-flex" />
              <Change label="7D" value={data.change7d} className="hidden min-[1700px]:inline-flex" />
            </>
          ) : null}
          {health === "stale" ? <span className="text-[10px] text-amber-600 dark:text-amber-400" aria-hidden>⚠<span className="hidden sm:inline"> {formatAge(age)}</span></span> : null}
        </span>
      }
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Ethereum</p>
        <HealthBadge health={health} age={age} fallbackText="Fallback source" />
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{formatEthPrice(data?.priceUsd)}</p>
      <EthChart />
      <dl className="mt-3 divide-y divide-foreground/10">
        <DetailRow label={<Tip label="1 Hour" text={DEFINITIONS.change1h} />}><ChangeDetail value={data?.change1h ?? null} /></DetailRow>
        <DetailRow label={<Tip label="24 Hours" text={DEFINITIONS.change24h} />}><ChangeDetail value={data?.change24h ?? null} /></DetailRow>
        <DetailRow label={<Tip label="7 Days" text={DEFINITIONS.change7d} />}><ChangeDetail value={data?.change7d ?? null} /></DetailRow>
        <DetailRow label="Updated">{data ? formatAgo(age) : "—"}</DetailRow>
        <DetailRow label="Source">{data?.sourceLabel ?? "—"}</DetailRow>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        {data?.source === "coinbase"
          ? "Live trade price. 1H, 24H, and 7D are calculated against the Coinbase price exactly that long ago."
          : data?.source === "coingecko"
            ? "CoinGecko supplies the 1H, 24H, and 7D changes directly."
            : "Waiting for the first price."}
        {state.fallback ? " The primary source failed, so the fallback is shown until it recovers." : ""}
      </p>
      {state.lastError ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Last refresh failed. {data ? "Showing the last good price." : ""}</p> : null}
      <RefreshButton busy={state.refreshing} onClick={() => marketClient().refreshNow("eth")} />
    </Popover>
  )
}

function TierRow({ name, tip, tier, highlight = false }: { name: string; tip: string; tier: GasTier | undefined; highlight?: boolean }) {
  return (
    <tr className={highlight ? "font-medium" : ""}>
      <th scope="row" className="py-1.5 pr-2 text-left text-xs font-medium tracking-wide uppercase"><Tip label={name} text={tip} /></th>
      <td className="py-1.5 text-right tabular-nums">{formatGwei(tier?.gwei)}</td>
      <td className="py-1.5 text-right text-xs text-muted-foreground tabular-nums">{tier ? formatGwei(tier.priorityFee) : "—"}</td>
      <td className="py-1.5 text-right text-xs text-muted-foreground tabular-nums">{tier ? `~${tier.estimatedSeconds}s` : "—"}</td>
    </tr>
  )
}

export function EthereumGasWidget() {
  const view = useMarket()
  const [tab, setTab] = useState<"estimate" | "guzzlers" | "spenders" | "history">("estimate")
  const now = useClock(1000)
  const state = view.gas
  const data = state.data
  const health = now == null ? "refreshing" : feedHealth(state, now, GAS_STALE_MS)
  const age = ageOf(state, now)
  const dot = health === "live" ? "bg-emerald-500" : health === "unavailable" ? "bg-destructive" : health === "refreshing" ? "bg-muted-foreground" : "bg-amber-500"
  const spoken = data
    ? `Ethereum gas, standard ${formatGwei(data.standard.gwei)} gwei, fast ${formatGwei(data.fast.gwei)}, rapid ${formatGwei(data.rapid.gwei)}.${health === "stale" ? ` Data is ${formatAge(age)} old.` : ""} Open details.`
    : `Ethereum gas ${health === "unavailable" ? "unavailable" : "loading"}. Open details.`

  return (
    <Popover
      label={spoken}
      panelClassName={GAS_PANEL}
      trigger={
        <span className="flex h-8 items-center gap-1.5 rounded-md bg-card px-2 ring-1 ring-foreground/10 hover:ring-foreground/25 sm:px-2.5">
          <Fuel size={13} aria-hidden className="shrink-0 text-muted-foreground" />
          <span className="hidden text-[10px] font-medium tracking-wide text-muted-foreground sm:inline">STD</span>
          <span key={data?.standard.gwei ?? "none"} className="value-bump text-sm font-semibold tabular-nums">{data ? formatGwei(data.standard.gwei) : health === "unavailable" ? "N/A" : "—"}</span>
          <span className="hidden text-[10px] text-muted-foreground sm:inline">gwei</span>
          <MoveArrow move={view.gasMove} now={now} />
          <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
          {health === "stale" ? <span className="hidden text-[10px] text-amber-600 sm:inline dark:text-amber-400" aria-hidden>⚠ {formatAge(age)}</span> : null}
        </span>
      }
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Ethereum gas</p>
        <HealthBadge health={health} age={age} fallbackText="Fallback RPC" />
      </div>
      <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="Gas details">
        {([["estimate", "Estimate"], ["guzzlers", "Guzzlers"], ["spenders", "Spenders"], ["history", "History"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded px-2 py-0.5 text-[11px] ${tab === id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{label}</button>
        ))}
      </div>
      {tab === "guzzlers" ? <div className="mt-2"><GasUsage kind="guzzlers" ethUsd={view.eth.data?.priceUsd ?? null} /></div> : null}
      {tab === "spenders" ? <div className="mt-2"><GasUsage kind="spenders" ethUsd={view.eth.data?.priceUsd ?? null} /></div> : null}
      {tab === "history" ? <div className="mt-2"><GasHistory /></div> : null}
      {tab === "estimate" ? <>
      <table className="mt-2 w-full">
        <thead>
          <tr className="text-[10px] text-muted-foreground uppercase">
            <th className="pb-1 text-left font-medium">Level</th>
            <th className="pb-1 text-right font-medium">Gwei</th>
            <th className="pb-1 text-right font-medium">Tip</th>
            <th className="pb-1 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/10">
          <TierRow name="Standard" tip={DEFINITIONS.standard} tier={data?.standard} highlight />
          <TierRow name="Fast" tip={DEFINITIONS.fast} tier={data?.fast} />
          <TierRow name="Rapid" tip={DEFINITIONS.rapid} tier={data?.rapid} />
        </tbody>
      </table>
      <dl className="mt-2 divide-y divide-foreground/10 border-t border-foreground/10">
        <DetailRow label={<Tip label="Base fee" text={DEFINITIONS.baseFee} />}>{data ? `${formatGwei(data.baseFee)} gwei` : "—"}</DetailRow>
        <DetailRow label="Block">{data?.blockNumber != null ? data.blockNumber.toLocaleString("en-US") : "—"}</DetailRow>
        <DetailRow label="Updated">{data ? formatAgo(age) : "—"}</DetailRow>
        <DetailRow label="Source">{data?.sourceLabel ?? "—"}</DetailRow>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        {data?.source === "etherscan"
          ? "Etherscan's gas oracle. Ethereum fee history is the fallback."
          : `Next block's base fee plus the median ${(data?.percentiles ?? GAS_PERCENTILES).map((value) => `${value}th`).join(" / ")} percentile tip over the last 20 blocks. Gwei is what a transaction pays per gas; the tip column is the priority fee part.`}
      </p>
      {state.lastError ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Last refresh failed. {data ? "Showing the last good estimate." : "No gas source answered."}</p> : null}
      <RefreshButton busy={state.refreshing} onClick={() => marketClient().refreshNow("gas")} />
      </> : null}
    </Popover>
  )
}

function RefreshButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-60">
      <RefreshCw size={12} aria-hidden className={busy ? "animate-spin" : ""} />
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  )
}
