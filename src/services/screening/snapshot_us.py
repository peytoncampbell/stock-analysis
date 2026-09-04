# -*- coding: utf-8 -*-
# Derived from AlphaSift revision 9f522747caafd3c0b1ddb7e14d5cf44c8580b6cf.
# Licensed under Apache-2.0 and modified for daily_stock_analysis.
"""North American stock and ETF snapshots via yfinance.

US snapshot provider for the screening L1 pipeline. Fetches a configurable
equity universe and returns the standard snapshot DataFrame schema.

HK is not supported yet: there is no HK universe source or ticker
configuration path, so ``market="hk"`` is rejected at the pipeline level
rather than silently screening the US pool.
"""

import logging
import os
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from io import StringIO
import pandas as pd
import requests

logger = logging.getLogger(__name__)

_SP500_WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
_TSX60_WIKI_URL = "https://en.wikipedia.org/wiki/S%26P/TSX_60"

_SECURITY_NAMES: dict[str, str] = {}
_US_ETFS = ["SPY", "QQQ", "VTI"]
_CA_ETFS = ["XIU.TO", "XEQT.TO", "VFV.TO", "XIC.TO"]
_KNOWN_ETFS = set(_US_ETFS + _CA_ETFS)
_DUAL_LISTED_CANADIAN_BASES = {
    "AEM", "BCE", "BMO", "BNS", "CM", "CNQ", "CP", "ENB", "FNV",
    "GIB", "IMO", "MFC", "NTR", "QSR", "RY", "SHOP", "SLF", "SU",
    "TD", "TRI", "TRP", "WCN",
}

_DEFAULT_US_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK-B",
    "AVGO", "JPM", "LLY", "V", "MA", "UNH", "XOM", "COST", "HD", "PG",
    "JNJ", "ABBV", "WMT", "NFLX", "BAC", "KO", "CRM", "CVX", "MRK",
    "PEP", "AMD", "TMO", "LIN", "ACN", "CSCO", "MCD", "ABT", "ADBE",
    "WFC", "GE", "DHR", "TXN", "PM", "ISRG", "MS", "NEE", "INTU",
    "DIS", "QCOM", "CAT", "NOW",
]

_DEFAULT_CA_UNIVERSE = [
    "RY.TO", "TD.TO", "SHOP.TO", "ENB.TO", "BMO.TO", "CP.TO",
    "CNQ.TO", "CNR.TO", "TRI.TO", "BNS.TO", "SU.TO", "MFC.TO",
    "CM.TO", "ATD.TO", "WCN.TO", "TRP.TO", "BCE.TO", "NTR.TO",
    "SLF.TO", "AEM.TO", "ABX.TO", "FNV.TO", "QSR.TO", "DOL.TO",
    "FTS.TO", "IFC.TO", "POW.TO", "GWO.TO", "NA.TO", "IMO.TO",
]

_DEFAULT_NAMES = {
    "AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA",
    "AMZN": "Amazon", "GOOGL": "Alphabet", "META": "Meta Platforms",
    "TSLA": "Tesla", "JPM": "JPMorgan Chase", "V": "Visa",
    "RY.TO": "Royal Bank of Canada", "TD.TO": "Toronto-Dominion Bank",
    "SHOP.TO": "Shopify", "ENB.TO": "Enbridge", "BMO.TO": "Bank of Montreal",
    "CP.TO": "Canadian Pacific Kansas City", "CNQ.TO": "Canadian Natural Resources",
    "CNR.TO": "Canadian National Railway", "TRI.TO": "Thomson Reuters",
    "BNS.TO": "Bank of Nova Scotia", "SU.TO": "Suncor Energy",
    "SPY": "SPDR S&P 500 ETF Trust", "QQQ": "Invesco QQQ Trust",
    "VTI": "Vanguard Total Stock Market ETF", "XIU.TO": "iShares S&P/TSX 60 ETF",
    "XEQT.TO": "iShares Core Equity ETF Portfolio", "VFV.TO": "Vanguard S&P 500 Index ETF",
    "XIC.TO": "iShares Core S&P/TSX Capped Composite ETF",
}
_SECURITY_NAMES.update(_DEFAULT_NAMES)


