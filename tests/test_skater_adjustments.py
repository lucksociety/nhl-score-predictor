import copy,json,sys
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import skaters as S
import availability as A

def fixture():
    state=S.empty();state.update(through='2026-11-08',season=2026)
    state['league']={'F':[30.,100.],'D':[20.,100.]}
    sides={}
    for team,offset in [('AAA',0),('BBB',100)]:
        roster=[];freq={}
        for i in range(20):
            pid=str(offset+i+1);pos='F' if i<14 else 'D';name=team+' Player '+str(i)
            state['players'][pid]={'w':10.,'gc':12. if i==0 else 2.,'toi':12000.-i*100,'pos':pos,'name':name,'team':team,'last':'2026-11-08'}
            roster.append({'id':int(pid),'name':name,'position':'C' if pos=='F' else 'D'})
            if i<12 or i>=14:freq[pid]=10.
        state['teams'][team]={'w':10.,'players':freq}
        sides[team]={'roster':roster,'injuries':[]}
    g={'away':'AAA','home':'BBB','state':'FUT','v4':{'la':3.,'lh':3.,'ra':2.661,'rh':2.661,'trainedThrough':'2026-11-08'},'availability':{'problems':[],'sides':{'away':sides['AAA'],'home':sides['BBB']}}}
    return state,g

def test_known_absence_changes_rates_and_replacement_not_a_fixed_penalty():
    state,g=fixture();g['availability']['sides']['away']['injuries']=[{'name':'AAA Player 0','position':'C','status':'Out','updatedAt':'2026-11-09'}]
    S.apply_game(g,state,'2026-11-09')
    assert g['v4']['la']<3. and g['v4']['lh']>3.
    chosen=g['v4']['skaterAdjustment']['sides']['away']['players']
    assert len(chosen)==18 and not any(x['name']=='AAA Player 0' for x in chosen)
    assert any(x['name']=='AAA Player 12' for x in chosen)
    assert g['v4']['skaterAdjustment']['scenarios'][0]['rates']==[2.661,2.661]
    g['availability']['skaterModelStatus']='adjusted';A.finalize([{'games':[g]}])
    assert g['availability']['blockReason'] is None
    with pytest.raises(ValueError,match='already applied'):S.apply_game(g,state,'2026-11-09')

def test_revised_injury_date_does_not_create_a_second_penalty():
    state,g=fixture();t=state['teams']['AAA'];t['players'].pop('1');t['players']['13']=10.
    g['availability']['sides']['away']['injuries']=[{'name':'AAA Player 0','position':'C','status':'Out','updatedAt':'2026-10-10'}]
    other=copy.deepcopy(g);other['availability']['sides']['away']['injuries'][0]['updatedAt']='2026-11-09'
    S.apply_game(g,state,'2026-11-09');S.apply_game(other,state,'2026-11-09')
    assert g['v4']['la']==other['v4']['la']==3.
    assert g['v4']['skaterAdjustment']['sides']['away']['absences'][0]['baselineParticipation']==0

def test_unknown_history_future_context_and_source_errors_fail_closed():
    state,g=fixture();state['through']='2026-11-09'
    with pytest.raises(ValueError,match='strictly pregame'):S.apply_game(g,state,'2026-11-09')
    state['through']='2026-11-08';g['availability']['sides']['away']['roster'][0]['name']='Unknown Star'
    g['availability']['sides']['away']['injuries']=[{'name':'Unknown Star','position':'C','status':'Out'}]
    with pytest.raises(ValueError,match='uniquely'):S.apply_game(g,state,'2026-11-09')
    g['availability']['skaterModelStatus']='unavailable';g['availability']['skaterModelReason']='live logs unavailable'
    A.finalize([{'games':[g]}]);assert 'unavailable' in g['availability']['blockReason']
    with pytest.raises(ValueError,match='incomplete'):S.fetch_recent(state,[],'2026-11-09',lambda u:{'data':[],'total':1})

def test_frozen_forecast_is_not_rewritten_and_feed_problem_not_cleared():
    state,g=fixture();g['v4']['frozen']=True;before=copy.deepcopy(g);S.apply_game(g,state,'2026-11-09');assert before==g
    g['availability'].update(skaterModelStatus='adjusted',problems=['live injury feed unavailable'])
    A.finalize([{'games':[g]}]);assert 'live injury' in g['availability']['blockReason']

def test_questionable_players_get_out_scenario_and_research_policy_is_fixed():
    state,g=fixture();g['availability']['sides']['away']['injuries']=[{'name':'AAA Player 0','position':'C','status':'Questionable'}]
    S.apply_game(g,state,'2026-11-09')
    scenarios=g['v4']['skaterAdjustment']['scenarios'];assert len(scenarios)==2 and 'OUT' in scenarios[1]['label']
    assert scenarios[1]['rates'][0]<g['v4']['ra']
    policy=json.loads((Path(__file__).parents[1]/'research/skater-policy.json').read_text())
    assert policy['trainedThrough']<'2026-09-01'


def test_eleven_forwards_seven_defensemen_is_a_supported_expected_lineup():
    state,g=fixture();side=g['availability']['sides']['away']
    # Three forwards are unavailable; add a seventh rated defenseman.
    side['injuries']=[{'name':'AAA Player '+str(i),'position':'C','status':'Out'} for i in [11,12,13]]
    state['players']['90']={'w':10.,'gc':2.,'toi':10000.,'pos':'D','name':'Seventh Defender','team':'AAA','last':'2026-11-08'}
    side['roster'].append({'id':90,'name':'Seventh Defender','position':'D'})
    S.apply_game(g,state,'2026-11-09')
    chosen=g['v4']['skaterAdjustment']['sides']['away']['players']
    assert len(chosen)==18 and sum(p['position']=='D' for p in chosen)==7
    assert sum(p['position']!='D' for p in chosen)==11
    side['roster']=[p for p in side['roster'] if p['id']!=90]
    with pytest.raises(ValueError,match='insufficient'):
        S.expected_lineup(state,'AAA',side['roster'],side['injuries'])


def test_verified_rookie_uses_zero_centered_prior_and_empirical_scenarios():
    state,g=fixture()
    # A new defender is required for the legal formation, while the other five have NHL history.
    side=g['availability']['sides']['away'];side['roster']=[p for p in side['roster']if p['id']!=20]
    side['roster'].append({'id':999,'name':'Verified Rookie','position':'D'})
    for i in range(30):
        state['players'][str(1000+i)]={'w':20.,'gc':3.0+.08*i,'toi':20000.,'pos':'D','name':'Historical D '+str(i),'team':'OTHER','last':'2026-11-08'}
    S.apply_game(g,state,'2026-11-09')
    a=g['v4']['skaterAdjustment'];rookies=a['priorOnlyPlayers']['away']
    assert rookies==[{'id':999,'name':'Verified Rookie','position':'D','productionAbovePositionMean':0.}]
    assert len(a['scenarios'])==3
    assert a['scenarios'][0]['label']=='unadjusted team baseline'
    assert any('rookie-prior'in x['label']for x in a['scenarios'])
    assert S.quality(state,999)==0.


def test_rookie_without_positional_uncertainty_evidence_still_blocks():
    state,g=fixture();side=g['availability']['sides']['away']
    side['roster']=[p for p in side['roster']if p['id']!=20]+[{'id':999,'name':'Rookie','position':'D'}]
    with pytest.raises(ValueError,match='position-history'):S.apply_game(g,state,'2026-11-09')
