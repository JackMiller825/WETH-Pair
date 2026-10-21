import { DEFAULT_GAS_REFRESH_MS, DEFAULT_PRICE_REFRESH_MS, GasStatusService, MarketStatusService, marketStatusOf, refreshMs } from "@/lib/market/service"
import type { MarketStatus } from "@/lib/market/types"

type Hub = { eth: MarketStatusService; gas: GasStatusService; timers: ReturnType<typeof setInterval>[] }

const KEY = Symbol.for("weth.market.hub")

/**
 * One worker per server process. Requests only read the in-memory cache, so the endpoint never waits on
 * an external provider; the timers refresh it in the background.
 */
function hub(): Hub {
  const store = globalThis as unknown as Record<symbol, Hub | undefined>
  const existing = store[KEY]
  if (existing) return existing
  const eth = new MarketStatusService()
  const gas = new GasStatusService({ etherscanKey: process.env.ETHERSCAN_API_KEY || null })
  const priceMs = refreshMs(process.env.MARKET_PRICE_REFRESH_MS, DEFAULT_PRICE_REFRESH_MS)
  const gasMs = refreshMs(process.env.GAS_REFRESH_MS, DEFAULT_GAS_REFRESH_MS)
  void eth.refresh()
  void gas.refresh()
  const timers = [setInterval(() => void eth.refresh(), priceMs), setInterval(() => void gas.refresh(), gasMs)]
  for (const timer of timers) (timer as { unref?: () => void }).unref?.()
  const created = { eth, gas, timers }
  store[KEY] = created
  return created
}

export function cachedMarketStatus(): MarketStatus {
  const { eth, gas } = hub()
  return marketStatusOf(eth, gas)
}

/** One synchronous refresh of both feeds, for the publish script. */
export async function freshMarketStatus(): Promise<MarketStatus> {
  const eth = new MarketStatusService()
  const gas = new GasStatusService({ etherscanKey: process.env.ETHERSCAN_API_KEY || null })
  await Promise.all([eth.refresh(), gas.refresh()])
  return marketStatusOf(eth, gas)
}
