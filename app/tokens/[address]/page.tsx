import { TokenDetail } from "@/components/trends/token-detail"
import { tokenParams } from "@/lib/narrative/slugs"

export function generateStaticParams() {
  return tokenParams()
}

export default async function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  return <TokenDetail address={address} />
}
