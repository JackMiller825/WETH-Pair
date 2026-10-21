import type { ReactNode } from "react"
import { PageFrame } from "@/components/trends/widgets"
import { DEFINITIONS } from "@/lib/market/copy"
import { GAS_PERCENTILES } from "@/lib/market/gas"
import { DEFAULT_GAS_REFRESH_MS, DEFAULT_PRICE_REFRESH_MS, GAS_STALE_MS, PRICE_STALE_MS, PRIMARY_RETRY_MS } from "@/lib/market/service"

export const metadata = { title: "Help · WETH live pairs" }

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="max-w-3xl">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  )
}

function Terms({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[10rem_1fr]">
      {items.map(([term, text]) => (
        <div key={term} className="contents">
          <dt className="font-medium text-foreground">{term}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  )
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} seconds`

export default function HelpPage() {
  return (
    <PageFrame eyebrow="Help" title="Market header and Live Activity" lede="What the ETH price, gas, and Live Activity numbers mean, where they come from, and how fresh they are. LP burn detection always runs first; none of this can delay it.">
      <Section title="ETH price in the header">
        <p>The header shows the ETH/USD price and its change over 1 hour, 24 hours, and 7 days. A plus or minus sign and an arrow show the direction, so it never depends on color alone. Changes under 0.05% are shown neutral.</p>
        <Terms items={[["1H", DEFINITIONS.change1h], ["24H", DEFINITIONS.change24h], ["7D", DEFINITIONS.change7d]]} />
        <p>Each change is (current price − price at that time) ÷ price at that time × 100. With Coinbase as the source, the live trade price is compared with Coinbase candles from exactly 1 hour, 24 hours, and 7 days earlier (1-minute, 15-minute, and hourly candles, interpolated inside the candle). The 7-day value is never derived from 24-hour data. When CoinGecko is the source, it supplies all three changes directly.</p>
        <p>Click the price to see every value, the source, when it was updated, and a Refresh button. Narrow screens show the price and the 24-hour change; wide screens add 1H and 7D.</p>
      </Section>

      <Section title="Ethereum gas">
        <Terms items={[["Standard", DEFINITIONS.standard], ["Fast", DEFINITIONS.fast], ["Rapid", DEFINITIONS.rapid], ["Base fee", DEFINITIONS.baseFee], ["Tip", DEFINITIONS.priorityFee]]} />
        <p>The header shows Standard. Click it for Fast, Rapid, base fee, block, source, and age. Each level is the next block&apos;s base fee plus a priority tip, in gwei: the median of the {GAS_PERCENTILES.map((value) => `${value}th`).join(", ")} percentile tips over the last 20 blocks, read with eth_feeHistory. Rapid is never lower than Fast, and Fast never lower than Standard. Values under 1 gwei show three decimals, for example 0.035; larger values show one, for example 12.4.</p>
        <p>The source line says which RPC answered, for example &quot;Ethereum fee history (rpc.mevblocker.io)&quot;. If that RPC fails, the next one is used and the status reads Fallback RPC. A server with ETHERSCAN_API_KEY uses Etherscan&apos;s gas oracle first and keeps fee history as the fallback; the source then says Etherscan. Values never come from Etherscan otherwise.</p>
      </Section>

      <Section title="Freshness and failures">
        <p>Price refreshes about every {seconds(DEFAULT_PRICE_REFRESH_MS)} and gas on each new Ethereum block, at least every {seconds(DEFAULT_GAS_REFRESH_MS)}. A background tab slows to once a minute. Several tabs share one request through browser storage.</p>
        <Terms
          items={[
            ["Live", "Fresh data from the primary source."],
            ["Refreshing", "No value yet; the first request is running."],
            ["Stale", `The value is older than ${seconds(Math.min(PRICE_STALE_MS, GAS_STALE_MS))}. It stays visible with its age, for example ⚠ 45s old.`],
            ["Fallback", `The primary source failed and the fallback answered. The primary is retried every ${seconds(PRIMARY_RETRY_MS)}, and the display only switches back when it answers, so values do not jump between sources.`],
            ["Unavailable", "Every source failed and there is no earlier value. Nothing is invented."],
          ]}
        />
        <p>A failed refresh keeps the last good value. The header renders immediately with the last value this browser saw, then the published seed, then live data.</p>
      </Section>

      <Section title="Live Activity">
        <p>The right-hand panel lists new WETH pairs, LP burns, rising trends, and news that matched new tokens. Filter by All, Pairs, LP Burns, Trends, or News. The status reads Live while the Ethereum socket is open, Reconnecting when it dropped, and Polling when only the published scan is updating.</p>
        <p>Full screen replaces the page with columns. The starting layout is News → Tokens (24 hours), Trends (24 hours), Pairs, and LP Burns. Add column puts back one you removed, and the button on a column removes it. At least one column stays open, and the layout is remembered in this browser. News and trends are the same 24 hour lists as those pages. Pairs and LP burns stay live. Escape, or Exit full screen, returns to the page. On a narrow screen the columns sit side by side and scroll sideways.</p>
        <p>Cards appear the moment an event is seen. Total Tx, Pooled WETH, and Holders fill in afterwards and update inside the same card; a second card is never created for an update. A new card has a brief soft highlight. When you scroll down to read, new events wait behind a &quot;new events&quot; button instead of moving the list.</p>
        <Terms items={[["Total Tx", `${DEFINITIONS.totalTx} Buys plus sells: every Swap event on the pair since it was created. For pairs younger than about 6 hours it is counted on chain from the creation block. Older pairs start from the DEXTools count and add swaps seen live. The same transaction and log index is never counted twice. It is not the number of Ethereum transactions that touched the token contract.`], ["Pooled WETH", `${DEFINITIONS.pooledWeth} Uniswap V2-style pairs read getReserves on chain, check whether WETH is token0 or token1, and update on every Sync event. V3 pools read the pool's WETH balance after each swap. V4 pools share one contract, so their value comes from DEXTools.`], ["Holders", `${DEFINITIONS.holders} From Blockscout, with Ethplorer as fallback, and DEXTools until either answers. Refreshed every 20 seconds for tokens under 10 minutes old, every minute under an hour, every 3 minutes under a day or while trading, and every 10 minutes otherwise.`]]} />
        <p>Three dots mean the value is still loading. N/A means no source has it; hover it for the reason, for example &quot;Holder provider temporarily unavailable&quot;. 0 is shown only when the source reports zero; DEXTools zeros for a pool it has not priced yet are treated as unknown. A token with a pool always has at least one holder, so an indexer reporting 0 holders, or 0 transfers, has not caught up with that token yet: the next source is used instead.</p>
        <p>Every value carries a block number or time. A delayed or older reply never replaces a newer value, and an on-chain value with a block is only replaced by a later block.</p>
      </Section>

      <Section title="Data sources">
        <Terms
          items={[
            ["ETH price", "Coinbase Exchange ETH-USD (primary), CoinGecko (fallback)."],
            ["Gas", "Ethereum eth_feeHistory via rpc.mevblocker.io, eth.drpc.org, then ethereum-rpc.publicnode.com."],
            ["Pool data", "Ethereum logs and eth_call via rpc.mevblocker.io and eth.drpc.org, and a separate eth.drpc.org socket."],
            ["Holders", "Blockscout, Ethplorer, DEXTools."],
            ["Trends and news", "Computed once per publish from the pair snapshot and RSS headlines."],
          ]}
        />
        <p>This site is a static GitHub Pages build, so there is no server to fetch prices for everyone. The publish job writes a market seed every run, and each browser then refreshes from the providers above. Run locally with npm run dev and the browser instead reads the cached /api/market/status endpoint, where one server worker calls the providers. No API key is ever sent to the browser.</p>
        <p>LP burn detection keeps its own socket to ethereum-rpc.publicnode.com. Market data and Live Activity enrichment use other endpoints and a queue that yields between tasks, so they cannot slow burn detection.</p>
      </Section>
    </PageFrame>
  )
}