def fetch_us_universe(source: str = "auto") -> list[str]:
    """Return a list of US equity tickers.

    Sources:
        sp500   — scrape S&P 500 from Wikipedia
        env     — read SCREENING_US_TICKERS (comma-separated)
        default — hardcoded top-50 US large-caps
        auto    — try sp500 → env → default
    """
    src = source.lower()
    if src == "auto":
        for s in ("sp500", "env", "default"):
            try:
                tickers = fetch_us_universe(s)
                if tickers:
                    logger.info("US universe from %s: %d tickers", s, len(tickers))
                    return tickers
            except Exception as e:
                logger.debug("US universe source %s failed: %s", s, e)
        return list(_DEFAULT_US_UNIVERSE)

    if src == "sp500":
        return _fetch_sp500_tickers()
    elif src == "env":
        raw = os.getenv("SCREENING_US_TICKERS", "").strip()
        if not raw:
            raise ValueError("SCREENING_US_TICKERS not set")
        return [t.strip() for t in raw.split(",") if t.strip()]
    elif src == "default":
        return [*_DEFAULT_US_UNIVERSE, *_US_ETFS]
    else:
        raise ValueError(f"Unknown US universe source: {source}")


def _fetch_sp500_tickers() -> list[str]:
    tables = _read_html_tables(_SP500_WIKI_URL)
    for tbl in tables:
        if "Symbol" in tbl.columns:
            tickers = tbl["Symbol"].dropna().astype(str).str.strip().str.replace(".", "-", regex=False)
            if "Security" in tbl.columns:
                for ticker, name in zip(tickers, tbl["Security"], strict=False):
                    _SECURITY_NAMES[ticker] = str(name).strip()
            return sorted(dict.fromkeys([*tickers.tolist(), *_US_ETFS]))
    raise RuntimeError("Could not find Symbol column in S&P 500 Wikipedia table")


def fetch_ca_universe(source: str = "auto") -> list[str]:
    """Return provider-ready Canadian symbols from TSX 60, env, or fallback."""
    src = source.lower()
    if src == "auto":
        for candidate in ("tsx60", "env", "default"):
            try:
                tickers = fetch_ca_universe(candidate)
                if tickers:
                    logger.info("Canadian universe from %s: %d tickers", candidate, len(tickers))
                    return tickers
            except Exception as exc:
                logger.debug("Canadian universe source %s failed: %s", candidate, exc)
        return [*_DEFAULT_CA_UNIVERSE, *_CA_ETFS]
    if src == "tsx60":
        return _fetch_tsx60_tickers()
    if src == "env":
        raw = os.getenv("SCREENING_CA_TICKERS", "").strip()
        if not raw:
            raise ValueError("SCREENING_CA_TICKERS not set")
        return [ticker.strip().upper() for ticker in raw.split(",") if ticker.strip()]
    if src == "default":
        return [*_DEFAULT_CA_UNIVERSE, *_CA_ETFS]
    raise ValueError(f"Unknown Canadian universe source: {source}")


def _fetch_tsx60_tickers() -> list[str]:
    for table in _read_html_tables(_TSX60_WIKI_URL):
        symbol_column = next((column for column in ("Symbol", "Ticker") if column in table.columns), None)
        if symbol_column is None:
            continue
        raw_symbols = table[symbol_column].dropna().astype(str).str.strip().str.replace(".", "-", regex=False)
        tickers = [symbol if symbol.endswith((".TO", ".V", ".CN", ".NE")) else f"{symbol}.TO" for symbol in raw_symbols]
        name_column = next((column for column in ("Company", "Security") if column in table.columns), None)
        if name_column is not None:
            for ticker, name in zip(tickers, table[name_column], strict=False):
                _SECURITY_NAMES[ticker] = str(name).strip()
        return sorted(dict.fromkeys([*tickers, *_CA_ETFS]))
    raise RuntimeError("Could not find a ticker column in the S&P/TSX 60 table")


def _read_html_tables(url: str) -> list[pd.DataFrame]:
    response = requests.get(url, headers={"User-Agent": "daily-stock-analysis/1.0"}, timeout=15)
    response.raise_for_status()
    return pd.read_html(StringIO(response.text))


