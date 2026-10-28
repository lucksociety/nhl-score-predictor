"""Model v4-independent: NO betting-market inputs.
Team strength = exponentially weighted (half-life 25 games, 30% carried over each new season, 20 pseudo-games of league
average) goals, MoneyPuck score/venue-adjusted xG and shots for/against; starting-goalie quality = shrunk log(GA / xGA faced);
rest / back-to-back / travel. A Poisson GLM (log link, ridge) maps these to expected goals per team; the Monte Carlo simulator
(js/model.js, identical to sim_v2.py) turns expected goals into score / win / total / puck-line probabilities.
Everything for a game uses only games completed before that game's date (no look-ahead)."""
import csv, gzip, io, json, math, os
import numpy as np
from scipy.optimize import minimize

HP = dict(hl=25.0, carry=0.3, n0=20.0, Kx=80.0, lgwin=1300, gk_carry=0.7, ridge=1.0)
SCALE = 0.887   # final-goal expectation -> simulator regulation rate (sim_v2.SCALE)
FEATS = ['gf', 'xf', 'sf', 'oga', 'oxa', 'osa', 'ogq', 'home', 'b2b', 'ob2b', 'km', 'tz', 'rest1']
ARENA = {
 'ANA':(33.808,-117.877,-8),'ARI':(33.532,-112.261,-7),'UTA':(40.768,-111.901,-7),'BOS':(42.366,-71.062,-5),'BUF':(42.875,-78.876,-5),
 'CGY':(51.037,-114.052,-7),'CAR':(35.803,-78.722,-5),'CHI':(41.881,-87.674,-6),'COL':(39.749,-105.008,-7),'CBJ':(39.969,-83.006,-5),
 'DAL':(32.790,-96.810,-6),'DET':(42.341,-83.055,-5),'EDM':(53.547,-113.498,-7),'FLA':(26.158,-80.326,-5),'LAK':(34.043,-118.267,-8),
 'MIN':(44.945,-93.101,-6),'MTL':(45.496,-73.569,-5),'NSH':(36.159,-86.779,-6),'NJD':(40.734,-74.171,-5),'NYI':(40.723,-73.590,-5),
 'NYR':(40.750,-73.993,-5),'OTT':(45.297,-75.927,-5),'PHI':(39.901,-75.172,-5),'PIT':(40.439,-79.989,-5),'SJS':(37.333,-121.901,-8),
 'SEA':(47.622,-122.354,-8),'STL':(38.627,-90.203,-6),'TBL':(27.943,-82.452,-5),'TOR':(43.643,-79.379,-5),'VAN':(49.278,-123.109,-8),
 'VGK':(36.103,-115.178,-8),'WSH':(38.898,-77.021,-5),'WPG':(49.893,-97.144,-6)}
SAME = {'ARI': 'UTA'}
HIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'v4', 'history.csv.gz')
COLS = ['id', 'date', 'season', 'away', 'home', 'a', 'h', 'per', 'sog_a', 'sog_h', 'gk_a', 'gkn_a', 'gk_h', 'gkn_h', 'gsa_a', 'gsa_h',
        'g_a', 'g_h', 'xg_a', 'xg_h']

def km(a, b):
    if a not in ARENA or b not in ARENA: return 0.0
    (la1, lo1, _), (la2, lo2, _) = ARENA[a], ARENA[b]
    p = math.pi / 180; d = 0.5 - math.cos((la2 - la1) * p) / 2 + math.cos(la1 * p) * math.cos(la2 * p) * (1 - math.cos((lo2 - lo1) * p)) / 2
    return 12742 * math.asin(math.sqrt(max(0.0, d)))
def days(d1, d0):
    import datetime as dt
    return (dt.date.fromisoformat(d1) - dt.date.fromisoformat(d0)).days

# ---------------- history I/O
def load_history(path=HIST):
    rows = []
    with gzip.open(path, 'rt', newline='') as f:
        for r in csv.DictReader(f):
            for k in ('id', 'season', 'a', 'h', 'sog_a', 'sog_h'): r[k] = int(r[k])
            for k in ('gk_a', 'gk_h'): r[k] = int(r[k]) if r[k] else None
            for k in ('gsa_a', 'gsa_h'): r[k] = json.loads(r[k]) if r[k] else []
            for k in ('g_a', 'g_h', 'xg_a', 'xg_h'): r[k] = float(r[k]) if r[k] not in ('', None) else None
            rows.append(r)
    rows.sort(key=lambda r: (r['date'], r['id']))
    return rows
