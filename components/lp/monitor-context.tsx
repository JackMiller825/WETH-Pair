"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createAudioContext, playNamedTone, requestNotifications, sendDesktopNotification } from "@/lib/alerts"
import {
  DEFAULT_CONFIG,
  eventsOf,
  resolveInterval,
  type LpBurnEvent,
  type WatchConfig,
} from "@/lib/lp/monitor"
import type { SnapshotFile } from "@/lib/narrative/types"

const CONFIG_KEY = "weth-lp-watch"
const SEEN_KEY = "weth-lp-burn-seen"
const HEADS_URL = "wss://ethereum-rpc.publicnode.com"

export type MonitorMode = "active" | "paused" | "error" | "realtime"

type MonitorValue = {
  config: WatchConfig
  update: (patch: Partial<WatchConfig>) => void
  snapshot: SnapshotFile | null
  loading: boolean
  error: string | null
  mode: MonitorMode
  lastCheck: number | null
  nextCheck: number | null
  block: number | null
  rpc: string
  alerts: LpBurnEvent[]
  dismiss: (id: string) => void
  scanNow: () => void
  testSound: () => void
  deliveryNote: string | null
}

const MonitorContext = createContext<MonitorValue | null>(null)

function readConfig(): WatchConfig {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) || "") as Partial<WatchConfig>
    const preset = DEFAULT_CONFIG.preset
    const windowId = DEFAULT_CONFIG.windowId
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      preset: parsed.preset && ["1m", "5m", "15m", "30m", "1h", "3h", "6h", "custom"].includes(parsed.preset) ? parsed.preset : preset,
      windowId: parsed.windowId && ["5m", "15m", "1h", "6h", "24h", "7d", "custom"].includes(parsed.windowId) ? parsed.windowId : windowId,
      soundId: parsed.soundId === "chime" || parsed.soundId === "pulse" ? parsed.soundId : "beep",
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

function readSeen(): Set<string> | null {
  const raw = localStorage.getItem(SEEN_KEY)
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === "string"))
  } catch {
    return new Set()
  }
}

function writeSeen(ids: Set<string>) {
  localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-4000)))
}

function alertText(event: LpBurnEvent): string {
  return [
    `Token: ${event.tokenName}`,
    `Ticker: $${event.symbol}`,
    `Pair: ${event.symbol}/WETH`,
    `LP Burn: ${event.lpBurntPercent.toFixed(1)}%`,
    `Liquidity: ${event.liquidity ?? "unknown"}`,
    `Market Cap: ${event.marketCap ?? "unknown"}`,
  ].join("\n")
}

