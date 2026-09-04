from datetime import datetime
from zoneinfo import ZoneInfo

from scripts.build_stock_dashboard import render_dashboard


def test_dashboard_renders_summary_candidates_and_escapes_text() -> None:
    page = render_dashboard(
        {
            "snapshot_count": 8000,
            "after_filter_count": 120,
            "snapshot_source": "market <feed>",
            "candidates": [
                {
                    "rank": 1,
                    "code": "SHOP.TO",
                    "name": "Shopify <Canada>",
                    "exchange": "TSX",
                    "currency": "CAD",
                    "market": "ca",
                    "price": 145.5,
                    "score": 88.4,
                    "screening_metrics": {
                        "price_estimate_1m": 150.0,
                        "price_estimate_3m": 160.0,
                        "price_estimate_1y": 174.6,
                        "analyst_target_high": 190.0,
                        "worst_case_price": 130.0,
                    },
                }
            ],
        },
        datetime(2026, 9, 4, 9, 15, tzinfo=ZoneInfo("America/Toronto")),
    )

    assert "8,000" in page
    assert "SHOP.TO" in page
    assert "+20.0%" in page
    assert "+30.6%" in page
    assert "-10.7%" in page
    assert "Shopify &lt;Canada&gt;" in page
    assert "market &lt;feed&gt;" in page
    assert "1Y upside" in page
    assert "Sep 04, 2026 · 09:15 AM ET" in page
