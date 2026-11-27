"""Chronological goalie-recency screen; no market inputs or November 22+ outcomes.

Select among fixed 30/60-start half-lives on 2023-25 exact-score log loss;
confirm on 2025-26 and separately diagnose 2026-27 through Nov21. The prior
goalie-quality studies already inspected these periods: this is exploratory.
Actual historical starters are optimistic relative to a morning scan.
"""
import hashlib, importlib.util, json, sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import v4_model as M
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
W=module('walk',ROOT/'research/walkforward-nov21.py')
U=module('uncertainty',ROOT/'research/uncertainty-nov23.py')
Old=M.State
rows=[r for r in M.load_history() if r['date']<'2026-11-22']
out={'history_sha256':hashlib.sha256(Path(M.HIST).read_bytes()).hexdigest(),
     'cutoff':'2026-11-21','candidates':{},'metric_order':['winner_log_loss','exact_score_log_loss','margin_log_loss','total_log_loss','brier','team_mae','total_mae']}
all_metrics={}
for half_life in [None,30.,60.]:
    class Recent(Old):
        def update(self,r):
            # Decay only past appearances, once per goalie appearance; then ingest
            # the same identity-validated specific xGA or fallback observation.
            if half_life:
                decay=.5**(1/half_life)
                for side in ['a','h']:
                    for pid,sa,sv in r['gsa_'+side] or []:
                        if pid in self.GK:self.GK[pid]=[v*decay for v in self.GK[pid]]
            super().update(r)
    M.State=Recent
    try: rates=W.walk(rows,M.HP,M.FEATS,M.FIRST_SEASON)
    finally: M.State=Old
    seasons,metrics,clipped=U.evaluate(rates,0,0)
    label='baseline' if half_life is None else 'hl'+str(int(half_life))
    all_metrics[label]=metrics
    (ROOT/f'research/goalie-recency-rates-{label}-nov27.json').write_text(json.dumps(rates))
    periods={}
    for s in sorted(set(seasons)):
        mask=seasons==s;d=metrics[mask]-all_metrics['baseline'][mask]
        periods[str(s)]={'n':int(mask.sum()),'metrics':metrics[mask].mean(axis=0).tolist(),
                         'delta':d.mean(axis=0).tolist(),'paired_se':(d.std(axis=0,ddof=1)/sum(mask)**.5).tolist()}
    out['candidates'][label]={'half_life_starts':half_life,'clipped_fraction':clipped,'periods':periods}
    print(label,periods,flush=True)
dev=seasons<20252026
chosen=min(all_metrics,key=lambda k:all_metrics[k][dev,1].mean())
confirmation=seasons==20252026
d=all_metrics[chosen][confirmation]-all_metrics['baseline'][confirmation]
out['selected']=chosen
out['confirmation_delta']=d.mean(axis=0).tolist()
out['confirmation_paired_se']=(d.std(axis=0,ddof=1)/sum(confirmation)**.5).tolist()
out['promote']=bool(chosen!='baseline' and d[:,1].mean()<-1.96*d[:,1].std(ddof=1)/sum(confirmation)**.5 and d[:,0].mean()<=0 and d[:,3].mean()<=0)
(ROOT/'research/goalie-recency-screen-nov27.json').write_text(json.dumps(out,indent=2)+'\n')
print('SELECTED',chosen,'PROMOTE',out['promote'],flush=True)
