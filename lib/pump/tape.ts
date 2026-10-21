/** A Sync event hands its reserves here. Nothing is listening until Top Pumpers starts, and a listener error cannot break the pool update. */
export type ReserveNote = {
  pair: string
  token: string
  wethFirst: boolean
  reserve0: bigint
  reserve1: bigint
  block: number
  at: number
}

type Listener = (note: ReserveNote) => void

let listener: Listener | null = null

export function onReserves(fn: Listener | null) {
  listener = fn
}

export function noteReserves(note: ReserveNote) {
  try {
    listener?.(note)
  } catch {
    // A ranking failure stays off the pool-update path.
  }
}
