import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import availability as A

def test_current_injury_supersedes_goalie_and_blocks_unmodeled_skater_change():
    def row(name,pos):return {'athlete':{'displayName':name,'team':{'abbreviation':'NJ'},'position':{'abbreviation':pos}},'status':'Out','date':'2026-11-07T18:00Z'}
    body={'injuries':[{'injuries':[row('Goalie One','G'),row('New Scratch','C')]}]}
    calls=[]
    def get(url):
        calls.append(url)
        return body if url.endswith('/injuries') else {'forwards':[],'defensemen':[],'goalies':[]}
    g={'away':'NJD','home':'SEA','goalies':{'away':{'name':'Goalie One'},'home':None},'v4':{'trainedThrough':'2026-11-06'}}
    slates=[{'games':[g]}]
    A.refresh(slates,get);A.finalize(slates)
    assert g['goalies']['away'] is None
    assert 'New Scratch' in g['availability']['blockReason'] and 'goalie' in g['availability']['blockReason']
    A.refresh(slates,get)
    assert sum(u.endswith('/injuries') for u in calls)==2

def test_feed_failure_is_not_a_clean_availability_check():
    g={'away':'A','home':'B','goalies':{}};ss=[{'games':[g]}]
    A.refresh(ss,lambda u:None);A.finalize(ss)
    assert 'unavailable' in g['availability']['blockReason']
