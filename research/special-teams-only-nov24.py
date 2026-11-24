"""Prior-only special-teams features from MoneyPuck's official listed team-game CSV.
Selection 2023–25, confirmation 2025–27 through Nov21. Actual starters are optimistic.
"""
import sys,json,csv,importlib.util,hashlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'));import v4_model as M
spec=importlib.util.spec_from_file_location('walk',ROOT/'research/walkforward-nov21.py');W=importlib.util.module_from_spec(spec);spec.loader.exec_module(W)
spec=importlib.util.spec_from_file_location('grid',ROOT/'research/uncertainty-nov23.py');U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)
rows=[{k:v for k,v in r.items()if k not in ('gxa_a','gxa_h')}for r in M.load_history()if r['date']<'2026-11-22'];wanted={r['id']for r in rows};source=Path('/tmp/nhl-all-teams-nov24.csv');detail={}
for x in csv.DictReader(source.open()):
 gid=int(x['gameId'])
 if gid not in wanted or x['situation']not in ['5on5','5on4','4on5']:continue
 side='a'if x['home_or_away']=='AWAY'else'h';d=detail.setdefault(gid,{}).setdefault(side,{})
 d[x['situation']]=[float(x['iceTime']),float(x['scoreVenueAdjustedxGoalsFor']),float(x['scoreVenueAdjustedxGoalsAgainst'])]
OriginalState=M.State;original_xrow=M.xrow;original_feats=list(M.FEATS)
EXTRA=['pp_attack','pk_defense','pp_opportunities','pk_opportunities']

def variant(prior):
 class State(OriginalState):
  def __init__(self,hp=M.HP):super().__init__(hp);self.special={};self.special_league=np.zeros((3,4))
  def new_season(self,se):
   if self.season is not None and self.season!=se:
    for value in self.special.values():value*=.3
   super().new_season(se)
  def features(self,*args,**kwargs):
   f=super().features(*args,**kwargs)
   for side,team in [('a',args[1]),('h',args[2])]:
    t=self.special.get(M.SAME.get(team,team),np.zeros((3,4)));lg=self.special_league
    for k,sit in enumerate(['ev','pp','pk']):
     # columns: exposure seconds, xGF, xGA, games; 40/80 pseudo games of league opportunities.
     league_seconds=lg[k,0]/max(1,lg[k,3]);league_f=lg[k,1]/max(1,lg[k,0]);league_a=lg[k,2]/max(1,lg[k,0]);pseudo=prior*league_seconds
     f[side+'_'+sit+'_f']=(t[k,1]+pseudo*league_f)/max(1,t[k,0]+pseudo)/max(1e-6,league_f)if lg[k,0]else 1.
     f[side+'_'+sit+'_a']=(t[k,2]+pseudo*league_a)/max(1,t[k,0]+pseudo)/max(1e-6,league_a)if lg[k,0]else 1.
     f[side+'_'+sit+'_time']=(t[k,0]+prior*league_seconds)/(t[k,3]+prior)/max(1,league_seconds)if lg[k,0]else 1.
   return f
  def update(self,r):
   super().update(r)
   for side in ['a','h']:
    d=detail.get(r['id'],{}).get(side,{})
    if not all(k in d for k in ['5on5','5on4','4on5']):continue
    team=M.SAME.get(r['away'if side=='a'else'home'],r['away'if side=='a'else'home']);t=self.special.setdefault(team,np.zeros((3,4)));t*=.5**(1/25)
    vals=np.array([d[k]+[1.]for k in ['5on5','5on4','4on5']]);t+=vals;self.special_league+=vals
 def xrow(f,side):
  other='h'if side=='a'else'a'
  return original_xrow(f,side)+[np.log(f[side+'_pp_f']),np.log(f[other+'_pk_a']),np.log(f[side+'_pp_time']),np.log(f[other+'_pk_time'])]
 M.State=State;M.xrow=xrow;M.FEATS=original_feats+EXTRA
 return W.walk(rows,M.HP,M.FEATS,M.FIRST_SEASON)

baseline=W.walk(rows,M.HP,M.FEATS,M.FIRST_SEASON);seas,b,_=U.evaluate(baseline,0,0);out={'source':'https://moneypuck.com/moneypuck/playerData/careers/gameByGame/all_teams.csv','history_sha256':hashlib.sha256(Path(M.HIST).read_bytes()).hexdigest(),'coverage_games':len(detail),'baseline':{},'candidates':[]}
for prior in [20.,40.,80.]:
 p=variant(prior);ss,m,clip=U.evaluate(p,0,0);assert list(p)==list(baseline);dev=ss<20252026
 result={'prior_games':prior,'development_exact_score_log_loss':float(m[dev,1].mean()),'periods':{}}
 for season in sorted(set(ss)):
  mask=ss==season;delta=m[mask]-b[mask];result['periods'][str(season)]={'n':int(mask.sum()),'baseline':b[mask].mean(axis=0).tolist(),'candidate':m[mask].mean(axis=0).tolist(),'delta':delta.mean(axis=0).tolist(),'paired_se':(delta.std(axis=0,ddof=1)/sum(mask)**.5).tolist()}
 out['candidates'].append(result);(ROOT/f'research/special-teams-only-rates-{int(prior)}-nov24.json').write_text(json.dumps(p));print(prior,result,flush=True)
 M.State=OriginalState;M.xrow=original_xrow;M.FEATS=original_feats
out['baseline_development_exact_score_log_loss']=float(b[seas<20252026,1].mean());(ROOT/'research/special-teams-only-screen-nov24.json').write_text(json.dumps(out,indent=2)+'\n')
