"""Real player IDs take precedence over stale abbreviated history."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import v4_update as U
import v4_model as M
import availability

class State:
    gkname={1:'M. Murray',2:'M. Murray',3:'C. Talbot'}
    teamgk={'TOR':{1:1,2:2},'DET':{3:1}}
    GK={1:[10,10,5000],2:[10,10,100],3:[10,10,100]}

def test_current_full_name_resolves_same_initial_and_surname():
    roster=[dict(id=1,position='G',name='Matt Murray'),dict(id=2,position='G',name='Matthew Murray')]
    assert U.match_goalie(State(),'TOR','Matthew Murray',roster)==2
    assert U.match_goalie(State(),'TOR','Matt Murray',roster)==1
    assert U.match_goalie(State(),'TOR','M. Murray',roster) is None
    assert U.match_goalie(State(),'TOR','M. Murray') is None

def test_current_roster_overrides_old_team_history_and_excludes_skaters():
    roster=[dict(id=2,position='G',name='Matt Murray'),dict(id=1,position='C',name='Matt Murray')]
    assert U.match_goalie(State(),'TOR','Matt Murray',roster)==2
    assert U.match_goalie(State(),'DET','Cam Talbot',roster) is None
    assert U.match_goalie(State(),'DET','Cam Talbot',[]) is None
    assert U.match_goalie(State(),'TOR','Matthew Murray',[dict(id=1,position='G',name='Matt Murray')]) is None

def test_new_goalie_keeps_identity_and_gets_league_prior_not_old_team_blend():
    pid=9999999
    roster=[dict(id=pid,position='G',name='New Goalie')]
    assert U.match_goalie(State(),'TOR','New Goalie',roster)==pid
    s=M.State(); f=s.features('2026-11-27','TOR','DET',pid,None)
    assert f['a_gkmode']=='new' and f['a_gq']==0

def test_accent_normalization_and_unique_abbreviated_name():
    roster=[dict(id=5,position='G',name='Samuel Ersson'),dict(id=6,position='G',name='Petr Mrázek')]
    assert U.match_goalie(State(),'PHI','Petr Mrazek',roster)==6
    assert U.match_goalie(State(),'PHI','S. Ersson',roster)==5

def test_conflicting_confirmed_starter_keeps_forecast_but_blocks_bet():
    game=dict(away='TOR',home='DET',goalies={'away':dict(name='M. Murray',status='Confirmed')},
              availability={'sides':{'away':{'roster':[dict(id=1,position='G',name='Matt Murray'),dict(id=2,position='G',name='Matthew Murray')]}}})
    names,ids=U.resolve_goalies(State(),game)
    assert names['away']=='M. Murray' and ids['away'] is None
    U.resolve_goalies(State(),game)
    assert len(game['availability']['problems'])==1
    game['v4']={'trainedThrough':'2026-11-26'}
    availability.finalize([{'games':[game]}])
    assert 'cannot be uniquely matched' in game['availability']['blockReason']

def test_roster_absence_has_unique_historical_fallback_and_no_invented_name():
    assert U.match_goalie(State(),'DET','Cam Talbot')==3
    game={'away':'TOR','home':'DET'}
    names,ids=U.resolve_goalies(State(),game)
    assert ids=={'away':None,'home':None}
    assert not game['availability'].get('problems')
