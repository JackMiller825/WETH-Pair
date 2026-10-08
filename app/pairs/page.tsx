import { PairFinder } from "@/components/pair-finder"

export default function PairsPage() {
  return (
    <main className="flex w-full flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:px-10">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Ethereum · DEXTools</p>
        <h1 className="text-3xl font-semibold tracking-tight">New WETH pairs</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          List new Ethereum pools that include WETH. Set how far back to look, pick CSV, JSON, or text, and press Start.
        </p>
      </header>
      <PairFinder />
    </main>
  )
}
