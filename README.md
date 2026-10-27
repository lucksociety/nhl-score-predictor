# NHL Score Predictor (model v3)

**Live dashboard:** https://lucksociety.github.io/nhl-score-predictor/

Pick a date (defaults to today in Eastern Time) and press **Simulate**. Your browser runs the v3
exact-score protocol for every game on that date and shows:

* matchup, puck drop (ET), probable/confirmed goalies
* the moneyline and total used (DraftKings via ESPN), no-vig win and over probabilities
* **final pick** (no ties: the OT/SO winner gets +1), with an **OT** label when P(OT | that score) ≥ 55%
* P(game goes to OT/SO), win probabilities, expected goals, top 5 exact scores
* a summary table (with a "Copy picks" button) and, for finished games, the actual score and contest error

## How it works

| Piece | What it does |
|---|---|
| `.github/workflows/update.yml` | Hourly 10 AM – 11 PM ET (plus :30 runs 5–11 PM ET) and on demand: runs `scripts/update_data.py`, commits `data/`, deploys GitHub Pages. |
| `scripts/update_data.py` | Stdlib-only. Pulls the NHL schedule and finals (`api-web.nhle.com/v1/schedule`), ESPN scoreboard odds + probable goalies, and ESPN core-API closing odds for finished games. Writes `data/today.json`, `data/days/YYYY-MM-DD.json`, `data/results_2026_27.json`. Keeps the last pre-game line once a game starts. |
| `js/espn.js` | On Simulate, re-pulls live odds/goalies from ESPN directly in the browser (ESPN allows CORS). If that fails, the Action snapshot is used. The NHL API does not allow browser CORS, so schedule/results come from the snapshot. |
| `js/model.js` | JavaScript port of `sim_v2.py` + `sim_v3.py` + `tonight.py`. |
| `js/worker.js` | Runs each game in a Web Worker (parallel, UI stays responsive). |

### The v3 protocol
1. Team ratings: 2025-26 goals for/against shrunk 50% to league average, Bayesian update with 2026-27 results before the selected date (prior weight 60 games).
2. Market: de-vig the moneyline and total; fit the simulator's two rate parameters so it reproduces P(home win) and P(over) exactly (**market weight 1.0**).
3. Simulator: regulation in 3-minute steps then 10-second steps, score effects, +20% for the trailing team in the last 20 minutes, goalie pull + empty-net module, 3-on-3 OT (65% decided) else shootout; final score gives the OT/SO winner +1.
4. Pick: the non-tied score (0–8 each) with the lowest expected |away error| + |home error|. Label **OT** when P(OT | that score) ≥ 55%.
5. No odds → **ratings fallback** (clearly flagged; backtest MAE ≈ 2.84 vs 2.79 with odds).
6. The extra "parameter uncertainty" layer is off (it made the backtest worse).

Simulation uses a fixed seed, so the same inputs give the same picks. **Standard** precision (200k sims, 40k-sim market fit) is fast;
**Full** (800k / 120k) matches the Python settings.

## Verification
`node tests/verify_oct26.js` runs the JS model on the Oct 26, 2026 slate with the same inputs used in Python and compares
against `tests/python_ref_2026-10-26.json` (Python v3, two seeds). See `tests/VERIFICATION.md`.

## Refresh data locally
```
python3 scripts/update_data.py                       # today (ET), yesterday, tomorrow
python3 scripts/update_data.py --backfill 2026-09-29 2026-10-25
```

No API keys or secrets are used anywhere. For entertainment / contest use; not betting advice.
