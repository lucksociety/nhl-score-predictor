# Luck Society NHL Predictor (model v3)

![Luck Society](assets/banner.jpg)

**Live dashboard:** https://lucksociety.github.io/nhl-score-predictor/

Pick a date (defaults to today in Eastern Time) and press **Simulate**. Your browser runs the v3
exact-score protocol for every game on that date and shows:

* matchup, puck drop (ET), probable/confirmed goalies
* the moneyline and total used (DraftKings via ESPN), no-vig win and over probabilities
* **final pick** (no ties: the OT/SO winner gets +1), with an **OT** label when P(OT | that score) ≥ 55%
* P(game goes to OT/SO), win probabilities, expected goals, top 5 exact scores
* a summary table (with a "Copy picks" button) and, for finished games, the actual score and contest error
* **Jupiter edge**: the Jupiter Predict price for each side, its no-vig value, the model win %, edge in percentage points and EV per $1 after fees, with a link to the market (see below)

## How it works

| Piece | What it does |
|---|---|
| `.github/workflows/update.yml` | Hourly 10 AM – 11 PM ET (plus :30 runs 5–11 PM ET) and on demand: runs `scripts/update_data.py`, commits `data/`, deploys GitHub Pages. |
| `scripts/update_data.py` | Stdlib-only. Pulls the NHL schedule and finals (`api-web.nhle.com/v1/schedule`), ESPN scoreboard odds + probable goalies, and ESPN core-API closing odds for finished games. Writes `data/today.json`, `data/days/YYYY-MM-DD.json`, `data/results_2026_27.json`. Keeps the last pre-game line once a game starts. |
| `js/espn.js` | On Simulate, re-pulls live odds/goalies from ESPN directly in the browser (ESPN allows CORS). If that fails, the Action snapshot is used. The NHL API does not allow browser CORS, so schedule/results come from the snapshot. |
| `js/model.js` | JavaScript port of `sim_v2.py` + `sim_v3.py` + `tonight.py`. |
| `js/jupiter.js` | Pulls Jupiter Predict NHL game markets in the browser (keyless, CORS allowed) and computes the edge. The Action also stores a copy on each game (`jupiter` field) as a fallback. |
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

## Jupiter edge

**Read this first: the edge is vs a DraftKings-derived model.** v3 fits the DraftKings moneyline at full weight (market weight 1.0), so the model's win % is essentially the DraftKings no-vig price. A positive edge means Jupiter (Polymarket liquidity) is cheaper than DraftKings implies. It is not an independent handicap.

