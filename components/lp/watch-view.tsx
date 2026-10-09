"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { formatCount, formatUsd } from "@/lib/format"
import { filterBurnEvents, formatBurnPercent } from "@/lib/lp/burn-logic"
import {
  INTERVAL_PRESETS,
  PAIR_AGE_FILTERS,
  SEARCH_WINDOWS,
  STATUS_LABEL,
  ago,
  clock,
  buildLpBurns,
  eventsOf,
  formatDuration,
  intervalBuckets,
  intervalLabel,
  launchGap,
  pairAgeLimitMs,
  resolveInterval,
  searchBounds,
  statsFor,
  surgeReport,
  watchStatus,
  type LpBurnEvent,
} from "@/lib/lp/monitor"
import { HistoryPanel } from "@/components/progress/history-panel"
import { useLpMonitor } from "@/components/lp/monitor-context"
import type { PairRecord } from "@/lib/types"

function oldestOf(values: string[]): number | null {
  const times = values.map((value) => Date.parse(value)).filter(Number.isFinite)
  return times.length ? Math.min(...times) : null
}

export function LpWatchSummary() {
  const { config, mode, snapshot, lastCheck, nextCheck, scanNow } = useLpMonitor()
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const resolved = resolveInterval(config)
  const total = "error" in resolved ? null : resolved.ms
  const remain = now && nextCheck ? Math.max(0, nextCheck - now) : null
  const progress = remain != null && total ? Math.min(1, Math.max(0, 1 - remain / total)) : 0
  const scannedAt = snapshot?.lpScan?.scannedAt ?? snapshot?.generatedAt
  const status = mode === "paused" ? "Paused" : mode === "error" ? "Reconnecting" : mode === "realtime" ? "Live" : "Polling"
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium">LP Burn Monitor</h2>
        <p className="text-sm">{status}</p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3 xl:grid-cols-6">
        <div><dt className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Monitoring interval</dt><dd>{intervalLabel(config)}</dd></div>
        <div><dt className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Last check</dt><dd>{lastCheck && now ? ago(now - lastCheck) : "Waiting"}</dd></div>
        <div><dt className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Dataset updated</dt><dd>{scannedAt && now ? ago(now - Date.parse(scannedAt)) : "Waiting"}</dd></div>
        <div><dt className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Pairs scanned</dt><dd>{formatCount(snapshot?.lpScan?.pairsChecked ?? snapshot?.rows.length)}</dd></div>
        <div><dt className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">New LP burns</dt><dd>{snapshot?.lpScan?.newBurns ?? "—"}</dd></div>
        <div><dt className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Next check</dt><dd>{remain == null ? "—" : formatDuration(remain)}</dd></div>
      </dl>
      <div>
        <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Next check</span><span>{remain == null ? "Paused or waiting" : `${Math.ceil(remain / 1000)} sec`}</span></div>
        <div className="h-1.5 rounded-full bg-muted" aria-hidden><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/lp-burns" className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground">Open monitor</Link>
        <button type="button" onClick={scanNow} className="rounded-md bg-muted px-3 py-1.5">Scan now</button>
        <Link href="/alerts" className="rounded-md bg-muted px-3 py-1.5">Alert settings</Link>
      </div>
    </section>
  )
}

