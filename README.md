# DEXTools WETH pairs (last 24 hours)

Python script that lists Ethereum pairs involving WETH from the [DEXTools live new pairs](https://www.dextools.io/app/ether/live-new-pairs) page.

That page is a JavaScript app. The script reads the same public listing feed the page uses, keeps pools where one token is canonical WETH (`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`), and drops anything older than 24 hours.

For each pair it prints:

- **name** — trading pair, for example `MINP/WETH (Minpentai)`
- **created_time** — when the pool was created, in UTC
- **url** — DEXTools pair explorer link

Native ETH pairs (quote token `0x000…000`, shown as `ETH` on the page) are not WETH and are left out.

## Run

Requires Python 3.10 or newer. No extra packages.

```bash
python3 scrape_weth_pairs.py
```

The latest run is saved as `weth_pairs.csv` (`name`, `created_time`, `url`). Refresh it with:

```bash
python3 scrape_weth_pairs.py --format csv --output weth_pairs.csv
```

JSON instead:

```bash
python3 scrape_weth_pairs.py --format json --output pairs.json
```

A different window, in hours:

```bash
python3 scrape_weth_pairs.py --hours 6
```

A short summary (how many pairs matched, how many pools were scanned) is printed to stderr. The pair list itself goes to stdout, or to `--output`.

The script waits briefly between pages. Use DEXTools in line with their terms of service, and don't hammer the listing endpoint.
