#!/usr/bin/env python3
"""List Ethereum pairs involving WETH from DEXTools live new pairs.

The page https://www.dextools.io/app/ether/live-new-pairs is a JavaScript app.
It loads pools from the public listing API below. This script pages through
that same feed, keeps pools where one token is canonical WETH, and drops
anything older than the requested window (24 hours by default).

Fields written for each pair:
  name          trading pair, for example MINP/WETH (Minpentai)
  created_time  pool creation time in UTC (ISO-8601)
  url           DEXTools pair explorer link
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

LISTING_API = "https://www.dextools.io/api/core"
PAGE_URL = "https://www.dextools.io/app/ether/live-new-pairs"
CHAIN = "ether"
# Canonical WETH on Ethereum mainnet. Native ETH (the zero address) is a
# different quote asset on this feed and is not included.
WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
PAGE_SIZE = 100
USER_AGENT = "dextools-weth-pairs/1.0"
MAX_RETRIES = 4


class ListingError(RuntimeError):
    """The live-new-pairs listing could not be read."""


def parse_created_time(value: str) -> datetime:
    """Parse a DEXTools creation timestamp into an aware UTC datetime."""
    text = value.strip()
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


def to_record(pool: dict[str, Any]) -> dict[str, str] | None:
    """Map one pool into the three requested fields, or skip incomplete rows."""
    address = str(pool.get("address") or "").strip()
    created_raw = str(pool.get("creationTime") or "").strip()
    if not address or not created_raw:
        return None
    if not (is_weth(pool.get("mainToken")) or is_weth(pool.get("sideToken"))):
        return None
    created = parse_created_time(created_raw)
    return {
        "name": pair_name(pool),
        "created_time": created.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "url": pair_url(address),
        "_created": created.isoformat(),
        "_address": address.lower(),
    }


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
            record = to_record(pool)
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
    public_rows = [
        {"name": row["name"], "created_time": row["created_time"], "url": row["url"]}
        for row in matches
    ]
    return public_rows, scanned


def render_table(rows: list[dict[str, str]]) -> str:
    headers = ("name", "created_time", "url")
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
    writer = csv.DictWriter(buffer, fieldnames=["name", "created_time", "url"])
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Extract name, created time, and URL for Ethereum pairs involving "
            "WETH from the DEXTools live new pairs feed."
        )
    )
    parser.add_argument(
        "--hours",
        type=float,
        default=24,
        help="How far back to look, in hours (default: 24).",
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


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.hours <= 0:
        print("--hours must be greater than 0.", file=sys.stderr)
        return 2
    if args.max_pages < 1:
        print("--max-pages must be at least 1.", file=sys.stderr)
        return 2
    try:
        rows, scanned = collect_weth_pairs(
            hours=args.hours,
            delay_seconds=max(0.0, args.delay),
            timeout=args.timeout,
            max_pages=args.max_pages,
        )
    except (ListingError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    text = render(rows, args.format)
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
    else:
        sys.stdout.write(text)
    print(
        f"Found {len(rows)} WETH pair(s) created in the last {args.hours:g} hour(s) "
        f"on Ethereum. Scanned {scanned} live new pool(s).",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
