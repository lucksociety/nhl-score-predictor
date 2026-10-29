# Model and Discord review — 2026-10-29

A stale schedule marked FUT could previously receive rates from a model trained through a later date. Annotation now sorts history and refuses fresh rates for any date at/before the training-through date, preserving existing frozen rates. Same-day historical feature collection remains batched before results are applied.

Validation: two Python cutoff/freeze tests and signed Worker dispatch/failure-fallback tests pass. This is a leakage guard, not a measured accuracy increase. The pre-existing v4 coefficients/hyperparameters remain unchanged. A stale schedule with no legitimate frozen rates produces no forecast rather than a retrospective prediction.

Further evaluation should use historical goalie information available before puck drop. The actual starter in retrospective box scores is a more informative input than an unconfirmed live goalie blend, so segment backtests by goalie confirmation status.

A read-only PR workflow now runs the model/command regressions. No dashboard presentation files were changed.

## Deployment prerequisites

Merge after checks pass. Redeploy the existing Worker for NBA/NHL/LoL changes as applicable; restart the NFL gateway bot after updating its checkout. Live Discord delivery, command registration and hosted secret state have not been verified by these offline tests.
