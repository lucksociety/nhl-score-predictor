# Reference Python model (v3)

These are the original Python files the JavaScript port (`js/model.js`) was checked against.
`ref_js.py` produced `tests/python_ref_2026-10-26.json`. They expect a `data/` folder with
`games.json` (2021-26 NHL finals) and `results_2026_27.csv`, which are not included here;
the dashboard does not need them (it uses `data/base_2025_26.json` + `data/results_2026_27.json`).
`backtest_v3.md` is the backtest write-up behind v3.
