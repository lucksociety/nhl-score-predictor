#!/usr/bin/env python3
"""Model vs market on settled NHL games, from data already in this repo.

    python research/market_benchmark.py

For each finished game it takes the last forecast frozen before puck drop (learning/forecasts.jsonl), the result
and the stored pre-game prices in data/days/*.json: the DraftKings closing moneyline (no-vig) and, where a
two-sided quote no wider than 6c was stored, the Polymarket moneyline mid (no-vig). It prints log loss for each,
the paired difference with a bootstrap interval, and what happened where model and market disagreed.

Read-only research. Nothing here is imported by the model and no price is ever a model input.
"""
import glob
import json
import math
import random
import statistics as st
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ll = lambda p, y: -math.log(max(1e-9, p if y else 1 - p))


def american(ml):
    return (-ml / (-ml + 100)) if ml < 0 else 100 / (ml + 100)


def polymarket_home(g):
    m = g.get("market") or g.get("jupiter") or {}          # 'jupiter': day files written before 2026-11-16
    mids = {}
    for side in ("away", "home"):
        x = (m.get("sides") or {}).get(side) or {}
        a, b = x.get("ask"), x.get("bid")
        if not (isinstance(a, (int, float)) and isinstance(b, (int, float)) and 0 < b <= a < 1 and a - b <= 0.06 + 1e-9):
            return None
        mids[side] = (a + b) / 2
    start, at = g.get("startUTC"), m.get("fetchedAt")
    if not start or not at or at >= start:                  # pre-game quotes only
        return None
    return mids["home"] / (mids["home"] + mids["away"])


def rows():
    last = {}
    for line in (ROOT / "learning/forecasts.jsonl").read_text().splitlines():
        if not line.strip(): continue
        f = json.loads(line)
        if f["frozen_at"] < f["start"] and (f["event_id"] not in last or last[f["event_id"]]["frozen_at"] < f["frozen_at"]):
            last[f["event_id"]] = f
    out = []
    for path in sorted(glob.glob(str(ROOT / "data/days/*.json"))):
        for g in json.loads(Path(path).read_text()).get("games", []):
            f, fin, o = last.get(str(g.get("id"))), g.get("final"), g.get("odds") or {}
            if not f or not fin or fin[0] is None or fin[1] is None: continue
            dk = None
            if o.get("mlHome") is not None and o.get("mlAway") is not None:
                h, a = american(o["mlHome"]), american(o["mlAway"]); dk = h / (h + a)
            out.append({"id": g["id"], "model": f["probabilities"][0], "dk": dk, "polymarket": polymarket_home(g),
                        "home_won": int(fin[1] > fin[0]), "version": f["model"], "date": Path(path).stem})   # final = [away, home, period]
    seen, uniq = set(), []
    for r in out:
        if r["id"] not in seen: seen.add(r["id"]); uniq.append(r)
    return uniq


def compare(rs, key, seed=3):
    rs = [r for r in rs if r[key] is not None]
    if not rs: return {"n": 0}
    d = [ll(r["model"], r["home_won"]) - ll(r[key], r["home_won"]) for r in rs]
    rng = random.Random(seed); boot = sorted(st.mean(rng.choice(d) for _ in d) for _ in range(4000))
    out = {"n": len(rs), "from": min(r["date"] for r in rs), "to": max(r["date"] for r in rs),
           "model_log_loss": round(st.mean(ll(r["model"], r["home_won"]) for r in rs), 4), "market_log_loss": round(st.mean(ll(r[key], r["home_won"]) for r in rs), 4),
           "model_accuracy": round(st.mean((r["model"] > .5) == bool(r["home_won"]) for r in rs), 3), "market_accuracy": round(st.mean((r[key] > .5) == bool(r["home_won"]) for r in rs), 3),
           "model_minus_market_log_loss": round(st.mean(d), 4), "ci95": [round(boot[100], 4), round(boot[3900], 4)],
           "mean_abs_gap": round(st.mean(abs(r["model"] - r[key]) for r in rs), 3)}
    big = [r for r in rs if abs(r["model"] - r[key]) > .05]
    if big:
        out["disagree_over_5pts"] = {"n": len(big), "model_side_won": round(st.mean((r["model"] > r[key]) == bool(r["home_won"]) for r in big), 3),
            "model_said": round(st.mean(r["model"] if r["model"] > r[key] else 1 - r["model"] for r in big), 3),
            "market_said": round(st.mean(r[key] if r["model"] > r[key] else 1 - r[key] for r in big), 3)}
    out["verdict"] = ("too few games to say" if len(rs) < 200 else "model at least matches the market" if out["ci95"][1] <= 0
                      else "market is more accurate than the model" if out["ci95"][0] > 0 else "no measurable difference yet")
    return out


if __name__ == "__main__":
    rs = rows()
    print(json.dumps({"games": len(rs), "vs_draftkings_close": compare(rs, "dk"), "vs_polymarket_pregame": compare(rs, "polymarket")}, indent=1))
