"use client"

import { useMemo, useState } from "react"
import { activeHours, ACTIVITY_LABEL, CONDITION_LABEL, formatCompact, formatDelta, formatInZone, heatmap, hourSpanLabel, readConditionHistory, type ActivityBucket, type ActivityLevel, type ConditionPoint, type ScoreResult, type WindowStat } from "@/lib/activity/pulse"
import { formatChange } from "@/lib/market/format"
import { resolveZone } from "@/lib/types"

export type SeriesMode = "pairs" | "burns" | "both"

const PAIR = "#38bdf8"
const BURN = "#fb923c"

function tone(change: number | null): string {
  if (change == null || Math.abs(change) < 0.05) return "text-muted-foreground"
  return change > 0 ? "tone-up" : "tone-down"
}

export function ActivityMetricHeader({
  title,
  stats,
  level,
  open,
  onToggle,
  range,
  ranges,
  onRange,
  series,
  onSeries,
  pairBuckets,
  burnBuckets,
  zone,
}: {
  title: string
  stats: WindowStat[]
  level: ActivityLevel | null
  open: boolean
  onToggle: () => void
  range: string
  ranges: readonly { id: string; label: string }[]
  onRange: (id: string) => void
  series: SeriesMode
  onSeries: (mode: SeriesMode) => void
  pairBuckets: ActivityBucket[]
  burnBuckets: ActivityBucket[]
  zone: string
}) {
  const headline = stats.find((item) => item.id === "24h")
  return (
    <div className="border-b border-foreground/10 px-3 py-2">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">{title}</p>
        {headline ? <span className="text-[11px] text-muted-foreground tabular-nums">{formatCompact(headline.current)} / 24H</span> : null}
        {level ? <span className="text-[11px] text-foreground">{ACTIVITY_LABEL[level]}</span> : null}
        <button type="button" onClick={onToggle} aria-pressed={open} className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
          {open ? "Hide chart" : "Show chart"}
        </button>
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1">
        {stats.map((item) => (
          <div key={item.id}>
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">{item.label}</p>
            <p className="text-sm font-semibold tabular-nums">{formatCompact(item.current)}</p>
            <p className={`text-[10px] tabular-nums ${tone(item.change)}`}>{formatDelta(item.current, item.previous)}</p>
          </div>
        ))}
      </div>
      {open ? (
        <div className="mt-2">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {ranges.map((item) => (
              <button key={item.id} type="button" aria-pressed={range === item.id} onClick={() => onRange(item.id)} className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${range === item.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {item.label}
              </button>
            ))}
            <span className="mx-1 text-muted-foreground">·</span>
            {(["pairs", "burns", "both"] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={series === mode} onClick={() => onSeries(mode)} className={`rounded px-1.5 py-0.5 text-[10px] capitalize ${series === mode ? "bg-foreground text-background" : "text-muted-foreground"}`}>
                {mode === "both" ? "Both" : mode === "pairs" ? "Pairs" : "LP burns"}
              </button>
            ))}
          </div>
          <HourlyActivityChart pairBuckets={series === "burns" ? [] : pairBuckets} burnBuckets={series === "pairs" ? [] : burnBuckets} zone={zone} />
        </div>
      ) : null}
    </div>
  )
}

export function HourlyActivityChart({ pairBuckets, burnBuckets, zone }: { pairBuckets: ActivityBucket[]; burnBuckets: ActivityBucket[]; zone: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const count = Math.max(pairBuckets.length, burnBuckets.length)
  if (count === 0) return <p className="py-3 text-[11px] text-muted-foreground">No buckets in this range.</p>
  const peak = Math.max(1, ...pairBuckets.map((bucket) => bucket.count), ...burnBuckets.map((bucket) => bucket.count))
  const width = 320
  const height = 96
  const pad = 4
  const slot = (width - pad * 2) / count
  const yAt = (value: number) => pad + (1 - value / peak) * (height - pad * 2 - 14)
  const index = hover ?? count - 1
  const pair = pairBuckets[index]
  const burn = burnBuckets[index]
  const start = pair?.start ?? burn?.start
  const labelAt = (bucket: ActivityBucket | undefined) => bucket ? formatInZone(bucket.start, zone, { month: "short", day: "numeric", hour: "numeric" }) : ""
  const ticks = [0, Math.floor(count / 2), count - 1].filter((item, pos, list) => list.indexOf(item) === pos)
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" role="img" aria-label="Activity by hour" onMouseLeave={() => setHover(null)} onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const x = ((event.clientX - rect.left) / rect.width) * width
        setHover(Math.max(0, Math.min(count - 1, Math.floor((x - pad) / slot))))
      }}>
        {Array.from({ length: count }, (_, item) => {
          const pairCount = pairBuckets[item]?.count ?? 0
          const burnCount = burnBuckets[item]?.count ?? 0
          const both = pairBuckets.length > 0 && burnBuckets.length > 0
          const bar = both ? slot * 0.32 : slot * 0.62
          const base = height - 16
          return (
            <g key={item}>
              {pairBuckets.length > 0 ? <rect x={pad + item * slot + (both ? slot * 0.12 : slot * 0.16)} y={yAt(pairCount)} width={bar} height={Math.max(0, base - yAt(pairCount))} fill={PAIR} /> : null}
              {burnBuckets.length > 0 ? <rect x={pad + item * slot + (both ? slot * 0.5 : slot * 0.16)} y={yAt(burnCount)} width={bar} height={Math.max(0, base - yAt(burnCount))} fill={BURN} /> : null}
            </g>
          )
        })}
        {ticks.map((item) => (
          <text key={item} x={pad + item * slot} y={height - 2} className="fill-current text-[8px] text-muted-foreground">
            {pairBuckets[item] || burnBuckets[item] ? formatInZone((pairBuckets[item] ?? burnBuckets[item]).start, zone, { hour: "numeric" }) : ""}
          </text>
        ))}
      </svg>
      <p className="text-[10px] leading-4 text-muted-foreground tabular-nums">
        {start != null ? labelAt(pair ?? burn) : ""}
        {pairBuckets.length > 0 ? ` · Pairs ${pair?.count ?? 0}${pair?.change == null ? "" : ` (${pair.change > 0 ? "+" : ""}${Math.round(pair.change * 10) / 10}% vs previous)`}` : ""}
        {burnBuckets.length > 0 ? ` · LP burns ${burn?.count ?? 0}` : ""}
      </p>
    </div>
  )
}

