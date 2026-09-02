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
) -> pd.DataFrame:
    """Fetch a US equity snapshot in the screening schema.

    Uses yfinance to fetch current data for each ticker. Returns a
    DataFrame matching the standard snapshot columns: code, name, price,
    change_pct, amount, total_mv, pe_ratio, pb_ratio, volume_ratio,
    turnover_rate, industry.
    """
    import yfinance as yf

    if tickers is None:
        tickers = fetch_ca_universe(universe_source) if market == "ca" else fetch_us_universe(universe_source)

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

            info = yf.Ticker(ticker).fast_info
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
    return fetch_us_snapshot(
        tickers,
        universe_source=universe_source,
        max_workers=max_workers,
        market="ca",
    )


def fetch_wealthsimple_snapshot() -> pd.DataFrame:
    """Combine broad US/Canadian universes and prefer Canadian dual listings."""
    frames: list[pd.DataFrame] = []
    errors: list[str] = []
    for market, fetcher in (("ca", fetch_ca_snapshot), ("us", fetch_us_snapshot)):
        try:
            frames.append(fetcher())
        except Exception as exc:
            errors.append(f"{market}: {exc}")
    if not frames:
        raise RuntimeError(f"North American snapshots failed: {'; '.join(errors)}")
    combined = pd.concat(frames, ignore_index=True)
    combined["_listing_key"] = combined["code"].map(_listing_key)
    combined["_ca_first"] = combined["currency"].eq("CAD").astype(int)
    combined = (
        combined.sort_values(["_listing_key", "_ca_first"], ascending=[True, False])
        .drop_duplicates("_listing_key", keep="first")
        .drop(columns=["_listing_key", "_ca_first"])
        .reset_index(drop=True)
    )
    combined.attrs["snapshot_source"] = "yfinance:tsx60+sp500"
    combined.attrs["source_errors"] = errors
    combined.attrs["fallback_used"] = bool(errors)
    return combined


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
