#!/usr/bin/env python3
"""
sim_v2.py - NHL score-contest simulator, v2 (2026-09-30).

Goal: choose the submitted (away, home) final score that minimises E[|predA-actA| + |predH-actH|], where the
recorded final score gives the OT/SO winner +1 goal and the contest now forbids tied submissions.

What changed vs v1 (see backtest_v2.md for numbers):
  * Dispersion fixed.  v1 used gamma tempo(shape 60) x team gamma(shape 22) -> Var(total)=6.8 vs 5.3 in 2023-26 NHL
    games (too many 0-2 and 9+ goal games, P(total<=3) 16.7% vs 13.3%).  v2 uses pure Poisson-in-state with
    score effects; heterogeneity between games comes only from the team-strength rates (Var(total)=5.7).
  * Score effects now apply all game (trailing teams ~+0% early, leaders -5% rates), + late-game trailing boost
    (+20% in last 20 min) and a goalie-pull/empty-net module in the last 3 min (pull mult 2.5x, EN goal 0.35/min).
    Result: reg-tie/OT rate 21.8% (empirical 22.1%), empty-net share of goals ~6% (empirical 6.6%, n=300 games).
  * Team ratings: last-season goals for/against (from api-web.nhle.com results in data/games.json) shrunk 50% to league,
    exponent 0.8 on the multiplicative matchup, in-season Bayesian update with prior weight n0=60 games.
    (Fit by Poisson log-likelihood on 2022-23..2025-26 games; all tuned with prior seasons only.)
  * Market blend is done on the SAME scale as the sim (final-score convention); ML = P(home wins incl OT/SO),
    total = P(over) on a betting total (SO goal excluded), default blend weight 0.6 (judgment; no free odds history).
  * Submission: argmin over 0..8 x 0..8 with the diagonal removed ("official", no ties) + OT label.

Usage examples
  python3 sim_v2.py --away PIT --home PHI --total 6.0 --over -110 --under -110 --ml-away 105 --ml-home -125
  python3 sim_v2.py --away LAK --home COL --sv-away .895 --sv-home .905 --results data/results_2026_27.csv
  python3 sim_v2.py --spec games.json      # list of dicts with the same keys (away, home, total, over, under, ml_away, ...)
Only --away/--home are required; without market inputs the ratings model alone is used.
All multipliers / goalie priors are JUDGMENT inputs, off by default (1.0 / league-average).
"""
import argparse, json, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
# ---------------------------------------------------------------- simulator parameters (fit in fit3.py / bt.py)
PARAMS = dict(st=0.0, sl=-0.05, st_late=0.2, pull_mult=2.5, en_rate=0.35, ot_goal_p=0.65, ot_tilt=0.6, so_tilt=0.3)
LG_A, LG_H = 2.979, 3.207      # 2023-26 mean goals (away, home), final-score convention
SCALE = 0.887                  # regulation-rate scale so sim mean total (incl. OT +1) matches empirical 6.19
EXPO, SHRINK, N0 = 0.8, 0.5, 60
SV_LEAGUE = 0.889
GOALIE_W = 0.5                 # JUDGMENT: half weight, since last-season team GA already contains last-season goalie
MKT_W_TOTAL, MKT_W_ML = 0.6, 0.6   # JUDGMENT (cannot be backtested without odds history)

