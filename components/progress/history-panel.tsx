import Link from "next/link"
import { coverageText, jobEtaMs, jobProgress, type BackfillState, type HistoryJob } from "@/lib/history/plan"
import { formatDuration } from "@/lib/lp/monitor"

export function ProgressMeter({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="font-medium tabular-nums">{value == null ? "Working" : `${value}%`}</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        aria-label={label}
      >
        {value == null ? <div className="h-full w-1/3 animate-pulse bg-primary" /> : <div className="h-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${value}%` }} />}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  )
}

export function HistoryPanel({
  backfill,
  oldestPair,
  pairCount,
  oldestBurn,
  burnCount,
  requestedMs,
  now,
}: {
  backfill: BackfillState | null | undefined
  oldestPair: number | null
  pairCount: number
  oldestBurn: number | null
  burnCount: number
  requestedMs?: number
  now: number
}) {
  const pairs = backfill?.pairs
  const burns = backfill?.burns
  const running = pairs?.status === "running" || pairs?.status === "failed" || burns?.status === "running" || burns?.status === "failed"
  const note = requestedMs ? coverageText(oldestPair, requestedMs, pairs, now) : null
  if (!backfill && !note) return null
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Historical coverage</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{backfill?.scope}</p>
        </div>
        <p className="text-xs text-muted-foreground">{running ? "Live monitoring continues during this scan." : "Backfill is not running."}</p>
      </div>
      {backfill?.providerNote ? <p className="text-sm">{backfill.providerNote}</p> : null}
      {note ? <p className="text-sm">{note}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <JobMeter job={pairs} label="WETH pair history" countLabel={`${pairCount.toLocaleString("en-US")} pairs stored`} oldest={oldestPair} now={now} />
        <JobMeter job={burns} label="LP burn history" countLabel={`${burnCount.toLocaleString("en-US")} burn events stored`} oldest={oldestBurn} now={now} />
      </div>
    </section>
  )
}

function JobMeter({ job, label, countLabel, oldest, now }: { job: HistoryJob | null | undefined; label: string; countLabel: string; oldest: number | null; now: number }) {
  const value = jobProgress(job)
  const eta = jobEtaMs(job, now)
  const oldestText = oldest == null ? "Oldest record: not stored yet" : `Oldest record: ${new Date(oldest).toISOString()}`
  const detail = [
    job?.stage ?? "No backfill has been published yet.",
    job ? `${job.blocksDone.toLocaleString("en-US")} / ${job.blocksTotal.toLocaleString("en-US")} blocks` : null,
    countLabel,
    oldestText,
    job?.error ? `Last error: ${job.error}` : null,
    eta == null ? null : `Estimated remaining ${formatDuration(eta)}`,
  ].filter(Boolean).join(" · ")
  return <ProgressMeter label={label} value={job?.status === "completed" ? 100 : value} detail={detail} />
}

export function BackfillLink({ backfill }: { backfill: BackfillState | null | undefined }) {
  const job = backfill?.pairs?.status === "running" || backfill?.pairs?.status === "failed" ? backfill.pairs : backfill?.burns?.status === "running" || backfill?.burns?.status === "failed" ? backfill.burns : null
  if (!job) return null
  const value = jobProgress(job)
  return <Link href="/system" className="text-foreground underline">History backfill {value == null ? "" : `${value}%`}</Link>
}
