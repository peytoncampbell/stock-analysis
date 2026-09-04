"""Broad North American stock catalogue for the Wealthsimple-focused UI."""

from __future__ import annotations

import csv
import math
import re
import threading
import time
from datetime import datetime, timezone
from io import StringIO
from typing import Any

import requests


_NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
_OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
_TMX_DIRECTORY_URL = "https://www.tsx.com/json/company-directory/search/{exchange}/%2A"
_CACHE_TTL_SECONDS = 6 * 60 * 60
_QUOTE_CACHE_TTL_SECONDS = 60
_HEADERS = {"User-Agent": "stock-analysis/1.0"}
_OTHER_EXCHANGES = {
    "A": "NYSE American",
    "N": "NYSE",
    "P": "NYSE Arca",
    "Z": "Cboe BZX",
}
_UNSUPPORTED_SECURITY = re.compile(
    r"\b(warrants?|rights?|units?|preferred|preference|debentures?|notes?)\b",
    re.IGNORECASE,
)
_UNSUPPORTED_CANADIAN_SYMBOL = re.compile(
    r"\.(?:DB|PR|WT|RT|CV|H|P)(?:\.|$)",
    re.IGNORECASE,
)

_catalogue_lock = threading.Lock()
_catalogue_cache: tuple[float, str, list[dict[str, Any]], list[str]] | None = None
_quote_lock = threading.Lock()
_quote_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def get_wealthsimple_universe_rows(*, refresh: bool = False) -> list[dict[str, Any]]:
    """Return the cached exchange-directory universe without fetching quotes."""
    rows, _, _, _ = _load_catalogue(refresh=refresh)
    return [dict(row) for row in rows]


def get_wealthsimple_catalogue(
    *,
    query: str = "",
    market: str = "all",
    asset_type: str = "all",
    page: int = 1,
    page_size: int = 25,
    refresh: bool = False,
) -> dict[str, Any]:
    """Return one searchable page of likely Wealthsimple-supported listings.

    Wealthsimple does not publish a complete public tradable-symbol API. Rows
    therefore represent active stocks and ETFs from its supported major
    exchange families, with explicit estimated eligibility.
    """
    rows, refreshed_at, source_errors, stale = _load_catalogue(refresh=refresh)
    normalized_query = " ".join(query.upper().split())
    filtered = [
        row
        for row in rows
        if (market == "all" or row["market"] == market)
        and (asset_type == "all" or row["asset_type"] == asset_type)
        and (
            not normalized_query
            or normalized_query in row["symbol"].upper()
            or normalized_query in row["display_symbol"].upper()
            or normalized_query in row["name"].upper()
        )
    ]
    filtered.sort(key=lambda row: (row["symbol"], row["name"]))
    total = len(filtered)
    total_pages = max(1, math.ceil(total / page_size))
    bounded_page = min(page, total_pages)
    start = (bounded_page - 1) * page_size
    items = [dict(row) for row in filtered[start : start + page_size]]

    quotes, quote_errors = _load_quotes(items, refresh=refresh)
    for item in items:
        quote = quotes.get(item["symbol"], {})
        item.update(
            price=quote.get("price"),
            change_pct=quote.get("change_pct"),
            volume=quote.get("volume"),
            quote_as_of=quote.get("quote_as_of"),
        )

    return {
        "items": items,
        "total": total,
        "page": bounded_page,
        "page_size": page_size,
        "total_pages": total_pages,
        "refreshed_at": refreshed_at,
        "stale": stale,
        "source_errors": [*source_errors, *quote_errors],
        "sources": ["Nasdaq Trader", "TMX TSX/TSXV", "Yahoo Finance quotes"],
        "eligibility_note": (
            "Estimated from supported exchanges and security types. Confirm current "
            "order eligibility in Wealthsimple before trading."
        ),
    }


def _load_catalogue(*, refresh: bool) -> tuple[list[dict[str, Any]], str, list[str], bool]:
    global _catalogue_cache
    now = time.time()
    with _catalogue_lock:
        if _catalogue_cache and not refresh and now - _catalogue_cache[0] < _CACHE_TTL_SECONDS:
            cached_at, refreshed_at, rows, errors = _catalogue_cache
            return rows, refreshed_at, list(errors), now - cached_at >= _CACHE_TTL_SECONDS
        try:
            rows, errors = _fetch_catalogue_sources()
            refreshed_at = datetime.now(timezone.utc).isoformat()
            _catalogue_cache = (now, refreshed_at, rows, errors)
            return rows, refreshed_at, errors, False
        except Exception as exc:
            if _catalogue_cache:
                _, refreshed_at, rows, errors = _catalogue_cache
                return rows, refreshed_at, [*errors, str(exc)], True
            raise


def _fetch_catalogue_sources() -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    for label, fetcher in (
        ("Nasdaq", _fetch_us_listings),
        ("TMX", _fetch_canadian_listings),
    ):
        try:
            rows.extend(fetcher())
        except Exception as exc:
            errors.append(f"{label}: {exc}")
    if not rows:
        raise RuntimeError("Could not load North American exchange directories")

    deduplicated: dict[str, dict[str, Any]] = {}
    for row in rows:
        deduplicated[row["symbol"]] = row
    return list(deduplicated.values()), errors


