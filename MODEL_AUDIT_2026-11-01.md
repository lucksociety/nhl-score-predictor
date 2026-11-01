# Improvements following the October 31 Discord audit

Intraday production verification found a coverage defect after an early final entered history: the date-level cutoff skipped every remaining same-day fixture. Remaining pregame fixtures now share a fit restricted to results strictly before their slate date; future-day slates can still use the newer full history. This restores evening-game coverage without incorporating same-day results or retroactively recomputing started games. Regression tests prove the exact training dates and fit-cache reuse.

The live production verification also exposed a 0.01-percentage-point edge, below Monte Carlo precision. Require the after-fee edge to exceed 1.96 times its Bernoulli simulation standard error (using the actual simulation count). This is a numerical-noise guard, not a confidence bound on real-world model accuracy. No minimum edge is fitted to wins or losses.

NHL: reject one-sided, crossed, closed, untraded and excessively wide quotes. Enforce the scheduled start clock even when the provider still says FUT/PRE, and recheck when rendering Discord. Preserve precise selected-contract costs and the actual rendered payload as workflow artifacts for future Discord-only grading. October 31's 5–4 betting result and 7/10 winners do not support changing team/goalie coefficients or banning side bets from four losses.

Validation covers boundary and failure cases, unchanged market-free forecasting, and the repository's existing model/Discord regressions. Statistical accuracy improvements require further prospective results; execution safeguards do not establish profitable betting. Soccer's 32–21 original Discord record is preserved, with no one-day parameter retuning.
