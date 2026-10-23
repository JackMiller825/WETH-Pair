import type { ReactNode } from "react"
import { PageFrame } from "@/components/trends/widgets"
import { DEFINITIONS } from "@/lib/market/copy"
import { GAS_SCORE_GWEI } from "@/lib/activity/pulse"
import { MIN_RELIABLE_WETH, PUMP_TOOLTIP } from "@/lib/pump/price"
import { TIE_BREAK } from "@/lib/pump/rank"
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
    <PageFrame eyebrow="Help" title="Market header, Live Activity, and Top Pumpers" lede="What the ETH price, gas, Live Activity numbers, and Top Pumpers ranking mean, where they come from, and how fresh they are. LP burn detection always runs first; none of this can delay it.">
      <Section title="ETH price in the header">
        <p>The header shows the ETH/USD price and its change over 1 hour, 24 hours, and 7 days. A plus or minus sign and an arrow show the direction, so it never depends on color alone. Changes under 0.05% are shown neutral.</p>
        <Terms items={[["1H", DEFINITIONS.change1h], ["24H", DEFINITIONS.change24h], ["7D", DEFINITIONS.change7d]]} />
        <p>Each change is (current price − price at that time) ÷ price at that time × 100. With Coinbase as the source, the live trade price is compared with Coinbase candles from exactly 1 hour, 24 hours, and 7 days earlier (1-minute, 15-minute, and hourly candles, interpolated inside the candle). The 7-day value is never derived from 24-hour data. When CoinGecko is the source, it supplies all three changes directly.</p>
        <p>Click the price to see every value, the source, when it was updated, a Refresh button, and the ETH chart. Area is the filled line. Candles show open, high, low, and close. The interval sets the candle size: 1 minute, 5 minutes, 15 minutes, 1 hour, 6 hours, or 1 day. The chart is the TradingView ETH/USD chart, so the candles follow the live market. Current is the latest trade, and the timer is the time left until that candle closes. If TradingView does not load, the same intervals are drawn from Coinbase, then Kraken, then CoinGecko, and the open candle still moves with the latest trade. Narrow screens show the price and the 24-hour change; wide screens add 1H and 7D.</p>
      </Section>

      <Section title="Ethereum gas">
        <Terms items={[["Standard", DEFINITIONS.standard], ["Fast", DEFINITIONS.fast], ["Rapid", DEFINITIONS.rapid], ["Base fee", DEFINITIONS.baseFee], ["Tip", DEFINITIONS.priorityFee]]} />
        <p>The header shows Standard. Click it for Fast, Rapid, base fee, block, source, and age. Each level is the next block&apos;s base fee plus a priority tip, in gwei: the median of the {GAS_PERCENTILES.map((value) => `${value}th`).join(", ")} percentile tips over the last 20 blocks, read with eth_feeHistory. Rapid is never lower than Fast, and Fast never lower than Standard. Values under 1 gwei show three decimals, for example 0.035; larger values show one, for example 12.4.</p>
        <p>The source line says which RPC answered, for example &quot;Ethereum fee history (rpc.mevblocker.io)&quot;. If that RPC fails, the next one is used and the status reads Fallback RPC. A server with ETHERSCAN_API_KEY uses Etherscan&apos;s gas oracle first and keeps fee history as the fallback; the source then says Etherscan. Values never come from Etherscan otherwise.</p>
        <p>Open the gas panel for Guzzlers, Spenders, and History. Those two tables are Etherscan&apos;s gas tracker: the name Etherscan shows, and the same 3 hour and 24 hour fees and percentages Etherscan published. Copy copies the address, not the name. The chart icon opens that address&apos;s fee analytics. The block number is the Etherscan block for those rows. The table is refreshed when this site republishes, about every five minutes, and an open panel reloads it. History charts Standard, Fast, and Rapid from Ethereum fee history over the last 15 minutes, 1 hour, 6 hours, or 24 hours.</p>
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
        <p>Full screen replaces the page with columns. The starting layout is News → Tokens (24 hours), Trends (24 hours), Top Pumpers, Pairs, and LP Burns. The interval chips in that header, from 1 minute through 24 hours or All, limit which pairs, LP burns, and news items are shown. Trends stay the 24 hour list. Add column puts back one you removed, and the button on a column removes it. At least one column stays open, and the layout is remembered in this browser. A layout saved before Top Pumpers is given that column once, between Trends and Pairs; removing it after that stays removed. Escape, or Exit full screen, returns to the page. On a narrow screen the columns sit side by side and scroll sideways.</p>
        <p>Cards appear the moment an event is seen. Total Tx, Pooled WETH, and Holders fill in afterwards and update inside the same card; a second card is never created for an update. A new card has a brief soft highlight. When you scroll down to read, new events wait behind a &quot;new events&quot; button instead of moving the list.</p>
        <Terms items={[["Total Tx", `${DEFINITIONS.totalTx} Buys plus sells: every Swap event on the pair since it was created. For pairs younger than about 6 hours it is counted on chain from the creation block. Older pairs start from the DEXTools count and add swaps seen live. The same transaction and log index is never counted twice. It is not the number of Ethereum transactions that touched the token contract.`], ["Pooled WETH", `${DEFINITIONS.pooledWeth} Uniswap V2-style pairs read getReserves on chain, check whether WETH is token0 or token1, and update on every Sync event. V3 pools read the pool's WETH balance after each swap. V4 pools share one contract, so their value comes from DEXTools.`], ["Holders", `${DEFINITIONS.holders} From Blockscout, with Ethplorer as fallback, and DEXTools until either answers. Refreshed every 20 seconds for tokens under 10 minutes old, every minute under an hour, every 3 minutes under a day or while trading, and every 10 minutes otherwise.`]]} />
        <p>Three dots mean the value is still loading. N/A means no source has it; hover it for the reason, for example &quot;Holder provider temporarily unavailable&quot;. 0 is shown only when the source reports zero; DEXTools zeros for a pool it has not priced yet are treated as unknown. A token with a pool always has at least one holder, so an indexer reporting 0 holders, or 0 transfers, has not caught up with that token yet: the next source is used instead.</p>
        <p>Every value carries a block number or time. A delayed or older reply never replaces a newer value, and an on-chain value with a block is only replaced by a later block.</p>
      </Section>

      <Section title="Top Pumpers">
        <p>{PUMP_TOOLTIP} The column sits between Trends and Pairs. It opens on New launch, because the pairs on this board are usually younger than a day, so a 24 hour window has no baseline for them yet. Window return is the other mode, and it says so when a token is too young. Changing the interval updates the list in place. Current reserves are read first, and the published snapshot price is stored at the time that snapshot was taken, so a ranking can appear before the older buckets finish. Details opens beside the row, with the return, prices, confidence, and links, and it stays on screen when the column scrolls.</p>
        <p>The multiple is the latest USD price divided by the reference USD price. The percentage is (multiple − 1) × 100. A price that doubles is 2.00x and +100%. A price that is four times the reference is 4.00x and +300%. The two USD prices each include the ETH price at the moment they were recorded, so ETH&apos;s own move between those moments is part of the result.</p>
        <Terms
          items={[
            ["Window return", "Tokens with a recorded price at, or just before, the start of the selected interval. The gap can be at most 2 minutes or 5% of the interval, whichever is longer. A token created after the interval started is left out, because it has no price for the full window."],
            ["New launch", "Tokens created during the interval. The reference is the first price after the pool held at least " + MIN_RELIABLE_WETH + " WETH. The row is labeled Since launch. It is a different list from Window return."],
            ["Peak", "The highest price observed between the reference and now, shown as its own multiple. Retracement is how far the current price sits below that peak."],
            ["Confidence", "High when the baseline pool held at least 1 WETH, at least three prices are indexed, the baseline sits within 2 minutes of the window start, and at least 10 transactions are recorded. Low when the baseline pool held under " + MIN_RELIABLE_WETH + " WETH, fewer than 3 transactions are recorded, or only one price is indexed. Medium is everything between. Low-confidence rows stay out of the numbered list until Show low confidence is on, and each one keeps its reason."],
            ["Tie", "Equal multiples are ordered by " + TIE_BREAK + "."],
          ]}
        />
        <p>A decline, such as 0.50x and -50%, stays off the list while Only above 1.00x is on. Filters for pooled WETH, transactions, holders, liquidity, and age are listed under the interval, so a token is never dropped by a rule you cannot see. Still rising and Retracing describe the latest observed moves. They are a record of what already happened.</p>
        <p>Prices come from Uniswap V2-style reserves. WETH may be token0 or token1, and the token&apos;s own decimals are used. Sync events on the Live Activity socket store a point about every 5 seconds. The publish job also stores reserve readings at 15 minutes, 30 minutes, 1 hour, 3 hours, 6 hours, 12 hours, 24 hours, 3 days, and 7 days for the newest V2 pairs. Each browser keeps that seed plus its own history. There is no shared live ranking server on the static site. While the column is open, missing buckets are read one at a time in the background.</p>
        <p>The list refreshes about every 5 seconds from the stored book. A common interval is reused until a price changes. 3 days uses a 72 hour baseline and 7 days uses 168 hours; a shorter history is never relabeled as the longer interval. When the oldest indexed point is inside the requested window, the column shows how much history is indexed and that the result is partial. A rank that moves shows an arrow, and a token that enters the list shows NEW. Click a token for the existing token page, or Details for the peak, the reference price, DEXTools, and Etherscan.</p>
      </Section>

      <Section title="Market conditions">
        <p>The full-screen board shows how active the WETH launch market is. Pair counts use each pair&apos;s creation time. LP burn counts use the burn time, so a pair created yesterday and burned in the last hour counts in LP burns 1H. Each percentage compares that window with the equal window before it: the last hour against the hour before that, not against 24 hours. A previous window of zero is shown as new, because there is nothing to divide by.</p>
        <p>Show chart draws the real hourly counts. 6H, 12H, and 24H use one-hour buckets. 3D uses three-hour buckets and 7D uses six-hour buckets, so the labels stay readable. Empty buckets stay at zero. Nothing is filled in between observations. Pairs, LP burns, or both can be drawn together. The choice is remembered in this browser. Hover text is the bucket&apos;s count and its change from the previous bucket.</p>
        <p>Very Active, Increasing, Normal, Slowing, and Quiet compare the last hour with the previous hour and with the average of that same clock hour over recent days. Very Active means the hour is at least 1.8 times that baseline and ahead of the previous hour, or at least 1.8 times the previous hour while also at or above the baseline. Increasing is at least 1.15 times the previous hour. Slowing is 0.75 times or below. Quiet is zero, or under 0.4 times the baseline.</p>
        <p>Top Pumpers can sort by Pump, Transactions, Volume, Pooled WETH, or Holders. Pump keeps Window return and New launch. Transactions counts deduplicated swap logs seen during the selected interval. A log loaded in one backfill shares one observation time, so it is not placed inside that interval, and a lifetime total is never substituted. Buy and sell sides and unique wallets are shown only when the log actually carries them. Volume is the published 24 hour volume. Pooled WETH and holders are the latest values.</p>
        <p>Market conditions is a 0–100 reading of observed activity. The parts are pair activity (weight 20), LP burn activity (12), tracked swaps (18), observed WETH reserve change (10), recent launch multiples (14), gas (16), and ETH stability (10). A missing part is left out and the other weights are rescaled, so a missing price history does not count as zero. Gas at or below {GAS_SCORE_GWEI.veryLow} gwei is Very Low (96), {GAS_SCORE_GWEI.low} gwei is Low (82), {GAS_SCORE_GWEI.moderate} gwei is Moderate (58), {GAS_SCORE_GWEI.high} gwei is High (32), and above that is Very High (12). ETH stability falls when the 1 hour or 24 hour move is large in either direction. 85–100 is Very Active, 70–84 Active, 50–69 Mixed, 30–49 Quiet, and 0–29 Very Quiet.</p>
        <p>The event activity ratio is LP burns divided by pair launches in the same hour. The cohort LP burn rate is the share of pairs created in the previous hour that have since burned. They are different numbers. Recent launch multiples use tokens created in the last 6 hours that have two observed prices. The median is shown with the 25th, 75th, and 90th percentiles. Continued prices count a pair when a later indexed price exists 15 minutes, 30 minutes, 1 hour, or 3 hours after creation. The 7 day heatmap and historically active hours count pair creations by the display timezone. Stored times stay in UTC. Each hour this browser records the score. The chart shows that local record only, and hours before it stay blank. Those hours are the busiest observed hours. They are not a recommended time to launch, and the score is not a chance that a new token succeeds.</p>
      </Section>

      <Section title="Data sources">
        <Terms
          items={[
            ["ETH price", "Coinbase Exchange ETH-USD (primary), CoinGecko (fallback)."],
            ["Gas", "Ethereum eth_feeHistory via rpc.mevblocker.io, eth.drpc.org, then ethereum-rpc.publicnode.com."],
            ["Pool data", "Ethereum logs and eth_call via rpc.mevblocker.io and eth.drpc.org, and a separate eth.drpc.org socket."],
            ["Holders", "Blockscout, Ethplorer, DEXTools."],
            ["Trends and news", "Computed once per publish from the pair snapshot and RSS headlines."],
            ["Top Pumpers", "Uniswap V2 reserves from Sync events and from historical eth_call reads via rpc.mevblocker.io and eth.drpc.org, priced with the header ETH/USD rate. The published seed is data/pumpers.json."],
          ]}
        />
        <p>This site is a static GitHub Pages build, so there is no server to fetch prices for everyone. The publish job writes a market seed every run, and each browser then refreshes from the providers above. Run locally with npm run dev and the browser instead reads the cached /api/market/status endpoint, where one server worker calls the providers. No API key is ever sent to the browser.</p>
        <p>LP burn detection keeps its own socket to ethereum-rpc.publicnode.com. Market data and Live Activity enrichment use other endpoints and a queue that yields between tasks, so they cannot slow burn detection.</p>
      </Section>
    </PageFrame>
  )
}
