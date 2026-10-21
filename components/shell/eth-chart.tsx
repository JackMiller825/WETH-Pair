"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MarketChart } from "@/components/shell/market-chart"
import { useClock } from "@/components/shell/clock"
import { ETH_CHARTS, applyLivePrice, candleCountdown, chartById, formatCountdown, loadEthBars, loadLastEthPrice, type PriceBar } from "@/lib/market/chart"
import { formatEthPrice } from "@/lib/market/format"

export function EthChart() {
  const [interval, setIntervalId] = useState("15m")
  const [style, setStyle] = useState<"area" | "candles">("candles")
  const [attempt, setAttempt] = useState("15m:candles")
  const [tvFailed, setTvFailed] = useState(false)
  const [dark, setDark] = useState(true)
  const key = `${interval}:${style}`
  if (attempt !== key) {
    setAttempt(key)
    setTvFailed(false)
  }
  useEffect(() => {
    const root = document.documentElement
    const read = () => {
      const next = root.classList.contains("dark")
      setDark((current) => (current === next ? current : next))
    }
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    const frame = window.requestAnimationFrame(read)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [])
  const onFail = useCallback(() => setTvFailed(true), [])
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Chart style">
          <button type="button" aria-pressed={style === "area"} onClick={() => setStyle("area")} className={`rounded px-1.5 py-0.5 text-[11px] ${style === "area" ? "bg-foreground text-background" : "text-muted-foreground"}`}>Area</button>
          <button type="button" aria-pressed={style === "candles"} onClick={() => setStyle("candles")} className={`rounded px-1.5 py-0.5 text-[11px] ${style === "candles" ? "bg-foreground text-background" : "text-muted-foreground"}`}>Candles</button>
        </div>
        <LiveQuote intervalId={interval} />
        <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Chart interval">
          {ETH_CHARTS.map((item) => (
            <button key={item.id} type="button" aria-pressed={interval === item.id} onClick={() => setIntervalId(item.id)} className={`rounded px-1.5 py-0.5 text-[11px] uppercase ${interval === item.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{item.label}</button>
          ))}
        </div>
      </div>
      {tvFailed ? <FallbackChart intervalId={interval} style={style} /> : <TradingViewChart key={`${key}:${dark ? "dark" : "light"}`} intervalId={interval} style={style} dark={dark} onFail={onFail} />}
    </div>
  )
}

function LiveQuote({ intervalId }: { intervalId: string }) {
  const now = useClock(1000)
  const [live, setLive] = useState<{ price: number; source: string } | null>(null)
  const [tick, setTick] = useState<{ price: number; prev: number | null }>({ price: 0, prev: null })
  useEffect(() => {
    let cancel = false
    async function pull() {
      try {
        const next = await loadLastEthPrice()
        if (!cancel) setLive(next)
      } catch {
        if (!cancel) setLive(null)
      }
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 2000)
    return () => {
      cancel = true
      window.clearInterval(timer)
    }
  }, [])
  const price = live?.price ?? null
  if (price != null && price !== tick.price) setTick({ price, prev: tick.price > 0 ? tick.price : null })
  const chart = chartById(intervalId)
  const remaining = now == null ? null : candleCountdown(now, chart.granularity * 1000).remainingMs
  const rising = tick.prev == null || tick.price >= tick.prev
  return (
    <p className="flex flex-wrap items-center gap-2 text-[11px]" aria-live="polite">
      <span className={`rounded px-1.5 py-0.5 font-semibold text-white tabular-nums ${rising ? "bg-emerald-600" : "bg-red-600"}`}>{price == null ? "—" : formatEthPrice(price)}</span>
      <span className="text-muted-foreground tabular-nums">Closes in <span className="font-semibold text-foreground">{remaining == null ? "—" : formatCountdown(remaining)}</span></span>
    </p>
  )
}

function TradingViewChart({ intervalId, style, dark, onFail }: { intervalId: string; style: "area" | "candles"; dark: boolean; onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const node = host.current
    if (!node) return
    const chart = chartById(intervalId)
    const widget = document.createElement("div")
    widget.className = "tradingview-widget-container__widget"
    widget.style.height = "calc(100% - 32px)"
    widget.style.width = "100%"
    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
    script.async = true
    script.type = "text/javascript"
    script.text = JSON.stringify({
      autosize: true,
      symbol: "COINBASE:ETHUSD",
      interval: chart.tv,
      timezone: "Etc/UTC",
      theme: dark ? "dark" : "light",
      style: style === "candles" ? "1" : "3",
      locale: "en",
      enable_publishing: false,
      allow_symbol_change: false,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      withdateranges: false,
      support_host: "https://www.tradingview.com",
      backgroundColor: dark ? "#181716" : "#fffdf8",
      gridColor: dark ? "rgba(243, 239, 230, 0.06)" : "rgba(28, 24, 20, 0.08)",
      overrides: {
        "mainSeriesProperties.showCountdown": true,
        "scalesProperties.showSeriesLastValue": true,
      },
    })
    script.onerror = () => onFail()
    const container = document.createElement("div")
    container.className = "tradingview-widget-container"
    container.style.height = "100%"
    container.style.width = "100%"
    container.append(widget, script)
    node.replaceChildren(container)
    const look = window.setInterval(() => {
      if (node.querySelector("iframe")) {
        setReady(true)
        window.clearInterval(look)
      }
    }, 300)
    const giveUp = window.setTimeout(() => {
      if (!node.querySelector("iframe")) onFail()
    }, 12000)
    return () => {
      window.clearInterval(look)
      window.clearTimeout(giveUp)
      node.replaceChildren()
    }
  }, [intervalId, style, dark, onFail])
  return (
    <div className="relative h-80 w-full sm:h-[32rem]">
      <div ref={host} className="h-full w-full" />
      {ready ? null : <p className="absolute inset-0 grid place-items-center bg-popover text-xs text-muted-foreground">Loading the live chart…</p>}
    </div>
  )
}

function FallbackChart({ intervalId, style }: { intervalId: string; style: "area" | "candles" }) {
  const now = useClock(1000)
  const [view, setView] = useState<{ id: string; bars: PriceBar[]; source: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState<number | null>(null)
  useEffect(() => {
    let cancel = false
    async function pull() {
      try {
        const rows = await loadEthBars(intervalId)
        if (!cancel) {
          setView({ id: intervalId, bars: rows.bars, source: rows.source })
          setError(null)
        }
      } catch {
        if (!cancel) setError("The ETH chart could not be loaded.")
      }
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 15000)
    return () => {
      cancel = true
      window.clearInterval(timer)
    }
  }, [intervalId])
  useEffect(() => {
    let cancel = false
    async function pull() {
      try {
        const next = await loadLastEthPrice()
        if (!cancel) setLive(next.price)
      } catch {
        if (!cancel) setLive(null)
      }
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 2000)
    return () => {
      cancel = true
      window.clearInterval(timer)
    }
  }, [])
  const chart = chartById(intervalId)
  const raw = view?.id === intervalId ? view.bars : null
  const bars = raw && now != null && live != null ? applyLivePrice(raw, live, now, chart.granularity * 1000) : raw
  const rising = bars != null && bars.length > 1 && bars[bars.length - 1].close >= bars[0].close
  return (
    <div>
      {error ? <p className="text-xs text-amber-600 dark:text-amber-400">{error}</p> : null}
      {bars ? (
        <MarketChart
          candles={style === "candles" ? bars : undefined}
          lines={style === "area" ? [{ id: "close", label: "Price", color: rising ? "#4ade80" : "#f87171", values: bars.map((bar) => bar.close) }] : undefined}
          area={style === "area"}
          formatValue={(value) => formatEthPrice(value)}
          formatTime={(index) => new Date(bars[index].at).toLocaleString()}
        />
      ) : error ? null : <p className="py-6 text-center text-xs text-muted-foreground">Loading the ETH chart…</p>}
      {bars && view ? <p className="mt-1 text-[10px] text-muted-foreground">{view.source} ETH/USD. The open candle follows the latest trade.</p> : null}
    </div>
  )
}
