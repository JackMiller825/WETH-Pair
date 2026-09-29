import { ListingError, collectWethPairs, filenameFor, renderFile, type OutputFormat, MAX_HOURS } from "@/lib/scrape"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const FORMATS = new Set<OutputFormat>(["csv", "json", "txt"])

export async function POST(request: Request) {
  let body: { hours?: unknown; format?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Send hours and a file format." }, { status: 400 })
  }

  const hours = typeof body.hours === "number" ? body.hours : Number(body.hours)
  const format = body.format
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
    return Response.json(
      { error: `Choose a period between 1 and ${MAX_HOURS} hours.` },
      { status: 400 },
    )
  }
  if (typeof format !== "string" || !FORMATS.has(format as OutputFormat)) {
    return Response.json({ error: "Choose a file type: CSV, JSON, or text." }, { status: 400 })
  }

  try {
    const outputFormat = format as OutputFormat
    const { rows, scanned } = await collectWethPairs(hours)
    return Response.json({
      hours,
      format: outputFormat,
      filename: filenameFor(hours, outputFormat),
      count: rows.length,
      scanned,
      rows,
      file: renderFile(rows, outputFormat),
    })
  } catch (error) {
    const message = error instanceof ListingError ? error.message : "The pair list could not be loaded."
    return Response.json({ error: message }, { status: 502 })
  }
}
