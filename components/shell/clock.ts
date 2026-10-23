"use client"

import { useSyncExternalStore } from "react"

const listeners = new Set<() => void>()
let timer: number | null = null
let now = 0

function publish(at: number) {
  now = at
}

/** A number derived only from `now`. Two reads in one turn return the same bucket. */
function readSnapshot(stepMs: number): number {
  if (now === 0) now = Date.now()
  return Math.floor(now / stepMs)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer == null) {
    timer = window.setInterval(() => {
      publish(Date.now())
      for (const item of listeners) item()
    }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer != null) {
      window.clearInterval(timer)
      timer = null
    }
  }
}

/**
 * Current time rounded down to `stepMs`. A component re-renders only when its step changes, so a card
 * that shows minutes is not redrawn every second. Null during server render.
 */
export function useClock(stepMs = 1000): number | null {
  const bucket = useSyncExternalStore(
    subscribe,
    () => readSnapshot(stepMs),
    () => -1,
  )
  return bucket < 0 ? null : bucket * stepMs
}
