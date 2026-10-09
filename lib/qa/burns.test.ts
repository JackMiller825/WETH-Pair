import assert from "node:assert/strict"
import test from "node:test"
import { burnEventId, isIrreversibleBurnEvent } from "../lp/monitor"
import {
  BLOCK_CHUNK,
  REORG_BLOCKS,
  burnPercent,
  commitCheckpoint,
  filterBurnEvents,
  freshLiveAlerts,
  isBurnAddress,
  passesNotifyFilter,
  type NotifySettings,
  isLiveBurnAlert,
  isReportedBurn,
  notificationCopy,
  classifyLpTransfer,
  parseTransferLog,
  planChunks,
  scanStart,
  TRANSFER_TOPIC,
} from "../lp/burn-logic"
import { findNewBurnt } from "../watch"
import { EMPTY_DETAIL, type PairRecord } from "../types"
import { WETH, parsePairCreated, wethSide } from "../history/plan"

const now = Date.parse("2026-10-08T12:00:00.000Z")
const PAIR = "0x1111111111111111111111111111111111111111"
const ZERO = "0x0000000000000000000000000000000000000000"
const DEAD = "0x000000000000000000000000000000000000dead"

test("burn percent uses integer math and never reports more than 100", () => {
  assert.equal(burnPercent(BigInt(1000), [BigInt(998)]), 99.8)
  assert.equal(burnPercent(BigInt(1000), [BigInt(990)]), 99)
  assert.equal(burnPercent(BigInt(1000), [BigInt(1000)]), 100)
  assert.equal(burnPercent(BigInt(1000), [BigInt(400), BigInt(500)]), 90)
  assert.equal(burnPercent(BigInt(10) ** BigInt(30), [(BigInt(998) * (BigInt(10) ** BigInt(27)))]), 99.8)
  assert.equal(burnPercent(BigInt(1000), [BigInt(1500)]), 100)
  assert.equal(isReportedBurn(0), false)
})

test("only transfers into a burn address are burns, including mixed-case dead", () => {
  assert.equal(isBurnAddress("0x000000000000000000000000000000000000dEaD"), true)
  assert.equal(isBurnAddress(ZERO), true)
  assert.equal(isBurnAddress("0x2222222222222222222222222222222222222222"), false)
  const normal = parseTransferLog(log(PAIR, "0x3333333333333333333333333333333333333333", "0x4444444444444444444444444444444444444444"))
  assert.equal(normal, null)
  const burned = parseTransferLog(log(PAIR, "0x3333333333333333333333333333333333333333", DEAD))
  assert.equal(burned?.to, DEAD)
})

test("the same chain log keeps one id when it is replayed", () => {
  const first = burnEventId(PAIR, "0x" + "ab".repeat(32), 4)
  const again = burnEventId(PAIR.toUpperCase(), "0x" + "AB".repeat(32), 4)
  assert.equal(first, again)
  const seen = new Set([first, again])
  assert.equal(seen.size, 1)
})

test("27 historical burns create records but no live notifications", () => {
  const events = Array.from({ length: 27 }, (_, index) => ({
    id: `backfill-${index}`,
    kind: "previously-burned" as const,
    detectionSource: "backfill" as const,
  }))
  assert.equal(freshLiveAlerts(events, new Set()).length, 0)
  assert.equal(events.filter(isLiveBurnAlert).length, 0)
})

test("one new live burn notifies once, and a replay does not notify again", () => {
  const event = { id: "live-1", kind: "newly-burned" as const, detectionSource: "live" as const }
  const first = freshLiveAlerts([event, event], new Set())
  assert.equal(first.length, 1)
  const second = freshLiveAlerts([event], new Set(first.map((item) => item.id)))
  assert.equal(second.length, 0)
})

test("notification filters require both the burn percent and the liquidity minimum", () => {
  const settings: NotifySettings = { minBurnPercent: 95, minLiquidity: 20_000, maxPairAgeMinutes: null }
  const event = (percent: number, liquidity: number | null) => ({
    lpBurntPercent: percent,
    liquidity,
    createdAt: new Date(now).toISOString(),
  })
  assert.equal(passesNotifyFilter(event(94, 50_000), settings, now), false)
  assert.equal(passesNotifyFilter(event(99, 10_000), settings, now), false)
  assert.equal(passesNotifyFilter(event(99, 50_000), settings, now), true)
})

test("a failed scan keeps the checkpoint and the next scan replays the reorg window", () => {
  assert.equal(commitCheckpoint(1000, null), 1000)
  assert.equal(commitCheckpoint(1000, 980), 1000)
  assert.equal(scanStart(1000, 1100), 1000 - REORG_BLOCKS + 1)
  assert.equal(scanStart(null, 500), 500 - 300)
  const chunks = planChunks(1, 100, BLOCK_CHUNK, 2)
  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].to - chunks[0].from + 1, BLOCK_CHUNK)
  assert.equal(chunks[1].from, chunks[0].to + 1)
})

