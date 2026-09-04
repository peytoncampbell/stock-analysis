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


def test_wealthsimple_snapshot_checks_every_catalogue_listing(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.services.wealthsimple_catalogue_service.get_wealthsimple_universe_rows",
        lambda: [
            {
                "symbol": "SHOP.TO", "name": "Shopify", "exchange": "TSX",
                "currency": "CAD", "market": "ca", "asset_type": "stock", "wealthsimple_status": "likely",
            },
            {
                "symbol": "MISSING", "name": "Missing Quote", "exchange": "NASDAQ",
                "currency": "USD", "market": "us", "asset_type": "stock", "wealthsimple_status": "likely",
            },
        ],
    )
    monkeypatch.setattr(
        snapshot_us,
        "_fetch_tradingview_market",
        lambda _market: [{
            "symbol": "SHOP.TO", "price": 100.0, "change_pct": 1.0,
            "volume": 100_000.0, "amount": 10_000_000.0,
            "total_mv": 1_000_000_000.0, "pe_ratio": 20.0,
            "pb_ratio": 5.0, "volume_ratio": 1.0, "industry": "Software",
        }],
    )

    result = snapshot_us.fetch_wealthsimple_snapshot()

    assert result["code"].tolist() == ["SHOP.TO", "MISSING"]
    assert result.iloc[0]["currency"] == "CAD"
    assert pd.isna(result.iloc[1]["price"])
    assert "1 of 2" in result.attrs["source_errors"][0]
    assert result.attrs["fallback_used"] is False


def test_canadian_snapshot_checks_every_canadian_catalogue_listing(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.services.wealthsimple_catalogue_service.get_wealthsimple_universe_rows",
        lambda: [
            {"symbol": "SHOP.TO", "name": "Shopify", "exchange": "TSX", "currency": "CAD", "market": "ca", "asset_type": "stock", "wealthsimple_status": "likely"},
            {"symbol": "THX.V", "name": "Thor Explorations", "exchange": "TSXV", "currency": "CAD", "market": "ca", "asset_type": "stock", "wealthsimple_status": "likely"},
            {"symbol": "AAPL", "name": "Apple", "exchange": "NASDAQ", "currency": "USD", "market": "us", "asset_type": "stock", "wealthsimple_status": "likely"},
        ],
    )
    monkeypatch.setattr(
        snapshot_us,
        "_fetch_tradingview_market",
        lambda market: [
            {"symbol": "SHOP.TO", "price": 100.0, "amount": 10_000_000.0, "total_mv": 200_000_000_000.0},
            {"symbol": "THX.V", "price": 2.0, "amount": 6_000_000.0, "total_mv": 3_000_000_000.0},
        ] if market == "canada" else [],
    )

    result = snapshot_us.fetch_ca_snapshot()

    assert result["code"].tolist() == ["SHOP.TO", "THX.V"]
    assert result["currency"].tolist() == ["CAD", "CAD"]
    assert result.attrs["snapshot_source"] == "tradingview:canada"


def test_institutional_us_snapshot_and_filters_cover_common_stocks_and_adrs(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.services.wealthsimple_catalogue_service.get_wealthsimple_universe_rows",
        lambda: [
            {"symbol": "GOOD", "name": "Good Operating Co", "exchange": "NYSE", "currency": "USD", "market": "us", "asset_type": "stock", "wealthsimple_status": "likely"},
            {"symbol": "ADR", "name": "Global ADR", "exchange": "NASDAQ", "currency": "USD", "market": "us", "asset_type": "stock", "wealthsimple_status": "likely"},
            {"symbol": "ETF", "name": "Index ETF", "exchange": "NASDAQ", "currency": "USD", "market": "us", "asset_type": "etf", "wealthsimple_status": "likely"},
            {"symbol": "SPAC", "name": "Example Acquisition Corp", "exchange": "NYSE", "currency": "USD", "market": "us", "asset_type": "stock", "wealthsimple_status": "likely"},
            {"symbol": "SHOP.TO", "name": "Shopify", "exchange": "TSX", "currency": "CAD", "market": "ca", "asset_type": "stock", "wealthsimple_status": "likely"},
        ],
    )
    monkeypatch.setattr(
        snapshot_us,
        "_fetch_tradingview_market",
        lambda _market: [
            {"symbol": symbol, "asset_type": asset_type, "price": 20.0, "amount": 10_000_000.0, "total_mv": 3_000_000_000.0}
            for symbol, asset_type in (("GOOD", "stock"), ("ADR", "adr"), ("ETF", "etf"), ("SPAC", "stock"))
        ],
    )

    from src.services.screening.filter import apply_hard_filters
    from src.services.screening.models import HardFilterConfig

    snapshot = snapshot_us.fetch_us_snapshot()
    filtered = apply_hard_filters(snapshot, HardFilterConfig(
        asset_type_whitelist=["stock", "adr"],
        exclude_shells=True,
        amount_min=5_000_000,
        market_cap_min=2_000_000_000,
    ))

    assert snapshot["code"].tolist() == ["GOOD", "ADR", "ETF", "SPAC"]
    assert filtered["code"].tolist() == ["GOOD", "ADR"]
