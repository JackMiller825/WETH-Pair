import { onActivity, type ActivitySighting } from "@/lib/activity/bus"
import { EnrichmentEngine } from "@/lib/activity/enrichment"
import { ActivityStore, burnActivity, pairActivity } from "@/lib/activity/store"

let store: ActivityStore | null = null
let engine: EnrichmentEngine | null = null

export function activityStore(): ActivityStore {
  store ??= new ActivityStore()
  return store
}

export function activityEngine(): EnrichmentEngine | null {
  return engine
}

export function applySighting(target: ActivityStore, sighting: ActivitySighting) {
  if (sighting.type === "pair") {
    const record = sighting.record
    target.ensurePair({ pair: record.address, token: record.tokenAddress, exchange: record.exchange, createdAt: record.created_at, creationBlock: record.creationBlock ?? null, token0: sighting.token0 })
    target.upsert(pairActivity(record, true))
  } else if (sighting.type === "burn") {
    const event = sighting.event
    target.ensurePair({ pair: event.pair, token: event.tokenAddress, exchange: event.exchange, createdAt: event.createdAt, creationBlock: null })
    target.upsert(burnActivity(event, true))
  } else {
    engine?.onHead(sighting.block)
  }
}

/** Starts Live Activity enrichment once per tab. */
export function startActivity(): () => void {
  const target = activityStore()
  engine ??= new EnrichmentEngine(target)
  engine.start()
  const off = onActivity((sighting) => applySighting(target, sighting))
  return () => {
    off()
    engine?.stop()
  }
}