test("pair-created logs keep WETH on either side and ignore other pairs", () => {
  const other = "0x2222222222222222222222222222222222222222"
  assert.equal(wethSide(WETH.toUpperCase(), other)?.token, other)
  assert.equal(wethSide(other, WETH)?.weth, "token1")
  assert.equal(wethSide(other, "0x3333333333333333333333333333333333333333"), null)
  const parsed = parsePairCreated({
    address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    topics: [
      "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9",
      "0x" + other.slice(2).padStart(64, "0"),
      "0x" + WETH.slice(2).padStart(64, "0"),
    ],
    data: "0x" + PAIR.slice(2).padStart(64, "0"),
    blockNumber: "0x10",
  })
  assert.equal(parsed?.pair, PAIR)
  assert.equal(wethSide(parsed!.token0, parsed!.token1)?.token, other)
})

test("a burn clock uses burn time, so an old pair can be a new burn", () => {
  const event = {
    createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
    burnAt: new Date(now - 2 * 60 * 1000).toISOString(),
  }
  assert.equal(filterBurnEvents([event], now - 5 * 60 * 1000, now, null, now).length, 1)
  assert.equal(filterBurnEvents([event], now - 5 * 24 * 60 * 60 * 1000, now - 4 * 24 * 60 * 60 * 1000, null, now).length, 0)
})

test("the desktop notification points at the token and is tagged by event id", () => {
  const copy = notificationCopy({
    tokenName: "Example",
    symbol: "EX",
    tokenAddress: "0xabc",
    lpBurntPercent: 99.8,
    liquidity: 25000,
    createdAt: new Date(now - 60_000).toISOString(),
    id: "live-1",
  }, now)
  assert.equal(copy.url, "/tokens/0xabc/")
  assert.equal(copy.tag, "live-1")
  assert.match(copy.body, /99\.8%/)
})

test("finding a burnt pair twice does not treat the second sighting as new", () => {
  const record = {
    ...EMPTY_DETAIL,
    name: "EX",
    created_at: new Date(now).toISOString(),
    exchange: "Uniswap V2",
    address: PAIR,
    tokenAddress: "0x2222222222222222222222222222222222222222",
    url: "https://example.com",
    price: null,
    remaining: null,
    remainingUnit: "",
    listingLiquidity: null,
    lpStatus: "burnt" as const,
  } satisfies PairRecord
  const seen = new Set<string>()
  assert.equal(findNewBurnt([record], seen).length, 1)
  seen.add(PAIR)
  assert.equal(findNewBurnt([record], seen).length, 0)
})

test("a holder transfer to the dead address is an irreversible burn, including a partial amount", () => {
  const holder = "0x3333333333333333333333333333333333333333"
  assert.equal(classifyLpTransfer({ pair: PAIR, from: holder, to: DEAD, amount: BigInt(650) }), "irreversible-burn")
  assert.equal(classifyLpTransfer({ pair: PAIR, from: holder.toUpperCase(), to: "0x000000000000000000000000000000000000dEaD", amount: BigInt(998) }), "irreversible-burn")
  assert.equal(classifyLpTransfer({ pair: PAIR, from: holder, to: ZERO, amount: BigInt(5000) }), "irreversible-burn")
})

test("uniswap liquidity removal and protocol minimum liquidity are not creator burns", () => {
  assert.equal(classifyLpTransfer({ pair: PAIR, from: PAIR, to: ZERO, amount: BigInt(10) ** BigInt(18) }), "liquidity-removal")
  assert.equal(classifyLpTransfer({ pair: PAIR, from: ZERO, to: ZERO, amount: BigInt(1000) }), "protocol-minimum")
  assert.equal(classifyLpTransfer({ pair: PAIR, from: ZERO, to: DEAD, amount: BigInt(1000) }), "protocol-minimum")
  assert.equal(classifyLpTransfer({ pair: PAIR, from: "0x3333333333333333333333333333333333333333", to: "0x4444444444444444444444444444444444444444", amount: BigInt(1000) }), "ordinary-transfer")
  assert.equal(isIrreversibleBurnEvent({ pair: PAIR, burnFrom: PAIR, burnTo: ZERO }), false)
  assert.equal(isIrreversibleBurnEvent({ pair: PAIR, burnFrom: "0x3333333333333333333333333333333333333333", burnTo: DEAD }), true)
})

test("classifying twenty thousand transfers stays under a fifth of a second", () => {
  const holder = "0x3333333333333333333333333333333333333333"
  const started = Date.now()
  let burns = 0
  for (let index = 0; index < 20_000; index += 1) {
    const kind = classifyLpTransfer({ pair: PAIR, from: index % 5 === 0 ? PAIR : holder, to: index % 2 === 0 ? ZERO : DEAD, amount: BigInt(1000 + index) })
    if (kind === "irreversible-burn") burns += 1
  }
  const elapsed = Date.now() - started
  assert.ok(burns > 0)
  assert.ok(elapsed < 200, `classify took ${elapsed}ms`)
})

function log(pair: string, from: string, to: string) {
  return {
    address: pair,
    topics: [
      TRANSFER_TOPIC,
      "0x" + from.slice(2).padStart(64, "0"),
      "0x" + to.slice(2).padStart(64, "0"),
    ],
    data: "0x" + BigInt(1000).toString(16).padStart(64, "0"),
    blockNumber: "0x10",
    transactionHash: "0x" + "ab".repeat(32),
    logIndex: "0x1",
  }
}
