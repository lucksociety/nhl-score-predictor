import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import update_data as U

FULL = ("If the Bruins win, the market will resolve to \"Bruins\". The result will be determined based on the final score including any overtime "
        "periods and shootouts. In the event of a shootout, one goal will be added to the winning team's score for the purpose of resolution.")
FEE = {"exponent": 1, "rate": 0.05, "takerOnly": True, "rebateRate": 0.15}


def gm(mid, kind, suffix, outcomes, line=None, bid=.49, ask=.50, text=FULL, **kw):
    return {"id": mid, "sportsMarketType": kind, "slug": "nhl-bos-tor-2026-11-05" + suffix, "outcomes": json.dumps(outcomes),
            "clobTokenIds": json.dumps([f"{mid}a", f"{mid}b"]), "line": line, "bestBid": bid, "bestAsk": ask, "volumeNum": 100.5,
            "description": text, "active": True, "closed": False, "acceptingOrders": True, "feesEnabled": True, "feeSchedule": FEE, **kw}


def event(**kw):
    return {"id": "55", "slug": "nhl-bos-tor-2026-11-05", "title": "Bruins vs. Maple Leafs", "live": False, "closed": False,
            "teams": [{"name": "Bruins", "abbreviation": "bos", "ordering": "away"}, {"name": "Maple Leafs", "abbreviation": "tor", "ordering": "home"}],
            "markets": [gm(1, "moneyline", "", ["Bruins", "Maple Leafs"], bid=.44, ask=.45),
                        gm(2, "totals", "-total-5pt5", ["Over", "Under"], 5.5, .56, .57),
                        gm(3, "totals", "-total-6pt5", ["Over", "Under"], 6.5, text="Regulation score only"),
                        gm(4, "spreads", "-spread-home-1pt5", ["Maple Leafs", "Bruins"], -1.5, .27, .28),
                        gm(5, "spreads", "-spread-away-1pt5", ["Bruins", "Maple Leafs"], -1.5, .20, .22, feeSchedule={"rate": 0.03, "exponent": 1}),
                        gm(6, "first_period_moneyline", "-1p", ["Bruins", "Maple Leafs"]),
                        gm(7, "totals", "-total-7pt5", ["Over", "Under"], 7.5, None, None),
                        gm(8, "totals", "-total-8pt5", ["Over", "Under"], 8.5, acceptingOrders=False),
                        gm(9, "spreads", "-spread-home-2pt5", ["Leafs", "Bruins"], -2.5),            # unknown team name: never guessed
                        gm(10, "moneyline", "-other", ["Bruins", "Maple Leafs"])], **kw}             # not the game's own moneyline


def test_each_contract_keeps_its_own_settlement_evidence():
    parsed = U.parse_polymarket_event(event(), "2026-11-05T17:00:00Z")
    assert (parsed["date"], parsed["away"], parsed["home"]) == ("2026-11-05", "BOS", "TOR")
    assert parsed["eventId"] == "POLY-55" and parsed["provider"] == "polymarket" and parsed["link"] == "https://polymarket.com/event/nhl-bos-tor-2026-11-05"
    away, home = parsed["sides"]["away"], parsed["sides"]["home"]
    assert away["includesOTSO"] is True and (away["ask"], away["bid"], away["tokenId"], away["marketId"]) == (.45, .44, "1a", "POLY-1-0")
    assert (home["ask"], home["bid"], home["tokenId"]) == (.56, .55, "1b")       # outcome 1 is the complement of outcome 0's book
    assert away["fee"] == {"rate": .05, "exponent": 1.0} and away["volume"] == 100.5
    extra = {m["label"]: m for m in parsed["extra"]}
    assert extra["O 5.5"]["includesOTSO"] is True and (extra["O 5.5"]["ask"], extra["U 5.5"]["ask"], extra["U 5.5"]["bid"]) == (.57, .44, .43)
    assert extra["O 6.5"]["includesOTSO"] is False and parsed["extraIncludesOTSO"] is False
    assert (extra["TOR -1.5"]["team"], extra["TOR -1.5"]["line"], extra["TOR -1.5"]["ask"]) == ("TOR", -1.5, .28)
    assert (extra["BOS +1.5"]["line"], extra["BOS +1.5"]["ask"], extra["BOS +1.5"]["bid"]) == (1.5, .73, .72)
    assert extra["BOS -1.5"]["fee"] == {"rate": .03, "exponent": 1.0} and extra["TOR +1.5"]["ask"] == .8
    assert extra["O 7.5"]["ask"] is None and extra["O 8.5"]["status"] == "closed"
    assert not any("2.5" in k for k in extra) and len(parsed["extra"]) == 12   # no period markets, no unknown teams