export function LpBurnWatch() {
  const monitor = useLpMonitor()
  const { config, update, snapshot, loading, error, mode, lastCheck, nextCheck, rpc, alerts, dismiss, scanNow, testSound, testNotification, enableNotifications, deliveryNote } = monitor
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])
  const bounds = now == null ? null : searchBounds(config, now)
  const interval = resolveInterval(config)
  const derived = useMemo(() => {
    if (!snapshot) return null
    if (snapshot.lpBurns && snapshot.lpScan) return { events: eventsOf(snapshot), scan: snapshot.lpScan }
    return buildLpBurns(snapshot.rows, null, snapshot.generatedAt)
  }, [snapshot])
  const events = derived?.events ?? []
  const scan = derived?.scan ?? null
  const visible = useMemo(() => {
    if (bounds == null || "error" in bounds) return []
    return filterBurnEvents(events, bounds.start, bounds.end, pairAgeLimitMs(config), now ?? bounds.end)
      .sort((a, b) => (b.burnAt ?? "").localeCompare(a.burnAt ?? ""))
  }, [bounds, config, events, now])
  const undated = useMemo(() => events.filter((event) => !event.burnAt), [events])
  const history = visible
  const selected = visible.find((event) => event.id === selectedId) ?? visible[0] ?? null
  const day = snapshot && now != null ? statsFor(snapshot.rows, events, now - 24 * 60 * 60_000, now) : null
  const buckets = bounds != null && !("error" in bounds) && !("error" in interval) ? intervalBuckets(events, bounds.start, bounds.end, interval.ms) : []
  const surge = now == null ? null : surgeReport(events, now)
  const ageNow = now ?? 0

  return (
    <main className="page-wrap flex w-full flex-col gap-6 py-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-medium tracking-[0.18em] text-primary uppercase">LP burn monitoring</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">LP Burn Watch</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Monitor newly launched WETH pairs and detect when their liquidity-provider tokens are burned.
        </p>
      </header>

      {snapshot && now != null ? (
        <HistoryPanel
          backfill={snapshot.backfill}
          oldestPair={oldestOf(snapshot.rows.map((row) => row.created_at))}
          pairCount={snapshot.rows.length}
          oldestBurn={oldestOf(events.map((event) => event.burnAt ?? ""))}
          burnCount={events.length}
          requestedMs={bounds && !("error" in bounds) ? bounds.end - bounds.start : undefined}
          now={now}
        />
      ) : null}
      <section className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Refresh interval</h2>
          <p className="text-sm">{mode === "realtime" ? "Live" : mode === "paused" ? "Paused" : mode === "error" ? "Reconnecting" : "Polling"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {INTERVAL_PRESETS.map((item) => (
            <button key={item.id} type="button" onClick={() => update({ preset: item.id })} className={chip(config.preset === item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-sm">Current: {mode === "paused" ? "Paused" : "error" in interval ? interval.error : `🟢 Monitoring ${interval.label}`}</p>
        {config.preset === "custom" ? <CustomInterval /> : null}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Last check</dt><dd>{lastCheck ? clock(lastCheck) : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Next check</dt><dd>{nextCheck ? clock(nextCheck) : "—"}</dd></div>
        </dl>
        <p className="text-sm">{mode === "realtime" ? "⚡ Realtime LP monitoring. Burn logs are classified in the browser. The refresh interval reloads published enrichment." : mode === "paused" ? "Monitoring is paused." : `⚠ Realtime feed unavailable. Polling the published scan${"error" in interval ? "." : ` ${interval.label}.`}`}</p>
        <p className="text-xs leading-5 text-muted-foreground">The interval does not decide whether a burn is seen. While the Ethereum socket is connected, a transfer into a burn address is checked immediately. The published scan is the reconciliation copy. A liquidity removal is not an LP burn.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Burn time</h2>
        <p className="text-xs text-muted-foreground">Shows LP burns whose burn timestamp falls in this period. Pair age is a separate filter and does not change what the monitor scans.</p>
        <div className="flex flex-wrap gap-2">
          {SEARCH_WINDOWS.map((item) => (
            <button key={item.id} type="button" onClick={() => { setNow(Date.now()); update({ windowId: item.id }) }} className={chip(config.windowId === item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <h2 className="text-sm font-medium">Pair age</h2>
        <div className="flex flex-wrap gap-2">
          {PAIR_AGE_FILTERS.map((item) => (
            <button key={item.id} type="button" onClick={() => update({ pairAgeId: item.id })} className={chip(config.pairAgeId === item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        {config.pairAgeId === "custom" ? (
          <label className="flex w-40 flex-col gap-1 text-sm">Maximum pair age in minutes
            <input type="number" min={1} value={config.pairAgeMinutes} onChange={(event) => update({ pairAgeMinutes: Number(event.target.value) })} className="rounded-md bg-muted px-2 py-1" />
          </label>
        ) : null}
        {config.windowId === "custom" ? (
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">Start<input type="datetime-local" value={config.customStart} onChange={(event) => update({ customStart: event.target.value })} className="rounded-md bg-muted px-2 py-1" /></label>
            <label className="flex flex-col gap-1">End<input type="datetime-local" value={config.customEnd} onChange={(event) => update({ customEnd: event.target.value })} className="rounded-md bg-muted px-2 py-1" /></label>
          </div>
        ) : null}
        {bounds != null && "error" in bounds ? <p className="text-sm text-destructive">{bounds.error}</p> : null}
      </section>

      <section className="flex flex-wrap gap-2">
        <button type="button" onClick={() => update({ enabled: true, paused: false })} className={chip(mode === "active" || mode === "realtime")}>Start Monitoring</button>
        <button type="button" onClick={() => update({ paused: true })} className={chip(config.paused)}>Pause Monitoring</button>
        <button type="button" onClick={() => update({ enabled: true, paused: false })} className={chip(false)}>Resume Monitoring</button>
        <button type="button" onClick={() => { setNow(Date.now()); scanNow() }} className={chip(false)}>Run Scan Now</button>
        <button type="button" className={chip(mode === "realtime")} disabled>Realtime feed</button>
      </section>

      <section className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Last successful scan" value={scan ? new Date(scan.scannedAt).toLocaleString() : "—"} />
        <Stat label="Next scheduled check" value={nextCheck ? clock(nextCheck) : "—"} />
        <Stat label="Pairs checked" value={formatCount(scan?.pairsChecked)} />
        <Stat label="New pairs found" value={formatCount(scan?.newPairs)} />
        <Stat label="New LP burns found" value={formatCount(scan?.newBurns)} />
        <Stat label="Already burned when first seen" value={formatCount(scan?.previouslyBurnedFound)} />
        <Stat label="Newest pair creation block" value={scan?.highestCreationBlock?.toLocaleString("en-US") ?? "—"} />
        <Stat label="RPC / API" value={rpc} />
      </section>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading && !snapshot ? <p className="text-sm text-muted-foreground">Loading the published scan…</p> : null}

      {alerts.map((event) => (
        <article key={event.id} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/20">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-medium">🔥 NEW LP BURN DETECTED</h2>
            <button type="button" onClick={() => dismiss(event.id)} className="text-xs text-muted-foreground">Dismiss</button>
          </div>
          <BurnFacts event={event} detected="Just now" />
          <BurnActions event={event} />
        </article>
      ))}
      {deliveryNote ? <p className="text-sm text-muted-foreground">{deliveryNote}</p> : null}

      {selected ? (
        <article className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <BurnFacts event={selected} />
          <p className="text-sm text-muted-foreground">{kindLabel(selected.kind)}. {selected.burnTx ? `Burn transaction ${selected.burnTx}.` : "Burn transaction, block, and sender were not in the pair record."} LP holder addresses were not in the pair record. {STATUS_LABEL.locked} is not counted as burned.</p>
          <BurnActions event={selected} />
        </article>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">LP Burn Watch</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {["Age", "Token", "Ticker", "Pair age", "LP burn time", "LP burn %", "Liquidity", "Market cap", "Volume", "Buys", "Contract"].map((label) => (
                  <th key={label} className="py-2 pr-3 font-medium">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => (
                <tr key={event.id} onClick={() => setSelectedId(event.id)} className={`cursor-pointer border-t border-foreground/10 ${alerts.some((item) => item.id === event.id) ? "bg-primary/15" : ""}`}>
                  <td className="py-2 pr-3">{ago(ageNow - Date.parse(event.detectedAt))}</td>
                  <td className="py-2 pr-3">{event.tokenName}</td>
                  <td className="py-2 pr-3">${event.symbol}</td>
                  <td className="py-2 pr-3">{formatDuration(ageNow - Date.parse(event.createdAt))}</td>
                  <td className="py-2 pr-3">{event.burnAt ? ago(ageNow - Date.parse(event.burnAt)) : "Not in the pair record"}</td>
                  <td className="py-2 pr-3">{formatBurnPercent(event.lpBurntPercent, event.percentKnown !== false)}</td>
                  <td className="py-2 pr-3">{formatUsd(event.liquidity)}</td>
                  <td className="py-2 pr-3">{formatUsd(event.marketCap)}</td>
                  <td className="py-2 pr-3">{formatUsd(event.volume24h)}</td>
                  <td className="py-2 pr-3">{formatCount(event.buys24h)}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{event.tokenAddress.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && snapshot ? <p className="pt-3 text-sm text-muted-foreground">No LP burn with a recorded burn time in this period. Pair age is {config.pairAgeId === "any" ? "not limited" : PAIR_AGE_FILTERS.find((item) => item.id === config.pairAgeId)?.label ?? "custom"}.</p> : null}
        </div>
      </section>

      {day ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Last 24 hours</h2>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="WETH pairs detected" value={formatCount(day.pairs)} />
            <Stat label="LP burned" value={formatCount(day.burned)} />
            <Stat label="LP locked" value={formatCount(day.locked)} />
            <Stat label="LP not burned" value={formatCount(day.notBurned)} />
            <Stat label="Unknown" value={formatCount(day.unknown)} />
            <Stat label="Average time to first detection" value={day.averageDetectMs == null ? "—" : formatDuration(day.averageDetectMs)} />
            <Stat label="Median time to first detection" value={day.medianDetectMs == null ? "—" : formatDuration(day.medianDetectMs)} />
            <Stat label="LP burn launch rate" value={day.rate == null ? "—" : `${day.burned} / ${day.pairs} = ${(day.rate * 100).toFixed(2)}%`} />
          </div>
          <p className="text-xs text-muted-foreground">
            {day.timedBurns > 0 && day.averageBurnMs != null
              ? `Average time from launch to the recorded burn time: ${formatDuration(day.averageBurnMs)} across ${day.timedBurns} pairs.`
              : "Burn timestamps were not in these pair records, so the average above is time until this monitor first stored the burned status."}
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Burns by check window</h2>
        {buckets.length === 0 ? <p className="text-sm text-muted-foreground">Choose a valid interval and search window to see counts.</p> : (
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {buckets.map((bucket) => (
              <li key={bucket.start} className="rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/10">{clock(bucket.start)}–{clock(bucket.end)} · {bucket.count} LP burns</li>
            ))}
          </ul>
        )}
      </section>

      {surge ? <section className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="text-sm font-medium">{surge.active ? "🚨 LP BURN SURGE" : "LP burn surge check"}</h2>
        <p className="text-sm text-muted-foreground">{surge.note}</p>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Current 24h" value={formatCount(surge.current24h)} />
          <Stat label="Previous 24h" value={formatCount(surge.previous24h)} />
          <Stat label="Previous hour / current hour" value={`${surge.previousHour} / ${surge.currentHour}`} />
          <Stat label="Previous 6h / current 6h" value={`${surge.previous6h} / ${surge.current6h}`} />
          <Stat label="7-day daily average" value={surge.dailyAverage7 == null ? `Need at least 2 days (${surge.daysUsed7} stored)` : surge.dailyAverage7.toFixed(1)} />
          <Stat label="30-day daily average" value={surge.dailyAverage30 == null ? `Need at least 2 days (${surge.daysUsed30} stored)` : surge.dailyAverage30.toFixed(1)} />
          <Stat label="Increase vs 7-day average" value={surge.increase7 == null ? "—" : `${surge.increase7 >= 0 ? "+" : ""}${Math.round(surge.increase7 * 100)}%`} />
        </div>
        <SurgeList title="Shared names and tickers" rows={surge.themes.map((item) => `${item.name}: ${item.count}`)} empty="No shared name or ticker among the last 24 hours of burns." />
        <SurgeList title="Repeated deployers" rows={surge.deployers.map((item) => `${item.address}: ${item.count}`)} empty="No deployer launched more than one of these burns." />
        <SurgeList title="Repeated exchanges" rows={surge.exchanges.map((item) => `${item.name}: ${item.count}`)} empty="No exchange repeated often enough to group." />
        <SurgeList title="Liquidity at detection" rows={surge.liquidity.map((item) => `${item.label}: ${item.count}`)} empty="No liquidity figures in this window." />
        <p className="text-xs text-muted-foreground">Funding wallets and token factories are not in the pair record, so they are not grouped here. Locked pools are excluded from the burn counts.</p>
      </section> : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">LP burn history</h2>
        <p className="text-xs text-muted-foreground">Same burn-time filter as the watch table. A pair can be hours old and still appear when its LP burn is inside the selected burn time.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {["Burn time", "Pair creation", "Time from launch", "Token", "Ticker", "Liquidity", "LP burn %", "Market cap", "Volume", "Buys", "Deployer", "Burn transaction"].map((label) => (
                  <th key={label} className="py-2 pr-3 font-medium">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((event) => {
                const gap = launchGap(event)
                return (
                  <tr key={event.id} className="border-t border-foreground/10">
                    <td className="py-2 pr-3">{event.burnAt ? new Date(event.burnAt).toLocaleString() : "Not in the pair record"}</td>
                    <td className="py-2 pr-3">{new Date(event.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-3">{gap ? `${formatDuration(gap.ms)}${gap.source === "detection" ? " to first detection" : ""}` : "—"}</td>
                    <td className="py-2 pr-3">{event.tokenName}</td>
                    <td className="py-2 pr-3">${event.symbol}</td>
                    <td className="py-2 pr-3">{formatUsd(event.liquidity)}</td>
                    <td className="py-2 pr-3">{formatBurnPercent(event.lpBurntPercent, event.percentKnown !== false)}</td>
                    <td className="py-2 pr-3">{formatUsd(event.marketCap)}</td>
                    <td className="py-2 pr-3">{formatUsd(event.volume24h)}</td>
                    <td className="py-2 pr-3">{formatCount(event.buys24h)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{event.deployer ? `${event.deployer.slice(0, 8)}…` : "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{event.burnTx ? `${event.burnTx.slice(0, 10)}…` : "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">Alerts</h2>
        <div className="flex flex-wrap gap-2">
          <Toggle label="In-app alerts" on={config.inApp} onClick={() => update({ inApp: !config.inApp })} />
          <Toggle label="Browser notifications" on={config.browser} onClick={() => update({ browser: !config.browser })} />
          <button type="button" onClick={enableNotifications} className={chip(false)}>Enable Notifications</button>
          <button type="button" onClick={testNotification} className={chip(false)}>Test Notification</button>
          <Toggle label="Sound alerts" on={config.sound} onClick={() => update({ sound: !config.sound })} />
          <Toggle label="Webhook" on={config.webhook} onClick={() => update({ webhook: !config.webhook })} />
          <Toggle label="Telegram" on={config.telegram} onClick={() => update({ telegram: !config.telegram })} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Sound</span>
          {(["beep", "chime", "pulse"] as const).map((sound) => (
            <button key={sound} type="button" onClick={() => update({ soundId: sound })} className={chip(config.soundId === sound)}>{sound}</button>
          ))}
          <button type="button" onClick={testSound} className={chip(false)}>Test Sound</button>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <label className="flex flex-col gap-1">Minimum LP burn %
            <input type="number" min={0} max={100} value={config.minBurnPercent} onChange={(event) => update({ minBurnPercent: Number(event.target.value) })} className="rounded-md bg-muted px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">Minimum liquidity USD
            <input type="number" min={0} value={config.minLiquidity} onChange={(event) => update({ minLiquidity: Number(event.target.value) })} className="rounded-md bg-muted px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">Maximum pair age minutes (blank = any)
            <input type="number" min={1} value={config.maxPairAgeMinutes ?? ""} onChange={(event) => update({ maxPairAgeMinutes: event.target.value === "" ? null : Number(event.target.value) })} className="rounded-md bg-muted px-2 py-1" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">Webhook URL
          <input value={config.webhookUrl} onChange={(event) => update({ webhookUrl: event.target.value })} placeholder="https://example.com/hook" className="rounded-md bg-muted px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Telegram relay URL
          <input value={config.telegramUrl} onChange={(event) => update({ telegramUrl: event.target.value })} placeholder="https://relay.example/telegram" className="rounded-md bg-muted px-2 py-1" />
        </label>
        <p className="text-xs leading-5 text-muted-foreground">Each method sends only for a burn found while monitoring was running, and only once. The stored id is chain, pair, and burn transaction hash. When the pair record has no burn hash, the id uses the pair address so the same burn is not announced again. Telegram uses a relay URL you provide. This site does not store a bot token. Sound starts after Test Sound or after you turn sound on, because the browser requires a click.</p>
      </section>

      {undated.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Burn time not on chain yet</h2>
          <p className="text-xs text-muted-foreground">{undated.length} stored burns have no burn timestamp, so they stay out of the clock filters above. Market data can be missing without hiding a timed burn.</p>
        </section>
      ) : null}

      {snapshot ? <StatusSample rows={snapshot.rows} /> : null}
    </main>
  )
}

function CustomInterval() {
  const { config, update } = useLpMonitor()
  const resolved = resolveInterval({ ...config, preset: "custom" })
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">Custom interval</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">Value
          <input
            type="number"
            min={1}
            step={1}
            value={config.customValue}
            onChange={(event) => update({ customValue: Number(event.target.value) })}
            className="w-24 rounded-md bg-muted px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">Unit
          <select value={config.customUnit} onChange={(event) => update({ customUnit: event.target.value === "hours" ? "hours" : "minutes" })} className="rounded-md bg-muted px-2 py-1">
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
          </select>
        </label>
      </div>
      <p>{"error" in resolved ? resolved.error : `Check ${resolved.label}.`}</p>
    </div>
  )
}

function BurnFacts({ event, detected }: { event: LpBurnEvent; detected?: string }) {
  const gap = launchGap(event)
  const now = Date.now()
  return (
    <div className="grid gap-2 text-sm sm:grid-cols-2">
      <p>Token: {event.tokenName}</p>
      <p>Ticker: ${event.symbol}</p>
      <p>Pair: {event.symbol}/WETH</p>
      <p>LP Status: {STATUS_LABEL.burned}</p>
      <p>LP Burned: {formatBurnPercent(event.lpBurntPercent, event.percentKnown !== false)}{event.source === "ethereum-transfer" ? " · Ethereum Transfer" : event.source === "dextools" ? " · DEXTools balance" : ""}</p>
      <p>Total LP supply: {event.lpSupply == null ? "Not in the pair record" : formatCount(event.lpSupply)}</p>
      <p>LP tokens burned: {event.lpBurnedTokens == null ? "Not in the pair record" : formatCount(event.lpBurnedTokens)}</p>
      <p>Remaining LP tokens: {event.lpRemaining == null ? "Not in the pair record" : formatCount(event.lpRemaining)}</p>
      <p>Burn time: {event.burnAt ? ago(now - Date.parse(event.burnAt)) : "Not in the pair record"}</p>
      <p>Detected: {detected ?? ago(now - Date.parse(event.detectedAt))}</p>
      <p>Pair age: {formatDuration(now - Date.parse(event.createdAt))}</p>
      <p>Time from launch: {gap ? `${formatDuration(gap.ms)}${gap.source === "detection" ? " to first detection" : " to LP burn"}` : "—"}</p>
      <p>Liquidity: {formatUsd(event.liquidity)}</p>
      <p>Market cap: {formatUsd(event.marketCap)}</p>
      <p className="sm:col-span-2 break-all">Burn transaction: {event.burnTx ?? "Not in the pair record"}</p>
    </div>
  )
}

function BurnActions({ event }: { event: LpBurnEvent }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <Link href={`/tokens/${event.tokenAddress}`} className={chip(false)}>View Token</Link>
      <a href={event.url} target="_blank" rel="noreferrer" className={chip(false)}>View Pair</a>
      <a href={event.url} target="_blank" rel="noreferrer" className={chip(false)}>Open DEXTools</a>
      <a href={event.burnTx ? `https://etherscan.io/tx/${event.burnTx}` : `https://etherscan.io/token/${event.tokenAddress}`} target="_blank" rel="noreferrer" className={chip(false)}>Open Etherscan</a>
      <button
        type="button"
        className={chip(false)}
        onClick={() => {
          void navigator.clipboard.writeText(event.tokenAddress).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? "Copied" : "Copy Contract"}
      </button>
    </div>
  )
}

function StatusSample({ rows }: { rows: PairRecord[] }) {
  const counts = { burned: 0, locked: 0, "not-burned": 0, unknown: 0 }
  for (const row of rows) {
    counts[watchStatus(row)] += 1
  }
  return (
    <p className="text-xs text-muted-foreground">
      In the stored listing: {STATUS_LABEL.burned} {counts.burned} · {STATUS_LABEL.locked} {counts.locked} · {STATUS_LABEL["not-burned"]} {counts["not-burned"]} · {STATUS_LABEL.unknown} {counts.unknown}. Unverified V3, V4, and unknown-exchange pools stay under Unknown.
    </p>
  )
}

function SurgeList({ title, rows, empty }: { title: string; rows: string[]; empty: string }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length ? <ul className="mt-1 text-sm text-muted-foreground">{rows.map((row) => <li key={row}>{row}</li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">{empty}</p>}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  )
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={chip(on)}>{label} {on ? "ON" : "OFF"}</button>
}

function chip(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`
}

function kindLabel(kind: LpBurnEvent["kind"]): string {
  return kind === "newly-burned" ? "Newly burned while this pair was already in a previous scan" : "Previously burned when the pair was first stored"
}