def _fetch_us_listings() -> list[dict[str, Any]]:
    session = requests.Session()
    session.headers.update(_HEADERS)
    nasdaq = session.get(_NASDAQ_LISTED_URL, timeout=15)
    nasdaq.raise_for_status()
    other = session.get(_OTHER_LISTED_URL, timeout=15)
    other.raise_for_status()
    return [
        *_parse_us_directory(nasdaq.text, default_exchange="NASDAQ"),
        *_parse_us_directory(other.text),
    ]


def _parse_us_directory(text: str, *, default_exchange: str = "") -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for source in csv.DictReader(StringIO(text), delimiter="|"):
        display_symbol = str(source.get("Symbol") or source.get("ACT Symbol") or "").strip()
        name = str(source.get("Security Name") or "").strip()
        if not display_symbol or not name or display_symbol.startswith("File Creation Time"):
            continue
        if str(source.get("Test Issue") or "N").strip().upper() != "N":
            continue
        financial_status = str(source.get("Financial Status") or "N").strip().upper()
        if financial_status not in {"", "N"}:
            continue
        exchange = default_exchange or _OTHER_EXCHANGES.get(
            str(source.get("Exchange") or "").strip().upper(), ""
        )
        if not exchange:
            continue
        is_etf = str(source.get("ETF") or "N").strip().upper() == "Y"
        if not is_etf and _UNSUPPORTED_SECURITY.search(name):
            continue
        provider_symbol = str(source.get("NASDAQ Symbol") or display_symbol).strip().replace(".", "-")
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9.-]{0,14}", provider_symbol, re.IGNORECASE):
            continue
        rows.append(
            _catalogue_row(
                symbol=provider_symbol.upper(),
                display_symbol=display_symbol.upper(),
                name=name,
                market="us",
                exchange=exchange,
                currency="USD",
                asset_type="etf" if is_etf else "stock",
                source="Nasdaq Trader",
            )
        )
    return rows


def _fetch_canadian_listings() -> list[dict[str, Any]]:
    session = requests.Session()
    session.headers.update(_HEADERS)
    rows: list[dict[str, Any]] = []
    for exchange, suffix in (("tsx", ".TO"), ("tsxv", ".V")):
        response = session.get(_TMX_DIRECTORY_URL.format(exchange=exchange), timeout=15)
        response.raise_for_status()
        rows.extend(_parse_tmx_directory(response.json(), exchange=exchange.upper(), suffix=suffix))
    return rows


def _parse_tmx_directory(payload: dict[str, Any], *, exchange: str, suffix: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for company in payload.get("results") or []:
        company_name = str(company.get("name") or "").strip()
        instruments = company.get("instruments") or [company]
        for instrument in instruments:
            display_symbol = str(instrument.get("symbol") or "").strip().upper()
            instrument_name = str(instrument.get("name") or company_name).strip()
            combined_name = f"{company_name} {instrument_name}".strip()
            if not display_symbol or _UNSUPPORTED_CANADIAN_SYMBOL.search(display_symbol):
                continue
            is_etf = bool(re.search(r"\bETF\b", combined_name, re.IGNORECASE))
            if not is_etf and _UNSUPPORTED_SECURITY.search(combined_name):
                continue
            provider_symbol = f"{display_symbol.replace('.', '-')}{suffix}"
            rows.append(
                _catalogue_row(
                    symbol=provider_symbol,
                    display_symbol=display_symbol,
                    name=company_name or instrument_name or display_symbol,
                    market="ca",
                    exchange=exchange,
                    currency="CAD",
                    asset_type="etf" if is_etf else "stock",
                    source="TMX",
                )
            )
    return rows


def _catalogue_row(**values: Any) -> dict[str, Any]:
    return {
        **values,
        "wealthsimple_status": "likely",
        "price": None,
        "change_pct": None,
        "volume": None,
        "quote_as_of": None,
    }


def _load_quotes(
    items: list[dict[str, Any]],
    *,
    refresh: bool,
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    now = time.time()
    quotes: dict[str, dict[str, Any]] = {}
    missing_by_market: dict[str, list[str]] = {"ca": [], "us": []}
    with _quote_lock:
        for item in items:
            cached = _quote_cache.get(item["symbol"])
            if cached and not refresh and now - cached[0] < _QUOTE_CACHE_TTL_SECONDS:
                quotes[item["symbol"]] = dict(cached[1])
            else:
                missing_by_market[item["market"]].append(item["symbol"])

    errors: list[str] = []
    if any(missing_by_market.values()):
        from src.services.screening.snapshot_us import fetch_us_snapshot

        for market, symbols in missing_by_market.items():
            if not symbols:
                continue
            try:
                frame = fetch_us_snapshot(
                    symbols,
                    market=market,
                    include_reference_data=False,
                )
                for _, row in frame.iterrows():
                    symbol = str(row.get("code") or "")
                    quote = {
                        "price": _finite_number(row.get("price")),
                        "change_pct": _finite_number(row.get("change_pct")),
                        "volume": _finite_number(row.get("volume")),
                        "quote_as_of": str(row.get("verified_at") or "") or None,
                    }
                    quotes[symbol] = quote
                    with _quote_lock:
                        _quote_cache[symbol] = (now, quote)
            except Exception as exc:
                errors.append(f"{market.upper()} quotes: {exc}")
    return quotes, errors


def _finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None
