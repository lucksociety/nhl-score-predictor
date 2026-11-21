"""v4.1: team ratings at two speeds (slow = underlying quality, fast = current form)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import v4_model as M


def row(gid, date, a, h, away="BOS", home="TOR"):
    return dict(id=gid, date=date, season=20252026, away=away, home=home, a=a, h=h, per="REG", sog_a=30, sog_h=30,
                gk_a=None, gk_h=None, gkn_a="", gkn_h="", gsa_a=[], gsa_h=[], g_a=float(a), g_h=float(h), xg_a=3.0, xg_h=3.0)


def test_feature_row_matches_feature_names():
    _, recs = M.run_history([row(1, "2026-01-01", 2, 3), row(2, "2026-01-03", 1, 2)])
    assert len(M.xrow(recs[1], "a")) == len(M.FEATS) == len(M.xrow(recs[1], "h"))
    assert len(set(M.FEATS)) == len(M.FEATS)


def test_fast_rating_reacts_more_than_slow_rating_to_a_recent_run():
    # forty level games, then BOS outscores TOR 6-1 five times in a row
    rows = [row(i, f"2026-01-{1 + i // 2:02d}", 3, 3) for i in range(40)]
    rows += [row(100 + i, f"2026-02-{1 + i:02d}", 6, 1) for i in range(5)]
    rows.append(row(200, "2026-03-01", 3, 3))
    _, recs = M.run_history(rows)
    last = recs[-1]
    assert last["a_gf_f"] > last["a_gf"] > 1.0          # BOS attack: fast rating has moved further than the slow one
    assert last["h_gf_f"] < last["h_gf"] < 1.0          # TOR attack: same, downwards
    assert last["a_ga_f"] < last["a_ga"] < 1.0


def test_both_speeds_use_only_earlier_days():
    rows = [row(1, "2026-01-01", 2, 3), row(2, "2026-01-01", 9, 0), row(3, "2026-01-02", 1, 2)]
    _, base = M.run_history(rows)
    rows[1]["a"] = 0; rows[1]["h"] = 10; rows[1]["g_a"] = 0.0; rows[1]["g_h"] = 10.0
    _, changed = M.run_history(rows)
    assert M.xrow(base[0], "a") == M.xrow(changed[0], "a") and M.xrow(base[1], "h") == M.xrow(changed[1], "h")
    assert base[2]["a_gf_f"] != changed[2]["a_gf_f"] and base[2]["a_gf"] != changed[2]["a_gf"]


def test_both_speeds_carry_the_same_share_into_a_new_season():
    rows = [row(i, f"2026-01-{1 + i:02d}", 5, 1) for i in range(10)]
    S, _ = M.run_history(rows)
    slow, fast = S.T["BOS"]["w"], S.F["BOS"]["w"]
    S.new_season(20262027)
    assert abs(S.T["BOS"]["w"] - slow * M.HP["carry"]) < 1e-12 and abs(S.F["BOS"]["w"] - fast * M.HP["carry"]) < 1e-12