def fetch_us_snapshot(
    tickers: list[str] | None = None,
    *,
    universe_source: str = "auto",
    max_workers: int = 8,
    market: str = "us",
    include_reference_data: bool = True,
) -> pd.DataFrame:
    """Fetch a US equity snapshot in the screening schema.

    Uses yfinance to fetch current data for each ticker. Returns a
    DataFrame matching the standard snapshot columns: code, name, price,
    change_pct, amount, total_mv, pe_ratio, pb_ratio, volume_ratio,
    turnover_rate, industry.
    """
    if tickers is None:
        if market == "us":
            return _fetch_catalogue_snapshot(markets={"us"}, scanner_markets=("america",))
        tickers = fetch_ca_universe(universe_source)

    import yfinance as yf

    logger.info("Fetching US snapshot for %d tickers", len(tickers))

    hist_end = pd.Timestamp.now().normalize()
    hist_start = hist_end - pd.Timedelta(days=30)
    data = yf.download(
        tickers,
        start=hist_start.strftime("%Y-%m-%d"),
        end=hist_end.strftime("%Y-%m-%d"),
        group_by="ticker",
        auto_adjust=True,
        progress=False,
        threads=True,
    )

    rows = []

    def _process_ticker(ticker: str) -> dict | None:
        try:
            if len(tickers) == 1:
                hist = data.copy()
                if isinstance(hist.columns, pd.MultiIndex):
                    hist.columns = hist.columns.droplevel("Ticker")
            else:
                if ticker not in data.columns.get_level_values(0):
                    return None
                hist = data[ticker].copy()
            if hist.empty:
                return None

            hist = hist[hist["Close"].notna()]
            if len(hist) < 2:
                return None

            latest = hist.iloc[-1]
            prev = hist.iloc[-2]
            price = float(latest["Close"])
            prev_close = float(prev["Close"])
            volume = float(latest["Volume"])
            change_pct = ((price - prev_close) / prev_close * 100) if prev_close > 0 else 0.0

            vol_20d = float(hist["Volume"].tail(20).mean())
            volume_ratio = (volume / vol_20d) if vol_20d > 0 else 1.0

            info = yf.Ticker(ticker).fast_info if include_reference_data else None
            market_cap = getattr(info, "market_cap", None) or 0
            shares = getattr(info, "shares", None) or 0
            turnover_rate = (volume / shares * 100) if shares > 0 else 0.0
            exchange = _normalize_exchange(getattr(info, "exchange", None), ticker)
            currency = str(getattr(info, "currency", None) or ("CAD" if market == "ca" else "USD")).upper()

            return {
                "code": ticker,
                "provider_symbol": ticker,
                "name": _SECURITY_NAMES.get(ticker, ticker),
                "exchange": exchange,
                "currency": currency,
                "asset_type": "etf" if ticker in _KNOWN_ETFS else "stock",
                "wealthsimple_status": "likely" if exchange != "Unknown" else "unknown",
                "verified_at": datetime.now(timezone.utc).isoformat(),
                "price": price,
                "change_pct": round(change_pct, 2),
                "volume": volume,
                "amount": round(volume * price, 0),
                "total_mv": market_cap,
                "circ_mv": market_cap,
                "pe_ratio": None,
                "pb_ratio": None,
                "volume_ratio": round(volume_ratio, 2),
                "turnover_rate": round(turnover_rate, 4),
                "industry": "",
            }
        except Exception as e:
            logger.debug("Failed to process %s: %s", ticker, e)
            return None

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_process_ticker, t): t for t in tickers}
        for future in as_completed(futures):
            result = future.result()
            if result:
                rows.append(result)

    if not rows:
        raise RuntimeError("yfinance returned no valid data for any ticker")

    df = pd.DataFrame(rows)

    numeric_cols = [
        "price", "change_pct", "amount", "total_mv", "circ_mv",
        "pe_ratio", "pb_ratio", "volume_ratio", "turnover_rate",
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["price"])
    df = df[df["price"] > 0]

    df.attrs["snapshot_source"] = "yfinance"
    logger.info("US snapshot: %d rows from yfinance", len(df))
    return df


def fetch_ca_snapshot(
    tickers: list[str] | None = None,
    *,
    universe_source: str = "auto",
    max_workers: int = 8,
) -> pd.DataFrame:
    if tickers is None:
        return _fetch_catalogue_snapshot(markets={"ca"}, scanner_markets=("canada",))
    return fetch_us_snapshot(
        tickers,
        universe_source=universe_source,
        max_workers=max_workers,
        market="ca",
    )


