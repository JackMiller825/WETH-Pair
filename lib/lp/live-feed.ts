import { FACTORIES, PAIR_CREATED_TOPIC, parsePairCreated, wethSide, dexForFactory } from "@/lib/history/plan"
import { TRANSFER_TOPIC, classifyLpTransfer, parseTransferLog, type ParsedTransfer, type TransferLog } from "@/lib/lp/burn-logic"
import { burnEventId, type LpBurnEvent } from "@/lib/lp/monitor"
import { parseIdentity } from "@/lib/narrative/text"
import { EMPTY_DETAIL, type PairRecord } from "@/lib/types"

export const LIVE_HEADS_URL = "wss://ethereum-rpc.publicnode.com"

const ZERO_TOPIC = "0x" + "0".repeat(24) + "0".repeat(40)
const DEAD_TOPIC = "0x" + "0".repeat(24) + "000000000000000000000000000000000000dead"

export function liveLogFilter() {
  return {
    jsonrpc: "2.0" as const,
    id: 2,
    method: "eth_subscribe" as const,
    params: ["logs", { topics: [TRANSFER_TOPIC, null, [ZERO_TOPIC, DEAD_TOPIC]] }],
  }
}

export function livePairFilter() {
  return {
    jsonrpc: "2.0" as const,
    id: 3,
    method: "eth_subscribe" as const,
    params: ["logs", { address: FACTORIES.map((item) => item.address), topics: [PAIR_CREATED_TOPIC] }],
  }
}

export type LiveSighting =
  | { type: "pair"; pair: string; token: string; dex: string; block: number }
  | { type: "burn"; transfer: ParsedTransfer; known: boolean }

/** Pull a log out of an eth_subscription message. Ignores heads and subscribe acks. */
export function sightingFromMessage(payload: unknown, pairs: ReadonlySet<string>): LiveSighting | null {
  if (!payload || typeof payload !== "object") return null
  const result = (payload as { params?: { result?: TransferLog & { topics?: string[] } } }).params?.result
  if (!result || !Array.isArray(result.topics)) return null
  const created = parsePairCreated(result)
  if (created) {
    const side = wethSide(created.token0, created.token1)
    const dex = dexForFactory(created.factory)
    if (!side || !dex) return null
    return { type: "pair", pair: created.pair, token: side.token, dex, block: created.block }
  }
  const transfer = parseTransferLog(result)
  if (!transfer || classifyLpTransfer(transfer) !== "irreversible-burn") return null
  return { type: "burn", transfer, known: pairs.has(transfer.pair) }
}

export function recordFromPairSighting(sighting: Extract<LiveSighting, { type: "pair" }>, seenAt: string): PairRecord {
  return {
    name: "WETH pair",
    created_at: seenAt,
    exchange: sighting.dex,
    address: sighting.pair,
    tokenAddress: sighting.token,
    url: `https://www.dextools.io/app/en/ether/pair-explorer/${sighting.pair}`,
    price: null,
    remaining: null,
    remainingUnit: "",
    listingLiquidity: null,
    ...EMPTY_DETAIL,
    creationBlock: sighting.block,
    listingSource: "ethereum-pair-created",
  }
}

export function liveBurnEvent(record: PairRecord, transfer: ParsedTransfer, detectedAt: string): LpBurnEvent {
  const identity = parseIdentity(record)
  return {
    id: burnEventId(record.address, transfer.tx, transfer.logIndex),
    chainId: 1,
    pair: record.address.toLowerCase(),
    tokenAddress: record.tokenAddress.toLowerCase(),
    symbol: identity.symbol,
    tokenName: identity.tokenName,
    exchange: record.exchange,
    createdAt: record.created_at,
    detectedAt,
    burnAt: null,
    kind: "newly-burned",
    detectionSource: "live",
    lpBurntPercent: 0,
    percentKnown: false,
    lpSupply: null,
    lpBurnedTokens: null,
    lpRemaining: null,
    liquidity: record.liquidity ?? record.listingLiquidity,
    marketCap: record.marketCap,
    volume24h: record.volume24h ?? null,
    buys24h: record.buys24h ?? null,
    deployer: record.deployer ?? null,
    url: record.url,
    burnTx: transfer.tx,
    burnBlock: transfer.block,
    burnFrom: transfer.from,
    burnTo: transfer.to,
    logIndex: transfer.logIndex,
    source: "ethereum-transfer",
  }
}
