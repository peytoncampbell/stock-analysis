#!/usr/bin/env python3
"""Build the read-only GitHub Pages dashboard from a fresh stock screen."""

from __future__ import annotations

import argparse
import html
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _number(value: Any, digits: int = 1) -> str:
    try:
        return f"{float(value):,.{digits}f}"
    except (TypeError, ValueError):
        return "—"


def _target_cell(candidate: dict[str, Any], field: str) -> str:
    current = candidate.get("price")
    target = (candidate.get("screening_metrics") or {}).get(field)
    if not isinstance(current, (int, float)) or current <= 0 or not isinstance(target, (int, float)):
        return '<td data-value="" class="numeric target"><strong>—</strong><span>No coverage</span></td>'
    upside = (target / current - 1) * 100
    tone = "gain" if upside >= 0 else "loss"
    currency = html.escape(str(candidate.get("currency") or ""))
    return (
        f'<td data-value="{upside}" class="numeric target">'
        f'<strong class="{tone}">{upside:+.1f}%</strong><span>{currency} {_number(target, 2)}</span></td>'
    )


def _candidate_rows(candidates: list[dict[str, Any]]) -> str:
    if not candidates:
        return '<tr><td colspan="10" class="empty">No candidates passed this scan.</td></tr>'

    rows = []
    for index, candidate in enumerate(candidates):
        code = str(candidate.get("code") or "—")
        name = str(candidate.get("name") or code)
        currency = str(candidate.get("currency") or "")
        rank = candidate.get("rank") or index + 1
        score = candidate.get("score")
        price = candidate.get("price")
        market = str(candidate.get("market") or "").upper() or ("CA" if code.endswith((".TO", ".V")) else "US")
        symbol_url = f"https://finance.yahoo.com/quote/{quote(code, safe='')}"
        rows.append(
            f'''<tr style="--i:{index}">
              <td data-value="{html.escape(str(rank))}" class="rank">{html.escape(str(rank))}</td>
              <td data-value="{html.escape(code)}"><a href="{symbol_url}" target="_blank" rel="noopener noreferrer"><strong>{html.escape(code)}</strong><span>{html.escape(name)}</span></a></td>
              <td data-value="{html.escape(market)}">{html.escape(market)}</td>
              <td data-value="{price if isinstance(price, (int, float)) else ''}" class="numeric">{html.escape(currency)} {_number(price, 2)}</td>
              <td data-value="{score if isinstance(score, (int, float)) else ''}" class="numeric score">{_number(score)}</td>
              {_target_cell(candidate, "price_estimate_1m")}
              {_target_cell(candidate, "price_estimate_3m")}
              {_target_cell(candidate, "price_estimate_1y")}
              {_target_cell(candidate, "analyst_target_high")}
              {_target_cell(candidate, "worst_case_price")}
            </tr>'''
        )
    return "\n".join(rows)