def fetch_wealthsimple_snapshot() -> pd.DataFrame:
    """Screen every listing in the exchange-directory Wealthsimple universe."""
    return _fetch_catalogue_snapshot(
        markets={"us", "ca"},
        scanner_markets=("america", "canada"),
    )


def _fetch_catalogue_snapshot(*, markets: set[str], scanner_markets: tuple[str, ...]) -> pd.DataFrame:
    """Join exchange-directory listings to one broad market-data snapshot."""
    from src.services.wealthsimple_catalogue_service import get_wealthsimple_universe_rows

    catalogue = [
        listing
        for listing in get_wealthsimple_universe_rows()
        if listing.get("market") in markets
    ]
    market_rows: dict[str, dict] = {}
    errors: list[str] = []
    for market in scanner_markets:
        try:
            market_rows.update({row["symbol"]: row for row in _fetch_tradingview_market(market)})
        except Exception as exc:
            errors.append(f"{market}: {exc}")
    if not market_rows:
        raise RuntimeError(f"North American market scanner failed: {'; '.join(errors)}")

    verified_at = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []
    missing = 0
    for listing in catalogue:
        quote = market_rows.get(listing["symbol"])
        if quote is None:
            missing += 1
            quote = {}
        rows.append({
            "code": listing["symbol"],
            "provider_symbol": listing["symbol"],
            "name": listing["name"],
            "exchange": listing["exchange"],
            "currency": listing["currency"],
            "asset_type": quote.get("asset_type") or listing["asset_type"],
            "wealthsimple_status": listing["wealthsimple_status"],
            "verified_at": verified_at,
            "price": quote.get("price"),
            "change_pct": quote.get("change_pct"),
            "volume": quote.get("volume"),
            "amount": quote.get("amount"),
            "total_mv": quote.get("total_mv"),
            "circ_mv": quote.get("total_mv"),
            "pe_ratio": quote.get("pe_ratio"),
            "pb_ratio": quote.get("pb_ratio"),
            "volume_ratio": quote.get("volume_ratio"),
            "turnover_rate": 0.0,
            "industry": quote.get("industry") or "",
            "sector": quote.get("sector") or "",
            **{
                field: quote.get(field)
                for field in _TRADINGVIEW_OUTPUT_FIELDS
            },
        })

    combined = pd.DataFrame(rows)
    price_fcf = pd.to_numeric(combined.get("price_fcf"), errors="coerce")
    combined["fcf_yield"] = (100.0 / price_fcf).where(price_fcf > 0)
    next_year_eps = pd.to_numeric(combined.get("next_year_eps"), errors="coerce")
    price = pd.to_numeric(combined.get("price"), errors="coerce")
    combined["next_year_pe"] = (price / next_year_eps).where(next_year_eps > 0)
    if missing:
        errors.append(
            f"TradingView quote data unavailable for {missing} of {len(catalogue)} catalogue listings"
        )
    combined.attrs["snapshot_source"] = f"tradingview:{'+'.join(scanner_markets)}"
    combined.attrs["source_errors"] = errors
    combined.attrs["fallback_used"] = False
    return combined