@pytest.mark.parametrize("change", [{"slug": "nhl-stanley-cup-winner"}, {"teams": []}, {"markets": []}])
def test_non_game_or_unidentified_events_are_dropped(change):
    assert U.parse_polymarket_event(event(**change)) is None


def test_outcomes_labelled_with_a_team_alias_are_matched():
    # live shape, 2026-11-16: team name "Mammoth", alias "Utah", and every outcome says "Utah"
    e = {"id": "77", "slug": "nhl-van-utah-2026-11-16", "title": "Canucks vs. Utah",
         "teams": [{"name": "Canucks", "abbreviation": "van", "alias": "Canucks", "ordering": "away"}, {"name": "Mammoth", "abbreviation": "utah", "alias": "Utah", "ordering": "home"}],
         "markets": [gm(1, "moneyline", "", ["Canucks", "Utah"], bid=.40, ask=.41, slug="nhl-van-utah-2026-11-16"),
                     gm(2, "spreads", "", ["Utah", "Canucks"], -1.5, .30, .31, slug="nhl-van-utah-2026-11-16-spread-home-1pt5")]}
    parsed = U.parse_polymarket_event(e)
    assert (parsed["away"], parsed["home"]) == ("VAN", "UTA") and parsed["sides"]["home"]["title"] == "Utah" and parsed["sides"]["home"]["ask"] == .6
    assert [x["label"] for x in parsed["extra"]] == ["UTA -1.5", "VAN +1.5"]
    if shutil.which("node"):
        js = "const P=require(process.argv[1]);const p=P.parseEvent(JSON.parse(process.argv[2]));console.log(JSON.stringify([p.away,p.home,p.sides.home.ask,p.extra.map(x=>x.label)]))"
        assert json.loads(subprocess.check_output(["node", "-e", js, str(ROOT / "js" / "polymarket.js"), json.dumps(e)], text=True)) == ["VAN", "UTA", .6, ["UTA -1.5", "VAN +1.5"]]


def test_live_and_closed_events_are_flagged():
    assert U.parse_polymarket_event(event(live=True))["live"] is True
    assert U.parse_polymarket_event(event(closed=True))["active"] is False


def test_fetch_pages_gamma_and_never_calls_jupiter(monkeypatch):
    urls = []
    def get(url):
        urls.append(url)
        return [event()] + [{"slug": "x"}] * 99 if len(urls) == 1 else [event(id="56", slug="nhl-mon-nyr-2026-11-05", teams=[
            {"name": "Canadiens", "abbreviation": "mon"}, {"name": "Rangers", "abbreviation": "nyr"}],
            markets=[gm(1, "moneyline", "", ["Canadiens", "Rangers"], slug="nhl-mon-nyr-2026-11-05")])]
    monkeypatch.setattr(U, "_PM", None); monkeypatch.setattr(U, "pm_get", get)
    out = U.polymarket_markets()
    assert set(out) == {("2026-11-05", "BOS", "TOR"), ("2026-11-05", "MTL", "NYR")}
    assert len(urls) == 2 and all(u.startswith("https://gamma-api.polymarket.com/events?") and "tag_id=899" in u and "closed=false" in u for u in urls)
    assert "offset=100" in urls[1] and not any("jup" in u for u in urls)
    monkeypatch.setattr(U, "_PM", None); monkeypatch.setattr(U, "pm_get", lambda _: None)
    assert U.polymarket_markets() == {}


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_browser_parser_matches_python():
    e = event()
    js = "const P=require(process.argv[1]);const e=JSON.parse(process.argv[2]);const p=P.parseEvent(e);p.fetchedAt='2026-11-05T17:00:00Z';p.host=P.GAMMA;console.log(JSON.stringify(p))"
    out = json.loads(subprocess.check_output(["node", "-e", js, str(ROOT / "js" / "polymarket.js"), json.dumps(e)], text=True))
    py = json.loads(json.dumps(U.parse_polymarket_event(e, "2026-11-05T17:00:00Z")))
    out.pop("title")
    assert out == py


def test_gamma_is_fetched_with_requests(monkeypatch):
    # live failure 2026-11-16: urllib got HTTP 406 from Gamma; the requests client used by the other pipelines works
    import requests
    calls = []
    class Resp:
        def raise_for_status(self): pass
        def json(self): return []
    def get(url, headers=None, timeout=None):
        calls.append((url, headers)); return Resp()
    monkeypatch.setattr(requests, "get", get)
    monkeypatch.setattr(U.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(AssertionError("urllib must not be used for Gamma")))
    assert U.pm_get("https://gamma-api.polymarket.com/events?x=1") == []
    assert calls[0][1]["Accept"] == "application/json"
    def boom(*a, **k): raise requests.HTTPError("406")
    monkeypatch.setattr(requests, "get", boom); monkeypatch.setattr(U.time, "sleep", lambda _: None)
    assert U.pm_get("https://gamma-api.polymarket.com/events?x=1") is None