def simulate(lam_a, lam_h, n, rng, P=None):
    """Monte Carlo. lam_* regulation goals/60 at even strength-state (scalars). Returns dict of arrays:
    a,h = FINAL recorded scores (OT/SO winner +1); tie = tied after regulation; en = empty-net goals; og = OT decided by goal (else SO)."""
    P = {**PARAMS, **(P or {})}
    ra, rh = lam_a, lam_h
    a = np.zeros(n, np.int32); h = np.zeros(n, np.int32); en = np.zeros(n, np.int32)
    u1 = rng.uniform(1.0, 2.5, n); u2 = rng.uniform(1.5, 3.0, n); u3 = rng.uniform(0.75, 1.5, n)  # goalie-pull times (min left)
    t = 0.0
    for dt, ns in ((3.0, 19), (1 / 6, 18)):                     # 0-57 in 3-min steps, then 10-sec steps
        for _ in range(ns):
            rem = 60 - t
            d = a - h
            stt = P['st'] + (P['st_late'] if rem <= 20 else 0.0)
            fa = np.where(d < 0, 1 + stt, np.where(d > 0, 1 + P['sl'], 1.0))
            fh = np.where(d > 0, 1 + stt, np.where(d < 0, 1 + P['sl'], 1.0))
            ra_, rh_ = ra / 60 * fa, rh / 60 * fh
            if dt < 1:
                pull_a = ((d == -1) & (rem <= u1)) | ((d == -2) & (rem <= u2)) | ((d == -3) & (rem <= u3))
                pull_h = ((d == 1) & (rem <= u1)) | ((d == 2) & (rem <= u2)) | ((d == 3) & (rem <= u3))
                ra_ = np.where(pull_a, P['pull_mult'] * ra / 60, ra_); rh_ = np.where(pull_h, P['pull_mult'] * rh / 60, rh_)
                ea = np.where(pull_h, P['en_rate'], 0.0); eh = np.where(pull_a, P['en_rate'], 0.0)
            else:
                ea = eh = np.zeros(n)
            na = rng.poisson(ra_ * dt); nh = rng.poisson(rh_ * dt)
            ne_a = rng.poisson(ea * dt); ne_h = rng.poisson(eh * dt)
            a = a + na + ne_a; h = h + nh + ne_h; en += ne_a + ne_h
            t += dt
    tie = a == h
    share = 0.5 + P['ot_tilt'] * (ra / (ra + rh) - 0.5)
    og = rng.random(n) < P['ot_goal_p']                          # OT (3on3) ends on a goal, else shootout
    awin = np.where(og, rng.random(n) < share, rng.random(n) < 0.5 + P['so_tilt'] * (share - 0.5))
    a = np.where(tie & awin, a + 1, a); h = np.where(tie & ~awin, h + 1, h)
    return dict(a=a, h=h, tie=tie, en=en, og=og)

# ---------------------------------------------------------------- team ratings
def load_games(path=None):
    g = pd.read_json(path or os.path.join(HERE, 'data', 'games.json'))
    for c in ('away', 'home'): g[c] = g[c].replace({'ARI': 'UTA'})
    return g

def team_ratings(prior_season=20252026, results_csv=None, n0=N0, shrink=SHRINK):
    """Returns {team: (off, def)} multipliers (goals-for / goals-against relative to league) using
    prior-season results shrunk to league, then a Bayesian update with any 2026-27 results (csv: away,home,a,h)."""
    g = load_games(); g = g[g.season == prior_season]
    lg = (LG_A + LG_H) / 2
    rat = {}
    teams = sorted(set(g.away) | set(g.home))
    cur = pd.read_csv(results_csv) if results_csv and os.path.isfile(results_csv) and os.path.getsize(results_csv)>0 else None
    for tm in teams:
        gf = np.r_[g[g.away == tm].a, g[g.home == tm].h]; ga = np.r_[g[g.away == tm].h, g[g.home == tm].a]
        pf = lg + shrink * (gf.mean() - lg); pa = lg + shrink * (ga.mean() - lg)
        sf = sa = k = 0
        if cur is not None:
            for r in cur.itertuples():
                if r.away == tm: sf += r.a; sa += r.h; k += 1
                elif r.home == tm: sf += r.h; sa += r.a; k += 1
        rat[tm] = (((n0 * pf + sf) / (n0 + k)) / lg, ((n0 * pa + sa) / (n0 + k)) / lg, k)
    return rat

def base_rates(away, home, rat, sv_a=None, sv_h=None, off=None, dfn=None):
    """Model-only regulation rates. sv_* goalie true-talent SV% (judgment input). off/dfn: dict team->multiplier, clamped to +-5%."""
    clamp = lambda x: min(1.05, max(0.95, x))
    off = off or {}; dfn = dfn or {}
    oa, da = rat[away][0] * clamp(off.get(away, 1)), rat[away][1] * clamp(dfn.get(away, 1))
    oh, dh = rat[home][0] * clamp(off.get(home, 1)), rat[home][1] * clamp(dfn.get(home, 1))
    gf = lambda sv: 1.0 if sv is None else 1 + GOALIE_W * ((1 - sv) / (1 - SV_LEAGUE) - 1)
    la = LG_A * SCALE * (oa * dh) ** EXPO * gf(sv_h)    # away scoring faces home goalie
    lh = LG_H * SCALE * (oh * da) ** EXPO * gf(sv_a)
    return la, lh

