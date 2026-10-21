import type { ActivitySignal } from "@/lib/activity/store"
import { buildIntelligence } from "@/lib/narrative/engine"
import type { SnapshotFile } from "@/lib/narrative/types"

const MAX_TRENDS = 8
const MAX_NEWS = 8

/**
 * Rising concept trends over the last hour and news headlines that matched new tokens. Built once per
 * publish. Only concept trends are used because their pages exist in every static build.
 */
export function buildSignals(snapshot: SnapshotFile): ActivitySignal[] {
  if (!snapshot.rows.length) return []
  const intel = buildIntelligence(snapshot, "1h")
  const hour = snapshot.generatedAt.slice(0, 13)
  const trends = intel.concepts
    .filter((trend) => (trend.direction === "rising" || trend.direction === "surging") && trend.count >= 3)
    .slice(0, MAX_TRENDS)
    .map<ActivitySignal>((trend) => ({
      id: `${trend.id}:${hour}`,
      type: "trend",
      at: trend.lastAt ?? snapshot.generatedAt,
      title: trend.name,
      detail: `${trend.count} launches in the last hour, ${trend.previousCount} the hour before`,
      href: `/trends/${trend.slug}`,
    }))
  const news = intel.newsLinks
    .filter((link) => link.tokens.length > 0)
    .slice(0, MAX_NEWS)
    .map<ActivitySignal>((link) => ({
      id: link.news.id,
      type: "news",
      at: link.firstTokenAt ?? link.news.publishedAt,
      title: link.news.title,
      detail: `${link.tokens.length} matching token${link.tokens.length === 1 ? "" : "s"}${link.best ? `, top ${link.best.symbol}` : ""}`,
      href: "/news",
    }))
  return [...trends, ...news]
}