def _fetch_tradingview_market(market: str) -> list[dict]:
    columns = [
        "name", "description", "type", "exchange", "close", "change",
        "volume", "Value.Traded", "average_volume_30d_calc", "market_cap_basic", "relative_volume_10d_calc",
        "price_earnings_ttm", "price_book_ratio", "sector", "industry",
        *_TRADINGVIEW_FIELD_MAP,
    ]
    response = requests.post(
        f"https://scanner.tradingview.com/{market}/scan",
        json={
            "filter": [{"left": "type", "operation": "in_range", "right": ["stock", "fund", "dr"]}],
            "options": {"lang": "en"},
            "markets": [market],
            "symbols": {"query": {"types": []}, "tickers": []},
            "columns": columns,
            "range": [0, 50_000],
        },
        headers={"User-Agent": "stock-analysis/1.0"},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise RuntimeError(f"TradingView {market} scanner returned an invalid response")
    suffixes = {"TSX": ".TO", "TSXV": ".V", "CSE": ".CN", "NEO": ".NE"}
    rows: list[dict] = []
    for item in payload["data"]:
        if not isinstance(item, dict):
            continue
        values = item.get("d") or []
        if len(values) != len(columns):
            continue
        data = dict(zip(columns, values, strict=True))
        symbol = str(data["name"] or "").strip().upper().replace(".", "-")
        if not symbol:
            continue
        if market == "canada":
            suffix = suffixes.get(str(data["exchange"] or "").upper())
            if suffix is None:
                continue
            symbol += suffix
        price = _finite_snapshot_number(data["close"])
        average_volume = _finite_snapshot_number(data["average_volume_30d_calc"])
        rows.append({
            "symbol": symbol,
            "asset_type": {"dr": "adr", "fund": "etf"}.get(str(data["type"] or "").lower(), "stock"),
            "price": price,
            "change_pct": _finite_snapshot_number(data["change"]),
            "volume": _finite_snapshot_number(data["volume"]),
            "amount": price * average_volume if price is not None and average_volume is not None else _finite_snapshot_number(data["Value.Traded"]),
            "total_mv": _finite_snapshot_number(data["market_cap_basic"]),
            "volume_ratio": _finite_snapshot_number(data["relative_volume_10d_calc"]),
            "pe_ratio": _finite_snapshot_number(data["price_earnings_ttm"]),
            "pb_ratio": _finite_snapshot_number(data["price_book_ratio"]),
            "sector": str(data["sector"] or ""),
            "industry": str(data["industry"] or data["sector"] or ""),
            **{
                output: _finite_snapshot_number(data[source])
                for source, output in _TRADINGVIEW_FIELD_MAP.items()
            },
        })
    return rows


_TRADINGVIEW_FIELD_MAP = {
    "enterprise_value_fq": "enterprise_value",
    "price_earnings_forward": "forward_pe",
    "price_earnings_growth_ttm": "peg_ratio",
    "enterprise_value_ebitda_ttm": "ev_ebitda",
    "enterprise_value_ebit_ttm": "ev_ebit",
    "price_free_cash_flow_ttm": "price_fcf",
    "free_cash_flow_ttm": "free_cash_flow",
    "free_cash_flow_margin_ttm": "fcf_margin",
    "earnings_yield_fq": "earnings_yield",
    "price_sales_ttm": "price_sales",
    "earnings_per_share_diluted_yoy_growth_ttm": "eps_growth",
    "revenue_growth_ttm": "revenue_growth",
    "ebitda_growth_ttm": "ebitda_growth",
    "free_cash_flow_growth_ttm": "fcf_growth",
    "return_on_invested_capital_fq": "roic",
    "return_on_equity_fq": "roe",
    "return_on_assets_fq": "roa",
    "gross_margin_ttm": "gross_margin",
    "operating_margin_ttm": "operating_margin",
    "debt_to_equity_fq": "debt_to_equity",
    "net_debt_to_ebitda_fq": "net_debt_ebitda",
    "interest_coverage_fq": "interest_coverage",
    "current_ratio_fq": "current_ratio",
    "cash_fq": "cash",
    "earnings_per_share_diluted_forecast_fy": "current_year_eps",
    "earnings_per_share_diluted_forecast_next_fy": "next_year_eps",
    "earnings_per_share_diluted_forecast_next_fy_growth": "next_year_eps_growth",
    "revenue_forecast_next_fy_growth": "next_year_revenue_growth",
    "recommendation_mark": "analyst_rating",
}
_TRADINGVIEW_OUTPUT_FIELDS = tuple(_TRADINGVIEW_FIELD_MAP.values())


def _finite_snapshot_number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def enrich_yfinance_consensus(
    df: pd.DataFrame,
    *,
    max_rows: int = 30,
    max_workers: int = 6,
) -> pd.DataFrame:
    """Best-effort consensus and revision enrichment for a ranked shortlist."""
    import yfinance as yf

    result = df.copy()
    errors: list[str] = []
    enriched_count = 0

    def fetch(index: object, row: pd.Series) -> tuple[object, dict[str, float], str]:
        symbol = str(row.get("provider_symbol") or row.get("code") or "").strip()
        try:
            ticker = yf.Ticker(symbol)
            earnings = ticker.earnings_estimate
            revenue = ticker.revenue_estimate
            trends = ticker.eps_trend
            growth = ticker.growth_estimates
            history = ticker.earnings_history
            targets = ticker.analyst_price_targets or {}
            current_earnings = _table_row(earnings, "0y")
            next_earnings = _table_row(earnings, "+1y")
            current_revenue = _table_row(revenue, "0y")
            next_revenue = _table_row(revenue, "+1y")
            revision_row = _table_row(trends, "+1y") or _table_row(trends, "0y")
            current_eps = _finite_snapshot_number(current_earnings.get("avg"))
            next_eps = _finite_snapshot_number(next_earnings.get("avg"))
            price = _finite_snapshot_number(row.get("price"))
            metrics = {
                "current_year_eps": current_eps,
                "next_year_eps": next_eps,
                "forward_pe": price / current_eps if price and current_eps and current_eps > 0 else None,
                "next_year_pe": price / next_eps if price and next_eps and next_eps > 0 else None,
                "next_year_eps_growth": _as_percent(next_earnings.get("growth")),
                "current_year_revenue_growth": _as_percent(current_revenue.get("growth")),
                "next_year_revenue_growth": _as_percent(next_revenue.get("growth")),
                "eps_revision_30d": _revision_percent(revision_row, "30daysAgo"),
                "eps_revision_60d": _revision_percent(revision_row, "60daysAgo"),
                "eps_revision_90d": _revision_percent(revision_row, "90daysAgo"),
                "long_term_eps_growth": _growth_value(growth, "LTG", "stockTrend"),
                "earnings_surprise_avg": _history_average(history, "surprisePercent"),
                "earnings_beat_rate": _history_beat_rate(history),
                "analyst_count": _finite_snapshot_number(next_earnings.get("numberOfAnalysts")),
                "analyst_target_upside": _target_upside(price, targets.get("mean")),
            }
            metrics.update(_price_outlook_metrics(price, targets))
            return index, {key: value for key, value in metrics.items() if value is not None}, ""
        except Exception as exc:
            return index, {}, f"{symbol}: {exc}"

    candidates = list(result.head(max(1, max_rows)).iterrows())
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(fetch, index, row) for index, row in candidates]
        for future in as_completed(futures):
            index, metrics, error = future.result()
            if error:
                errors.append(error)
            if metrics:
                enriched_count += 1
            for field, value in metrics.items():
                result.at[index, field] = value
    result.attrs.update(df.attrs)
    result.attrs["consensus_source"] = "yfinance"
    result.attrs["consensus_attempted_count"] = len(candidates)
    result.attrs["consensus_enriched_count"] = enriched_count
    result.attrs["consensus_errors"] = errors
    return result


