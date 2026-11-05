import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import update_data as U


def test_each_contract_keeps_its_own_settlement_evidence(monkeypatch):
    rules = "Final score including overtime and shootout; one goal will be added to the winner."
    def market(kind, mid, team=None, period=None, text=rules):
        return {
            "marketId": mid, "sportsMarketType": kind, "periodType": period,
            "team": {"abbreviation": team} if team else None,
            "marketOptions": [{"label": "O 5.5"}], "status": "open",
            "rulesPrimary": text, "pricing": {"buyYesPriceUsd": 500000, "sellYesPriceUsd": 490000, "volume": 100},
        }
    body = {"data": [{"eventId": "POLY-1", "metadata": {"slug": "nhl-bos-tor-2026-11-05"},
                     "markets": [market("moneyline", "ML", "BOS"),
                                 market("totals", "FULL"),
                                 market("totals", "REG", text="Regulation score only"),
                                 market("totals", "PERIOD", period="1st")]}]}
    monkeypatch.setattr(U, "_JUP", None)
    monkeypatch.setattr(U, "get", lambda _: body)
    parsed = U.jupiter_markets()[("2026-11-05", "BOS", "TOR")]
    assert parsed["sides"]["away"]["includesOTSO"] is True
    extra = {m["marketId"]: m for m in parsed["extra"]}
    assert extra["FULL"]["includesOTSO"] is True
    assert extra["REG"]["includesOTSO"] is False
    assert "PERIOD" not in extra
