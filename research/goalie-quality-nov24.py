"""Research goalie-specific xGA, avoiding team xGA assigned by shot share."""
import sys,json,zipfile,csv,io,importlib.util
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'));import v4_model as M
spec=importlib.util.spec_from_file_location('walk',ROOT/'research/walkforward-nov21.py');W=importlib.util.module_from_spec(spec);spec.loader.exec_module(W)
spec=importlib.util.spec_from_file_location('grid',ROOT/'research/uncertainty-nov23.py');U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)
rows=[{k:v for k,v in r.items()if k not in ('gxa_a','gxa_h')}for r in M.load_history()if r['date']<'2026-11-22'];data={}
for year in range(2021,2027):
 with zipfile.ZipFile(f'/tmp/nhl-goalies-{year}-nov24.zip')as z:
  name=next(n for n in z.namelist()if n.endswith('.csv'))
  for r in csv.DictReader(io.StringIO(z.read(name).decode())):
   if r['situation']=='all'and float(r['icetime'])>0:data[(int(r['gameId']),int(r['playerId']))]=[float(r['goals']),float(r['xGoals']),float(r['ongoal'])]
Old=M.State
class State(Old):
 def update(self,r):
  previous={pid:list(self.GK.get(pid,[0,0,0]))for side in ['a','h']for pid,sa,sv in(r['gsa_'+side]or[])}
  super().update(r)
  for side in ['a','h']:
   for pid,sa,sv in(r['gsa_'+side]or[]):
    entry=data.get((r['id'],pid))
    if entry and abs(entry[0]-(sa-sv))<.1 and abs(entry[2]-sa)<.1:
     self.GK[pid]=[a+b for a,b in zip(previous[pid],entry)]
base=W.walk(rows,M.HP,M.FEATS,M.FIRST_SEASON);M.State=State;new=W.walk(rows,M.HP,M.FEATS,M.FIRST_SEASON);M.State=Old
seas,b,_=U.evaluate(base,0,0);_,m,_=U.evaluate(new,0,0);out={}
for s in sorted(set(seas)):
 mask=seas==s;d=m[mask]-b[mask];out[str(s)]={'n':int(mask.sum()),'baseline':b[mask].mean(axis=0).tolist(),'candidate':m[mask].mean(axis=0).tolist(),'delta':d.mean(axis=0).tolist(),'paired_se':(d.std(axis=0,ddof=1)/sum(mask)**.5).tolist()}
# Production ingestion must match the independently researched goalie calculation.
import goalie_xga as G
G.attach(rows,data);_,production=M.run_history(rows)
M.State=State;_,reference=M.run_history([{k:v for k,v in r.items()if k not in ('gxa_a','gxa_h')}for r in rows]);M.State=Old
assert all(np.allclose(M.xrow(a,'h'),M.xrow(b,'h'),rtol=0,atol=1e-10)for a,b in zip(production,reference))
(ROOT/'research/goalie-quality-screen-nov24.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
