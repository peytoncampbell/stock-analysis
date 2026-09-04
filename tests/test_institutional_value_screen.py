import pandas as pd

from src.services.screening.models import ScreeningConfig
from src.services.screening.scorer import compute_screen_scores
from src.services.screening.snapshot_us import _price_outlook_metrics


def test_institutional_factors_reward_value_growth_cash_and_quality() -> None:
    frame = pd.DataFrame([
        {
            "code": "STRONG", "pe_ratio": 8, "ev_ebitda": 5, "price_fcf": 7,
            "fcf_yield": 14, "fcf_margin": 20, "eps_growth": 18, "revenue_growth": 12,
            "roic": 24, "roe": 22, "roa": 12, "gross_margin": 55,
            "operating_margin": 25, "debt_to_equity": 0.2, "net_debt_ebitda": 0.4,
            "interest_coverage": 18, "current_ratio": 2,
        },
        {
            "code": "WEAK", "pe_ratio": 30, "ev_ebitda": 20, "price_fcf": 35,
            "fcf_yield": 3, "fcf_margin": 4, "eps_growth": -8, "revenue_growth": -3,
            "roic": 4, "roe": 5, "roa": 2, "gross_margin": 15,
            "operating_margin": 3, "debt_to_equity": 2, "net_debt_ebitda": 5,
            "interest_coverage": 2, "current_ratio": 0.7,
        },
    ])
    result = compute_screen_scores(frame, ScreeningConfig(factor_weights={
        "valuation": 0.25, "growth": 0.15, "cash_generation": 0.15,
        "quality": 0.15, "balance_sheet": 0.10, "revisions": 0.10,
        "catalysts": 0.05, "value_trap": 0.05,
    }))

    assert result.loc[0, "screen_score"] > result.loc[1, "screen_score"]
    assert result.loc[0, "fundamental_data_coverage"] > 50
    assert result["factor_revisions_score"].eq(50).all()


def test_price_outlook_uses_analyst_mean_and_low_targets() -> None:
    result = _price_outlook_metrics(100, {"mean": 124, "low": 78, "high": 150})

    assert result["price_estimate_1m"] == 102
    assert result["price_estimate_3m"] == 106
    assert result["price_estimate_1y"] == 124
    assert result["worst_case_price"] == 78
