# WETH live pairs

Web app for listing new Ethereum pools that include WETH from the [DEXTools live new pairs](https://www.dextools.io/app/ether/live-new-pairs) page, with market data and LP burn status for each pair.

Pick a time window (last 1, 8, 24, or 48 hours, or a custom number up to 72), choose a file type, and press **Start**. The pairs show in the page. Nothing downloads on its own; press the download button above the results to save the file.

Each row has:

- **name** — the token and its full name, without the WETH side, for example `MINP(Minpentai)`
- **created_time** — when the pool was created, as `2026-09-29 17:52:47`, in the time zone you pick
- **exchange** — DEX shown on that pair’s page, for example `Uniswap V4`
- **price_usd** — token price in USD
- **market_cap_usd** — market cap from DEXTools. When DEXTools has none, fully diluted value is used, then price times total supply. Empty if the price is unknown.
- **liquidity_usd** — total pool liquidity in USD
- **remaining**, **remaining_unit** — how much of the quote token (ETH for WETH pools) is left in the pool
- **holders** — token holder count
- **total_tx** — total transactions in the pool
- **lp_status** — `Burnt`, `Locked`, `Unverified`, or `None`. `Unverified` means the LP tokens sit at the burn address but DEXTools does not recognise the exchange, so it does not show the pool as burnt.
- **lp_burnt_percent** — exact share of LP tokens burnt, up to four decimals (for example `99.9533`)
- **lp_locked_percent**, **lp_unlock_time** — share of LP currently locked and the latest unlock time, in the chosen time zone. Empty when nothing is locked.
- **token_address**, **pair_address** — full contract addresses
- **url** — DEXTools pair explorer link

Time zone: DEXTools shows pool times in your device's time zone, so the **Time zone** setting defaults to **This device** and matches what you see on the DEXTools pair page. Choose UTC or another city to change it. The same zone is used in the downloaded file. The sample CSVs in this folder use New York time.

File types: CSV (`.csv`), JSON (`.json`), and text (`.txt`).

Native ETH pairs (quote token `0x000…000`) are not WETH and are left out.

## Reading the table

The results use the full width of the screen. Price uses DEXTools-style subscripts for long runs of zeros, so `$0.0₅4957` means `$0.000004957`. Token and pair addresses are shortened, and the copy icon beside each copies the full address.

The LP status column shows the state (Burnt, Locked, or Unverified) with the exact burnt percentage under it. A locked pool shows its locked share and unlock time as well. Pools with no burn or lock record show `-`.

## Find LP Burnt Token

The **Find LP Burnt Token** button shows only pairs whose liquidity is burnt, as cards that match the DEXTools liquidity panel: liquidity value, flame icon, and burnt percentage. Use the download button in the results header to save the list in the chosen file type.

A pair counts as burnt when the share of its LP tokens held by the burn address is above the share that is locked, which is the rule the DEXTools pair page uses to show the flame instead of the padlock. Locks that have already expired do not count.

The page also shows the flame only when it recognises the exchange, so pools on an "Unknown DEX" are never counted, even when their LP tokens went to the burn address. DEXTools shows a plain padlock with "-" for those pools, which means it has no burn or lock record it trusts for them.

Only pools that issue LP tokens can be burnt. Uniswap V3 and V4 style pools hold liquidity as positions instead, so the button skips them, which also makes it much faster than Start. If you pressed Start for the same period first, the button reuses that data and answers instantly.

## Filter and sort

Above the results, **Name** filters by part of the pair name (not case sensitive) and **Exchange** limits the list to one DEX, with the number of pairs for each. **Clear filters** appears when either is set.

Sort with the **Sort by** menu and its arrow, or click a column header: Created, Price, Market cap, Total liquidity, Remaining, Holders, Total Tx, or LP status. The first click sorts high to low and the next flips it. Rows with no value in the sorted column always stay at the bottom. LP status sorts burnt first (a larger burnt share ahead of a smaller one), then locked, unverified, and none.

Filters and sorting work in both the table and the burnt cards, and the file you download follows the same filters and order. Filters reset when you fetch fresh data.

## Live updates

Start and Find LP Burnt Token turn on a one-minute refresh. The page reloads the same time window, keeps your filters and sort, and stays current while the tab is open. **Stop watching** pauses it, and **Start watching** resumes it.

Tokens that are already LP burnt when a search finishes are the baseline, so they do not raise an alert. A token that becomes LP burnt later does:

- a card in the corner with the name, exchange, liquidity, burnt share, and a link to the pair
- a desktop notification, including while the tab is in the background, once you allow notifications
- two short beeps, unless you turn **Sound** off
- a `NEW` badge on that row until you dismiss the alert
- the browser tab title shows the number of open alerts

**Test alert** plays the same sound and shows a sample card, so you can check it before a real token appears. Pools on an unknown exchange stay out of these alerts, because DEXTools does not show them as burnt.

## Back and pagination

The burnt view has a **Back to all pairs** button. It returns to the full list for the same period, instantly if Start already loaded it, otherwise it loads the list first.

Both the table and the burnt cards are paginated, with a page size of 10, 25, 50, or 100 (25 for the table and 10 for the cards by default). Downloaded files contain every row that matches your filters, not just the current page. The download button shows the count, for example `(8 of 181)`, whenever a filter is on.

## Download

`downloads/weth-live-pairs.rar` holds the project source. Extract it with WinRAR (or 7-Zip), then run the commands below inside the extracted folder.

## Run the app

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the URL printed in the terminal.

## Command line

The same search is available as a Python script. It lists name, created time, exchange, and URL only; market data and LP burn status are in the web app. Requires Python 3.10 or newer and no extra packages.

```bash
python3 scrape_weth_pairs.py --hours 24 --format csv --output weth_pairs_24h.csv
python3 scrape_weth_pairs.py --hours 8h --format csv --output weth_pairs_8h.csv
python3 scrape_weth_pairs.py --hours 8,24 --format csv --output weth_pairs.csv
```

The script waits briefly between pages. Use DEXTools in line with their terms of service.
