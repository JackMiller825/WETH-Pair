import { TrendDetail } from "@/components/trends/trend-detail"
import { trendParams } from "@/lib/narrative/slugs"

export function generateStaticParams() {
  return trendParams()
}

export default async function TrendPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <TrendDetail slug={slug} />
}
