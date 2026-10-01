# WETH live pairs

Web app for listing new Ethereum pools that include WETH from the [DEXTools live new pairs](https://www.dextools.io/app/ether/live-new-pairs) page, with market data and LP burn status for each pair.

Pick a time window (last 1, 8, 24, or 48 hours, or a custom number up to 72), choose a file type, and press **Start**. The pairs show in the page. Nothing downloads on its own; press the download button above the results to save the file.

Each row has:

- **name** — the token and its full name, without the WETH side, for example `MINP(Minpentai)`
- **created_time** — when the pool was created, as `2026-09-29 17:52:47`, in the time zone you pick
- **exchange** — DEX shown on that pair’s page, for example `Uniswap V4`
- **market_cap_usd** — market cap from DEXTools. When DEXTools has none, fully diluted value is used, then price times total supply. Empty if the price is unknown.
- **liquidity_usd** — pool liquidity in USD
- **holders** — token holder count
- **total_tx** — total transactions in the pool
- **lp_status** — `Burnt 100%`, `Locked 80%` (or `Locked` when the share is not published), or `None`
- **url** — DEXTools pair explorer link

Time zone: DEXTools shows pool times in your device's time zone, so the **Time zone** setting defaults to **This device** and matches what you see on the DEXTools pair page. Choose UTC or another city to change it. The same zone is used in the downloaded file. The sample CSVs in this folder use New York time.

File types: CSV (`.csv`), JSON (`.json`), and text (`.txt`).

Native ETH pairs (quote token `0x000…000`) are not WETH and are left out.

## Find LP Burnt Token

The **Find LP Burnt Token** button shows only pairs whose liquidity is burnt, as cards that match the DEXTools liquidity panel: liquidity value, flame icon, and burnt percentage. Use the download button in the results header to save the list in the chosen file type.

A pair counts as burnt when the share of its LP tokens held by the burn address is above the share that is locked, which is the rule the DEXTools pair page uses to show the flame instead of the padlock. Locks that have already expired do not count.

Only pools that issue LP tokens can be burnt. Uniswap V3 and V4 style pools hold liquidity as positions instead, so the button skips them, which also makes it much faster than Start. If you pressed Start for the same period first, the button reuses that data and answers instantly.

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
