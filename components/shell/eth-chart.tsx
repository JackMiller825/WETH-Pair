"use client"

import { useEffect, useState } from "react"
import { MarketChart } from "@/components/shell/market-chart"
import { ETH_CHARTS, loadEthBars, type PriceBar } from "@/lib/market/chart"
import { formatEthPrice } from "@/lib/market/format"

export function EthChart() {
  const [interval, setIntervalId] = useState("5m")
  const [active, setActive] = useState("5m")
  const [style, setStyle] = useState<"area" | "candles">("area")
  const [view, setView] = useState<{ id: string; bars: PriceBar[]; source: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (interval !== active) {
    setActive(interval)
    setError(null)
  }
  useEffect(() => {
    let cancel = false
    loadEthBars(interval)
      .then((rows) => {
        if (!cancel) {
          setView({ id: interval, bars: rows.bars, source: rows.source })
          setError(null)
        }
      })
      .catch(() => {
        if (!cancel) setError("The ETH chart could not be loaded.")
      })
    return () => {
      cancel = true
    }
  }, [interval])
  const bars = view?.id === interval ? view.bars : null
  const rising = bars != null && bars.length > 1 && bars[bars.length - 1].close >= bars[0].close
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <div className="flex gap-1" role="group" aria-label="Chart style">
          <button type="button" aria-pressed={style === "area"} onClick={() => setStyle("area")} className={`rounded px-1.5 py-0.5 text-[11px] ${style === "area" ? "bg-foreground text-background" : "text-muted-foreground"}`}>Area</button>
          <button type="button" aria-pressed={style === "candles"} onClick={() => setStyle("candles")} className={`rounded px-1.5 py-0.5 text-[11px] ${style === "candles" ? "bg-foreground text-background" : "text-muted-foreground"}`}>Candles</button>
        </div>
        <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Chart interval">
          {ETH_CHARTS.map((item) => (
            <button key={item.id} type="button" aria-pressed={interval === item.id} onClick={() => setIntervalId(item.id)} className={`rounded px-1.5 py-0.5 text-[11px] uppercase ${interval === item.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{item.label}</button>
          ))}
        </div>
      </div>
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
      {bars && view ? <p className="mt-1 text-[10px] text-muted-foreground">{view.source} ETH/USD</p> : null}
    </div>
  )
}