def _table_row(table: object, label: str) -> dict:
    if not isinstance(table, pd.DataFrame) or label not in table.index:
        return {}
    row = table.loc[label]
    return row.to_dict() if hasattr(row, "to_dict") else {}


def _as_percent(value: object) -> float | None:
    number = _finite_snapshot_number(value)
    return number * 100 if number is not None else None


def _revision_percent(row: dict, past_column: str) -> float | None:
    current = _finite_snapshot_number(row.get("current"))
    past = _finite_snapshot_number(row.get(past_column))
    if current is None or past in (None, 0):
        return None
    return (current / past - 1) * 100


def _growth_value(table: object, row: str, column: str) -> float | None:
    return _as_percent(_table_row(table, row).get(column))


def _history_average(table: object, column: str) -> float | None:
    if not isinstance(table, pd.DataFrame) or column not in table.columns:
        return None
    values = pd.to_numeric(table[column], errors="coerce").dropna()
    return float(values.mean() * 100) if not values.empty else None


def _history_beat_rate(table: object) -> float | None:
    if not isinstance(table, pd.DataFrame) or "epsDifference" not in table.columns:
        return None
    values = pd.to_numeric(table["epsDifference"], errors="coerce").dropna()
    return float(values.gt(0).mean() * 100) if not values.empty else None


def _target_upside(price: float | None, target: object) -> float | None:
    target_value = _finite_snapshot_number(target)
    if not price or target_value is None:
        return None
    return (target_value / price - 1) * 100


