import { WETH_DECIMALS } from "@/lib/activity/pool"

/** A pool must hold at least this much WETH before its price can be a baseline. Below this, one dust swap can invent a huge multiple. */
export const MIN_RELIABLE_WETH = 0.05

/** How far before the window start a baseline may sit. A wider gap is not sold as that window's return. */
export const BASELINE_GAP_RATIO = 0.05
export const MIN_BASELINE_GAP_MS = 2 * 60 * 1000

export const PUMP_TOOLTIP =
  "Ranks tracked WETH pairs by observed price increase over the selected period. Tokens without sufficient historical price coverage may be excluded or labeled as since-launch results."

export type PriceSource = "chain" | "dextools"
export type Confidence = "high" | "medium" | "low"

/** One observed pool price. Stored values are plain numbers so a snapshot file and the browser can both keep them. */
export type PricePoint = {
  pair: string
  token: string
  block: number | null
  /** Unix milliseconds of the observation. */
  at: number
  /** Token price in WETH, using the pool's reserves and the token's decimals. */
  priceWeth: number
  /** priceWeth times the ETH/USD price at this observation. */
  priceUsd: number
  reserveWeth: number
  liquidityUsd: number | null
  source: PriceSource
}

export function maxBaselineGap(windowMs: number): number {
  return Math.max(MIN_BASELINE_GAP_MS, windowMs * BASELINE_GAP_RATIO)
}

/** Integer token units to a number. Decimals are not assumed to be 18. */
export function units(raw: bigint, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return Number.NaN
  const scale = BigInt(10) ** BigInt(decimals)
  const whole = raw / scale
  const fraction = raw % scale
  return Number(whole) + Number(fraction) / Number(scale)
}

/**
 * V2 price from reserves. WETH may be token0 or token1.
 * Price is WETH per 1 whole token. Zero reserves and an absurd result are not a price.
 */
export function priceWethFromReserves(
  reserve0: bigint,
  reserve1: bigint,
  wethFirst: boolean,
  tokenDecimals: number,
): { priceWeth: number; reserveWeth: number; reserveToken: number } | null {
  const reserveWethRaw = wethFirst ? reserve0 : reserve1
  const reserveTokenRaw = wethFirst ? reserve1 : reserve0
  if (reserveWethRaw <= BigInt(0) || reserveTokenRaw <= BigInt(0)) return null
  const reserveWeth = units(reserveWethRaw, WETH_DECIMALS)
  const reserveToken = units(reserveTokenRaw, tokenDecimals)
  if (!(reserveToken > 0) || !Number.isFinite(reserveWeth) || !Number.isFinite(reserveToken)) return null
  const priceWeth = reserveWeth / reserveToken
  if (!Number.isFinite(priceWeth) || priceWeth <= 0 || priceWeth > 1e15) return null
  return { priceWeth, reserveWeth, reserveToken }
}

/** 4x is +300%, because the price is four times the reference, not 400% of it. A zero reference is not a rank. */
export function pumpOf(reference: number, current: number): { multiple: number; percent: number } | null {
  if (!Number.isFinite(reference) || !Number.isFinite(current) || reference <= 0 || current < 0) return null
  const multiple = current / reference
  if (!Number.isFinite(multiple)) return null
  return { multiple, percent: (multiple - 1) * 100 }
}

export function formatMultiple(multiple: number): string {
  if (!Number.isFinite(multiple)) return "—"
  return `${multiple.toFixed(2)}x`
}

export function formatPumpPercent(percent: number): string {
  if (!Number.isFinite(percent)) return "—"
  const digits = Math.abs(percent) >= 100 ? 0 : 1
  const rounded = percent.toFixed(digits)
  return `${percent > 0 ? "+" : ""}${rounded}%`
}

/** Latest valid point at or before `target`, and only when it is close enough to be that moment's price. */
export function baselineBefore(points: readonly PricePoint[], target: number, maxGapMs: number): PricePoint | null {
  let best: PricePoint | null = null
  for (const point of points) {
    if (!(point.priceUsd > 0) || point.at > target) continue
    if (!best || point.at > best.at || (point.at === best.at && (point.block ?? -1) > (best.block ?? -1))) best = point
  }
  if (!best || target - best.at > maxGapMs) return null
  return best
}

/** Earliest observation with enough WETH in the pool to be a launch price. Dust is not a baseline. */
export function firstReliable(points: readonly PricePoint[], minWeth = MIN_RELIABLE_WETH): PricePoint | null {
  let best: PricePoint | null = null
  for (const point of points) {
    if (!(point.priceUsd > 0) || !(point.reserveWeth >= minWeth)) continue
    if (!best || point.at < best.at || (point.at === best.at && (point.block ?? Infinity) < (best.block ?? Infinity))) best = point
  }
  return best
}

/** Block that was mining near `target`, estimated from the head block's timestamp. Used to read reserves, not to invent a price. */
export function blockForTime(headBlock: number, headTimeMs: number, targetMs: number, blockMs = 12_000): number {
  if (!Number.isFinite(headBlock) || headBlock < 0) return 0
  const behind = Math.round((headTimeMs - targetMs) / blockMs)
  return Math.max(0, headBlock - Math.max(0, behind))
}
