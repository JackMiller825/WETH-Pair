import assert from "node:assert/strict"
import test from "node:test"
import { addColumn, columnsFrom, DEFAULT_BOARD_COLUMNS, removeColumn } from "./board"

test("a first visit opens News, Trends, Pairs, and LP Burns", () => {
  assert.deepEqual(columnsFrom(null), ["news", "trends", "pairs", "burns"])
  assert.deepEqual(columnsFrom("not json"), DEFAULT_BOARD_COLUMNS)
  assert.deepEqual(columnsFrom("[]"), DEFAULT_BOARD_COLUMNS)
  assert.deepEqual(columnsFrom("{}"), DEFAULT_BOARD_COLUMNS)
})

test("a saved layout keeps its order and drops unknown or repeated columns", () => {
  assert.deepEqual(columnsFrom(JSON.stringify(["burns", "pairs", "nope", "pairs"])), ["burns", "pairs"])
})

test("adding a column appends it, and adding it again does not duplicate it", () => {
  assert.deepEqual(addColumn(["pairs"], "news"), ["pairs", "news"])
  assert.deepEqual(addColumn(["pairs", "news"], "news"), ["pairs", "news"])
})

test("removing a column leaves the rest, and the last column cannot be removed", () => {
  assert.deepEqual(removeColumn(["news", "trends", "pairs", "burns"], "trends"), ["news", "pairs", "burns"])
  assert.deepEqual(removeColumn(["burns"], "burns"), ["burns"])
})