* **Source:** official Jupiter Prediction API, `GET https://api.jup.ag/prediction/v1/events?category=sports&subcategory=nhl&includeMarkets=true&start=0&end=100` (paginated; [docs](https://developers.jup.ag/docs/prediction)). It needs no key or wallet and is limited to 0.5 requests per second without a key. The fallback host is `https://prediction-market-api.jup.ag/api/v1`, the same API behind jup.ag. No keys are stored in this repo.
* **Matching:** the event slug is `nhl-{away}-{home}-{YYYY-MM-DD}`, using Polymarket team codes mapped to NHL codes (`mon`→MTL, `nj`→NJD, `las`→VGK, `cal`→CGY, `sj`→SJS, `tb`→TBL, `utah`→UTA). Each game has one YES market per team. A game with no market shows **No Jupiter market**.
* **Resolution:** per the market rules, the result uses "the final score including any overtime periods and shootouts". It is compared with the model's win % **including OT/SO**.
* **Price:** p = YES ask (`buyYesPriceUsd` / 1e6), which is the cost of a $1 contract. Bid = `sellYesPriceUsd`. No-vig = p_side / (p_away + p_home).
* **Edge** = model % − p (in pp). **EV per $1** = model / (p + fee) − 1, where fee = 0.07 · p · (1 − p) per contract. This matches Jupiter's published fee table for Polymarket-sourced markets, which Jupiter rounds up to the cent per order. Rows with positive EV after fees are green. A positive edge before fees is shown in gold.
* **Limitations:** prices move and the order book can be thin. The ask is only good for the size posted. Once a game starts, the dashboard keeps the last pre-game snapshot price if one exists. Otherwise it marks the price "in-game", and that edge is not meaningful. Markets for past dates usually disappear from the feed. Fee rounding makes small orders slightly worse.

## Verification
`node tests/verify_oct26.js` runs the JS model on the Oct 26, 2026 slate with the same inputs used in Python and compares
against `tests/python_ref_2026-10-26.json` (Python v3, two seeds). See `tests/VERIFICATION.md`.

## Refresh data locally
```
python3 scripts/update_data.py                       # today (ET), yesterday, tomorrow
python3 scripts/update_data.py --backfill 2026-09-29 2026-10-25
```

No API keys or secrets are used anywhere. For entertainment / contest use; not betting advice.

## v4-independent model (default) and the Discord `/nhl` command

**v4-independent** uses no betting-market input, so its edge against Jupiter is a real disagreement with the market, not a DraftKings copy. Features are built only from games before each date: exponentially weighted (half-life 25 games) goals, MoneyPuck score/venue-adjusted xG and shots for and against; the starting goalie's goals vs expected (shrunk); home ice; back-to-backs, rest and travel. A Poisson regression is refit on 2022-23 onward every Action run (`scripts/v4_model.py`, `scripts/v4_update.py`, history in `data/v4/history.csv.gz`). Expected goals feed the same Monte Carlo as v3 (score effects, goalie pulls/empty nets, 3-on-3 OT, shootout).

### Honest backtest (rolling origin: each season predicted by a model fit only on earlier seasons, 4k sims/game)

| | Exact-score MAE 2023-26 | MAE 2026-27 | Win log loss 2024-26* | Win log loss 2026-27 |
|---|---|---|---|---|
| v4-independent | **2.805** | 2.781 | 0.6721 | 0.6625 |
| v3 ratings-only | 2.828 | 2.791 | 0.6792 | 0.6730 |
| v3 market-anchored (DraftKings) | 2.793 | 2.759 | 0.6704 | 0.6558 |
| DraftKings no-vig line | – | – | 0.6700 | 0.6535 |

\*2023-24 stored lines are 3-way regulation prices, so they are left out of moneyline comparisons. v4 clearly beats v3's ratings-only fallback, but **the betting market is still a bit sharper than v4** on win probability, and v4 underpredicts total goals by about 0.1 per game. A flat $1 rule (model > 50% and EV > 0 at DraftKings closing prices) lost 1.2% per bet over 2024-26 (1,628 bets), so treat any edge as thin. No historical Jupiter prices exist to backtest against.

### Best bet rule (dashboard and Discord)
For each Jupiter market on the game, q is the model probability (final result incl. OT/SO, matching Jupiter's rules) and p is the YES ask. The fee is 0.07·p·(1−p), and EV = q/(p+fee) − 1. A side qualifies only if **q > 50% and EV > 0**. The best bet is the qualifying side with the highest EV; otherwise the game is **NO BET**. Jupiter currently lists **NHL moneylines only**. Totals and puck lines are parsed automatically if they appear; until then they are shown as model leans only.

### Discord `/nhl` architecture
`/nhl` → Cloudflare Worker (`cloudflare/worker.mjs`, free plan). The Worker checks Discord's Ed25519 signature, replies "thinking…", and triggers `.github/workflows/discord.yml` with the 15-minute interaction token. That workflow refreshes the slate and Jupiter prices, retrains v4, runs 400k sims per game (`scripts/predict.js`), and edits the reply with Luck Society embeds (`scripts/discord_post.js`). If GitHub can't be reached, the Worker posts the latest precomputed `data/predictions/DATE.json` instead.

Secrets are **never** stored in this repo:
- `GITHUB_TOKEN`: a Worker secret (`wrangler secret put GITHUB_TOKEN`). Use a fine-grained PAT limited to this repo with Contents: read & write, which repository_dispatch requires.
- The Discord bot token is only needed once, to register the command: `DISCORD_BOT_TOKEN=… node scripts/register_command.js`.
- The application ID and public key are public and live in `cloudflare/wrangler.toml`.