def save_history(rows, path=HIST):
    rows = sorted(rows, key=lambda r: (r['date'], r['id']))
    buf = io.StringIO(); w = csv.DictWriter(buf, COLS, lineterminator='\n'); w.writeheader()
    for r in rows:
        o = {k: r.get(k) for k in COLS}
        for k in ('gsa_a', 'gsa_h'): o[k] = json.dumps(o[k] or [], separators=(',', ':'))
        for k in ('xg_a', 'xg_h', 'g_a', 'g_h'): o[k] = '' if o[k] is None else round(o[k], 3)
        for k in ('gk_a', 'gk_h'): o[k] = '' if o[k] is None else o[k]
        w.writerow(o)
    with gzip.GzipFile(path, 'wb', mtime=0) as f: f.write(buf.getvalue().encode())

# ---------------- sequential state
class State:
    def __init__(self, hp=HP):
        self.hp = hp; self.lam = 0.5 ** (1 / hp['hl']); self.T = {}; self.GK = {}; self.last = {}; self.season = None
        self.hist = []; self.lg = dict(gf=3.05, xf=2.95, sf=30.0); self.gkname = {}; self.teamgk = {}
    def new_season(self, se):
        if self.season is not None and se != self.season:
            for t in self.T: self.T[t] = {k: v * self.hp['carry'] for k, v in self.T[t].items()}
            for g in self.GK: self.GK[g] = [v * self.hp['gk_carry'] for v in self.GK[g]]
            for t in self.teamgk: self.teamgk[t] = {g: v * 0.5 for g, v in self.teamgk[t].items()}
        self.season = se
    def refresh_league(self):
        if self.hist:
            H = self.hist[-self.hp['lgwin']:]; n = len(H)
            self.lg = dict(gf=sum(x[0] for x in H) / n, xf=sum(x[1] for x in H) / n, sf=sum(x[2] for x in H) / n)
    def gq(self, gk):
        v = self.GK.get(gk, [0, 0, 0]); K = self.hp['Kx']
        return math.log((v[0] + K) / (v[1] + K))
    def team_gq_blend(self, t):
        """expected goalie quality when the starter is unknown: recent-start-weighted mix of the team's goalies"""
        m = self.teamgk.get(SAME.get(t, t), {}); tot = sum(m.values())
        if tot <= 0: return 0.0, None
        top = max(m, key=m.get)
        return sum(w * self.gq(g) for g, w in m.items()) / tot, top
    def features(self, date, away, home, gk_a, gk_h, prev_games=()):
        """features for a game on `date`. prev_games: scheduled games after the last processed final (for rest / travel)."""
        lg = self.lg; n0 = self.hp['n0']; rec = {}
        last = dict(self.last)
        for g in prev_games:   # (date, away, home) games already played/scheduled before `date` but not in history yet
            if g[0] < date:
                for t in (g[1], g[2]):
                    tk = SAME.get(t, t)
                    if tk not in last or last[tk][0] <= g[0]: last[tk] = (g[0], g[2])
        for side, t, gk in (('a', away, gk_a), ('h', home, gk_h)):
            tk = SAME.get(t, t); s = self.T.get(tk, dict(w=0, gf=0, ga=0, xf=0, xa=0, sf=0, sa=0)); w = s['w'] + n0
            rec[side + '_gf'] = (s['gf'] + n0 * lg['gf']) / w / lg['gf']; rec[side + '_ga'] = (s['ga'] + n0 * lg['gf']) / w / lg['gf']
            rec[side + '_xf'] = (s['xf'] + n0 * lg['xf']) / w / lg['xf']; rec[side + '_xa'] = (s['xa'] + n0 * lg['xf']) / w / lg['xf']
            rec[side + '_sf'] = (s['sf'] + n0 * lg['sf']) / w / lg['sf']; rec[side + '_sa'] = (s['sa'] + n0 * lg['sf']) / w / lg['sf']
            rec[side + '_n'] = s['w']
            if tk in last:
                d0, loc = last[tk]; rest = days(date, d0)
                rec[side + '_rest'] = min(rest, 5); rec[side + '_b2b'] = int(rest == 1)
                rec[side + '_km'] = km(loc, home); rec[side + '_tz'] = abs(ARENA.get(loc, (0, 0, 0))[2] - ARENA.get(home, (0, 0, 0))[2])
            else:
                rec[side + '_rest'] = 5; rec[side + '_b2b'] = 0; rec[side + '_km'] = 0.0; rec[side + '_tz'] = 0
            if gk is not None and gk in self.GK:
                rec[side + '_gq'] = self.gq(gk); rec[side + '_gkmode'] = 'named'
            elif gk is not None:
                rec[side + '_gq'] = 0.0; rec[side + '_gkmode'] = 'new'          # no NHL history: league average
            else:
                rec[side + '_gq'], _ = self.team_gq_blend(t); rec[side + '_gkmode'] = 'blend'
        rec['lg_gf'] = lg['gf']
        return rec
    def update(self, r):
        lam = self.lam
        xa_, xh_ = r['xg_a'], r['xg_h']; ga_, gh_ = r['g_a'], r['g_h']
        if ga_ is None: ga_, gh_ = r['a'] - (1 if r['per'] == 'SO' and r['a'] > r['h'] else 0), r['h'] - (1 if r['per'] == 'SO' and r['h'] > r['a'] else 0)
        if xa_ is None or xh_ is None:   # MoneyPuck not yet available: shots x league xG/shot proxy
            xps = self.lg['xf'] / self.lg['sf']; xa_, xh_ = r['sog_a'] * xps, r['sog_h'] * xps
        for t, gf, ga, xf, xa, sf, sa in ((r['away'], ga_, gh_, xa_, xh_, r['sog_a'], r['sog_h']), (r['home'], gh_, ga_, xh_, xa_, r['sog_h'], r['sog_a'])):
            tk = SAME.get(t, t); s = self.T.setdefault(tk, dict(w=0, gf=0, ga=0, xf=0, xa=0, sf=0, sa=0))
            for k in s: s[k] *= lam
            s['w'] += 1; s['gf'] += gf; s['ga'] += ga; s['xf'] += xf; s['xa'] += xa; s['sf'] += sf; s['sa'] += sa
            self.last[tk] = (r['date'], r['home'])
        for side, team, xg_against in (('a', r['away'], xh_), ('h', r['home'], xa_)):
            lst = r['gsa_' + side] or []; tot = sum(x[1] for x in lst) or 1
            for pid, sa, sv in lst:
                g = self.GK.setdefault(pid, [0, 0, 0]); g[0] += sa - sv; g[1] += xg_against * sa / tot; g[2] += sa
            st = r['gk_' + side]
            if st is not None:
                tk = SAME.get(team, team); m = self.teamgk.setdefault(tk, {})
                for k in m: m[k] *= 0.85
                m[st] = m.get(st, 0) + 1; self.gkname[st] = r['gkn_' + side]
        self.hist.append(((ga_ + gh_) / 2, (xa_ + xh_) / 2, (r['sog_a'] + r['sog_h']) / 2))

