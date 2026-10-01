import { ListingError } from "@/lib/http"
import { collectWethPairs } from "@/lib/scrape"
import { MAX_HOURS } from "@/lib/types"

export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  let body: { hours?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Send the number of hours to look back." }, { status: 400 })
  }

  const hours = typeof body.hours === "number" ? body.hours : Number(body.hours)
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
    return Response.json(
      { error: `Choose a period between 1 and ${MAX_HOURS} hours.` },
      { status: 400 },
    )
  }

  try {
    const { rows, scanned } = await collectWethPairs(hours)
    return Response.json({ hours, scanned, rows })
  } catch (error) {
    const message = error instanceof ListingError ? error.message : "The pair list could not be loaded."
    return Response.json({ error: message }, { status: 502 })
  }
}
