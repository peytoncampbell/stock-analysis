# GitHub Pages stock dashboard

The public, read-only stock dashboard is deployed from
`.github/workflows/stock-dashboard-pages.yml`. It runs the Canadian and U.S.
`wealthsimple_core` screen near 09:15 and 16:15 America/Toronto on weekdays,
skips days when both markets are closed, and publishes the latest successful
ranking through GitHub Pages.

GitHub Pages cannot run FastAPI or background processes. The published page
therefore supports viewing and sorting the latest ranking, while interactive
analysis, configuration, and manual scans remain available only in a running
local or server deployment. The workflow can be run manually from the Actions
tab to refresh the page on demand.