# ---------------------------------------------------------------- market handling
def ml_prob(o):   # american odds -> implied prob
    return -o / (-o + 100) if o < 0 else 100 / (o + 100)
def devig2(o1, o2):
    p1, p2 = ml_prob(o1), ml_prob(o2); return p1 / (p1 + p2)

def fit_market(la, lh, p_home=None, total=None, p_over=None, n=120000, seed=7):
    """Find scale s and tilt t with sim P(home win)=p_home and P(over total)=p_over; returns (s, t). Common random numbers."""
    def probs(s, t):
        r = simulate(la * s * t, lh * s / t, n, np.random.default_rng(seed))
        tb = r['a'] + r['h'] - (r['tie'] & ~r['og'])             # SO goal excluded from betting total
        if total is None: po = None
        else:
            if float(total) == int(total):                       # integer line: condition on no push
                po = (tb > total).sum() / max(1, (tb != total).sum())
            else: po = (tb > total).mean()
        return (r['h'] > r['a']).mean(), po
    s = t = 1.0
    for _ in range(3):
        if total is not None:
            lo, hi = 0.7, 1.4
            for _ in range(8):
                mid = (lo + hi) / 2
                if probs(mid, t)[1] > p_over: hi = mid
                else: lo = mid
            s = (lo + hi) / 2
        if p_home is not None:
            lo, hi = 0.6, 1.6
            for _ in range(8):
                mid = (lo + hi) / 2
                if probs(s, mid)[0] > p_home: lo = mid      # larger tilt = more away scoring = lower P(home)
                else: hi = mid
            t = (lo + hi) / 2
    return s, t

# ---------------------------------------------------------------- contest output
def analyze(r, maxg=8):
    a, h, tie, og = r['a'], r['h'], r['tie'], r['og']
    N = len(a); G = np.arange(0, 13)
    ac, hc = np.clip(a, 0, 12), np.clip(h, 0, 12)
    pa = np.bincount(ac, minlength=13) / N; ph = np.bincount(hc, minlength=13) / N
    D = np.abs(G[:, None] - G[None, :])
    EA = (D @ pa)[:maxg + 1]; EH = (D @ ph)[:maxg + 1]
    cost = EA[:, None] + EH[None, :]
    J = np.zeros((13, 13)); np.add.at(J, (ac, hc), 1); J /= N
    mode = np.unravel_index(J.argmax(), J.shape)
    order = lambda C: [(float(C[i, j]), int(i), int(j)) for i, j in zip(*np.unravel_index(np.argsort(C, axis=None), C.shape))]
    anyt = order(cost); C2 = cost.copy(); np.fill_diagonal(C2, 1e9); nt = order(C2)
    x, y = nt[0][1], nt[0][2]
    m = (a == x) & (h == y)
    p_ot_given = float(tie[m].mean()) if m.sum() > 200 else float('nan')
    return dict(ea=float(a.mean()), eh=float(h.mean()), et=float((a + h).mean()), mode=(int(mode[0]), int(mode[1])), modep=float(J[mode]),
                best_any=anyt[0], alts_any=anyt[1:4], official=nt[0], alts_notie=nt[1:4], p_ot=float(tie.mean()),
                p_ot_given_official=p_ot_given, p_home=float((h > a).mean()), p_le3=float(((a + h) <= 3).mean()),
                p_ge9=float(((a + h) >= 9).mean()), en_share=float(r['en'].sum() / (a + h).sum()),
                top=[(f"{i}-{j}", float(J[i, j])) for i, j in [np.unravel_index(k, J.shape) for k in np.argsort(J.ravel())[::-1][:6]]])

