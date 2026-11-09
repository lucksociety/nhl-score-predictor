import json,gzip,sys,math,hashlib
from pathlib import Path
from collections import defaultdict
import numpy as np
from scipy.optimize import minimize
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import v4_model as M
import skaters as S
import argparse
ap=argparse.ArgumentParser();ap.add_argument('--skaters',required=True);ap.add_argument('--out',required=True);args=ap.parse_args()
rows=M.load_history();_,recs=M.run_history(rows);byid={r['id']:r for r in rows};fs={r['id']:r for r in recs}
sk=json.loads(gzip.decompress(Path(args.skaters).read_bytes()));glogs=defaultdict(list)
for r in sk:
 if r['timeOnIcePerGame']>0:glogs[r['gameId']].append(r)
state=S.empty();feature={}
for date in sorted({r['date'] for r in rows if r['date']>='2024-09-01'}):
 day=[r for r in rows if r['date']==date];S.begin_season(state,int(str(day[0]['id'])[:4]))
 for r in day:
  g=glogs.get(r['id'],[]);sides={t:[p for p in g if p['teamAbbrev']==t] for t in [r['away'],r['home']]}
  if any(not 16<=len(p)<=19 for p in sides.values()):continue
  if all(t in state['teams'] for t in sides):
   feature[r['id']]=[S.feature(state,t,[p['playerId'] for p in sides[t]]) for t in [r['away'],r['home']]]
 S.advance(state,[p for r in day for p in glogs.get(r['id'],[])])
# baseline fits before each season; separate lineup feature uses only earlier game performances.
X=[];Y=[];OFF=[];labels=[];gids=[]
fitcache={}
for f in recs:
 if f['id'] not in feature or f['date']<'2025-01-01':continue
 import datetime as dt
 date=dt.date.fromisoformat(f['date']);anchor=str(date-dt.timedelta(days=date.weekday()))
 if anchor not in fitcache:
  past=[z for z in recs if z['season']>=20222023 and z['date']<anchor];coef=M.fit(past);tail=past[-1000:];cal=sum(z['a']+z['h'] for z in tail)/sum(sum(M.predict(z,coef)) for z in tail);fitcache[anchor]=(coef,cal)
 coef,cal=fitcache[anchor];mu=M.predict(f,coef);a,h=feature[f['id']]
 X.extend([[a,h],[h,a]]);Y.extend([f['a'],f['h']]);OFF.extend(np.log(np.array(mu)*cal));labels.extend([f['season']]*2);gids.extend([f['id']]*2)
X=np.array(X);Y=np.array(Y);OFF=np.array(OFF);labels=np.array(labels);gids=np.array(gids)
def fit(mask,pen):
 xx=X[mask];yy=Y[mask];off=OFF[mask]
 def obj(b):
  eta=off+xx@b;mu=np.exp(eta);return (mu-yy*eta).sum()+pen*(b*b).sum(),xx.T@(mu-yy)+2*pen*b
 return minimize(obj,np.zeros(2),jac=True).x
def metric(mask,b):
 mu=np.exp(OFF[mask]+X[mask]@b);y=Y[mask];return float(np.mean(mu-y*np.log(mu))),float(np.mean(abs(mu-y)))
train=labels==20242025;validation=(labels==20252026)&(gids<2025020400);test=(labels==20252026)&~validation
print('games',{str(se):int((labels==se).sum()/2) for se in set(labels)},flush=True)
for pen in [1,10,100,1000]:
 b=fit(train,pen);print('pen',pen,'coef',b,'validation',metric(validation,b),'baseline',metric(validation,np.zeros(2)),flush=True)
# select on early 2025 games only
pen=min([1,10,100,1000],key=lambda k:metric(validation,fit(train,k))[0]);b=fit(train|validation,pen)
print('selected',pen,'coef',b,'2025holdout',metric(test,b),'base',metric(test,np.zeros(2)),flush=True)
current=labels==20262027;b=fit(labels<20262027,pen)
print('2026coef',b,'holdout',metric(current,b),'base',metric(current,np.zeros(2)),flush=True)
# Day-cluster bootstrap of held-out Poisson score improvement, not game-winner/bet profitability.
out=[]
for name,mask,b in [('2025_later',test,fit(train|validation,pen)),('2026',current,b)]:
 mu=np.exp(OFF[mask]);new=np.exp(OFF[mask]+X[mask]@b);y=Y[mask];improvement=(mu-y*np.log(mu))-(new-y*np.log(new));groups=defaultdict(list)
 for gid,v in zip(gids[mask],improvement):groups[byid[int(gid)]['date']].append(float(v))
 rng=np.random.default_rng(20261109);vals=list(groups.values());boot=[np.mean([v for i in rng.choice(len(vals),len(vals)) for v in vals[i]]) for _ in range(2000)]
 out.append({'period':name,'coef':b.tolist(),'games':int(mask.sum()/2),'baseline_poisson_score':metric(mask,np.zeros(2))[0],'adjusted_poisson_score':metric(mask,b)[0],'day_bootstrap95_improvement':np.quantile(boot,[.025,.975]).tolist()})
print(json.dumps(out,indent=2));Path(args.out).write_text(json.dumps({'input_sha256':hashlib.sha256(Path(args.skaters).read_bytes()).hexdigest(),'penalty':pen,'results':out,'protocol':'Prior-statistics-only features; same-game participation identity known (optimistic versus expected live lineups). Outcome is full-game goals. No betting price inputs.'},indent=2))

policy={'id':'skater-context-sensitivity-v1','coefficients':fit(labels<20262027,pen).tolist(),'ridge':pen,'trainedThrough':max(byid[int(i)]['date'] for i in gids[labels<20262027]),'feature_bounds':[float(X[labels<20262027].min()),float(X[labels<20262027].max())],'note':'Small experimental point adjustment; bets must also qualify under the unadjusted baseline. Actual historical lineups are optimistic; recent-period score improvement is not statistically established.'}
Path(args.out).with_name('skater-policy.json').write_text(json.dumps(policy,indent=2)+'\n')
