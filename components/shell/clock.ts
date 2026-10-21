"use client"

import { useSyncExternalStore } from "react"

const listeners = new Set<() => void>()
let timer: number | null = null
let now = 0

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer == null) {
    now = Date.now()
    timer = window.setInterval(() => {
      now = Date.now()
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
    () => Math.floor((now || Date.now()) / stepMs),
    () => -1,
  )
  return bucket < 0 ? null : bucket * stepMs
}
