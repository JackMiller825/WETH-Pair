import assert from "node:assert/strict"
import test from "node:test"
import { PAIR_CREATED_TOPIC, WETH } from "../history/plan"
import { TRANSFER_TOPIC } from "./burn-logic"
import { burnEventId } from "./monitor"
import { liveBurnEvent, sightingFromMessage } from "./live-feed"
import { EMPTY_DETAIL, type PairRecord } from "../types"

const PAIR = "0x1111111111111111111111111111111111111111"
const HOLDER = "0x3333333333333333333333333333333333333333"
const DEAD = "0x000000000000000000000000000000000000dead"
const ZERO = "0x0000000000000000000000000000000000000000"
const TX = "0x" + "ab".repeat(32)

function transferLog(from: string, to: string, pair = PAIR) {
  return {
    address: pair,
    topics: [TRANSFER_TOPIC, "0x" + from.slice(2).padStart(64, "0"), "0x" + to.slice(2).padStart(64, "0")],
    data: "0x" + BigInt(5000).toString(16).padStart(64, "0"),
    blockNumber: "0x10",
    transactionHash: TX,
    logIndex: "0x2",
  }
}

test("a dead-address transfer on a known pair is a live burn, and a removal is ignored", () => {
  const pairs = new Set([PAIR])
  const burn = sightingFromMessage({ params: { result: transferLog(HOLDER, DEAD) } }, pairs)
  assert.equal(burn?.type, "burn")
  if (burn?.type === "burn") assert.equal(burn.known, true)
  const removal = sightingFromMessage({ params: { result: transferLog(PAIR, ZERO) } }, pairs)
  assert.equal(removal, null)
  const mint = sightingFromMessage({ params: { result: transferLog(ZERO, ZERO) } }, pairs)
  assert.equal(mint, null)
})

test("a burn that arrives before the pair is known is kept, then matches once the pair exists", () => {
  const early = sightingFromMessage({ params: { result: transferLog(HOLDER, DEAD) } }, new Set())
  assert.equal(early?.type, "burn")
  if (early?.type !== "burn") return
  assert.equal(early.known, false)
  const later = sightingFromMessage({ params: { result: transferLog(HOLDER, DEAD) } }, new Set([PAIR]))
  assert.equal(later?.type, "burn")
  if (later?.type === "burn") assert.equal(later.known, true)
  assert.equal(burnEventId(PAIR, TX, 2), burnEventId(PAIR, TX, 2))
})

test("the same transaction and log index is one event id", () => {
  const record = {
    name: "Example",
    created_at: "2026-10-08T12:00:00.000Z",
    exchange: "Uniswap V2",
    address: PAIR,
    tokenAddress: "0x2222222222222222222222222222222222222222",
    url: "https://example.com",
    price: null,
    remaining: null,
    remainingUnit: "",
    listingLiquidity: null,
    ...EMPTY_DETAIL,
  } satisfies PairRecord
  const first = sightingFromMessage({ params: { result: transferLog(HOLDER, DEAD) } }, new Set([PAIR]))
  const second = sightingFromMessage({ params: { result: transferLog(HOLDER, DEAD) } }, new Set([PAIR]))
  assert.equal(first?.type, "burn")
  assert.equal(second?.type, "burn")
  if (first?.type !== "burn" || second?.type !== "burn") return
  const left = liveBurnEvent(record, first.transfer, "2026-10-08T12:00:01.000Z")
  const right = liveBurnEvent(record, second.transfer, "2026-10-08T12:00:02.000Z")
  assert.equal(left.id, right.id)
  assert.equal(left.detectionSource, "live")
  assert.equal(left.percentKnown, false)
  assert.equal(left.kind, "newly-burned")
})

test("a WETH PairCreated log is recognized and a non-WETH pair is not", () => {
  const token = "0x2222222222222222222222222222222222222222"
  const factory = "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f"
  const message = {
    params: {
      result: {
        address: factory,
        topics: [PAIR_CREATED_TOPIC, "0x" + WETH.slice(2).padStart(64, "0"), "0x" + token.slice(2).padStart(64, "0")],
        data: "0x" + PAIR.slice(2).padStart(64, "0"),
        blockNumber: "0x20",
      },
    },
  }
  const sighting = sightingFromMessage(message, new Set())
  assert.equal(sighting?.type, "pair")
  if (sighting?.type === "pair") assert.equal(sighting.pair, PAIR)
  const other = sightingFromMessage({
    params: {
      result: {
        address: factory,
        topics: [PAIR_CREATED_TOPIC, "0x" + token.slice(2).padStart(64, "0"), "0x" + "44".repeat(32)],
        data: "0x" + PAIR.slice(2).padStart(64, "0"),
        blockNumber: "0x20",
      },
    },
  }, new Set())
  assert.equal(other, null)
})