def predict(away, home, rat=None, sv_a=None, sv_h=None, total=None, over=None, under=None, ml_away=None, ml_home=None,
            w_total=MKT_W_TOTAL, w_ml=MKT_W_ML, off=None, dfn=None, n=1_000_000, seed=2026, verbose=False):
    rat = rat or team_ratings()
    la, lh = base_rates(away, home, rat, sv_a, sv_h, off, dfn)
    p_home = devig2(ml_home, ml_away) if (ml_home is not None and ml_away is not None) else None
    p_over = devig2(over, under) if (total is not None and over is not None and under is not None) else (0.5 if total is not None else None)
    s = t = 1.0; info = {}
    if p_home is not None or total is not None:
        s, t = fit_market(la, lh, p_home, total, p_over)
        info = dict(mkt_scale=s, mkt_tilt=t, p_home_mkt=p_home, p_over_mkt=p_over)
        s_ = s ** w_total; t_ = t ** w_ml
        la, lh = la * s_ * t_, lh * s_ / t_
    r = simulate(la, lh, n, np.random.default_rng(seed))
    out = analyze(r); out.update(away=away, home=home, lam=(la, lh), market=info)
    return out

def fmt(o):
    A, H = o['away'], o['home']
    x, y = o['official'][1], o['official'][2]
    lab = ''
    if abs(x - y) == 1:
        pot = o['p_ot_given_official']
        lab = f" [{'OT/SO' if pot >= 0.5 else 'regulation'} win for {A if x > y else H}; P(OT | this score)={pot:.0%}]"
    f = lambda t: f"{t[1]}-{t[2]} ({t[0]:.3f})"
    L = [f"### {A} @ {H}",
         f"Expected away goals: {o['ea']:.2f}", f"Expected home goals: {o['eh']:.2f}", f"Expected total: {o['et']:.2f}",
         f"Most likely exact score: {o['mode'][0]}-{o['mode'][1]} ({o['modep']:.1%}; next: " + ", ".join(f"{k} {p:.1%}" for k, p in o['top'][1:4]) + ")",
         f"Score that minimizes expected contest error (ties allowed): {o['best_any'][1]}-{o['best_any'][2]} (expected abs. error {o['best_any'][0]:.3f})",
         "Three closest alternatives (ties allowed): " + "; ".join(f(t) for t in o['alts_any']),
         f"Win prob (incl. OT/SO): {A} {1-o['p_home']:.0%} / {H} {o['p_home']:.0%}   |   P(game goes to OT/SO)={o['p_ot']:.1%}",
         f"OFFICIAL SUBMISSION (no tie): {A} {x}, {H} {y}{lab}  expected abs. error {o['official'][0]:.3f}",
         "Three closest non-tie alternatives: " + "; ".join(f(t) for t in o['alts_notie']),
         f"Diagnostics: P(total<=3)={o['p_le3']:.1%}, P(total>=9)={o['p_ge9']:.1%}, empty-net share of goals={o['en_share']:.1%}" +
         (f", market fit scale={o['market']['mkt_scale']:.3f} tilt={o['market']['mkt_tilt']:.3f}" if o['market'] else ", (no market inputs: ratings-only)")]
    return "\n".join(L)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--away'); ap.add_argument('--home'); ap.add_argument('--spec')
    ap.add_argument('--sv-away', type=float); ap.add_argument('--sv-home', type=float)
    ap.add_argument('--total', type=float); ap.add_argument('--over', type=float); ap.add_argument('--under', type=float)
    ap.add_argument('--ml-away', type=float); ap.add_argument('--ml-home', type=float)
    ap.add_argument('--w-total', type=float, default=MKT_W_TOTAL); ap.add_argument('--w-ml', type=float, default=MKT_W_ML)
    ap.add_argument('--results', default=os.path.join(HERE, 'data', 'results_2026_27.csv'), help='csv away,home,a,h of 2026-27 finals (Bayesian update)')
    ap.add_argument('--n', type=int, default=1_000_000)
    a = ap.parse_args()
    rat = team_ratings(results_csv=a.results)
    specs = json.load(open(a.spec)) if a.spec else [dict(away=a.away, home=a.home, sv_a=a.sv_away, sv_h=a.sv_home, total=a.total, over=a.over,
            under=a.under, ml_away=a.ml_away, ml_home=a.ml_home, w_total=a.w_total, w_ml=a.w_ml)]
    for sp in specs:
        if not sp.get('away') or not sp.get('home'): ap.error('need --away and --home (or --spec)')
        print(fmt(predict(rat=rat, n=a.n, **sp)), "\n")

if __name__ == '__main__':
    main()
