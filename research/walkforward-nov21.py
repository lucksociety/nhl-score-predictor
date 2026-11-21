"""Walk-forward test behind v4.1 (research/REVIEW-2026-11-21.md). No market inputs.

Every game from October 2023 is forecast by a regression fitted only on games before the start of its 30-day block,
with ratings built only from earlier days. The real result is then scored under the production simulator.
Compares v4 (one rating speed, fitted from 2022-23, old simulator) with v4.1 (two speeds, fitted from 2021-22,
goalie-pull fix). Historical starting goalies are the actual starters, which is kinder than a live morning forecast.

    python research/walkforward-nov21.py            # about 3 minutes; writes research/walkforward-nov21.json
"""
import datetime as dt, json, subprocess, sys
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import v4_model as M

def walk(rows, hp, cols, first_season, step=30, start='2023-10-01'):
    _, recs = M.run_history(rows, hp)
    keep = [M.FEATS.index(c) for c in cols]
    XA = np.array([M.xrow(f, 'a') for f in recs])[:, keep]; XH = np.array([M.xrow(f, 'h') for f in recs])[:, keep]
    a = np.array([f['a'] for f in recs], float); h = np.array([f['h'] for f in recs], float)
    off = np.log([f['lg_gf'] for f in recs]); dates = np.array([f['date'] for f in recs]); seas = np.array([f['season'] for f in recs])
    from scipy.optimize import minimize
    def fit(X, y, o):
        X1 = np.c_[np.ones(len(X)), X]
        def obj(b):
            eta = o + X1 @ b; mu = np.exp(eta)
            return (mu - y * eta).sum() + hp['ridge'] * (b[1:] ** 2).sum(), X1.T @ (mu - y) + 2 * hp['ridge'] * np.r_[0, b[1:]]
        return minimize(obj, np.zeros(X1.shape[1]), jac=True, method='L-BFGS-B', options=dict(maxiter=500)).x
    out = {}; d = dt.date.fromisoformat(start); last = dt.date.fromisoformat(dates[-1])
    while d <= last:
        nxt = d + dt.timedelta(days=step); tr = (dates < str(d)) & (seas >= first_season); te = (dates >= str(d)) & (dates < str(nxt))
        if te.any():
            b = fit(np.r_[XA[tr], XH[tr]], np.r_[a[tr], h[tr]], np.r_[off[tr], off[tr]])
            ma = np.exp(off + b[0] + XA @ b[1:]); mh = np.exp(off + b[0] + XH @ b[1:])
            tail = np.where(tr)[0][-1000:]; cal = (a[tail] + h[tail]).sum() / (ma[tail] + mh[tail]).sum()   # same scoring-level step as production
            for i in np.where(te)[0]: out[recs[i]['id']] = (float(ma[i] * cal), float(mh[i] * cal), int(a[i]), int(h[i]), int(seas[i]))
        d = nxt
    return out

def simulate(pred, sim, scale, n=150000):
    games = [list(v[:4]) for v in pred.values()]
    o = subprocess.run(['node', str(ROOT / 'research' / 'score-distribution-nov21.js')], capture_output=True, text=True,
                       input=json.dumps(dict(P=sim, scale=scale, n=n, games=games, lo=1.3, st=0.25, k=15)))
    if o.returncode: raise RuntimeError(o.stderr[-800:])
    return {k: -np.array(v) for k, v in json.loads(o.stdout).items() if k in ('win', 'ex', 'mar', 'tot')}

def main():
    rows = M.load_history()
    slow = [c for c in M.FEATS if not c.endswith('_f')]
    v4 = walk(rows, {**M.HP, 'hl': 25.0}, slow, 20222023)          # the single 25-game rating v4 used
    v41 = walk(rows, M.HP, M.FEATS, M.FIRST_SEASON)
    assert list(v4) == list(v41)
    seas = np.array([v[4] for v in v4.values()])
    runs = {'v4': simulate(v4, {}, 0.887), 'v4.1 ratings, v4 simulator': simulate(v41, {}, 0.887), 'v4.1': simulate(v41, M.SIM, M.SCALE)}
    names = dict(win='winner_log_loss', ex='exact_score_log_loss', mar='margin_log_loss', tot='total_goals_log_loss')
    report = dict(games=len(seas), first=min(r['date'] for r in rows if r['id'] in v4), last=max(r['date'] for r in rows if r['id'] in v4), models={})
    for label, r in runs.items():
        m = {}
        for k, nm in names.items():
            d = r[k] - runs['v4'][k]
            m[nm] = dict(value=round(float(r[k].mean()), 5), change_vs_v4=round(float(d.mean()), 5), paired_se=round(float(d.std(ddof=1) / len(d) ** .5), 5),
                         change_by_season={str(s): round(float(d[seas == s].mean()), 5) for s in sorted(set(seas))})
        report['models'][label] = m
    (ROOT / 'research' / 'walkforward-nov21.json').write_text(json.dumps(report, indent=1) + '\n')
    for label, m in report['models'].items():
        print(label, {k: (v['value'], v['change_vs_v4'], v['paired_se']) for k, v in m.items()})

if __name__ == '__main__':
    main()
