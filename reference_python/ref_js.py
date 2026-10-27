import json, sys, numpy as np
from tonight import *
from specs26 import S1,S2,S3
out=[]
for sp in (S1,S2,S3):
    for seed in (11,12):
        r,info=run_game(sp,n=800_000,seed=seed)
        o=report(sp,r,info,sp['away'],sp['home'])
        x,y,p,pot=o['argmin']
        out.append(dict(away=sp['away'],home=sp['home'],seed=seed,pick=[x,y],p_pick=p,pot_pick=pot,ot_label=pot>=0.55,
            p_ot=float(o['ext']['ot']),p_home=float(o['ext']['p_home']),ea=float(o['ea']),eh=float(o['eh']),
            rates=list(map(float,info['blend'])),fit=[float(info['mkt']['scale']),float(info['mkt']['tilt'])],
            top5=[[a,b,float(pp),float(po)] for a,b,pp,po in o['top'][:5]],err_pick=o['err'][(x,y)]))
        print(out[-1],flush=True)
json.dump(out,open('/workspace/nhl-score-predictor/tests/python_ref_2026-10-26.json','w'),indent=1)
