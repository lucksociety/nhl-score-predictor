import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import v4_model as M


def test_history_features_do_not_contain_same_day_results():
    def row(gid, date, a, h):
        return dict(id=gid, date=date, season=20252026, away="BOS", home="TOR", a=a, h=h,
                    per="REG", sog_a=30, sog_h=30, gk_a=None, gk_h=None, gkn_a="", gkn_h="",
                    gsa_a=[], gsa_h=[], g_a=None, g_h=None, xg_a=None, xg_h=None)
    rows = [row(1, "2026-01-01", 2, 3), row(2, "2026-01-01", 9, 0), row(3, "2026-01-02", 1, 2)]
    _, base = M.run_history(rows)
    rows[1]["a"] = 0; rows[1]["h"] = 10
    _, changed = M.run_history(rows)
    for k in M.FEATS:
        assert M.xrow(base[0], "a")[M.FEATS.index(k)] == M.xrow(changed[0], "a")[M.FEATS.index(k)]
    assert base[2]["a_gf"] != changed[2]["a_gf"]


def test_stale_future_feed_never_gets_rates_from_later_history(monkeypatch, tmp_path):
    import v4_update as U
    import numpy as np
    class State:
        lg = {"gf": 3., "xf": 3., "sf": 30.}
        T = {}
    rec = {"a": 3, "h": 3}
    monkeypatch.setattr(U, "DATA", str(tmp_path))
    (tmp_path / 'v4').mkdir()
    monkeypatch.setattr(M, "train", lambda rows: (State(), np.zeros(1+len(M.FEATS)), [rec]))
    monkeypatch.setattr(M, "predict", lambda f,b: (3.,3.))
    frozen = {"frozen": True, "la": 2., "lh": 4.}
    games = [{"state":"FUT", "away":"BOS", "home":"TOR"},
             {"state":"OFF", "away":"BOS", "home":"TOR", "v4": frozen.copy()}]
    U.annotate([{"date":"2026-01-01", "games":games}], [{"date":"2026-01-02", "id":1}])
    assert "v4" not in games[0]
    assert games[1]["v4"] == frozen
