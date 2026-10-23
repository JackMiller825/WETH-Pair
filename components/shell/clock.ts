"use client"

import { useSyncExternalStore } from "react"

const listeners = new Set<() => void>()
const steps = new Map<number, number>()
let timer: number | null = null
let now = 0

function readNow(): number {
  if (now === 0) now = Date.now()
  return now
}

function publish(at: number) {
  now = at
  for (const step of steps.keys()) steps.set(step, Math.floor(at / step))
}

function readSnapshot(stepMs: number): number {
  const saved = steps.get(stepMs)
  if (saved != null) return saved
  const value = Math.floor(readNow() / stepMs)
  steps.set(stepMs, value)
  return value
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer == null) {
    publish(Date.now())
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
