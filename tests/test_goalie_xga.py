import csv,gzip,io,json,sys,zipfile
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import goalie_xga as G,v4_model as M

def archive(rows):
 text=io.StringIO();w=csv.DictWriter(text,['gameId','playerId','situation','icetime','goals','xGoals','ongoal']);w.writeheader();w.writerows(rows)
 data=io.BytesIO()
 with zipfile.ZipFile(data,'w')as z:z.writestr('goalies.csv',text.getvalue())
 return data.getvalue()
def item(**kw):return dict(gameId=2026020001,playerId=123,situation='all',icetime=3600,goals=2,xGoals=2.4,ongoal=30,**kw)
def game(gid=2026020001,date='2026-10-01'):
 return dict(id=gid,date=date,season=20262027,away='BOS',home='TOR',a=2,h=4,per='REG',sog_a=30,sog_h=30,gk_a=123,gkn_a='A. Goalie',gk_h=456,gkn_h='B. Goalie',gsa_a=[[123,30,28]],gsa_h=[[456,30,28]],g_a=2.,g_h=4.,xg_a=3.,xg_h=8.)
def test_parse_validated_identity_and_situation_and_cache_roundtrip(tmp_path):
 good=item();data=G.parse(archive([good,{**good,'situation':'other'}]),2026)
 assert data=={(2026020001,123):[2.,2.4,30.]}
 with pytest.raises(ValueError):G.parse(archive([good,good]),2026)
 with pytest.raises(ValueError):G.parse(archive([{**good,'xGoals':'nan'}]),2026)
 with pytest.raises(ValueError):G.parse(archive([good]),2025)
 path=tmp_path/'goalie_xga.csv.gz';G.save(path,data);assert G.load(path)==data
 r=game();G.attach([r],data);assert r['gxa_a']==[[123,2.,2.4,30.]]
 r['gsa_a']=[[123,29,27]];G.attach([r],data);assert 'gxa_a'not in r

def test_actual_goalie_xga_replaces_team_share_and_other_side_falls_back():
 r=game();r['gxa_a']=[[123,2.,2.4,30.]];s=M.State();s.update(r)
 assert s.GK[123]==[2.,2.4,30.]
 assert s.GK[456]==[2.,3.,30.]
 assert s.goalie_quality_counts=={'specific_xga':1,'team_shot_proxy':1}
 r['gxa_a']=[[123,2.,2.4,99.]];t=M.State();t.update(r);assert t.GK[123][1]==8.

def test_same_day_and_future_goalie_values_do_not_enter_features():
 rows=[game(2026020001,'2026-10-01'),game(2026020002,'2026-10-01'),game(2026020003,'2026-10-02')]
 G.attach(rows,{(r['id'],123):[2.,2.4,30.]for r in rows});_,before=M.run_history(rows)
 rows[1]['gxa_a'][0][2]=9.;_,after=M.run_history(rows)
 assert M.xrow(before[0],'h')==M.xrow(after[0],'h')
 assert M.xrow(before[1],'h')==M.xrow(after[1],'h')
 assert before[2]['a_gq']!=after[2]['a_gq']

def test_failed_refresh_preserves_cache_and_keeps_older_data(tmp_path):
 path=tmp_path/'goalie_xga.csv.gz';data={(2026020001,123):[2.,2.4,30.]};G.save(path,data)
 rows=G.refresh([game()],tmp_path,lambda *a,**kw:b'invalid zip',now=1)
 assert G.load(path)==data and rows[0]['gxa_a'][0][2]==2.4
 assert json.loads((tmp_path/'goalie_xga_meta.json').read_text())['years']=={}
