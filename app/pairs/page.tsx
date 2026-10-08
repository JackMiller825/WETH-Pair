import { PairFinder } from "@/components/pair-finder"

export default function PairsPage() {
  return (
    <main className="page-wrap flex w-full flex-1 flex-col gap-6 py-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-medium tracking-[0.18em] text-primary uppercase">Pair detection</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">New WETH pairs</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          See Ethereum/WETH pools as they are collected. Choose how far back to look, then export CSV, JSON, or text.
        </p>
      </header>
      <PairFinder />
    </main>
  )
}
