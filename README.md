# DEXTools WETH pairs

Python script that lists Ethereum pairs involving WETH from the [DEXTools live new pairs](https://www.dextools.io/app/ether/live-new-pairs) page.

That page is a JavaScript app. The script reads the same public listing feed the page uses, keeps pools where one token is canonical WETH (`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`), and drops anything older than the period you choose.

For each pair it writes:

- **name** — trading pair, for example `MINP/WETH (Minpentai)`
- **created_time** — when the pool was created, in UTC, as `2026-09-29 17:52:47`
- **exchange** — DEX shown on that pair’s page, for example `Uniswap V4`
- **url** — DEXTools pair explorer link

Native ETH pairs (quote token `0x000…000`, shown as `ETH` on the page) are not WETH and are left out.

## Run

Requires Python 3.10 or newer. No extra packages.

Last 24 hours, saved as CSV:

```bash
python3 scrape_weth_pairs.py --hours 24 --format csv --output weth_pairs_24h.csv
```

Last 8 hours:

```bash
python3 scrape_weth_pairs.py --hours 8h --format csv --output weth_pairs_8h.csv
```

Both windows in one pass (scans the longer period once, then writes one file per window):

```bash
python3 scrape_weth_pairs.py --hours 8,24 --format csv --output weth_pairs.csv
```

That writes `weth_pairs_8h.csv` and `weth_pairs_24h.csv`.

`--hours` accepts `8`, `8h`, `24`, or `24h`. The default period is 24 hours. A short summary is printed to stderr.

The checked-in files `weth_pairs_8h.csv` and `weth_pairs_24h.csv` are the latest runs.

The script waits briefly between pages. Use DEXTools in line with their terms of service, and don't hammer the listing endpoint.
