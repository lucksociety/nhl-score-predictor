# NHL score-contest model: v3 (written 2026-10-27, America/New_York)

Contest metric: |pred away - actual away| + |pred home - actual home| per game, final recorded score (OT/SO winner +1), ties not allowed.

## New data this run
* `data/results_2026_27.csv` / `results_full.csv`: Oct 26 finals appended (LAK 6-3 NYR, TOR 2-5 CGY, DET 4-3 EDM SO); 187 games. Backups `*.bak_v2`.
* `data/games26.json`: all 187 2026-27 finals with NHL game ids.
* `data/box/*.json`: NHL boxscore for all 6,747 games 2021-27 (starting goalie, shots/saves per goalie, team SOG).
* `data/espn/od_*.json`: ESPN core-API odds for every game 2022-23..2026-27 (closing moneyline + total + over/under prices; Bet365 2022-24, ESPN BET 2024-26, DraftKings 2025-27). 100% coverage. **This removes the v2 limitation "market blend can't be backtested".**
* `data/v3_games.pkl` = all of the above joined (v3data.py). `grid_v3.pkl` maps sim input rates -> P(home win), P(over line), means (used to convert market lines to rates fast).

## Harness (bt3.py, run_bt3.py, exp1.py, exp2.py)
Every game 2023-24..2025-26 (3,936) plus 2026-27 to Oct 26 (187); ratings use only earlier games; market = that game's closing line; 3,000 sims/game through the unchanged v2 simulator; pick = argmin expected |error| over non-tied scores unless stated. Paired bootstrap SE in brackets. (Absolute levels differ slightly from backtest_v2.md's 2.815 because v2's harness calibrated scoring level in-sample; compare rows within this table.)

| config | MAE 2023-26 (n=3,936) | vs v2 | MAE 2026-27 (n=187) |
|---|---|---|---|
| v2 official (ratings only, argmin) | 2.839 | 0 | 2.791 |
| v2 exactly as run live on Oct 26 (n0=25, market 0.6, extra uncertainty, mode-first pick) | 2.822 | -0.018 | 2.759 |
| same, but argmin pick | 2.802 | -0.038 | 2.743 |
| market 0.6, no extra uncertainty | 2.801 | -0.038 (0.013) | 2.754 |
| market ML only, weight 1.0 | 2.806 | -0.034 | 2.727 |
| market total 0.6 + ML 1.0 | 2.795 | -0.045 | 2.738 |
| market 0.8 (with v3 ratings) | 2.797 | -0.043 | 2.690 |
| **v3: market 1.0 (ML and total), argmin, no extra uncertainty** | **2.788** | **-0.051 (0.015)** | **2.684** |
| v3 + mode-first 'choose' pick | 2.806 | -0.033 | 2.727 |
| v3 + market total shaded down 1.5% / 3% | 2.798 / 2.796 | -0.042 / -0.043 | 2.797 / 2.684 |
| v3 + lognormal/goalie-meltdown uncertainty layer | 2.797 (w/ v3 ratings; +0.009 vs without, SE 0.006) | -0.042 | 2.791 (+0.11 vs without, SE 0.04) |
| better ratings (shots 25%, relative goalie SV% w=0.5, shrink .6, n0 40, expo .9), no market | 2.826 | -0.014 (0.011) | 2.759 |
| better ratings + market 1.0 | 2.792 | +0.004 vs v3 (0.003) | 2.717 |
| home-ice +4% / -4% (no market) | 2.838 / 2.830 | -0.002 / -0.009 (0.009-0.010) | 2.840 / 2.866 |
| nonparametric "historical best score by odds bucket" (leave-one-season-out) | 2.897 | +0.058 | 2.668 |
v3 beats v2 in every season: 2023-24 2.792 vs 2.826, 2024-25 2.777 vs 2.829, 2025-26 2.796 vs 2.863, 2026-27 2.684 vs 2.791.

