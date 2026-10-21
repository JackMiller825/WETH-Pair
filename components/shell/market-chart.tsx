"use client"

import { useState, type MouseEvent, type ReactNode } from "react"

export type ChartCandle = { open: number; high: number; low: number; close: number }
export type ChartLine = { id: string; label: string; color: string; values: readonly number[] }

const PAD = { top: 12, right: 8, bottom: 8, left: 52 }

function extent(values: readonly number[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (!Number.isFinite(min) || min === max) return { min: min === max ? min * 0.98 : 0, max: min === max ? max * 1.02 : 1 }
  const pad = (max - min) * 0.08
  return { min: min - pad, max: max + pad }
}

/** Area, candlestick, or multi-line chart drawn from the prices passed in. */
export function MarketChart({
  candles,
  lines,
  area = false,
  formatValue,
  formatTime,
}: {
  candles?: readonly ChartCandle[]
  lines?: readonly ChartLine[]
  area?: boolean
  formatValue: (value: number) => string
  formatTime?: (index: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const count = candles?.length ?? lines?.[0]?.values.length ?? 0
  if (count < 2) return <p className="py-6 text-center text-xs text-muted-foreground">Waiting for enough prices to draw the chart.</p>
  const values = candles ? candles.flatMap((bar) => [bar.low, bar.high]) : (lines ?? []).flatMap((line) => [...line.values])
  const { min, max } = extent(values)
  const width = 640
  const height = 220
  const innerW = width - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const xAt = (index: number) => PAD.left + (count === 1 ? innerW / 2 : (index / (count - 1)) * innerW)
  const yAt = (value: number) => PAD.top + ((max - value) / (max - min)) * innerH
  const ticks = [max, (max + min) / 2, min]
  const index = hover == null ? count - 1 : hover
  const guide = xAt(index)

  function onMove(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * width
    const slot = Math.round(((x - PAD.left) / innerW) * (count - 1))
    setHover(Math.max(0, Math.min(count - 1, slot)))
  }

  let body: ReactNode = null
  if (candles) {
    const slot = innerW / count
    body = candles.map((bar, item) => {
      const up = bar.close >= bar.open
      const color = up ? "#4ade80" : "#f87171"
      const high = yAt(bar.high)
      const low = yAt(bar.low)
      const open = yAt(bar.open)
      const close = yAt(bar.close)
      return (
        <g key={item}>
          <line x1={xAt(item)} x2={xAt(item)} y1={high} y2={low} stroke={color} strokeWidth="1" />
          <rect x={xAt(item) - slot * 0.3} y={Math.min(open, close)} width={Math.max(1, slot * 0.6)} height={Math.max(1, Math.abs(close - open))} fill={color} />
        </g>
      )
    })
  } else if (lines) {
    body = lines.map((line) => {
      const path = line.values.map((value, item) => `${item === 0 ? "M" : "L"}${xAt(item).toFixed(1)},${yAt(value).toFixed(1)}`).join(" ")
      const fill = area && lines.length === 1 ? `${path} L${xAt(count - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${xAt(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z` : null
      return (
        <g key={line.id}>
          {fill ? <path d={fill} fill={line.color} opacity="0.18" /> : null}
          <path d={path} fill="none" stroke={line.color} strokeWidth="1.6" />
        </g>
      )
    })
  }

  const caption = candles
    ? `${formatValue(candles[index].close)} · O ${formatValue(candles[index].open)} H ${formatValue(candles[index].high)} L ${formatValue(candles[index].low)}`
    : (lines ?? []).map((line) => `${line.label} ${formatValue(line.values[index] ?? Number.NaN)}`).join(" · ")

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full" role="img" aria-label="Price chart" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yAt(tick)} y2={yAt(tick)} stroke="currentColor" opacity="0.12" />
            <text x={PAD.left - 6} y={yAt(tick) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{formatValue(tick)}</text>
          </g>
        ))}
        {body}
        <line x1={guide} x2={guide} y1={PAD.top} y2={PAD.top + innerH} stroke="currentColor" opacity="0.35" />
      </svg>
      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{formatTime ? `${formatTime(index)} · ` : ""}{caption}</p>
    </div>
  )
}
