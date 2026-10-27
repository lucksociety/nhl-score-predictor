import sys, json, numpy as np
import sim_v3 as S
from sim_v3 import *   # v3: market weight 1.0, n0=60, argmin pick, uncertainty layer off by default

def run_game(spec, n=800_000, seed=11, P_unc=None):
    # v3: extra parameter-uncertainty layer OFF unless spec['unc'] (backtest: it raised MAE). Per-goalie sd/mixtures ignored when off.
    if spec.get('unc'):
        U = dict(sd_team=0.045, sd_pace=0.035, sd_gk_a=0.010, sd_gk_h=0.010, p_blow=0.04, p_hot=0.04, blow=1.30, hot=0.75)
    else:
        U = dict(sd_team=0.0, sd_pace=0.0, sd_gk_a=0.0, sd_gk_h=0.0, p_blow=0.0, p_hot=0.0, blow=1.30, hot=0.75)
    U.update(P_unc or {})
    rat = team_ratings(results_csv=os.path.join(HERE,'data','results_2026_27.csv'), n0=spec.get('n0',N0))
    away, home = spec['away'], spec['home']
    # base rates with NO goalie adj first (goalie handled via distribution), then market-fit on the *mean-goalie* rates
    la0, lh0 = base_rates(away, home, rat, None, None, spec.get('off'), spec.get('dfn'))
    sva, svh = spec['sv_a'], spec['sv_h']
    gf = lambda sv: 1 + GOALIE_W * ((1 - sv) / (1 - SV_LEAGUE) - 1)
    la, lh = la0 * gf(svh), lh0 * gf(sva)
    model = (la, lh)
    p_home = devig2(spec['ml_home'], spec['ml_away'])
    p_over = devig2(spec['over'], spec['under'])
    s, t = fit_market(la, lh, p_home, spec['total'], p_over)
    w_t, w_m = spec.get('w_total', MKT_W_TOTAL), spec.get('w_ml', MKT_W_ML)
    la_b, lh_b = la * s**w_t * t**w_m, lh * s**w_t / t**w_m
    # v3: goalie news that broke AFTER the entered line (judgment; not backtested): sv delta vs what the line assumed
    if spec.get('post_dsv_h'): la_b *= 1 - GOALIE_W * spec['post_dsv_h'] / (1 - SV_LEAGUE)
    if spec.get('post_dsv_a'): lh_b *= 1 - GOALIE_W * spec['post_dsv_a'] / (1 - SV_LEAGUE)
    rng = np.random.default_rng(seed)
    # parameter uncertainty: team multipliers, shared pace, goalie true talent (lognormal / normal), blow-up & hot-goalie mixtures
    def ln(sd): return np.exp(rng.normal(-sd*sd/2, sd, n))
    pace = ln(U['sd_pace'])
    ma, mh = ln(U['sd_team']) * pace, ln(U['sd_team']) * pace
    # goalie: gf factor change from sv deviation (sv ~ N(mean, sd)) relative to the point estimate
    sp = spec if spec.get('unc') else {k: v for k, v in spec.items() if k not in ('sd_gk_a','sd_gk_h','mix_a','mix_h','p_blow_a','p_blow_h')}
    dsv_h = rng.normal(0, sp.get('sd_gk_h', U['sd_gk_h']), n); dsv_a = rng.normal(0, sp.get('sd_gk_a', U['sd_gk_a']), n)
    def mixdev(mix, mean):
        if not mix: return 0.0
        u = rng.random(n); out = np.zeros(n); c = 0.0
        for sv, p in mix:
            m = (u >= c) & (u < c + p); out[m] = mean - sv; c += p
        return out
    dsv_h = dsv_h + mixdev(sp.get('mix_h'), svh); dsv_a = dsv_a + mixdev(sp.get('mix_a'), sva)
    fa = gf(svh - dsv_h) / gf(svh); fh = gf(sva - dsv_a) / gf(sva)
    def tail(pb, ph_):
        u = rng.random(n); return np.where(u < pb, U['blow'], np.where(u < pb + ph_, U['hot'], 1.0))
    # hot/blowup mixtures are mean-roughly neutral (0.05*1.3+0.05*.75 ~ 1.0275 -> renormalise)
    nrm = 1 + sp.get('p_blow_h', U['p_blow'])*(U['blow']-1) + U['p_hot']*(U['hot']-1)
    ta = tail(sp.get('p_blow_h', U['p_blow']), U['p_hot']) / nrm   # multiplier on away scoring (home goalie meltdown/hot)
    nrm2 = 1 + sp.get('p_blow_a', U['p_blow'])*(U['blow']-1) + U['p_hot']*(U['hot']-1)
    th = tail(sp.get('p_blow_a', U['p_blow']), U['p_hot']) / nrm2
    LA = la_b * ma * fa * ta; LH = lh_b * mh * fh * th
    # keep mean rate equal to market-blended rate
    LA *= la_b / LA.mean(); LH *= lh_b / LH.mean()
    r = simulate(LA, LH, n, rng)
    r['LA'], r['LH'] = LA, LH
    info = dict(model=model, blend=(la_b, lh_b), mkt=dict(scale=s, tilt=t, p_home=p_home, p_over=p_over))
    return r, info