## Diagnosis
1. **Favorite / market bias: not the problem.** Closing moneylines are well calibrated 2022-27 (e.g. 70-85% favorites win 76.5% vs 74.8% implied; this season favorites win 61.5% vs 58.4% implied). The real error was the opposite: v2 trusted the market too little (0.6) and its own ratings too much. Full market weight is the single biggest gain.
2. **Pick rule:** the live 'start from the most likely score' rule cost ~0.018-0.02/game vs plain expected-error argmin. Replaced.
3. **Extra variance layer (team/pace lognormals, goalie sd, meltdown/hot-goalie mixtures):** made MAE worse in both samples. Market + simulator already carry the right spread for this metric. Off by default (`unc=True` for scenario text only).
4. **Home ice:** league home edge 2026-27 is +0.26 goals (larger than 2023-26's +0.23); +/-4% changes did not help. Unchanged.
5. **Goalies:** backups/low-sample starters (<300 career shots since 2021) allowed ~4.7% more goals than the ratings model expected, but only ~1% less than the *market* expected, i.e. the closing line already prices the confirmed goalie. A relative-SV% goalie term improved the ratings-only model (log-lik +8) but added nothing on top of the market. Kept only as a manual post-line override (`post_dsv_a/h`, not backtested) for goalie news that breaks after the line you entered.
6. **Ratings prior weight:** Oct 26 used n0=25, which had never been backtested; log-lik best ~40, MAE n0 25 vs 60 identical within noise. Back to 60 (matters only without odds).
7. **"Picks are always one-goal favorite wins":** that is what minimizing this metric does: the best guess for each team's goals is its median, so the pick is nearly always the favorite by 1 (or by 2 in lopsided games; v3 picks 2-4/4-2 about 13% of the time). Long run, the v3 pick has the right winner 59.5% of the time and the exact score 6.8%. Underdogs win by 2+ in ~25% of even 60/40 games; no rule tested predicts which ones.
8. **The 13 contest games:** submitted picks total error 44 (expected ~36 +/- 6 at 2.8/game, about +1.3 SD). 4/13 winners right; at a 60% true rate, 4 or fewer happens ~3% of the time: unlucky, not a broken model. Re-scored with v3 and the closing lines: total error 41 (NYR@BOS 2-3 instead of 3-4, CHI@VGK 2-4 instead of 2-3, others same). Oct 26 v3 picks would have been identical (2-3, 4-3, 3-4).

## OT label
Kept: label OT when P(OT | the exact submitted score) >= 55%. Caution: whether the *game* goes to OT is only ~20-24% for every pick type historically (3-4 picks: 22.4%, 4-3: 20.3%), so if the contest grades the OT label on its own, never labeling OT would be right ~78% of the time.

## What v3 changes in code
* `sim_v3.py`: imports sim_v2, sets MKT_W_TOTAL = MKT_W_ML = 1.0, N0 = 60, VERSION = 'v3'.
* `tonight.py` (v2 copy: `tonight_v2.py`): imports sim_v3; uncertainty layer off unless spec `unc=True`; default n0 = 60; `report()` computes expected error for every cell; `choose()` = argmin over all non-tied scores (old rule kept as `choose_v2`); optional `post_dsv_a/post_dsv_h`.
* `emit.py` (v2 copy: `emit_v2.py`): accepts argmin picks outside the top-12 list.
* Workflow: always enter the current moneyline and total (the model is only as good as the line); confirm goalies before entering the line, or use post_dsv if news breaks later. Without odds, v3 falls back to ratings (MAE ~2.84).

## Honest limits
* The whole gain is ~0.05 goals/game (about 0.65 goals over a 13-game run). Contest totals over a 3-5 game slate are dominated by noise (one game's error SD ~1.7).
* ESPN odds are one book per game (not a consensus), and some 'closing' snapshots may be slightly before puck drop.
* Simulator still slightly too wide (Var total 5.76 vs 5.34) and the sim's market mapping implies ~1-4% more goals than actually scored; a 1.5-3% total shade did not improve MAE, so it was not adopted.
* 2026-27 sample is 187 games (SE ~0.07), supportive but not decisive alone.