def render_dashboard(result: dict[str, Any], generated_at: datetime | None = None) -> str:
    generated_at = generated_at or datetime.now(ZoneInfo("America/Toronto"))
    candidates = result.get("candidates") if isinstance(result.get("candidates"), list) else []
    updated = generated_at.strftime("%b %d, %Y · %I:%M %p ET")
    source = html.escape(str(result.get("snapshot_source") or "market data providers"))
    rows = _candidate_rows([row for row in candidates if isinstance(row, dict)])
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Twice-daily Canadian and U.S. Wealthsimple stock rankings.">
  <title>Northstar Stock Scanner</title>
  <style>
    :root {{ color-scheme: dark; --bg:#070b11; --surface:#0c121b; --line:#1b2735; --text:#ecf4ff; --muted:#8fa1b7; --accent:#5aa9ff; --gain:#58d6a9; --loss:#ff7b86; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; background:var(--bg); color:var(--text); font:14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    main {{ width:min(1500px, 100%); margin:auto; padding:44px clamp(18px, 4vw, 64px) 64px; }}
    nav {{ display:flex; justify-content:space-between; gap:20px; align-items:center; padding-bottom:38px; border-bottom:1px solid var(--line); }}
    .brand {{ color:var(--text); font-weight:760; letter-spacing:.03em; text-decoration:none; }}
    .back {{ color:var(--muted); text-decoration:none; transition:color .18s ease; }}
    .back:hover, .back:focus-visible {{ color:var(--accent); }}
    header {{ display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:36px; align-items:end; padding:54px 0 36px; }}
    .eyebrow {{ margin:0 0 10px; color:var(--accent); font-size:12px; font-weight:750; letter-spacing:.16em; text-transform:uppercase; }}
    h1 {{ margin:0; max-width:760px; font-size:clamp(36px, 6vw, 76px); line-height:.98; letter-spacing:-.055em; }}
    .lede {{ max-width:620px; margin:20px 0 0; color:var(--muted); font-size:16px; }}
    .freshness {{ min-width:230px; padding-left:24px; border-left:1px solid var(--line); }}
    .freshness span {{ display:block; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.12em; }}
    .freshness strong {{ display:block; margin-top:7px; font-size:16px; }}
    .stats {{ display:grid; grid-template-columns:repeat(3, 1fr); border-block:1px solid var(--line); }}
    .stat {{ padding:24px 0; }}
    .stat + .stat {{ padding-left:28px; border-left:1px solid var(--line); }}
    .stat span {{ display:block; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.1em; }}
    .stat strong {{ display:block; margin-top:4px; font-size:25px; }}
    .table-head {{ display:flex; justify-content:space-between; gap:24px; align-items:end; margin:42px 0 14px; }}
    h2 {{ margin:0; font-size:22px; letter-spacing:-.02em; }}
    .table-head p {{ margin:0; color:var(--muted); }}
    .table-wrap {{ overflow-x:auto; border-top:1px solid var(--line); }}
    table {{ width:100%; min-width:1060px; border-collapse:collapse; }}
    th {{ padding:13px 12px; color:var(--muted); font-size:11px; letter-spacing:.09em; text-align:left; text-transform:uppercase; border-bottom:1px solid var(--line); }}
    th button {{ all:unset; cursor:pointer; }}
    th button:hover, th button:focus-visible {{ color:var(--accent); }}
    td {{ padding:17px 12px; border-bottom:1px solid var(--line); vertical-align:top; animation:enter .35s both; animation-delay:calc(var(--i) * 24ms); }}
    tbody tr {{ transition:background .16s ease; }}
    tbody tr:hover {{ background:var(--surface); }}
    td a {{ color:var(--text); text-decoration:none; }}
    td a span {{ display:block; max-width:230px; overflow:hidden; color:var(--muted); font-size:12px; text-overflow:ellipsis; white-space:nowrap; }}
    .rank {{ color:var(--muted); }} .numeric {{ text-align:right; font-variant-numeric:tabular-nums; }} .gain {{ color:var(--gain); }} .loss {{ color:var(--loss); }} .score {{ color:var(--accent); font-weight:750; }}
    td.target strong, td.target span {{ display:block; }} td.target span {{ color:var(--muted); font-size:11px; }} .empty {{ padding:50px; color:var(--muted); text-align:center; }}
    footer {{ display:flex; justify-content:space-between; gap:28px; margin-top:40px; padding-top:24px; color:var(--muted); border-top:1px solid var(--line); font-size:12px; }}
    @keyframes enter {{ from {{ opacity:0; transform:translateY(7px); }} }}
    @media (max-width:760px) {{ main {{ padding-top:24px; }} nav {{ padding-bottom:24px; }} header {{ grid-template-columns:1fr; padding-top:38px; }} .freshness {{ padding-left:0; border-left:0; }} .stats {{ grid-template-columns:1fr; }} .stat + .stat {{ padding-left:0; border-left:0; border-top:1px solid var(--line); }} .table-head, footer {{ align-items:flex-start; flex-direction:column; }} }}
    @media (prefers-reduced-motion:reduce) {{ *, *::before, *::after {{ scroll-behavior:auto!important; animation:none!important; transition:none!important; }} }}
  </style>
</head>
<body>
  <main>
    <nav><a class="brand" href="./">NORTHSTAR / STOCK SCANNER</a><a class="back" href="https://peytoncampbell.ca/">← peytoncampbell.ca</a></nav>
    <header>
      <div><p class="eyebrow">Canadian + U.S. equities</p><h1>Twice-daily value shortlist.</h1><p class="lede">All eligible listings are rescanned before market open and after market close, then ranked by fundamentals and current analyst targets.</p></div>
      <div class="freshness"><span>Last scan</span><strong>{html.escape(updated)}</strong></div>
    </header>
    <section class="stats" aria-label="Scan summary">
      <div class="stat"><span>Listings reviewed</span><strong>{_number(result.get("snapshot_count"), 0)}</strong></div>
      <div class="stat"><span>Passed filters</span><strong>{_number(result.get("after_filter_count"), 0)}</strong></div>
      <div class="stat"><span>Published candidates</span><strong>{len(candidates)}</strong></div>
    </section>
    <div class="table-head"><div><p class="eyebrow">Latest ranking</p><h2>Stocks to review</h2></div><p>Click a heading to sort · source: {source}</p></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th><button>Rank</button></th><th><button>Company</button></th><th><button>Market</button></th><th><button>Current</button></th><th><button>Score</button></th><th><button>1M upside</button></th><th><button>3M upside</button></th><th><button>1Y upside</button></th><th><button>High upside</button></th><th><button>Worst case</button></th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
    <footer><span>Refreshes near 9:15 AM and 4:15 PM Toronto time on market days.</span><span>Research tool only — not financial advice.</span></footer>
  </main>
  <script>
    document.querySelectorAll('th button').forEach((button, index) => button.addEventListener('click', () => {{
      const body = document.querySelector('tbody');
      const ascending = button.dataset.order !== 'asc';
      document.querySelectorAll('th button').forEach(item => delete item.dataset.order);
      button.dataset.order = ascending ? 'asc' : 'desc';
      [...body.rows].sort((a, b) => {{
        const left = a.cells[index].dataset.value || a.cells[index].textContent.trim();
        const right = b.cells[index].dataset.value || b.cells[index].textContent.trim();
        const leftNumber = Number(left), rightNumber = Number(right);
        const compared = Number.isNaN(leftNumber) || Number.isNaN(rightNumber) ? left.localeCompare(right) : leftNumber - rightNumber;
        return ascending ? compared : -compared;
      }}).forEach(row => body.appendChild(row));
    }}));
  </script>
</body>
</html>'''


def run_screen(*, skip_closed: bool) -> dict[str, Any] | None:
    if skip_closed:
        from src.core.trading_calendar import get_open_markets_today

        if not {"ca", "us"} & get_open_markets_today():
            print("Canadian and U.S. markets are closed; keeping the previous dashboard.")
            return None

    from src.config import Config
    from src.services.screening_service import ScreeningService

    service = ScreeningService(Config(screening_enabled=True))
    results = []
    candidates = []
    for market in ("us", "ca"):
        result = service.screen(strategy="institutional_value", market=market, max_results=20)
        results.append(result)
        candidates.extend({**candidate, "market": market} for candidate in result.get("candidates", []))

    candidates.sort(
        key=lambda candidate: (
            (candidate.get("screening_metrics") or {}).get("analyst_target_upside") is not None,
            (candidate.get("screening_metrics") or {}).get("analyst_target_upside") or float("-inf"),
        ),
        reverse=True,
    )
    for rank, candidate in enumerate(candidates, 1):
        candidate["rank"] = rank
    return {
        "snapshot_count": sum(result.get("snapshot_count", 0) for result in results),
        "after_filter_count": sum(result.get("after_filter_count", 0) for result in results),
        "snapshot_source": " + ".join(result.get("snapshot_source", "") for result in results),
        "candidates": candidates,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, help="Render an existing screening JSON payload")
    parser.add_argument("--output", type=Path, default=Path("_site/index.html"))
    parser.add_argument("--skip-closed", action="store_true")
    args = parser.parse_args()

    result = json.loads(args.input.read_text(encoding="utf-8")) if args.input else run_screen(skip_closed=args.skip_closed)
    if result is None:
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render_dashboard(result), encoding="utf-8")
    print(f"Dashboard written to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
