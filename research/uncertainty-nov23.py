"""Chronological distribution-uncertainty screen. Known starters are optimistic;
blend proxy uses only a team's previous goalie starts. Nov 22 is not a selection day.
Run grid helper first. Candidate grid fixed before reading confirmation scores.
"""
import sys,json,importlib.util,itertools,hashlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import v4_model as M
spec=importlib.util.spec_from_file_location('walk',ROOT/'research/walkforward-nov21.py');W=importlib.util.module_from_spec(spec);spec.loader.exec_module(W)

def rates(mode):
 path=ROOT/f'research/uncertainty-rates-{mode}-nov23.json'
 if path.exists():return json.loads(path.read_text())
 old=M.State.features
 if mode=='blend':
  def blind(self,date,away,home,gk_a,gk_h,prev_games=()):return old(self,date,away,home,None,None,prev_games)
  M.State.features=blind
 try:p=W.walk([r for r in M.load_history()if r['date']<'2026-11-22'],M.HP,M.FEATS,M.FIRST_SEASON)
 finally:M.State.features=old
 path.write_text(json.dumps(p));return json.loads(path.read_text())

grid=json.loads((ROOT/'research/uncertainty-grid-nov23.json').read_text());B=grid['B'];K=grid['k'];J=np.array(grid['cells']).reshape(K*K,B,B)
A,H=np.indices((B,B));pw=(J*(H>A)).sum(axis=(1,2));ma=(J*A).sum(axis=(1,2));mh=(J*H).sum(axis=(1,2))
mar=np.stack([(J*(H-A==v)).sum(axis=(1,2))for v in range(-B+1,B)],axis=1)
tot=np.stack([(J*(H+A==v)).sum(axis=(1,2))for v in range(B*2-1)],axis=1)
x,w=np.polynomial.hermite.hermgauss(3);x=x*2**.5;w=w/np.pi**.5

def evaluate(p,pace,team):
 rows=list(p.values());mu=np.array([r[:2]for r in rows])*M.SCALE;a=np.array([r[2]for r in rows]);h=np.array([r[3]for r in rows]);seas=np.array([r[4]for r in rows]);seasons=sorted(set(seas))
 indexes=list(itertools.product(range(3)if pace else[1],range(3)if team else[1],range(3)if team else[1]));weights=np.array([(w[i]if pace else 1)*(w[j]if team else 1)*(w[k]if team else 1)for i,j,k in indexes])
 factors=np.array([[np.exp(pace*x[i]-.5*pace**2+team*x[j]-.5*team**2),np.exp(pace*x[i]-.5*pace**2+team*x[k]-.5*team**2)]for i,j,k in indexes])
 q=(mu[:,None,:]*factors[None,:,:]-grid['lo'])/grid['step'];clipped=(q<0)|(q>K-1.001);q=np.clip(q,0,K-1.001);ij=np.floor(q).astype(int);frac=q-ij
 outputs=[np.zeros(len(rows))for _ in range(6)]
 for di,dj,weight in [(0,0,(1-frac[:,:,0])*(1-frac[:,:,1])),(1,0,frac[:,:,0]*(1-frac[:,:,1])),(0,1,(1-frac[:,:,0])*frac[:,:,1]),(1,1,frac[:,:,0]*frac[:,:,1])]:
  c=(ij[:,:,0]+di)*K+ij[:,:,1]+dj;wt=weight*weights
  values=[pw[c],J[c,np.minimum(a,B-1)[:,None],np.minimum(h,B-1)[:,None]],mar[c,np.clip(h-a+B-1,0,B*2-2)[:,None]],tot[c,np.minimum(a+h,B*2-2)[:,None]],ma[c],mh[c]]
  for out,val in zip(outputs,values):out+=(val*wt).sum(axis=1)
 ph,ex,pm,pt,ea,eh=outputs;y=h>a
 metrics=np.c_[-np.log(np.maximum(1e-8,np.where(y,ph,1-ph))),-np.log(np.maximum(ex,1e-8)),-np.log(np.maximum(pm,1e-8)),-np.log(np.maximum(pt,1e-8)),(ph-y)**2,(abs(ea-a)+abs(eh-h))/2,abs(ea+eh-a-h)]
 return seas,metrics,float(clipped.any(axis=2).mean())

def main():
 report={'history_sha256':hashlib.sha256(Path(M.HIST).read_bytes()).hexdigest(),'grid_sha256':hashlib.sha256((ROOT/'research/uncertainty-grid-nov23.json').read_bytes()).hexdigest(),'grid':{k:grid[k]for k in ['lo','step','k','n','B']},'selection':'2023-24 and 2024-25 only; confirmation 2025-26 and 2026-27 through Nov21','metrics':['winner_log_loss','exact_score_log_loss','margin_log_loss','total_log_loss','brier','team_mae','total_mae'],'modes':{}}
 for mode in ['named','blend']:
  p=rates(mode);candidates=[]
  for pace,team in itertools.product([0.,.10,.20],[0.,.10,.20]):
   seasons,m,clip=evaluate(p,pace,team);dev=seasons<20252026
   candidates.append((m[dev,1].mean(),pace,team,m,clip))
  _,pace,team,chosen,clip=min(candidates,key=lambda v:v[0]);base=candidates[0][3]
  out={'selected':dict(pace_sigma=pace,team_sigma=team),'development_candidates':[dict(pace_sigma=p,team_sigma=t,exact_score_log_loss=float(v))for v,p,t,_,_ in candidates],'clipped_fraction':clip,'periods':{}}
  for season in sorted(set(seasons)):
   mask=seasons==season;d=chosen[mask]-base[mask];out['periods'][str(season)]={'n':int(mask.sum()),'baseline':base[mask].mean(axis=0).tolist(),'candidate':chosen[mask].mean(axis=0).tolist(),'delta':d.mean(axis=0).tolist(),'paired_se':(d.std(axis=0,ddof=1)/sum(mask)**.5).tolist()}
  report['modes'][mode]=out;print(mode,out['selected'],out['periods'],flush=True)
 (ROOT/'research/uncertainty-screen-nov23.json').write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main()