type Survival = { eligible: number; active: number; rate: number | null }

function survivalText(label: string, item: Survival): string {
  return item.rate == null ? `${label} —` : `${label} ${item.rate.toFixed(0)}% of ${item.eligible}`
}

export function MarketPulse({
  pairs,
  burns,
  tx,
  txPrevious,
  netWeth,
  gas,
  gasLabel,
  eth1h,
  score,
  fresh,
  stale,
  zone,
  onZone,
  zones,
  pairTimes,
  now,
  recordedHour,
  typicalPairs,
  typicalBurns,
  survival,
  ratio,
  cohort,
  distribution,
}: {
  pairs: WindowStat | undefined
  burns: WindowStat | undefined
  tx: number
  txPrevious: number
  netWeth: number | null
  gas: number | null
  gasLabel: string | null
  eth1h: number | null
  score: ScoreResult
  fresh: string
  stale: boolean
  zone: string
  onZone: (zone: string) => void
  zones: readonly { id: string; label: string }[]
  pairTimes: readonly number[]
  now: number
  recordedHour: number
  typicalPairs: number | null
  typicalBurns: number | null
  survival: { m15: Survival; m30: Survival; h1: Survival; h3: Survival }
  ratio: number | null
  cohort: { launched: number; burned: number; rate: number | null }
  distribution: { n: number; median: number; p25: number; p75: number; p90: number; above12: number; above15: number; above2: number } | null
}) {
  const [open, setOpen] = useState(false)
  const resolved = resolveZone(zone)
  const calendar = useMemo(() => (open ? { cells: heatmap(pairTimes, now, resolved), active: activeHours(pairTimes, now, resolved) } : null), [open, pairTimes, now, resolved])
  const pairCount = pairs?.current ?? 0
  const burnCount = burns?.current ?? 0
  const recorded = useMemo(() => {
    if (!open) return []
    const stored = readConditionHistory().filter((row) => row.hour !== recordedHour && row.hour >= recordedHour - 168)
    stored.push({ hour: recordedHour, score: score.score, pairs: pairCount, burns: burnCount, tx, gas })
    stored.sort((a, b) => a.hour - b.hour)
    return stored
  }, [open, recordedHour, score, pairCount, burnCount, tx, gas])
  const maxCell = Math.max(1, ...(calendar?.cells ?? []).flatMap((row) => row.hours))
  return (
    <section className="border-b border-foreground/10 px-4 py-2" aria-label="Market conditions">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div>
          <p className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">Market conditions</p>
          <p className="text-sm font-semibold tabular-nums">{score.score} / 100 <span className="text-xs font-medium text-muted-foreground">{CONDITION_LABEL[score.band]}</span></p>
        </div>
        <PulseStat label="Pairs 1H" value={formatCompact(pairs?.current ?? 0)} delta={pairs ? formatDelta(pairs.current, pairs.previous) : "—"} change={pairs?.change ?? null} hint={typicalPairs == null ? null : `typical ${typicalPairs < 10 ? typicalPairs.toFixed(1) : Math.round(typicalPairs)}`} />
        <PulseStat label="LP burns 1H" value={formatCompact(burns?.current ?? 0)} delta={burns ? formatDelta(burns.current, burns.previous) : "—"} change={burns?.change ?? null} hint={typicalBurns == null ? null : `typical ${typicalBurns < 10 ? typicalBurns.toFixed(1) : Math.round(typicalBurns)}`} />
        <PulseStat label="Swaps 1H" value={formatCompact(tx)} delta={formatDelta(tx, txPrevious)} change={txPrevious === 0 && tx > 0 ? null : txPrevious === 0 ? 0 : ((tx - txPrevious) / txPrevious) * 100} />
        <PulseStat label="WETH reserves" value={netWeth == null ? "—" : `${netWeth >= 0 ? "+" : ""}${netWeth.toFixed(1)}`} delta="observed" change={null} />
        <PulseStat label="Gas" value={gas == null ? "—" : `${gas < 1 ? gas.toFixed(3) : gas.toFixed(2)} gwei`} delta={gasLabel ?? "—"} change={null} />
        <PulseStat label="ETH 1H" value={formatChange(eth1h)} delta="" change={eth1h} />
        <p className={`text-[10px] ${stale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{stale ? `⚠ Updated ${fresh}` : `Updated ${fresh}`}</p>
        <button type="button" onClick={() => setOpen((value) => !value)} className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground" aria-expanded={open}>
          {open ? "Hide details" : "View details"}
        </button>
      </div>
      {open ? (
        <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="text-[11px] leading-5 text-muted-foreground">
            <p className="text-foreground">{score.read}</p>
            <p>This score describes observed launch activity. It is not a prediction and not a chance of a successful launch.</p>
            <ul className="mt-1 grid grid-cols-2 gap-x-3">
              {score.parts.map((part) => (
                <li key={part.id} className="flex justify-between gap-2 tabular-nums"><span>{part.label}</span><span className="text-foreground">{part.score}</span></li>
              ))}
            </ul>
            <p className="mt-1">Event activity ratio, last hour: {ratio == null ? "—" : `${ratio.toFixed(1)}%`} of pair launches. Cohort LP burn rate, prior hour: {cohort.rate == null ? "—" : `${cohort.rate.toFixed(1)}%`} of {cohort.launched} pairs.</p>
            {distribution ? (
              <p>Recent launch multiples, last 6h (n={distribution.n}): median {distribution.median.toFixed(2)}x, 25th {distribution.p25.toFixed(2)}x, 75th {distribution.p75.toFixed(2)}x, top 10% {distribution.p90.toFixed(2)}x. At least 1.2x {(distribution.above12 * 100).toFixed(0)}%, 1.5x {(distribution.above15 * 100).toFixed(0)}%, 2x {(distribution.above2 * 100).toFixed(0)}%.</p>
            ) : <p>Recent launch multiples need two observed prices. None are indexed for the last 6 hours yet.</p>}
            <p>Historically active hours, last 7 days, pair launches: {calendar == null || calendar.active.length === 0 ? "not enough history" : calendar.active.map((item, index) => `#${index + 1} ${item.label} (${item.total})`).join(", ")}. These are the busiest observed hours, not a recommended launch time.</p>
            <p>Continued prices, pairs launched in the last 6h that are old enough: {survivalText("15m", survival.m15)}, {survivalText("30m", survival.m30)}, {survivalText("1h", survival.h1)}, {survivalText("3h", survival.h3)}. A later indexed price counts as continued activity.</p>
            <ConditionChart points={recorded} />
            <label className="mt-1 flex items-center gap-2">Display timezone
              <select value={zone} onChange={(event) => onZone(event.target.value)} className="rounded bg-muted px-1 py-0.5 text-foreground">
                {zones.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </div>
          <div>
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">7-day pair heatmap · 12 AM through 11 PM</p>
            <div className="mt-1 overflow-x-auto">
              <table className="text-[9px] text-muted-foreground">
                <tbody>
                  {(calendar?.cells ?? []).map((row) => (
                    <tr key={row.key}>
                      <th className="pr-1 text-left font-medium">{row.weekday}</th>
                      {row.hours.map((value, hour) => (
                        <td key={hour} title={`${row.weekday} ${hourSpanLabel(hour)}: ${value} pairs`} className="size-2.5" style={{ background: value === 0 ? "transparent" : `rgba(56, 189, 248, ${0.15 + (value / maxCell) * 0.85})` }} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ConditionChart({ points }: { points: readonly ConditionPoint[] }) {
  if (points.length < 2) return <p className="mt-1">The score chart fills in as this browser records each hour. Hours before that stay blank.</p>
  const width = 280
  const height = 64
  const min = Math.min(...points.map((point) => point.score))
  const max = Math.max(...points.map((point) => point.score))
  const span = Math.max(1, max - min)
  const path = points.map((point, index) => {
    const x = (index / (points.length - 1)) * (width - 8) + 4
    const y = height - 8 - ((point.score - min) / span) * (height - 16)
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(" ")
  const last = points[points.length - 1]
  return (
    <div className="mt-1">
      <p className="text-[10px] tracking-wide uppercase">Launch environment, recorded on this browser · last {last.score}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-16 w-full text-sky-400" role="img" aria-label="Launch environment score recorded on this browser">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  )
}

function PulseStat({ label, value, delta, change, hint }: { label: string; value: string; delta: string; change: number | null; hint?: string | null }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-xs font-semibold tabular-nums">{value} {delta ? <span className={tone(change)}>{delta}</span> : null}</p>
      {hint ? <p className="text-[10px] tabular-nums text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
