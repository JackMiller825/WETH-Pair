#!/usr/bin/env python3
"""List Ethereum pairs involving WETH from DEXTools live new pairs.

The page https://www.dextools.io/app/ether/live-new-pairs is a JavaScript app.
It loads pools from the public listing API below. This script pages through
that same feed, keeps pools where one token is canonical WETH, and drops
anything older than the requested window (24 hours by default, or 8h, 24h, …).

Fields written for each pair:
  name          trading pair, for example MINP/WETH (Minpentai)
  created_time  pool creation time in UTC, for example 2026-09-29 17:52:47
  exchange      DEX shown on the pair page, for example Uniswap V4
  url           DEXTools pair explorer link
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

LISTING_API = "https://www.dextools.io/api/core"
EXCHANGES_API = "https://www.dextools.io/shared/exchanges/v2"
PAGE_URL = "https://www.dextools.io/app/ether/live-new-pairs"
CHAIN = "ether"
# Canonical WETH on Ethereum mainnet. Native ETH (the zero address) is a
# different quote asset on this feed and is not included.
WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
PAGE_SIZE = 100
USER_AGENT = "dextools-weth-pairs/1.0"
MAX_RETRIES = 4
UNKNOWN_EXCHANGE = "Unknown DEX"
COLUMNS = ("name", "created_time", "exchange", "url")
_PERIOD = re.compile(r"^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)?$", re.IGNORECASE)


class ListingError(RuntimeError):
    """The live-new-pairs listing could not be read."""


def parse_created_time(value: str) -> datetime:
    """Parse a DEXTools creation timestamp into an aware UTC datetime."""
    text = value.strip().replace(" ", "T", 1)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def is_weth(token: dict[str, Any] | None) -> bool:
    if not token:
        return False
    return str(token.get("address") or "").lower() == WETH_ADDRESS


def pair_name(pool: dict[str, Any]) -> str:
    """Build the pair label shown as BASE/QUOTE, plus the base token name."""
    main = pool.get("mainToken") or {}
    side = pool.get("sideToken") or {}
    base_symbol = str(main.get("symbol") or "?").strip() or "?"
    quote_symbol = str(side.get("symbol") or "?").strip() or "?"
    label = f"{base_symbol}/{quote_symbol}"
    token_name = str(main.get("name") or "").strip()
    if token_name and token_name.lower() != base_symbol.lower():
        return f"{label} ({token_name})"
    return label


def pair_url(address: str) -> str:
    quoted = urllib.parse.quote(address, safe="")
    return f"https://www.dextools.io/app/{CHAIN}/pair-explorer/{quoted}"


def exchange_label(slug: str, names: dict[str, str]) -> str:
    """Map a pool exchange id to the name shown on the pair page."""
    key = slug.strip().lower()
    if not key:
        return UNKNOWN_EXCHANGE
    return names.get(key) or UNKNOWN_EXCHANGE


def to_record(pool: dict[str, Any], exchange_names: dict[str, str]) -> dict[str, str] | None:
    """Map one pool into the requested fields, or skip incomplete rows."""
    address = str(pool.get("address") or "").strip()
    created_raw = str(pool.get("creationTime") or "").strip()
    if not address or not created_raw:
        return None
    if not (is_weth(pool.get("mainToken")) or is_weth(pool.get("sideToken"))):
        return None
    created = parse_created_time(created_raw)
    return {
        "name": pair_name(pool),
        "created_time": created.strftime("%Y-%m-%d %H:%M:%S"),
        "exchange": exchange_label(str(pool.get("exchange") or ""), exchange_names),
        "url": pair_url(address),
        "_created": created.isoformat(),
        "_address": address.lower(),
    }


def parse_period_token(value: str) -> float:
    """Accept 8, 8h, 24h, or 24 hours."""
    match = _PERIOD.fullmatch(value.strip())
    if not match:
        raise argparse.ArgumentTypeError(
            f"Invalid period {value!r}. Use a number of hours, for example 8, 8h, or 24h."
        )
    hours = float(match.group(1))
    if hours <= 0:
        raise argparse.ArgumentTypeError("period must be greater than 0")
    return hours


def parse_periods(values: list[str] | None) -> list[float]:
    """Flatten repeated and comma-separated --hours values, preserving order."""
    if not values:
        return [24.0]
    periods: list[float] = []
    seen: set[float] = set()
    for raw in values:
        for part in raw.split(","):
            if not part.strip():
                continue
            hours = parse_period_token(part)
            if hours in seen:
                continue
            seen.add(hours)
            periods.append(hours)
    if not periods:
        raise argparse.ArgumentTypeError("Provide at least one period, for example 8h or 24h.")
    return periods


def period_label(hours: float) -> str:
    return f"{hours:g}h"


def _request_json(url: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "X-API-Version": "1",
            "Referer": PAGE_URL,
        },
    )
    delay = 1.0
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.load(response)
            if not isinstance(payload, dict):
                raise ListingError(f"Unexpected response from {url}")
            return payload
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in {429, 500, 502, 503, 504} or attempt == MAX_RETRIES:
                detail = exc.read().decode("utf-8", errors="replace")[:300]
                raise ListingError(
                    f"DEXTools listing returned HTTP {exc.code} for {url}. {detail}"
                ) from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt == MAX_RETRIES:
                break
        time.sleep(delay)
        delay *= 2
    raise ListingError(f"Could not reach the DEXTools listing API: {last_error}")


def fetch_exchange_names(timeout: float) -> dict[str, str]:
    """Load the slug-to-name catalog the pair page uses for its DEX label."""
    query = urllib.parse.urlencode({"allowUnknowns": "false", "chain": CHAIN})
    payload = _request_json(f"{EXCHANGES_API}?{query}", timeout)
    blocks = payload.get("data")
    names: dict[str, str] = {}
    if isinstance(blocks, list):
        for block in blocks:
            if not isinstance(block, dict):
                continue
            for item in block.get("exchanges") or []:
                if not isinstance(item, dict):
                    continue
                slug = str(item.get("slug") or "").strip().lower()
                name = str(item.get("name") or "").strip()
                if slug and name:
                    names[slug] = name
    if not names:
        raise ListingError("DEXTools exchange list was empty.")
    return names


def fetch_page(cursor: int | None, timeout: float) -> dict[str, Any]:
    """Fetch one page. The first page has no cursor; later pages pass next.ts."""
    if cursor is None:
        path = f"/pool/listing/liveNew/latest?chain={CHAIN}&limit={PAGE_SIZE}"
    else:
        path = f"/pool/listing/liveNew?ts={cursor}&chain={CHAIN}&limit={PAGE_SIZE}"
    payload = _request_json(LISTING_API + path, timeout)
    data = payload.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("pools"), list):
        raise ListingError("DEXTools listing response did not include a pools list.")
    return data


def collect_weth_pairs(
    *,
    hours: float,
    delay_seconds: float,
    timeout: float,
    max_pages: int,
    exchange_names: dict[str, str],
    now: datetime | None = None,
) -> tuple[list[dict[str, str]], int]:
    """Page the live feed until pools fall outside the time window.

    Returns the matching pairs (newest first) and how many pools were scanned.
    """
    if hours <= 0:
        raise ValueError("hours must be greater than 0")
    moment = now or datetime.now(timezone.utc)
    cutoff = moment - timedelta(hours=hours)
    matches: list[dict[str, str]] = []
    seen: set[str] = set()
    scanned = 0
    cursor: int | None = None
    previous_cursor: int | None = None

    for _page in range(max_pages):
        data = fetch_page(cursor, timeout)
        pools: list[dict[str, Any]] = data["pools"]
        if not pools:
            break

        oldest_on_page: datetime | None = None
        for pool in pools:
            scanned += 1
            created_raw = str(pool.get("creationTime") or "").strip()
            created = parse_created_time(created_raw) if created_raw else None
            if created is not None and (oldest_on_page is None or created < oldest_on_page):
                oldest_on_page = created
            if created is not None and created < cutoff:
                continue
            record = to_record(pool, exchange_names)
            if record is None or record["_address"] in seen:
                continue
            seen.add(record["_address"])
            matches.append(record)

        next_info = data.get("next") if isinstance(data.get("next"), dict) else {}
        next_ts = next_info.get("ts")
        reached_cutoff = oldest_on_page is not None and oldest_on_page < cutoff
        if reached_cutoff or next_ts is None:
            break
        try:
            cursor = int(next_ts)
        except (TypeError, ValueError):
            break
        if previous_cursor is not None and cursor >= previous_cursor:
            break
        previous_cursor = cursor
        if delay_seconds > 0:
            time.sleep(delay_seconds)
    else:
        print(
            f"Stopped after {max_pages} pages before the {hours:g}-hour window was fully covered.",
            file=sys.stderr,
        )

    matches.sort(key=lambda row: row["_created"], reverse=True)
    public_rows = [{key: row[key] for key in COLUMNS} for row in matches]
    return public_rows, scanned


def filter_period(rows: list[dict[str, str]], hours: float, now: datetime) -> list[dict[str, str]]:
    cutoff = now - timedelta(hours=hours)
    return [row for row in rows if parse_created_time(row["created_time"]) >= cutoff]


def render_table(rows: list[dict[str, str]]) -> str:
    headers = COLUMNS
    if not rows:
        return "No WETH pairs were created in this window."
    widths = {
        key: max(len(key), *(len(row[key]) for row in rows))
        for key in headers
    }
    line = "  ".join(key.ljust(widths[key]) for key in headers)
    rule = "  ".join("-" * widths[key] for key in headers)
    body = [
        "  ".join(row[key].ljust(widths[key]) for key in headers)
        for row in rows
    ]
    return "\n".join([line, rule, *body])


def render_csv(rows: list[dict[str, str]]) -> str:
    from io import StringIO

    buffer = StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(COLUMNS))
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def render(rows: list[dict[str, str]], fmt: str) -> str:
    if fmt == "json":
        return json.dumps(rows, indent=2) + "\n"
    if fmt == "csv":
        return render_csv(rows)
    if fmt == "table":
        return render_table(rows) + "\n"
    raise ValueError(f"Unsupported format: {fmt}")


def output_path_for(base: str | None, hours: float, multiple: bool, fmt: str) -> str | None:
    """One period uses --output as given. Several periods get a suffix such as _8h."""
    if not multiple:
        return base
    extension = {"csv": ".csv", "json": ".json", "table": ".txt"}[fmt]
    label = period_label(hours)
    if base is None:
        return f"weth_pairs_{label}{extension}"
    root, current = split_output_name(base)
    return f"{root}_{label}{current or extension}"


def split_output_name(path: str) -> tuple[str, str]:
    if path.endswith(".csv"):
        return path[:-4], ".csv"
    if path.endswith(".json"):
        return path[:-5], ".json"
    if path.endswith(".txt"):
        return path[:-4], ".txt"
    return path, ""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Extract name, created time, exchange, and URL for Ethereum pairs "
            "involving WETH from the DEXTools live new pairs feed."
        )
    )
    parser.add_argument(
        "--hours",
        action="append",
        default=None,
        metavar="PERIOD",
        help=(
            "How far back to look. Examples: 8, 24, 8h, 24h. "
            "Pass several values (8,24 or repeated --hours) to write one file per window. "
            "Default: 24."
        ),
    )
    parser.add_argument(
        "--format",
        choices=("table", "json", "csv"),
        default="table",
        help="Output format (default: table).",
    )
    parser.add_argument(
        "--output",
        help="Write results to this file. Prints to stdout when omitted.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.4,
        help="Seconds to wait between listing pages (default: 0.4).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30,
        help="HTTP timeout in seconds (default: 30).",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=40,
        help="Safety cap on listing pages (default: 40, 100 pools each).",
    )
    return parser


def write_result(text: str, path: str | None) -> None:
    if path:
        with open(path, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
        return
    sys.stdout.write(text)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.max_pages < 1:
        print("--max-pages must be at least 1.", file=sys.stderr)
        return 2
    try:
        periods = parse_periods(args.hours)
    except argparse.ArgumentTypeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    now = datetime.now(timezone.utc)
    widest = max(periods)
    multiple = len(periods) > 1
    try:
        exchange_names = fetch_exchange_names(args.timeout)
        rows, scanned = collect_weth_pairs(
            hours=widest,
            delay_seconds=max(0.0, args.delay),
            timeout=args.timeout,
            max_pages=args.max_pages,
            exchange_names=exchange_names,
            now=now,
        )
    except (ListingError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    for hours in periods:
        selected = filter_period(rows, hours, now)
        path = output_path_for(args.output, hours, multiple, args.format)
        write_result(render(selected, args.format), path)
        destination = path or "stdout"
        print(
            f"Found {len(selected)} WETH pair(s) created in the last {period_label(hours)} "
            f"on Ethereum. Wrote {destination}.",
            file=sys.stderr,
        )
    print(f"Scanned {scanned} live new pool(s).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
