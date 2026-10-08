"use client"

import { useEffect, useState } from "react"
import { DEFAULT_RULES, type AlertRule } from "@/lib/narrative/alerts"
import { readRules, readWebhook, saveRules, saveWebhook } from "@/components/alert-watcher"
import { PageFrame } from "@/components/trends/widgets"

const LABELS: Record<string, string> = {
  "score-70": "Trend score exceeds 70",
  "score-90": "Trend score exceeds 90",
  "new-trend": "A new naming trend appears",
  burst: "More than 5 related tokens launch in 15 minutes",
  elon: "An Elon Musk narrative is rising",
  vitalik: "A Vitalik Buterin narrative is rising",
  pepe: "A Pepe naming-derivative trend is rising",
  news: "A headline is followed by multiple matching tokens",
  keyword: "A previously unseen keyword appears",
}

export function AlertsView() {
  const [rules, setRules] = useState<AlertRule[]>(DEFAULT_RULES)
  const [webhook, setWebhook] = useState("")
  const [permission, setPermission] = useState("default")

  useEffect(() => {
    setRules(readRules())
    setWebhook(readWebhook())
    setPermission(window.Notification?.permission ?? "unsupported")
  }, [])

  function toggle(id: string) {
    const next = rules.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule))
    setRules(next)
    saveRules(next)
  }

  return (
    <PageFrame eyebrow="Alerts" title="Trend alerts" lede="Get notified in this browser when a name, ticker, or headline pattern crosses a rule you turn on.">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="h-8 w-fit rounded-lg bg-primary px-3 text-sm text-primary-foreground"
          onClick={async () => {
            if (!window.Notification) return
            setPermission(await window.Notification.requestPermission())
          }}
        >
          Allow browser notifications
        </button>
        <p className="text-xs text-muted-foreground">Notification permission: {permission}</p>
        <label className="flex flex-col gap-1 text-sm">
          Webhook URL
          <input
            value={webhook}
            onChange={(event) => setWebhook(event.target.value)}
            onBlur={() => saveWebhook(webhook)}
            placeholder="https://example.com/weth-alerts"
            className="h-9 max-w-lg rounded-lg border border-input bg-transparent px-3"
          />
        </label>
        <ul className="flex flex-col gap-2 text-sm">
          {rules.map((rule) => (
            <li key={rule.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={rule.enabled} onChange={() => toggle(rule.id)} />
                {LABELS[rule.id] ?? rule.id}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </PageFrame>
  )
}