export function LpMonitor({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<WatchConfig>(DEFAULT_CONFIG)
  const [ready, setReady] = useState(false)
  const [snapshot, setSnapshot] = useState<SnapshotFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastCheck, setLastCheck] = useState<number | null>(null)
  const [block, setBlock] = useState<number | null>(null)
  const [socket, setSocket] = useState<"off" | "open" | "error">("off")
  const [alerts, setAlerts] = useState<LpBurnEvent[]>([])
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null)
  const [scanNonce, setScanNonce] = useState(0)
  const configRef = useRef(config)
  const audioRef = useRef<AudioContext | null>(null)
  const lastFetchRef = useRef(0)
  configRef.current = config

  useEffect(() => {
    setConfig(readConfig())
    setReady(true)
  }, [])

  useEffect(() => {
    if (ready) localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  }, [config, ready])

  const update = useCallback((patch: Partial<WatchConfig>) => {
    setConfig((current) => ({ ...current, ...patch }))
    if (patch.browser) void requestNotifications()
    if (patch.sound) audioRef.current = audioRef.current ?? createAudioContext()
  }, [])

  const dismiss = useCallback((id: string) => {
    setAlerts((current) => current.filter((event) => event.id !== id))
  }, [])

  const testSound = useCallback(() => {
    audioRef.current = audioRef.current ?? createAudioContext()
    playNamedTone(audioRef.current, configRef.current.soundId)
  }, [])

  const considerAlerts = useCallback((data: SnapshotFile) => {
    const current = configRef.current
    const events = eventsOf(data).filter((event) => event.kind === "newly-burned")
    const seen = readSeen()
    if (seen == null) {
      writeSeen(new Set(eventsOf(data).map((event) => event.id)))
      return
    }
    const fresh = events.filter((event) => !seen.has(event.id))
    if (!current.enabled || current.paused) return
    for (const event of eventsOf(data)) seen.add(event.id)
    writeSeen(seen)
    if (fresh.length === 0) return
    const announce = fresh.slice(0, 3)
    if (fresh.length > announce.length) {
      setDeliveryNote(`${fresh.length - announce.length} more new LP burns are in the watch list.`)
    }
    if (current.inApp) setAlerts((existing) => [...announce, ...existing].slice(0, 4))
    for (const event of announce) {
      if (current.browser) sendDesktopNotification("🔥 NEW LP BURN DETECTED", alertText(event), event.id)
      if (current.sound) playNamedTone(audioRef.current, current.soundId)
      const body = { type: "lp-burn", chainId: event.chainId, id: event.id, text: alertText(event), event }
      const posts: Promise<void>[] = []
      if (current.webhook && current.webhookUrl) posts.push(postJson(current.webhookUrl, body))
      if (current.telegram && current.telegramUrl) posts.push(postJson(current.telegramUrl, body))
      if (posts.length) {
        void Promise.all(posts).then(
          () => {
            if (fresh.length <= announce.length) setDeliveryNote(null)
          },
          () => setDeliveryNote("A webhook or Telegram relay rejected the alert, or the browser blocked it."),
        )
      }
    }
  }, [])

  const load = useCallback(async () => {
    lastFetchRef.current = Date.now()
    setLastCheck(Date.now())
    try {
      const response = await fetch(`/data/snapshot.json?t=${Date.now()}`, { cache: "no-store" })
      if (!response.ok) throw new Error("The published pair list is not available.")
      const data = (await response.json()) as SnapshotFile
      setSnapshot(data)
      setError(null)
      considerAlerts(data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The pair list could not be loaded.")
    } finally {
      setLoading(false)
    }
  }, [considerAlerts])

  const pollKey = `${config.enabled}:${config.paused}:${config.preset}:${config.customValue}:${config.customUnit}:${scanNonce}`

  useEffect(() => {
    if (!ready) return
    void load()
    if (!config.enabled || config.paused) return
    const resolved = resolveInterval(config)
    if ("error" in resolved) return
    const timer = window.setInterval(() => void load(), resolved.ms)
    return () => window.clearInterval(timer)
    // The interval identity is pollKey. Other config fields must not restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pollKey, load])

  useEffect(() => {
    if (!ready || !config.realtime || config.paused || !config.enabled) {
      setSocket("off")
      setBlock(null)
      return
    }
    let closed = false
    let ws: WebSocket
    try {
      ws = new WebSocket(HEADS_URL)
    } catch {
      setSocket("error")
      return
    }
    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] }))
    }
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { params?: { result?: { number?: string } } }
        const hex = message.params?.result?.number
        if (typeof hex !== "string") return
        if (!closed) {
          setBlock(Number.parseInt(hex, 16))
          setSocket("open")
        }
      } catch {
        // Ignore subscription confirmations that are not block headers.
      }
    }
    ws.onerror = () => {
      if (!closed) setSocket("error")
    }
    ws.onclose = () => {
      if (!closed) setSocket("error")
    }
    return () => {
      closed = true
      ws.close()
    }
  }, [ready, config.realtime, config.paused, config.enabled])

  useEffect(() => {
    if (socket !== "open" || block == null) return
    if (Date.now() - lastFetchRef.current < 15_000) return
    void load()
  }, [block, socket, load])

  const resolved = resolveInterval(config)
  const nextCheck =
    config.enabled && !config.paused && lastCheck != null && !("error" in resolved) ? lastCheck + resolved.ms : null

  let mode: MonitorMode = "active"
  if (!config.enabled || config.paused) mode = "paused"
  else if (error || (config.realtime && socket === "error")) mode = "error"
  else if (config.realtime && socket === "open") mode = "realtime"

  const rpc = error
    ? "Published scan unavailable"
    : config.realtime && socket === "open"
      ? `Ethereum heads connected${block != null ? `, block ${block.toLocaleString("en-US")}` : ""}`
      : config.realtime && socket === "error"
        ? "Ethereum heads unavailable. Using the refresh interval."
        : "Published scan"

  const value = useMemo<MonitorValue>(
    () => ({
      config,
      update,
      snapshot,
      loading,
      error,
      mode,
      lastCheck,
      nextCheck,
      block,
      rpc,
      alerts,
      dismiss,
      scanNow: () => setScanNonce((value) => value + 1),
      testSound,
      deliveryNote,
    }),
    [config, update, snapshot, loading, error, mode, lastCheck, nextCheck, block, rpc, alerts, dismiss, testSound, deliveryNote],
  )

  return <MonitorContext.Provider value={value}>{children}</MonitorContext.Provider>
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(String(response.status))
}

export function useLpMonitor(): MonitorValue {
  const value = useContext(MonitorContext)
  if (!value) throw new Error("LP monitoring is only available inside the site layout.")
  return value
}

export function modeLabel(mode: MonitorMode): string {
  if (mode === "realtime") return "⚡ Real-Time"
  if (mode === "paused") return "🟡 Paused"
  if (mode === "error") return "🔴 Connection Error"
  return "🟢 Active"
}
