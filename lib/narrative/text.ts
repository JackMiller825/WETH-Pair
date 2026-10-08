import { ALIASES, CONCEPTS, type Concept } from "@/lib/narrative/lexicon"
import type { PairRecord } from "@/lib/types"

export type ConceptHit = {
  id: string
  label: string
  group: Concept["group"]
  generic: boolean
  confidence: number
  via: "name" | "ticker" | "description"
}

const STOP = new Set([
  "the", "a", "an", "of", "and", "or", "for", "to", "in", "on", "at", "by", "with",
  "coin", "token", "tokens", "official", "erc", "erc20", "new", "real", "true",
])

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

export function parseIdentity(record: PairRecord): { symbol: string; tokenName: string } {
  const listed = record.name.trim()
  const match = listed.match(/^([^()]+)\((.+)\)$/)
  const symbol = (record.symbol || (match ? match[1] : listed)).trim()
  const tokenName = (record.tokenName || (match ? match[2] : listed)).trim()
  return { symbol, tokenName }
}

export function tickerOf(symbol: string): string {
  return symbol.replace(/[^a-z0-9]/gi, "").toUpperCase()
}

export function nameWords(tokenName: string): string[] {
  return normalizeText(tokenName)
    .split(" ")
    .filter((word) => word.length >= 2 && !STOP.has(word))
}

function hasPhrase(normalized: string, phrase: string): boolean {
  return ` ${normalized} `.includes(` ${phrase} `)
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]
      row[j] = a[i - 1] === b[j - 1] ? previous : Math.min(previous, row[j - 1], current) + 1
      previous = current
    }
  }
  return row[b.length]
}

function remember(hits: Map<string, ConceptHit>, hit: ConceptHit) {
  const existing = hits.get(hit.id)
  if (!existing || hit.confidence > existing.confidence) hits.set(hit.id, hit)
}

export function matchConcepts(tokenName: string, symbol: string, description: string | null): ConceptHit[] {
  const hits = new Map<string, ConceptHit>()
  const normalized = normalizeText(tokenName)
  const described = description ? normalizeText(description) : ""
  const ticker = tickerOf(symbol)
  const knownFragments = new Set(CONCEPTS.flatMap((concept) => concept.ticker.map((item) => item.toUpperCase())))

  for (const { concept, alias } of ALIASES) {
    if (hasPhrase(normalized, alias)) {
      remember(hits, {
        id: concept.id,
        label: concept.label,
        group: concept.group,
        generic: concept.generic === true,
        confidence: alias.length <= 3 ? 0.62 : 0.92,
        via: "name",
      })
    } else if (described && alias.length >= 4 && hasPhrase(described, alias)) {
      remember(hits, {
        id: concept.id,
        label: concept.label,
        group: concept.group,
        generic: concept.generic === true,
        confidence: 0.55,
        via: "description",
      })
    }
  }

  for (const word of normalized.split(" ").filter((item) => item.length >= 6)) {
    for (const { concept, alias } of ALIASES) {
      if (alias.length < 6 || alias.includes(" ")) continue
      if (hits.get(concept.id)?.via === "name") continue
      if (Math.abs(word.length - alias.length) > 1) continue
      if (levenshtein(word, alias) === 1) {
        remember(hits, {
          id: concept.id,
          label: concept.label,
          group: concept.group,
          generic: concept.generic === true,
          confidence: 0.5,
          via: "name",
        })
      }
    }
  }

  if (ticker) {
    for (const concept of CONCEPTS) {
      for (const fragment of concept.ticker) {
        const frag = fragment.toUpperCase()
        if (!frag || !tickerMatches(ticker, frag, knownFragments)) continue
        remember(hits, {
          id: concept.id,
          label: concept.label,
          group: concept.group,
          generic: concept.generic === true,
          confidence: frag.length <= 2 ? 0.58 : 0.84,
          via: hits.get(concept.id)?.via === "name" ? "name" : "ticker",
        })
      }
    }
  }

  return [...hits.values()].sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label))
}

function tickerMatches(ticker: string, fragment: string, known: Set<string>): boolean {
  if (fragment.length >= 4) return ticker.includes(fragment)
  if (ticker === fragment) return true
  if (ticker.startsWith(fragment)) return remainderIsSignal(ticker.slice(fragment.length), known)
  if (ticker.endsWith(fragment)) return remainderIsSignal(ticker.slice(0, -fragment.length), known)
  return false
}

function remainderIsSignal(remainder: string, known: Set<string>): boolean {
  if (!remainder) return true
  if (known.has(remainder)) return true
  for (const fragment of known) {
    if (fragment.length >= 3 && remainder.includes(fragment)) return true
  }
  return false
}

export function initials(tokenName: string): string {
  return nameWords(tokenName).map((word) => word[0]).join("").toUpperCase()
}

export function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return slug || "trend"
}
