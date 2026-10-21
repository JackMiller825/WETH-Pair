import { fetchGasTracker } from "@/lib/market/gas-tracker"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return Response.json(await fetchGasTracker(), { headers: { "cache-control": "no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The gas tracker could not be read"
    return Response.json({ error: message }, { status: 502, headers: { "cache-control": "no-store" } })
  }
}
