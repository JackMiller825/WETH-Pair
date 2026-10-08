"use client"

import { useEffect, useState } from "react"
import type { SnapshotFile } from "@/lib/narrative/types"

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<SnapshotFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch("/data/snapshot.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("The published pair list is not available yet.")
        return (await response.json()) as SnapshotFile
      })
      .then((data) => {
        if (!cancelled) setSnapshot(data)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "The pair list could not be loaded.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  return { snapshot, error, loading, reload: () => setTick((value) => value + 1) }
}
