import type { LpBurnEvent } from "@/lib/lp/monitor"
import type { PairRecord } from "@/lib/types"

export type ActivitySighting =
  | { type: "pair"; record: PairRecord; token0: string | null }
  | { type: "burn"; event: LpBurnEvent }
  | { type: "head"; block: number }

type Listener = (sighting: ActivitySighting) => void

const listeners = new Set<Listener>()
let queue: ActivitySighting[] = []
let scheduled = false

function flush() {
  scheduled = false
  const batch = queue
  queue = []
  for (const sighting of batch) for (const listener of listeners) listener(sighting)
}

/**
 * Hand-off from the LP monitor to Live Activity. Publishing only appends to a queue; listeners run in a
 * later macrotask, so the socket handler that detected a burn returns before any enrichment work starts.
 */
export function publishActivity(sighting: ActivitySighting) {
  queue.push(sighting)
  if (queue.length > 1000) queue = queue.slice(-1000)
  if (scheduled) return
  scheduled = true
  setTimeout(flush, 0)
}

export function onActivity(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
