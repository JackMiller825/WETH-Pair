"use client"

import { useEffect } from "react"
import { DEFAULT_RULES, evaluateAlerts, type AlertRule } from "@/lib/narrative/alerts"
import { buildIntelligence } from "@/lib/narrative/engine"
import type { SnapshotFile } from "@/lib/narrative/types"

const RULES_KEY = "weth-trend-alert-rules"
const SEEN_KEY = "weth-trend-alert-seen"
const WEBHOOK_KEY = "weth-trend-alert-webhook"

export function readRules(): AlertRule[] {
  if (typeof window === "undefined") return DEFAULT_RULES
  try {
    const saved = window.localStorage.getItem(RULES_KEY)
    if (!saved) return DEFAULT_RULES
    const parsed = JSON.parse(saved) as AlertRule[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_RULES
  } catch {
    return DEFAULT_RULES
  }
}

export function saveRules(rules: AlertRule[]) {
  window.localStorage.setItem(RULES_KEY, JSON.stringify(rules))
}

export function readWebhook(): string {
  return window.localStorage.getItem(WEBHOOK_KEY) ?? ""
}

export function saveWebhook(value: string) {
  window.localStorage.setItem(WEBHOOK_KEY, value.trim())
}

export function AlertWatcher() {
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const response = await fetch("/data/snapshot.json", { cache: "no-store" })
        if (!response.ok) return
        const snapshot = (await response.json()) as SnapshotFile
        if (cancelled) return
        const rules = readRules()
        const hour = buildIntelligence(snapshot, "1h")
        const burstWindow = buildIntelligence(snapshot, "15m")
        const hits = [
          ...evaluateAlerts(hour, rules.filter((rule) => rule.type !== "burst")),
          ...evaluateAlerts(burstWindow, rules.filter((rule) => rule.type === "burst")),
        ]
        const seen = new Set(JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]") as string[])
        const fresh = hits.filter((item) => !seen.has(item.id))
        if (fresh.length === 0) return
        for (const item of fresh) seen.add(item.id)
        window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)))
        if (window.Notification?.permission === "granted") {
          for (const item of fresh.slice(0, 3)) new window.Notification(item.title, { body: item.body })
        }
        const webhook = readWebhook()
        if (webhook) {
          await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alerts: fresh, at: snapshot.generatedAt }),
          }).catch(() => undefined)
        }
      } catch {
        // Alerts wait for the next pass when the snapshot or webhook is unavailable.
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])
  return null
}
