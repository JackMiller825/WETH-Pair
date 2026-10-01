import { ListingError, requestJson } from "@/lib/http"
import { EMPTY_DETAIL, type LpStatus, type PairDetail } from "@/lib/types"

const DETAIL_API = "https://www.dextools.io/shared/data/pair"
const CHAIN = "ether"
const CONCURRENCY = 8

type RawLock = {
  type?: string
  percent?: number
  amount?: number
  unlockDate?: string
}

type RawPair = {
  locks?: RawLock[]
  metrics?: {
    liquidity?: number | null
    txCount?: number | null
    balanceLpToken?: number | null
    balanceLpTokenBurned?: number | null
  }
  price?: number | null
  token?: {
    locks?: RawLock[]
    metrics?: {
      holders?: number | null
      mcap?: number | null
      fdv?: number | null
      totalSupply?: number | null
    }
  }
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Same rule the pair page uses: burned LP tokens as a share of all LP tokens. */
export function burntPercent(balance: number | null, burned: number | null): number {
  if (balance === null || burned === null) return 0
  if (balance <= 0 || burned <= 0 || balance < burned) return 0
  return (burned * 100) / balance
}

export type LockSummary = { percent: number; active: boolean; unlockAt: string | null }

/** Active locks only. A lock with no known percentage still counts as locked. */
export function summarizeLocks(locks: RawLock[] | undefined, totalSupply: number | null): LockSummary {
  if (!Array.isArray(locks) || locks.length === 0) return { percent: 0, active: false, unlockAt: null }
  const now = Date.now()
  let pairTotal = 0
  let tokenTotal = 0
  let active = false
  let unlockAt: number | null = null
  for (const lock of locks) {
    if (lock.unlockDate) {
      const unlock = new Date(lock.unlockDate).getTime()
      if (Number.isFinite(unlock) && unlock <= now) continue
      if (Number.isFinite(unlock) && (unlockAt === null || unlock > unlockAt)) unlockAt = unlock
    }
    active = true
    const amount = num(lock.amount)
    let percent = num(lock.percent)
    if (percent === null && lock.type === "token" && amount !== null && totalSupply) {
      percent = (amount / totalSupply) * 100
    }
    percent = percent === null ? 0 : Math.min(100, percent)
    if (lock.type === "token") tokenTotal += percent
    else pairTotal += percent
  }
  return {
    percent: Math.max(0, Math.min(100, Math.max(pairTotal, tokenTotal))),
    active,
    unlockAt: unlockAt === null ? null : new Date(unlockAt).toISOString(),
  }
}

/** The pair page shows the flame when burnt liquidity exceeds locked liquidity. */
export function classifyLp(burnt: number, locked: LockSummary): LpStatus {
  if (burnt > 0 && burnt > locked.percent) return "burnt"
  if (locked.active) return "locked"
  return "none"
}

export function parseDetail(raw: RawPair): PairDetail {
  const tokenMetrics = raw.token?.metrics ?? {}
  const totalSupply = num(tokenMetrics.totalSupply)
  const price = num(raw.price)

  const marketCap =
    num(tokenMetrics.mcap) ??
    num(tokenMetrics.fdv) ??
    (price !== null && totalSupply !== null ? price * totalSupply : null)

  const lpBurntPercent = burntPercent(
    num(raw.metrics?.balanceLpToken),
    num(raw.metrics?.balanceLpTokenBurned),
  )
  const pairLocks = summarizeLocks(raw.locks, totalSupply)
  const tokenLocks = summarizeLocks(raw.token?.locks, totalSupply)
  const locked: LockSummary = {
    percent: Math.max(pairLocks.percent, tokenLocks.percent),
    active: pairLocks.active || tokenLocks.active,
    unlockAt: [pairLocks.unlockAt, tokenLocks.unlockAt].filter((value): value is string => value !== null).sort().at(-1) ?? null,
  }

  return {
    marketCap,
    liquidity: num(raw.metrics?.liquidity),
    holders: num(tokenMetrics.holders),
    totalTx: num(raw.metrics?.txCount),
    lpStatus: classifyLp(lpBurntPercent, locked),
    lpBurntPercent,
    lpLockedPercent: locked.percent,
    lpUnlockAt: locked.unlockAt,
  }
}

export async function fetchPairDetail(address: string): Promise<PairDetail> {
  const query = new URLSearchParams({ address, chain: CHAIN })
  const referer = `https://www.dextools.io/app/${CHAIN}/pair-explorer/${address}`
  try {
    const payload = (await requestJson(`${DETAIL_API}?${query}`, referer)) as { data?: RawPair[] }
    const raw = payload.data?.[0]
    if (!raw) return { ...EMPTY_DETAIL }
    return parseDetail(raw)
  } catch (error) {
    if (error instanceof ListingError) return { ...EMPTY_DETAIL }
    throw error
  }
}

export async function fetchPairDetails(addresses: string[]): Promise<Record<string, PairDetail>> {
  const results: Record<string, PairDetail> = {}
  let index = 0
  async function worker() {
    while (index < addresses.length) {
      const address = addresses[index++]
      results[address.toLowerCase()] = await fetchPairDetail(address)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, addresses.length) }, worker))
  return results
}
