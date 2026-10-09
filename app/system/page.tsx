"use client"

import { useEffect, useState } from "react"
import { notificationState } from "@/lib/alerts"
import { backfillHealth, rpcHealth } from "@/lib/health"
import { useLpMonitor } from "@/components/lp/monitor-context"
import { HistoryPanel } from "@/components/progress/history-panel"
import { PageFrame } from "@/components/trends/widgets"

type Health = {
  permission: string
  worker: string
  push: string
  secure: string
}

export default function SystemPage() {
  const { snapshot, mode, block, error } = useLpMonitor()
  const [health, setHealth] = useState<Health | null>(null)
  const chain = snapshot?.chain

  useEffect(() => {
    let cancel = false
    async function read() {
      let worker = "Unavailable"
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined)
        worker = registration?.active ? "Active" : "Not active"
      }
      if (cancel) return
      setHealth({
        permission: notificationState(),
        worker,
        push: "Unavailable — this host has no Web Push server",
        secure: window.isSecureContext ? "HTTPS or localhost" : "Insecure origin",
      })
    }
    void read()
    return () => {
      cancel = true
    }
  }, [])

  const behind = chain?.blocksBehind
  return (
    <PageFrame eyebrow="Diagnostics" title="Monitor status" lede="The published scan stores the chain checkpoint. The time range on other pages only filters what you see.">
      {snapshot ? <HistoryPanel backfill={snapshot.backfill} oldestPair={oldest(snapshot.rows.map((row) => row.created_at))} pairCount={snapshot.rows.length} oldestBurn={oldest((snapshot.lpBurns ?? []).map((event) => event.burnAt ?? ""))} burnCount={snapshot.lpBurns?.length ?? 0} now={Date.parse(snapshot.generatedAt)} /> : null}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Row label="Ethereum RPC" value={chain?.lastError ? `Error: ${chain.lastError}` : chain ? `Connected · ${chain.rpcHost}` : "Waiting for a publish"} />
        <Row label="RPC health" value={rpcHealth(chain, snapshot ? Date.parse(snapshot.generatedAt) : 0)} />
        <Row label="Backfill health" value={backfillHealth(snapshot?.backfill)} />
        <Row label="Browser refresh" value={mode} />
        <Row label="Current Ethereum block" value={chain?.headBlock?.toLocaleString("en-US") ?? (block ? block.toLocaleString("en-US") : "Waiting")} />
        <Row label="LP monitor checkpoint" value={chain?.lpMonitorBlock?.toLocaleString("en-US") ?? "Not saved yet"} />
        <Row label="Newest pair creation block" value={chain?.pairMonitorBlock?.toLocaleString("en-US") ?? "Waiting"} />
        <Row label="Blocks behind" value={behind == null ? "Waiting" : String(behind)} />
        <Row label="Last successful LP scan" value={chain?.lastSuccessAt ? new Date(chain.lastSuccessAt).toISOString() : "Waiting"} />
        <Row label="Dataset" value={snapshot ? `${snapshot.generatedAt} · ${snapshot.rows.length} pairs` : "Waiting"} />
        <Row label="New burns in last publish" value={snapshot?.lpScan ? String(snapshot.lpScan.newBurns) : "Waiting"} />
        <Row label="Notification permission" value={health?.permission ?? "Checking"} />
        <Row label="Service worker" value={health?.worker ?? "Checking"} />
        <Row label="Push subscription" value={health?.push ?? "Checking"} />
        <Row label="Secure origin" value={health?.secure ?? "Checking"} />
        <Row label="Published scan" value={error ?? "Online"} />
      </dl>
      <div className="max-w-3xl text-sm leading-6 text-muted-foreground">
        <p>The DEXTools live listing ends after about 24 hours. Pairs and LP burns older than that are backfilled from Ethereum and kept in the published snapshot. Uniswap V2 and SushiSwap PairCreated logs supply the older pairs. The live LP checkpoint is separate, and a failed RPC call does not move it. Backfill burns are stored and do not send a new-burn notification.</p>
        <p className="mt-2">The first live scan looks back 300 blocks, not 24 hours. Later scans continue from the saved block and replay 12 blocks so a short reorg can be deduplicated. Historical backfill keeps its own cursor. A failed RPC call leaves that cursor where it was, and the next publish resumes. Backfill does not move the live LP checkpoint.</p>
        <p className="mt-2">Chrome notifications work while this site is open, including a background tab, through the service worker. Web Push after the browser closes the site needs a push server, which GitHub Pages does not provide.</p>
      </div>
    </PageFrame>
  )
}

function oldest(values: string[]): number | null {
  const times = values.map((value) => Date.parse(value)).filter(Number.isFinite)
  return times.length ? Math.min(...times) : null
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/10">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  )
}
