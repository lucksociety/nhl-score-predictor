#!/usr/bin/env python3
"""sim_v3.py - NHL score-contest model v3 (2026-10-27). Same simulator as sim_v2; changed decision inputs.
Backtest (bt3.py / run_bt3.py / exp1.py / exp2.py; write-up backtest_v3.md), contest MAE, no ties, 3,936 games 2023-26:
  v2 official (ratings only, argmin)                         2.839
  v2 as run live Oct 26 (n0=25, market 0.6, extra uncertainty, mode-first 'choose' pick)  2.822
  v3 (market weight 1.0 on ML and total, no extra uncertainty layer, pure argmin pick)    2.788
Changes:
  1. MKT_W_TOTAL = MKT_W_ML = 1.0: when a moneyline and total are available, use the market-implied scoring rates
     outright (closing ESPN/DraftKings/Bet365 lines 2023-27 were backtested; every weight <1 was worse).
  2. Team-ratings prior weight back to n0=60 (n0=25 used on Oct 26 was never backtested; ratings matter only when odds are missing).
  3. Pick = argmin of expected |error| over ALL non-tied scores (not 'mode unless a top-5 cell within 85%').
  4. The lognormal team/pace/goalie/meltdown 'parameter uncertainty' layer is OFF by default (it made MAE worse:
     +0.009 on 2023-26, +0.11 on 2026-27). Can be turned on with spec unc=True for scenario reporting only.
  5. Goalie SV% inputs only matter when no market line exists, or via post_dsv_a/post_dsv_h when goalie news
     breaks AFTER the line you entered (judgment, not backtested).
Unchanged: simulator (score effects, EN, OT/SO), home-ice (tested +/-4%: no gain), OT label rule P(OT|pick)>=55%.
"""
from sim_v2 import *          # noqa
import sim_v2 as _v2
VERSION = 'v3'
MKT_W_TOTAL, MKT_W_ML = 1.0, 1.0
N0 = 60
_v2.MKT_W_TOTAL, _v2.MKT_W_ML = MKT_W_TOTAL, MKT_W_ML
if __name__ == '__main__':
    _v2.main()
