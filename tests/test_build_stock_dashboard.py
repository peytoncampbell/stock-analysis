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
                    "price": 145.5,
                    "change_pct": 1.25,
                    "score": 88.4,
                    "industry": "Software",
                    "reason": "本地后置评分",
                }
            ],
        },
        datetime(2026, 9, 4, 9, 15, tzinfo=ZoneInfo("America/Toronto")),
    )

    assert "8,000" in page
    assert "SHOP.TO" in page
    assert "+1.25%" in page
    assert "Shopify &lt;Canada&gt;" in page
    assert "market &lt;feed&gt;" in page
    assert "Factor ranking" in page
    assert "本地后置评分" not in page
    assert "Sep 04, 2026 · 09:15 AM ET" in page
