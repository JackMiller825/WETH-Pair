import { defaultFetch, type FetchLike, type GasEstimate, type GasTier } from "@/lib/market/types"
import type { ProviderHealth } from "@/lib/market/price"

export interface GasProvider {
  readonly id: string
  readonly label: string
  getGasEstimate(): Promise<GasEstimate>
  getHealth(): ProviderHealth
}

/**
 * Priority-tip percentiles for standard, fast, and rapid. Many bots tip exactly 1 gwei, which puts the
 * 75th–90th percentile at 1 gwei on nearly every block, far above what inclusion needs.
 */
export const GAS_PERCENTILES = [20, 40, 60] as const
export const FEE_HISTORY_BLOCKS = 20
const SECONDS = { standard: 36, fast: 24, rapid: 12 } as const

export type FeeHistory = {
  oldestBlock: string
  baseFeePerGas: string[]
  gasUsedRatio: number[]
  reward?: string[][]
}

const GWEI = 1e9

function hexGwei(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null
  const parsed = Number(BigInt(value)) / GWEI
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function tier(baseFee: number, tip: number, seconds: number): GasTier {
  return { gwei: baseFee + tip, priorityFee: tip, maxFeePerGas: baseFee * 2 + tip, estimatedSeconds: seconds }
}

/**
 * Standard, fast, and rapid from `eth_feeHistory`. The last base fee in the response is the next block's,
 * which is what a transaction sent now pays. Each tier's tip is the median, across recent non-empty blocks,
 * of that block's tip percentile. Tiers never decrease from standard to rapid.
 */
export function estimateFromFeeHistory(history: unknown, observedAt: string, source: string, sourceLabel: string): GasEstimate {
  const value = history as FeeHistory
  if (!value || !Array.isArray(value.baseFeePerGas) || value.baseFeePerGas.length === 0 || !Array.isArray(value.reward)) {
    throw new Error("Fee history is missing base fees or rewards")
  }
  const baseFee = hexGwei(value.baseFeePerGas[value.baseFeePerGas.length - 1])
  if (baseFee == null) throw new Error("Fee history base fee is malformed")
  const oldest = typeof value.oldestBlock === "string" ? Number.parseInt(value.oldestBlock, 16) : NaN
  const tips: number[][] = [[], [], []]
  value.reward.forEach((row, index) => {
    if (!Array.isArray(row) || row.length < 3) return
    if (Array.isArray(value.gasUsedRatio) && value.gasUsedRatio[index] === 0) return
    const parsed = row.slice(0, 3).map(hexGwei)
    if (parsed.some((item) => item == null)) return
    parsed.forEach((item, slot) => tips[slot].push(item as number))
  })
  if (tips[0].length === 0) throw new Error("Fee history has no usable blocks")
  const standardTip = median(tips[0])
  const fastTip = Math.max(standardTip, median(tips[1]))
  const rapidTip = Math.max(fastTip, median(tips[2]))
  return {
    standard: tier(baseFee, standardTip, SECONDS.standard),
    fast: tier(baseFee, fastTip, SECONDS.fast),
    rapid: tier(baseFee, rapidTip, SECONDS.rapid),
    baseFee,
    blockNumber: Number.isFinite(oldest) ? oldest + value.reward.length - 1 : null,
    observedAt,
    source,
    sourceLabel,
    percentiles: GAS_PERCENTILES,
  }
}

class Tracker {
  health: ProviderHealth = { ok: false, lastSuccessAt: null, lastError: null }
  ok(now: number) {
    this.health = { ok: true, lastSuccessAt: new Date(now).toISOString(), lastError: null }
  }
  fail(error: unknown) {
    this.health = { ...this.health, ok: false, lastError: error instanceof Error ? error.message : String(error) }
  }
}

/** Calculates the estimate on our side from an Ethereum RPC's fee history. */
export class RpcFeeHistoryProvider implements GasProvider {
  readonly id: string
  readonly label: string
  private tracker = new Tracker()

  constructor(private url: string, private fetcher: FetchLike = defaultFetch, private now: () => number = Date.now) {
    const host = new URL(url).host
    this.id = `rpc:${host}`
    this.label = `Ethereum fee history (${host})`
  }

  async getGasEstimate(): Promise<GasEstimate> {
    try {
      const response = await this.fetcher(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_feeHistory", params: [`0x${FEE_HISTORY_BLOCKS.toString(16)}`, "latest", GAS_PERCENTILES] }),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = (await response.json()) as { result?: unknown; error?: { message?: string } }
      if (payload.error) throw new Error(payload.error.message || "RPC error")
      const estimate = estimateFromFeeHistory(payload.result, new Date(this.now()).toISOString(), this.id, this.label)
      this.tracker.ok(this.now())
      return estimate
    } catch (error) {
      this.tracker.fail(error)
      throw error
    }
  }

  getHealth() {
    return this.tracker.health
  }
}

/** Etherscan's gas oracle. Server-side only, because it needs ETHERSCAN_API_KEY. */
export class EtherscanGasOracleProvider implements GasProvider {
  readonly id = "etherscan"
  readonly label = "Etherscan gas oracle"
  private tracker = new Tracker()

  constructor(private apiKey: string, private fetcher: FetchLike = defaultFetch, private now: () => number = Date.now) {}

  async getGasEstimate(): Promise<GasEstimate> {
    try {
      const url = `https://api.etherscan.io/v2/api?chainid=1&module=gastracker&action=gasoracle&apikey=${encodeURIComponent(this.apiKey)}`
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(8000), cache: "no-store" })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = (await response.json()) as { status?: string; result?: Record<string, string> }
      const result = payload.result
      const nums = result ? [result.SafeGasPrice, result.ProposeGasPrice, result.FastGasPrice, result.suggestBaseFee].map(Number) : []
      if (payload.status !== "1" || nums.length !== 4 || nums.some((item) => !Number.isFinite(item) || item < 0)) throw new Error("Etherscan gas oracle payload is malformed")
      const [safe, propose, fast, base] = nums
      const make = (gwei: number, seconds: number): GasTier => ({ gwei, priorityFee: Math.max(0, gwei - base), maxFeePerGas: base * 2 + Math.max(0, gwei - base), estimatedSeconds: seconds })
      this.tracker.ok(this.now())
      return {
        standard: make(safe, SECONDS.standard),
        fast: make(Math.max(safe, propose), SECONDS.fast),
        rapid: make(Math.max(safe, propose, fast), SECONDS.rapid),
        baseFee: base,
        blockNumber: Number.isFinite(Number(result?.LastBlock)) ? Number(result?.LastBlock) : null,
        observedAt: new Date(this.now()).toISOString(),
        source: this.id,
        sourceLabel: this.label,
        percentiles: GAS_PERCENTILES,
      }
    } catch (error) {
      this.tracker.fail(error)
      throw error
    }
  }

  getHealth() {
    return this.tracker.health
  }
}

/**
 * RPCs that answer `eth_feeHistory` for 20 blocks and send CORS headers. The first is primary. publicnode
 * carries the LP burn socket, so it is the last resort here.
 */
export const GAS_RPCS = ["https://rpc.mevblocker.io", "https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"] as const
