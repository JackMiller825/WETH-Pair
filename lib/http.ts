const PAGE_URL = "https://www.dextools.io/app/ether/live-new-pairs"
const USER_AGENT = "dextools-weth-pairs/1.0"

export class ListingError extends Error {}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function requestJson(url: string, referer = PAGE_URL): Promise<unknown> {
  let delay = 400
  let lastError: unknown
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "X-API-Version": "1",
          Referer: referer,
        },
        cache: "no-store",
      })
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300)
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 4) {
          await sleep(delay)
          delay *= 2
          continue
        }
        throw new ListingError(`DEXTools returned HTTP ${response.status}. ${detail}`)
      }
      return await response.json()
    } catch (error) {
      if (error instanceof ListingError) throw error
      lastError = error
      if (attempt === 4) break
      await sleep(delay)
      delay *= 2
    }
  }
  const message = lastError instanceof Error ? lastError.message : "Unknown network error"
  throw new ListingError(`Could not reach DEXTools. ${message}`)
}
