[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) [![rank](https://make.fun/badge/token-radar-01/Renga154/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) [![reward](https://make.fun/badge/token-radar-01/Renga154/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar

Token Launch Radar ranks pre-token DeFi protocols from a sealed DefiLlama snapshot. It covers the snapshot watchlist and adds up to 260 eligible early candidates below the watchlist TVL floor, with a $5 million minimum TVL.

## Valuation model

The model estimates fully diluted token value conditional on a launch. It multiplies TVL by a calibrated category-family base multiple and three factors for seven-day TVL growth, time since listing, and the number of distinct chains. Each family’s base multiple blends a prior with the bounded median market-cap-to-TVL ratio of comparable issued-token protocols in the snapshot. The sample size determines how much weight the observed median receives.

## Dashboard

The offline dashboard has a sortable ranking with text, watchlist, category, and chain filters. Each protocol’s detail view shows the valuation factors and its numbered farm plan. Separate sections show snapshot market caps for already-issued tokens and the evidence behind each family’s calibration.

## Run locally

With Node.js 22 or later, run the entry from the repository root.

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

The entry validates the board, writes `out/board.json` and `out/data.js`, copies the dashboard and submission screenshots, and produces `out/dossier.json`. Open `out/dashboard/index.html` to browse the generated board.

## How it was made

This bounty entry was built through a two-agent collaboration.