def run_history(rows, hp=HP, collect=True):
    """process history in date order; returns (state, per-game feature records for all games)."""
    S = State(hp); out = []; i = 0; n = len(rows)
    while i < n:
        d = rows[i]['date']; j = i
        while j < n and rows[j]['date'] == d: j += 1
        day = rows[i:j]; S.new_season(day[0]['season']); S.refresh_league()
        if collect:
            for r in day:
                f = S.features(d, r['away'], r['home'], r['gk_a'], r['gk_h']); f.update(id=r['id'], season=r['season'], a=r['a'], h=r['h'], date=d)
                out.append(f)
        for r in day: S.update(r)
        i = j
    S.refresh_league()
    return S, out

# ---------------- GLM
def xrow(f, side):
    o = 'h' if side == 'a' else 'a'
    return [math.log(f[side + '_gf']), math.log(f[side + '_xf']), math.log(f[side + '_sf']), math.log(f[o + '_ga']), math.log(f[o + '_xa']),
            math.log(f[o + '_sa']), f[o + '_gq'], 1.0 if side == 'h' else 0.0, f[side + '_b2b'], f[o + '_b2b'], f[side + '_km'] / 1000,
            f[side + '_tz'], float(f[side + '_rest'] >= 3) - float(f[o + '_rest'] >= 3)]
def fit(recs, ridge=HP['ridge']):
    X = np.array([xrow(f, 'a') for f in recs] + [xrow(f, 'h') for f in recs]); y = np.array([f['a'] for f in recs] + [f['h'] for f in recs], float)
    off = np.log(np.array([f['lg_gf'] for f in recs] * 2)); X1 = np.c_[np.ones(len(X)), X]
    def obj(b):
        eta = off + X1 @ b; mu = np.exp(eta)
        return (mu - y * eta).sum() + ridge * (b[1:] ** 2).sum(), X1.T @ (mu - y) + 2 * ridge * np.r_[0, b[1:]]
    return minimize(obj, np.zeros(X1.shape[1]), jac=True, method='L-BFGS-B').x
def predict(f, b):
    la = f['lg_gf'] * math.exp(b[0] + float(np.dot(b[1:], xrow(f, 'a'))))
    lh = f['lg_gf'] * math.exp(b[0] + float(np.dot(b[1:], xrow(f, 'h'))))
    return la, lh
def train(rows, first_season=20222023):
    S, recs = run_history(rows)
    b = fit([f for f in recs if f['season'] >= first_season])
    return S, b, recs
