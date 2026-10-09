import Link from "next/link"
import { coverageText, jobEtaMs, jobProgress, overallProgress, type BackfillState, type HistoryJob } from "@/lib/history/plan"
import { formatDuration } from "@/lib/lp/monitor"

export function ProgressMeter({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-3xl font-semibold tabular-nums text-primary">{value == null ? "…" : `${value}%`}</span>
      </div>
      <ProgressTrack label={label} value={value} />
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  )
}

function ProgressTrack({ label, value }: { label: string; value: number | null }) {
  return (
    <div
      className="mt-3 h-3 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-label={label}
    >
      {value == null ? <div className="h-full w-1/3 animate-pulse bg-primary" /> : <div className="progress-fill h-full rounded-full bg-primary" style={{ width: `${value}%` }} />}
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
  const overall = overallProgress(backfill)
  const complete = overall === 100
  const note = requestedMs ? coverageText(oldestPair, requestedMs, pairs, now) : null
  if (!backfill && !note) return null
  return (
    <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-primary/30">
      <div className="px-5 py-5">
        <p className="text-xs font-medium tracking-[0.14em] text-primary">{complete ? "HISTORY READY" : "LOADING ALL HISTORY"}</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">{complete ? "7-day history is complete" : "Collecting the full 7-day record"}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {complete
                ? "New pairs, LP burns, trends, and news now use the stored history. A selected range is no longer limited to the last day."
                : "Exact 3-day and 7-day results unlock at 100%. Numbers shown before that are only the blocks saved so far. Live monitoring keeps running."}
            </p>
          </div>
          <p className="text-6xl font-semibold tabular-nums leading-none text-primary">{overall == null ? "…" : `${overall}%`}</p>
        </div>
        <ProgressTrack label="All historical data" value={overall} />
        {backfill?.providerNote ? <p className="mt-3 text-sm">{backfill.providerNote}</p> : null}
        {note && !complete ? <p className="mt-2 text-sm">{note}</p> : null}
      </div>
      <div className="grid gap-px bg-foreground/10 md:grid-cols-2">
        <div className="bg-card px-5 py-5">
          <JobMeter job={pairs} label="WETH pairs" countLabel={`${pairCount.toLocaleString("en-US")} pairs stored`} oldest={oldestPair} now={now} />
        </div>
        <div className="bg-card px-5 py-5">
          <JobMeter job={burns} label="LP burns" countLabel={`${burnCount.toLocaleString("en-US")} burn events stored`} oldest={oldestBurn} now={now} />
        </div>
      </div>
    </section>
  )
}

function JobMeter({ job, label, countLabel, oldest, now }: { job: HistoryJob | null | undefined; label: string; countLabel: string; oldest: number | null; now: number }) {
  const value = job?.status === "completed" ? 100 : jobProgress(job)
  const eta = jobEtaMs(job, now)
  const oldestText = oldest == null ? "Oldest record not stored yet" : `Oldest record ${new Date(oldest).toISOString()}`
  const detail = [
    job?.stage ?? "Waiting for the first backfill publish.",
    job ? `${job.blocksDone.toLocaleString("en-US")} / ${job.blocksTotal.toLocaleString("en-US")} blocks` : null,
    countLabel,
    oldestText,
    eta == null ? null : `About ${formatDuration(eta)} left in this scan`,
    job?.error ? job.error : null,
  ].filter(Boolean).join(". ")
  return <ProgressMeter label={label} value={value} detail={`${detail}.`} />
}

export function HistoryBanner({ backfill }: { backfill: BackfillState | null | undefined }) {
  const value = overallProgress(backfill)
  if (value == null || value >= 100) return null
  return (
    <div className="page-wrap pb-4">
      <Link href="/lp-burns" className="block rounded-xl bg-card px-4 py-3 ring-1 ring-primary/40">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[0.14em] text-primary">LOADING ALL HISTORY</p>
            <p className="mt-1 text-sm text-muted-foreground">Exact results for every range appear when this reaches 100%.</p>
          </div>
          <p className="text-4xl font-semibold tabular-nums leading-none text-primary">{value}%</p>
        </div>
        <ProgressTrack label="All historical data" value={value} />
      </Link>
    </div>
  )
}

export function BackfillLink({ backfill }: { backfill: BackfillState | null | undefined }) {
  const value = overallProgress(backfill)
  if (value == null || value >= 100) return null
  return <Link href="/lp-burns" className="text-foreground underline">History {value}%</Link>
}
