import type { BackfillState } from "@/lib/history/plan"
import type { ChainCheckpoint } from "@/lib/lp/burn-logic"

export type HealthState = "connected" | "backfilling" | "delayed" | "failed" | "waiting"

export function rpcHealth(chain: Pick<ChainCheckpoint, "lastError" | "lastSuccessAt"> | null | undefined, now: number): HealthState {
  if (!chain) return "waiting"
  if (chain.lastError) return "failed"
  const success = chain.lastSuccessAt ? Date.parse(chain.lastSuccessAt) : NaN
  if (!Number.isFinite(success)) return "waiting"
  if (now - success > 30 * 60 * 1000) return "delayed"
  return "connected"
}

export function backfillHealth(backfill: BackfillState | null | undefined): HealthState {
  if (!backfill) return "waiting"
  const statuses = [backfill.pairs.status, backfill.burns.status]
  if (statuses.includes("failed")) return "failed"
  if (statuses.includes("running")) return "backfilling"
  if (statuses.every((status) => status === "completed")) return "connected"
  return "waiting"
}
