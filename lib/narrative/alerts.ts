import type { Intelligence, Trend } from "@/lib/narrative/types"

export type AlertRule =
  | { id: string; type: "score"; threshold: 70 | 90; enabled: boolean }
  | { id: string; type: "new-trend"; enabled: boolean }
  | { id: string; type: "burst"; count: number; minutes: number; enabled: boolean }
  | { id: string; type: "person"; personId: "elon-musk" | "vitalik" | "donald-trump"; enabled: boolean }
  | { id: string; type: "family"; conceptId: "pepe"; enabled: boolean }
  | { id: string; type: "news-burst"; minTokens: number; enabled: boolean }
  | { id: string; type: "new-keyword"; enabled: boolean }

export type AlertHit = {
  id: string
  title: string
  body: string
  href: string
}

export const DEFAULT_RULES: AlertRule[] = [
  { id: "score-70", type: "score", threshold: 70, enabled: true },
  { id: "score-90", type: "score", threshold: 90, enabled: true },
  { id: "new-trend", type: "new-trend", enabled: true },
  { id: "burst", type: "burst", count: 5, minutes: 15, enabled: true },
  { id: "elon", type: "person", personId: "elon-musk", enabled: true },
  { id: "vitalik", type: "person", personId: "vitalik", enabled: true },
  { id: "pepe", type: "family", conceptId: "pepe", enabled: true },
  { id: "news", type: "news-burst", minTokens: 2, enabled: true },
  { id: "keyword", type: "new-keyword", enabled: true },
]

export function evaluateAlerts(intel: Intelligence, rules: AlertRule[]): AlertHit[] {
  const hits: AlertHit[] = []
  const trends = [...intel.concepts, ...intel.clusters, ...intel.words, ...intel.families]
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.type === "score") {
      for (const trend of trends) {
        if (trend.score >= rule.threshold) hits.push(hit(rule.id, trend, `Trend score ${trend.score}/100 crossed ${rule.threshold}.`))
      }
    }
    if (rule.type === "new-trend") {
      for (const trend of intel.emerging) hits.push(hit(rule.id, trend, "A naming pattern showed up with almost no launches in the previous day."))
    }
    if (rule.type === "burst") {
      for (const trend of intel.concepts) {
        if (trend.count >= rule.count && trend.perHour * (rule.minutes / 60) >= rule.count) {
          hits.push(hit(rule.id, trend, `${trend.count} related tokens launched in the current window.`))
        }
      }
    }
    if (rule.type === "person") {
      const trend = intel.concepts.find((item) => item.id === rule.personId && item.count > 0)
      if (trend && (trend.direction === "rising" || trend.direction === "surging" || trend.lifecycle === "emerging")) {
        hits.push(hit(rule.id, trend, `${trend.name} names are ${trend.direction}.`))
      }
    }
    if (rule.type === "family") {
      const trend = intel.families.find((item) => item.id === `family:${rule.conceptId}` && item.count >= 2)
      if (trend && (trend.direction === "rising" || trend.direction === "surging" || trend.lifecycle === "emerging")) {
        hits.push(hit(rule.id, trend, "Possible Pepe naming derivatives are increasing."))
      }
    }
    if (rule.type === "news-burst") {
      for (const link of intel.newsLinks) {
        if (link.tokens.length >= rule.minTokens) {
          hits.push({
            id: `${rule.id}:${link.news.id}`,
            title: link.news.title,
            body: `${link.tokens.length} tokens launched after this headline. ${link.origin.label}.`,
            href: "/news",
          })
        }
      }
    }
    if (rule.type === "new-keyword") {
      for (const trend of intel.words) {
        if (trend.previousCount === 0 && trend.count >= 2) hits.push(hit(rule.id, trend, "This word was absent in the previous window."))
      }
    }
  }
  const seen = new Set<string>()
  return hits.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
}

function hit(ruleId: string, trend: Trend, body: string): AlertHit {
  return { id: `${ruleId}:${trend.id}`, title: trend.name, body, href: `/trends/${trend.slug}` }
}
