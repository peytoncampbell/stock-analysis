from src.services.screening.snapshot_us import _TRADINGVIEW_FIELD_MAP


def test_bulk_snapshot_requests_analyst_targets() -> None:
    assert {
        "price_target_average": "analyst_target_mean",
        "price_target_high": "analyst_target_high",
        "price_target_low": "analyst_target_low",
    }.items() <= _TRADINGVIEW_FIELD_MAP.items()
