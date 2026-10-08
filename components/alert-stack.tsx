"use client"

import { ExternalLink, Flame, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatExactPercent, formatUsd } from "@/lib/format"
import type { WatchAlert } from "@/lib/watch"

const MAX_VISIBLE = 4

type AlertStackProps = {
  alerts: WatchAlert[]
  onDismiss: (id: string) => void
  onDismissAll: () => void
}

export function AlertStack({ alerts, onDismiss, onDismissAll }: AlertStackProps) {
  if (alerts.length === 0) return null
  const visible = alerts.slice(0, MAX_VISIBLE)
  const hidden = alerts.length - visible.length

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed right-4 bottom-4 z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {visible.map((alert) => (
        <div
          key={alert.id}
          className="flex gap-3 rounded-xl bg-card p-3 shadow-lg ring-1 ring-emerald-400/40"
        >
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
            <Flame className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-xs font-medium tracking-wide text-emerald-300 uppercase">
              {alert.test ? "Test alert" : "New LP burnt token"}
            </p>
            <p className="truncate text-sm font-medium">{alert.name}</p>
            <p className="text-xs text-muted-foreground">
              {alert.exchange} · Liquidity {formatUsd(alert.liquidity)} · Burnt{" "}
              {formatExactPercent(alert.burntPercent)} · Market cap {formatUsd(alert.marketCap)}
            </p>
            <a
              href={alert.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
            >
              Open on DEXTools
              <ExternalLink className="size-3" />
            </a>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(alert.id)}
            aria-label={`Dismiss alert for ${alert.name}`}
            className="h-fit rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
      {hidden > 0 || alerts.length > 1 ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-card/95 px-3 py-2 text-xs text-muted-foreground ring-1 ring-foreground/10">
          <span>{hidden > 0 ? `${hidden} more new LP burnt ${hidden === 1 ? "token" : "tokens"}` : `${alerts.length} alerts`}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onDismissAll}>
            Dismiss all
          </Button>
        </div>
      ) : null}
    </div>
  )
}