def _price_outlook_metrics(price: float | None, targets: object) -> dict[str, float]:
    """Build transparent price scenarios from the analyst target range."""
    if not isinstance(targets, dict):
        return {}
    current = _finite_snapshot_number(price)
    mean = _finite_snapshot_number(targets.get("mean"))
    low = _finite_snapshot_number(targets.get("low"))
    high = _finite_snapshot_number(targets.get("high"))
    metrics = {
        key: value
        for key, value in {
            "analyst_target_mean": mean,
            "analyst_target_low": low,
            "analyst_target_high": high,
            "price_estimate_1y": mean,
            "worst_case_price": low,
        }.items()
        if value is not None and value > 0
    }
    if current is not None and current > 0 and mean is not None and mean > 0:
        metrics["price_estimate_1m"] = current + (mean - current) / 12
        metrics["price_estimate_3m"] = current + (mean - current) / 4
    return metrics


def _listing_key(ticker: str) -> str:
    """Use a name when available so same-company CA/US listings collapse."""
    normalized = str(ticker or "").upper()
    base = normalized.rsplit(".", 1)[0]
    if base in _DUAL_LISTED_CANADIAN_BASES:
        return f"dual:{base}"
    name = _SECURITY_NAMES.get(normalized, "").strip().lower()
    return name or normalized.removesuffix(".TO").removesuffix(".V").removesuffix(".CN").removesuffix(".NE")


def _normalize_exchange(value: object, ticker: str) -> str:
    suffix = str(ticker).upper().rsplit(".", 1)[-1] if "." in str(ticker) else ""
    if suffix == "TO":
        return "TSX"
    if suffix == "V":
        return "TSXV"
    if suffix == "CN":
        return "CSE"
    if suffix == "NE":
        return "Cboe Canada"
    exchange = str(value or "").upper()
    if exchange in {"NMS", "NGM", "NCM", "NASDAQ"}:
        return "NASDAQ"
    if exchange in {"NYQ", "NYSE"}:
        return "NYSE"
    if exchange in {"PCX", "ASE", "ARCA"}:
        return "NYSE Arca"
    return exchange or "US"


def _enrich_info_fields(df: pd.DataFrame) -> None:
    """Best-effort enrichment of pe_ratio, pb_ratio, industry from yfinance info."""
    import yfinance as yf

    needs_pe = df["pe_ratio"].isna().sum() > len(df) * 0.5
    if not needs_pe:
        return

    for idx in df.index:
        ticker = df.at[idx, "code"]
        try:
            info = yf.Ticker(ticker).info
            if pd.isna(df.at[idx, "pe_ratio"]) or df.at[idx, "pe_ratio"] == 0:
                df.at[idx, "pe_ratio"] = info.get("trailingPE")
            if pd.isna(df.at[idx, "pb_ratio"]) or df.at[idx, "pb_ratio"] == 0:
                df.at[idx, "pb_ratio"] = info.get("priceToBook")
            if not df.at[idx, "industry"]:
                df.at[idx, "industry"] = info.get("industry", "")
            if not df.at[idx, "name"] or df.at[idx, "name"] == ticker:
                df.at[idx, "name"] = info.get("shortName", ticker)
        except Exception:
            pass


def fetch_daily_history_yfinance(
    ticker: str,
    *,
    lookback_days: int = 120,
) -> pd.DataFrame:
    """Fetch daily OHLCV history for a US ticker via yfinance.

    Returns a DataFrame with columns: date, open, high, low, close, volume
    matching the schema expected by the daily enrichment logic.
    """
    import yfinance as yf

    end = pd.Timestamp.now().normalize()
    start = end - pd.Timedelta(days=max(lookback_days * 2, 180))
    hist = yf.download(
        ticker,
        start=start.strftime("%Y-%m-%d"),
        end=end.strftime("%Y-%m-%d"),
        auto_adjust=True,
        progress=False,
    )
    if hist is None or hist.empty:
        raise RuntimeError(f"yfinance daily history empty for {ticker}")

    if isinstance(hist.columns, pd.MultiIndex):
        hist.columns = hist.columns.droplevel("Ticker")

    hist = hist.tail(max(lookback_days, 30)).copy()
    hist = hist.rename(columns={
        "Open": "开盘", "High": "最高", "Low": "最低",
        "Close": "收盘", "Volume": "成交量",
    })
    hist.index.name = "日期"
    hist = hist.reset_index()
    return hist
