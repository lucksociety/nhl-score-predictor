"""Read-only goal-rate challengers. Fit only earlier seasons; no market inputs.

Actual historical starters are used, an optimistic lineup-information assumption.
Poisson loss is a rate screen, not a simulation accuracy or profit backtest.
"""
import json, math, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import v4_model as M

rows = M.load_history()
out = {}
for label, changes in [('baseline', {}), ('half_life_15', {'hl':15.}),
                       ('half_life_40', {'hl':40.}), ('prior_40', {'n0':40.}),
                       ('ridge_10', {'ridge':10.})]:
    hp = {**M.HP, **changes}
    _, recs = M.run_history(rows, hp)
    periods = {}
    for season in [20242025, 20252026, 20262027]:
        train = [r for r in recs if 20222023 <= r['season'] < season]
        test = [r for r in recs if r['season'] == season]
        b = M.fit(train, hp['ridge'])
        tail = train[-1000:]
        scale = sum(r['a']+r['h'] for r in tail)/sum(sum(M.predict(r,b))for r in tail)
        losses = []
        for r in test:
            mu = [v*scale for v in M.predict(r,b)]
            loss = sum(p-y*math.log(p) for p,y in zip(mu,[r['a'],r['h']]))/2
            losses.append(loss)
        periods[str(season)] = dict(n=len(test), poisson_loss=float(np.mean(losses)), losses=losses)
    out[label] = periods
base = out['baseline']
for label,periods in out.items():
    for season,p in periods.items():
        delta=np.array(p.pop('losses'))-np.array(base[season]['losses']) if label!='baseline' else None
        if delta is not None:p.update(delta=float(delta.mean()),paired_se=float(delta.std(ddof=1)/len(delta)**.5))
for p in base.values():p.pop('losses',None)
dest=Path(__file__).with_suffix('.json');dest.write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
