from src.services.wealthsimple_catalogue_service import (
    _parse_tmx_directory,
    _parse_us_directory,
)


def test_catalogue_parsers_keep_supported_north_american_securities_only():
    us_rows = _parse_us_directory(
        "Symbol|Security Name|ETF|Test Issue|Financial Status\n"
        "AAPL|Apple Inc. - Common Stock|N|N|N\n"
        "TESTW|Example Warrants|N|N|N\n"
        "FAKE|Test Listing|N|Y|N\n",
        default_exchange="NASDAQ",
    )
    ca_rows = _parse_tmx_directory(
        {
            "results": [
                {"name": "Shopify Inc.", "instruments": [{"symbol": "SHOP"}]},
                {"name": "Example Corp.", "instruments": [{"symbol": "BAD.WT"}]},
            ]
        },
        exchange="TSX",
        suffix=".TO",
    )

    assert [(row["symbol"], row["market"]) for row in [*us_rows, *ca_rows]] == [
        ("AAPL", "us"),
        ("SHOP.TO", "ca"),
    ]
