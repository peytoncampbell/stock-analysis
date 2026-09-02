from __future__ import annotations

import pandas as pd

from api.v1.endpoints.stocks import get_stock_quote
from data_provider.base import DataFetcherManager, normalize_stock_code
from data_provider.yfinance_fetcher import YfinanceFetcher
from src.core.trading_calendar import get_market_for_stock
from src.market_context import detect_market, get_market_guidelines
from src.services.screening import snapshot_us
from src.services.stock_code_utils import resolve_daily_stock_identity


def test_canadian_suffixes_share_one_market_identity() -> None:
    for code in ("SHOP.TO", "THX.V", "CARS.NE", "BIG.CN"):
        assert detect_market(code) == "ca"
        assert get_market_for_stock(code) == "ca"
        assert resolve_daily_stock_identity(code).market == "ca"
        assert normalize_stock_code(code.lower()) == code
        fetcher = YfinanceFetcher()
        assert fetcher._convert_stock_code(code.lower()) == code
        assert fetcher._is_ca_suffix_stock(code)

    assert DataFetcherManager._DAILY_MARKET_FETCHER_SUPPORT["YfinanceFetcher"] >= {"ca"}
    assert "Bank of Canada" in get_market_guidelines("SHOP.TO", "en")


def test_canadian_quote_exposes_market_and_currency(monkeypatch) -> None:
    monkeypatch.setattr(
        "api.v1.endpoints.stocks.StockService.get_realtime_quote",
        lambda _self, _code: {
            "stock_code": "SHOP.TO",
            "stock_name": "Shopify",
            "market": "ca",
            "currency": "CAD",
            "current_price": 100.0,
        },
    )

    quote = get_stock_quote("SHOP.TO")

    assert quote.market == "ca"
    assert quote.currency == "CAD"


def test_wealthsimple_snapshot_prefers_canadian_dual_listing(monkeypatch) -> None:
    columns = {
        "name": "Shopify",
        "price": 100.0,
        "change_pct": 1.0,
        "amount": 10_000_000.0,
        "total_mv": 1_000_000_000.0,
        "circ_mv": 1_000_000_000.0,
        "pe_ratio": None,
        "pb_ratio": None,
        "volume_ratio": 1.0,
        "turnover_rate": 0.1,
        "industry": "",
        "provider_symbol": "",
        "exchange": "",
        "asset_type": "stock",
        "wealthsimple_status": "likely",
        "verified_at": "2026-09-02T00:00:00Z",
    }
    monkeypatch.setattr(
        snapshot_us,
        "fetch_ca_snapshot",
        lambda: pd.DataFrame([{**columns, "code": "SHOP.TO", "provider_symbol": "SHOP.TO", "exchange": "TSX", "currency": "CAD"}]),
    )
    monkeypatch.setattr(
        snapshot_us,
        "fetch_us_snapshot",
        lambda: pd.DataFrame([{**columns, "code": "SHOP", "provider_symbol": "SHOP", "exchange": "NASDAQ", "currency": "USD"}]),
    )

    result = snapshot_us.fetch_wealthsimple_snapshot()

    assert result["code"].tolist() == ["SHOP.TO"]
    assert result.iloc[0]["currency"] == "CAD"
