import { fetchPairDetails } from "@/lib/details"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const MAX_BATCH = 40
// Pool ids are 20-byte addresses, 32-byte ids (Uniswap V4), or dash-joined ids (Balancer).
const ADDRESS = /^0x[0-9a-fA-F]{40,64}(-0x[0-9a-fA-F]{40})*$/

export async function POST(request: Request) {
  let body: { addresses?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Send a list of pair addresses." }, { status: 400 })
  }

  const addresses = Array.isArray(body.addresses) ? body.addresses : null
  if (
    !addresses ||
    addresses.length === 0 ||
    addresses.length > MAX_BATCH ||
    !addresses.every((item): item is string => typeof item === "string" && ADDRESS.test(item))
  ) {
    return Response.json(
      { error: `Send between 1 and ${MAX_BATCH} valid pair addresses.` },
      { status: 400 },
    )
  }

  const details = await fetchPairDetails(addresses)
  return Response.json({ details })
}