def report(spec, r, info, label_a, label_h):
    a, h, tie, og = r['a'], r['h'], r['tie'], r['og']
    N = len(a); A, H = spec['away'], spec['home']
    tot = a + h; regtot = tot - tie
    out = {}
    out['ea'], out['eh'], out['et'] = a.mean(), h.mean(), tot.mean()
    out['var_tot'], out['var_a'], out['var_h'] = tot.var(), a.var(), h.var()
    out['corr'] = np.corrcoef(a, h)[0, 1]
    out['med_a'], out['med_h'], out['med_t'] = np.median(a), np.median(h), np.median(tot)
    pm = lambda x, k: np.mean(x == k)
    out['dist_a'] = [pm(a, k) for k in range(6)] + [np.mean(a >= 6)]
    out['dist_h'] = [pm(h, k) for k in range(6)] + [np.mean(h >= 6)]
    out['dist_t'] = [np.mean(tot <= 3)] + [pm(tot, k) for k in (4, 5, 6, 7, 8)] + [np.mean(tot >= 9)]
    out['ext'] = dict(h5=np.mean(h >= 5), a5=np.mean(a >= 5), hw3=np.mean(h - a >= 3), aw3=np.mean(a - h >= 3), hle1=np.mean(h <= 1), ale1=np.mean(a <= 1),
                      ot=tie.mean(), a0=np.mean(a == 0), h0=np.mean(h == 0), p_home=np.mean(h > a), en_share=r['en'].sum()/tot.sum(), tot_ge8=np.mean(tot>=8), tot_le2=np.mean(tot<=2))
    # exact scores
    J = {}
    keys = a * 100 + h
    u, c = np.unique(keys, return_counts=True)
    order = np.argsort(-c)
    top = []
    for i in order:
        x, y = divmod(int(u[i]), 100)
        if x == y: continue
        m = keys == u[i]
        top.append((x, y, c[i]/N, float(tie[m].mean())))
        if len(top) == 12: break
    out['top'] = top
    # unconditional mode incl ties
    out['mode_any'] = divmod(int(u[order[0]]), 100); out['mode_any_p'] = c[order[0]]/N
    # expected abs error for candidate non-tied scores
    G = np.arange(0, 13); ac, hc = np.clip(a, 0, 12), np.clip(h, 0, 12)
    pa = np.bincount(ac, minlength=13)/N; ph = np.bincount(hc, minlength=13)/N
    D = np.abs(G[:, None]-G[None, :]); EA = D@pa; EH = D@ph
    out['err'] = {(x, y): float(EA[x]+EH[y]) for x, y in [(i, j) for i in range(13) for j in range(13)]}
    C = EA[:9, None] + EH[None, :9]; C = C.copy(); np.fill_diagonal(C, 1e9)
    bx, by = np.unravel_index(C.argmin(), C.shape); mb = keys == bx * 100 + by
    out['argmin'] = (int(bx), int(by), float(mb.mean()), float(tie[mb].mean()) if mb.sum() > 0 else float('nan'))
    # script tree
    fav_home = out['ext']['p_home'] >= 0.5
    reg_margin = np.where(tie, 0, h - a) * (1 if fav_home else -1)   # + = favorite ahead
    duel = regtot <= 3
    chaos = (regtot >= 8) & ~duel
    blow = (np.abs(reg_margin) >= 3) & ~duel & ~chaos
    rest = ~(duel | chaos | blow)
    close = rest & (np.abs(reg_margin) <= 1)
    favc = rest & (reg_margin == 2); dogc = rest & (reg_margin == -2)
    out['script'] = dict(fav='home' if fav_home else 'away', fav_controls=favc.mean(), close=close.mean(), dog_controls=dogc.mean(), duel=duel.mean(), chaos=chaos.mean(),
                         blow=blow.mean(), blow_fav=(blow & (reg_margin > 0)).mean(), blow_dog=(blow & (reg_margin < 0)).mean())
    # OT/ shootout split
    out['og'] = float(og[tie].mean()); out['p_ot_given_top'] = {(x, y): p for x, y, _, p in top}
    return out

