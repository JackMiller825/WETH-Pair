import { cachedMarketStatus } from "@/lib/market/server"

export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json(cachedMarketStatus(), { headers: { "cache-control": "no-store" } })
}
