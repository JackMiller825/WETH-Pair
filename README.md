# WETH live pairs

Web app for listing new Ethereum pools that include WETH from the [DEXTools live new pairs](https://www.dextools.io/app/ether/live-new-pairs) page.

Pick a time window (last 1, 8, 24, or 48 hours, or a custom number up to 72), choose a file type, and press **Start**. The file downloads and the pairs show in the page.

Each row has:

- **name** — trading pair, for example `MINP/WETH (Minpentai)`
- **created_time** — when the pool was created, in UTC, as `2026-09-29 17:52:47`
- **exchange** — DEX shown on that pair’s page, for example `Uniswap V4`
- **url** — DEXTools pair explorer link

File types: CSV (`.csv`), JSON (`.json`), and text (`.txt`).

Native ETH pairs (quote token `0x000…000`) are not WETH and are left out.

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

The same search is available as a Python script. Requires Python 3.10 or newer and no extra packages.

```bash
python3 scrape_weth_pairs.py --hours 24 --format csv --output weth_pairs_24h.csv
python3 scrape_weth_pairs.py --hours 8h --format csv --output weth_pairs_8h.csv
python3 scrape_weth_pairs.py --hours 8,24 --format csv --output weth_pairs.csv
```

The script waits briefly between pages. Use DEXTools in line with their terms of service.