def fmtpct(x): return f"{100*x:.1f}%"
def write(spec, o, info, r):
    A, H = spec['away'], spec['home']
    L = []
    L.append(f"model-only (goalie-adjusted, pre-market) regulation rates: {A} {info['model'][0]:.3f} / {H} {info['model'][1]:.3f}; market-implied devig P({H} win)={info['mkt']['p_home']:.3f}, P(over)={info['mkt']['p_over']:.3f}; blended rates {info['blend'][0]:.3f}/{info['blend'][1]:.3f}")
    L.append(f"E goals {A} {o['ea']:.2f} / {H} {o['eh']:.2f} / total {o['et']:.2f}; var total {o['var_tot']:.2f}, sd away {o['var_a']**.5:.2f}, sd home {o['var_h']**.5:.2f}, corr(a,h) {o['corr']:+.3f}")
    L.append(f"medians: away {o['med_a']:.0f} home {o['med_h']:.0f} total {o['med_t']:.0f}; mode (any) {o['mode_any'][0]}-{o['mode_any'][1]} {fmtpct(o['mode_any_p'])}")
    L.append(f"{A} goals 0-5,6+: " + ", ".join(fmtpct(x) for x in o['dist_a']))
    L.append(f"{H} goals 0-5,6+: " + ", ".join(fmtpct(x) for x in o['dist_h']))
    L.append("total <=3,4,5,6,7,8,9+: " + ", ".join(fmtpct(x) for x in o['dist_t']))
    e = o['ext']
    L.append(f"home5+ {fmtpct(e['h5'])}, away5+ {fmtpct(e['a5'])}, home by3+ {fmtpct(e['hw3'])}, away by3+ {fmtpct(e['aw3'])}, home<=1 {fmtpct(e['hle1'])}, away<=1 {fmtpct(e['ale1'])}, OT/SO {fmtpct(e['ot'])} (decided in 3v3 OT {fmtpct(o['og'])} of those), P({H} win)={fmtpct(e['p_home'])}, shutout away-scored-0 {fmtpct(e['a0'])} home-scored-0 {fmtpct(e['h0'])}, EN share {fmtpct(e['en_share'])}, total>=8 {fmtpct(e['tot_ge8'])}, total<=2 {fmtpct(e['tot_le2'])}")
    s = o['script']
    L.append(f"script (fav={s['fav']}): fav controls {fmtpct(s['fav_controls'])}, close {fmtpct(s['close'])}, dog controls {fmtpct(s['dog_controls'])}, goalie duel {fmtpct(s['duel'])}, chaos {fmtpct(s['chaos'])}, blowout {fmtpct(s['blow'])} (fav {fmtpct(s['blow_fav'])}/dog {fmtpct(s['blow_dog'])}); sum={100*(s['fav_controls']+s['close']+s['dog_controls']+s['duel']+s['chaos']+s['blow']):.1f}")
    L.append("TOP (non-tied final, recorded convention): " + "; ".join(f"{x}-{y} {fmtpct(p)} (P(OT|score)={po:.0%}, E|err|={o['err'][(x,y)]:.2f})" for x, y, p, po in o['top'][:10]))
    return "\n".join(L)

def choose(o):
    """v3: pick = argmin expected |error| over all non-tied scores (backtest: beats v2's mode-first rule by 0.018/game)."""
    return o['top'][0], o['argmin']

def choose_v2(o):
    top = o['top']; mode = top[0]
    best = mode
    for x, y, p, po in top[:5]:
        if p >= 0.85 * mode[2] and o['err'][(x, y)] < o['err'][(best[0], best[1])] - 1e-9:
            best = (x, y, p, po)
    return mode, best

def shots(spec, info):
    gf = lambda sv: 1 + GOALIE_W * ((1 - sv) / (1 - SV_LEAGUE) - 1)
    la, lh = info['blend']
    sa = 29.3 * (la / gf(spec['sv_h'])) / 2.74; sh = 29.3 * (lh / gf(spec['sv_a'])) / 2.74
    return sa, sh
