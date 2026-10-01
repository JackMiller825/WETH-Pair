"use client"

import { useEffect, useState } from "react"
import { Bell, BellOff, Loader2, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { NotificationState } from "@/lib/alerts"

type WatchPanelProps = {
  watching: boolean
  refreshing: boolean
  nextAt: number | null
  lastUpdated: number | null
  failed: boolean
  sound: boolean
  desktop: NotificationState
  disabled: boolean
  onToggle: () => void
  onSoundChange: (value: boolean) => void
  onTest: () => void
  intervalSeconds: number
}

function useCountdown(nextAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (nextAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [nextAt])
  if (nextAt === null) return null
  return Math.max(0, Math.ceil((nextAt - now) / 1000))
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour12: false })
}

export function WatchPanel({
  watching,
  refreshing,
  nextAt,
  lastUpdated,
  failed,
  sound,
  desktop,
  disabled,
  onToggle,
  onSoundChange,
  onTest,
  intervalSeconds,
}: WatchPanelProps) {
  const seconds = useCountdown(watching && !refreshing ? nextAt : null)

  let status = `After Start or Find LP Burnt Token, results refresh every ${intervalSeconds} seconds and a new LP burnt token raises an alert.`
  if (watching) {
    if (refreshing) status = "Updating results..."
    else if (failed) status = `The last update failed. Trying again in ${seconds ?? intervalSeconds}s.`
    else if (lastUpdated)
      status = `Watching. Updated ${clock(lastUpdated)}. Next update in ${seconds ?? intervalSeconds}s.`
    else status = `Watching. Next update in ${seconds ?? intervalSeconds}s.`
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {refreshing ? <Loader2 className="size-4 animate-spin text-emerald-300" /> : watching ? <Bell className="size-4 text-emerald-300" /> : <BellOff className="size-4 text-muted-foreground" />}
          Watch for new LP burnt tokens
          {watching ? (
            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs text-emerald-300">On</span>
          ) : null}
        </p>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {status}
        </p>
        {watching && desktop === "default" ? (
          <p className="text-xs text-amber-300">
            Allow notifications when the browser asks, so an alert still appears when this tab is in the
            background.
          </p>
        ) : null}
        {watching && desktop === "denied" ? (
          <p className="text-xs text-amber-300">
            Desktop notifications are blocked for this site. Allow them in your browser settings to get alerts
            when this tab is in the background. On-screen alerts and sound still work.
          </p>
        ) : null}
        {watching && desktop === "unsupported" ? (
          <p className="text-xs text-amber-300">
            This browser does not support desktop notifications. On-screen alerts and sound still work.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={sound}
          onClick={() => onSoundChange(!sound)}
        >
          {sound ? <Volume2 /> : <VolumeX />}
          Sound {sound ? "on" : "off"}
        </Button>
        {watching ? (
          <Button type="button" variant="ghost" size="sm" onClick={onTest}>
            Test alert
          </Button>
        ) : null}
        <Button
          type="button"
          variant={watching ? "outline" : "default"}
          onClick={onToggle}
          disabled={disabled}
        >
          {watching ? <BellOff /> : <Bell />}
          {watching ? "Stop watching" : "Start watching"}
        </Button>
      </div>
    </div>
  )
}
