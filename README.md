# Stock Analysis

An AI-assisted stock research dashboard focused on securities available through Wealthsimple. It screens a broad Canadian and US market universe, ranks the strongest candidates, and lets you run deeper analysis from one dashboard.

## Highlights

- Wealthsimple-focused Canadian and US stock screening
- Ranked opportunities with scores, prices, daily changes, and strongest factors
- Live watchlist quotes and click-to-analyze workflows
- Portfolio import support for Wealthsimple CSV exports
- AI-generated research reports when an LLM channel is configured
- English-first web interface

## Quick start

Requirements: Python 3.10+, Node.js, and npm.

```powershell
git clone https://github.com/peytoncampbell/stock-analysis.git
cd stock-analysis
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python main.py --serve-only
```

Open [http://localhost:8000](http://localhost:8000). The server builds the frontend automatically when needed.

Configure an LLM provider from the web settings before running AI analysis. Market screening and quotes can be used independently.

## Documentation

See the [full English project guide](docs/README_EN.md) for configuration, data providers, automation, notifications, and deployment options.

## Attribution

This project is a customized spin-off of [ZhuLinsen/daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis). The original copyright and MIT license are retained in [LICENSE](LICENSE).

## Disclaimer

This software is for research and educational use only. Rankings and generated analysis are not financial advice. Verify all data and make investment decisions based on your own circumstances and risk tolerance.
