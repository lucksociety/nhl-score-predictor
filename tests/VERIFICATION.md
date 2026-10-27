# JS v3 vs Python v3: Oct 26, 2026 slate

Inputs are the ones used live on Oct 26 (`reference_python/specs26.py`): LAK@NYR ML +114/-132, total 5.5 (-125/+105);
TOR@CGY -145/+128, 6.5 (-120/+100); DET@EDM +152/-178, 6.5 (-120/+100). Ratings are the 2025-26 base plus all 187 2026-27 games
(`tests/results_through_2026-10-26.json`, same as the Python run). Full precision: 800k sims, 120k-sim market fit, seeds 11 and 12.

| Game | Python v3 pick | JS v3 pick | P(OT) Py / JS | P(home) Py / JS | xG Py / JS |
|---|---|---|---|---|---|
| LAK @ NYR | 2-3 | 2-3 | 22.2% / 22.2% | 54.9% / 55.0% | 2.86-3.16 / 2.85-3.16 |
| TOR @ CGY | 4-3 (no OT label, P(OT\|pick) 54%) | 4-3 (54%) | 21.0% / 21.0% | 42.7% / 42.7% | 3.64-3.18 / 3.64-3.18 |
| DET @ EDM | 3-4 | 3-4 | 20.5% / 20.5% | 62.0% / 61.6% | 3.02-3.78 / 3.04-3.79 |

All 6 game x seed runs give identical picks and OT labels (`verify_oct26_output.txt`). Standard precision (200k / 40k) over 10 seeds:
the same pick in 10/10 runs for each game (`standard_precision_stability.txt`).

Note: P(OT | pick) for 4-3 / 3-4 picks often sits at 52-57%, right at the 55% OT-label cutoff, so the OT label (not the score)
can flip with small odds moves or Monte Carlo noise.
