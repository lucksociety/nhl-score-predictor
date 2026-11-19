import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import v4_update as U


class State:
    GK = {1: [10, 20, 100], 2: [20, 20, 100]}
    def gq(self, pid):
        return {1: -.2, 2: .1}.get(pid, 0.)


def test_goalie_candidates_use_available_current_roster_ids():
    g = {'goalies': {'home': {'name': 'First Goalie', 'status': 'Expected'}},
         'availability': {'sides': {'home': {
             'roster': [{'id':1, 'position':'G', 'name':'First Goalie'},
                        {'id':2, 'position':'G', 'name':'Second Goalie'},
                        {'id':3, 'position':'G', 'name':'Rookie Goalie'},
                        {'id':4, 'position':'D', 'name':'Skater'}],
             'injuries':[{'name':'Second Goalie', 'status':'Injured Reserve'}]}}}}
    candidates = U.goalie_candidates(State(), g, 'home')
    assert [x['id'] for x in candidates] == [1, 3]
    assert candidates[1]['gq'] == 0.
    assert candidates[1]['mode'] == 'league-prior'
    g['goalies']['home']['status'] = 'Confirmed'
    assert U.goalie_candidates(State(), g, 'home') == []
    assert U.goalie_candidates(State(), g, 'away') == []
