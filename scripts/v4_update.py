"""Keeps data/v4/history.csv.gz current (NHL boxscores + MoneyPuck xG), retrains v4 and annotates day slates with
pre-game v4 expected goals. Called from update_data.py. No betting-market inputs are used here."""
import csv, datetime as dt, io, json, os, sys, time, unicodedata, urllib.request
import v4_model as M
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
META = os.path.join(DATA, 'v4', 'meta.json')
UA = {'User-Agent': 'Mozilla/5.0 (luck-society-nhl-predictor; github.com/lucksociety/nhl-score-predictor)'}
def get(url, tries=3, raw=False, timeout=60):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read() if raw else json.load(r)
        except Exception as e:
            print('get fail', url, e, file=sys.stderr); time.sleep(1 + 2 * k)
    return None
def season_of(gid): y = int(str(gid)[:4]); return y * 10000 + y + 1

def boxscore(gid):
    d = get(f'https://api-web.nhle.com/v1/gamecenter/{gid}/boxscore')
    if not d: return None
    o = {}
    for s, k in (('awayTeam', 'a'), ('homeTeam', 'h')):
        gs = [dict(pid=x['playerId'], nm=x['name']['default'], st=x.get('starter'), sa=x.get('shotsAgainst', 0) or 0, sv=x.get('saves', 0) or 0)
              for x in d['playerByGameStats'][s]['goalies']]
        st = [x for x in gs if x['st']] or sorted(gs, key=lambda x: -x['sa'])[:1]
        o['sog_' + k] = d[s].get('sog'); o['gk_' + k] = st[0]['pid'] if st else None; o['gkn_' + k] = st[0]['nm'] if st else ''
        o['gsa_' + k] = [[x['pid'], x['sa'], x['sv']] for x in gs if x['sa'] > 0]
    return o

def moneypuck_fill(rows, meta, force=False):
    """fill MoneyPuck xG for current-season rows missing it; at most one download per 6 hours."""
    miss = {r['id'] for r in rows if r['xg_a'] is None}
    if not miss: return 0
    last = meta.get('mp_try')
    if not force and last and time.time() - last < 6 * 3600: return 0
    meta['mp_try'] = time.time()
    raw = get('https://moneypuck.com/moneypuck/playerData/careers/gameByGame/all_teams.csv', raw=True, timeout=300)
    if not raw: return 0
    want_seasons = {str(int(str(i)[:4])) for i in miss}; got = {}
    for r in csv.DictReader(io.StringIO(raw.decode('utf-8', 'replace'))):
        if r['situation'] != 'all' or r['season'] not in want_seasons: continue
        gid = int(r['gameId'])
        if gid in miss: got.setdefault(gid, {})[r['home_or_away']] = (float(r['goalsFor']), float(r['scoreVenueAdjustedxGoalsFor']))
    n = 0
    for r in rows:
        x = got.get(r['id'])
        if x and 'HOME' in x and 'AWAY' in x:
            r['g_a'], r['xg_a'] = x['AWAY']; r['g_h'], r['xg_h'] = x['HOME']; n += 1
    meta['mp_rows'] = n; print(f'moneypuck: filled xG for {n}/{len(miss)} games')
    return n

def update_history(results):
    rows = M.load_history(); have = {r['id'] for r in rows}
    meta = json.load(open(META)) if os.path.exists(META) else {}
    new = 0
    for g in results:
        if g['id'] in have or g.get('a') is None: continue
        b = boxscore(g['id'])
        if not b or b['sog_a'] is None: continue
        rows.append(dict(id=g['id'], date=g['date'], season=season_of(g['id']), away=g['away'], home=g['home'], a=g['a'], h=g['h'],
                         per=g.get('last') or 'REG', g_a=None, g_h=None, xg_a=None, xg_h=None, **b)); new += 1
    filled = moneypuck_fill(rows, meta)
    if new or filled: M.save_history(rows)
    meta['games'] = len(rows); meta['through'] = max(r['date'] for r in rows); meta['missing_xg'] = sum(1 for r in rows if r['xg_a'] is None)
    json.dump(meta, open(META, 'w'), indent=1)
    print(f'v4 history: {len(rows)} games (+{new}), through {meta["through"]}, {meta["missing_xg"]} awaiting MoneyPuck xG (shots proxy)')
    return rows

def norm(s): return ''.join(c for c in unicodedata.normalize('NFKD', s or '') if not unicodedata.combining(c)).lower().replace('.', '').strip()
def match_goalie(S, team, name):
    """ESPN full name ('Cam Talbot') -> NHL player id via history names ('C. Talbot'); prefer the team's own goalies."""
    if not name: return None
    p = norm(name).split(); last = p[-1] if p else ''; ini = p[0][0] if p else ''
    def ok(pid):
        q = norm(S.gkname.get(pid, '')).split()
        return q and q[-1] == last and q[0][0] == ini
    cand = [pid for pid in S.teamgk.get(M.SAME.get(team, team), {}) if ok(pid)]
    if not cand: cand = [pid for pid in S.gkname if ok(pid)]
    return cand[0] if len(cand) == 1 else (max(cand, key=lambda p: S.GK.get(p, [0, 0, 0])[2]) if cand else None)

def goalie_table(S, team):
    m = S.teamgk.get(M.SAME.get(team, team), {}); tot = sum(m.values()) or 1
    return [dict(id=g, name=S.gkname.get(g, ''), gq=round(S.gq(g), 4), share=round(w / tot, 3), shots=round(S.GK.get(g, [0, 0, 0])[2]))
            for g, w in sorted(m.items(), key=lambda x: -x[1]) if w / tot >= 0.03]

def annotate(slates, rows):
    """slates: list of day-slate dicts (ascending dates). Adds g['v4'] for every game not yet started; started games keep
    their frozen pre-game v4 (copied by caller from the previous file)."""
    S, b, recs = M.train(rows)
    # scoring-level recalibration: actual / predicted goals over the last 1000 games (league scoring drifts up; out-of-sample
    # this never hurt and improved holdout log-likelihood in 2025-26 and 2026-27)
    tail = recs[-1000:]; calib = sum(f['a'] + f['h'] for f in tail) / sum(sum(M.predict(f, b)) for f in tail)
    through = rows[-1]['date']; bq = float(b[1 + M.FEATS.index('ogq')])
    model = dict(version='v4-independent', trainedThrough=through, trainedAt=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                 coef=dict(zip(['b0'] + M.FEATS, [round(float(x), 5) for x in b])), calib=round(calib, 5), hp=M.HP, scale=M.SCALE, games=len(rows),
                 league=dict(gf=round(S.lg['gf'], 4), xf=round(S.lg['xf'], 4), sf=round(S.lg['sf'], 3)),
                 teams={t: dict(gf=round((s['gf'] + 20 * S.lg['gf']) / (s['w'] + 20), 3), ga=round((s['ga'] + 20 * S.lg['gf']) / (s['w'] + 20), 3),
                                xf=round((s['xf'] + 20 * S.lg['xf']) / (s['w'] + 20), 3), xa=round((s['xa'] + 20 * S.lg['xf']) / (s['w'] + 20), 3),
                                goalies=goalie_table(S, t)) for t, s in sorted(S.T.items()) if t in M.ARENA and t != 'ARI'})
    json.dump(model, open(os.path.join(DATA, 'v4', 'model.json'), 'w'), indent=1)
    sched = [(s['date'], g['away'], g['home']) for s in slates for g in s['games']]
    for s in slates:
        for g in s['games']:
            if g.get('v4') and g.get('v4', {}).get('frozen'): continue
            started = g.get('state') not in ('FUT', 'PRE', None)
            if started and g.get('v4'): g['v4']['frozen'] = True; continue
            if s['date'] <= through and started:   # game already in history; never recompute (would leak its own result)
                continue
            names = {sd: ((g.get('goalies') or {}).get(sd) or {}).get('name') for sd in ('away', 'home')}
            ids = {sd: match_goalie(S, g[sd], names[sd]) for sd in ('away', 'home')}
            f = S.features(s['date'], g['away'], g['home'], ids['away'], ids['home'], prev_games=[x for x in sched if x[0] > through])
            la, lh = (x * calib for x in M.predict(f, b))
            gk = {}
            for sd, k in (('away', 'a'), ('home', 'h')):
                mode = f[k + '_gkmode']
                gk[sd] = dict(name=names[sd] if mode != 'blend' else None, id=ids[sd], gq=round(f[k + '_gq'], 4), mode=mode,
                              table=goalie_table(S, g[sd]))
            g['v4'] = dict(version='v4-independent', la=round(la, 4), lh=round(lh, 4), ra=round(la * M.SCALE, 4), rh=round(lh * M.SCALE, 4),
                           betaGq=round(bq, 5), calib=round(calib, 4), goalies=gk, trainedThrough=through,
                           rest=dict(away=f['a_rest'], home=f['h_rest']), b2b=dict(away=f['a_b2b'], home=f['h_b2b']), km=dict(away=round(f['a_km']), home=round(f['h_km'])),
                           form=dict(away=dict(gf=round(f['a_gf'], 3), ga=round(f['a_ga'], 3), xf=round(f['a_xf'], 3), xa=round(f['a_xa'], 3)),
                                     home=dict(gf=round(f['h_gf'], 3), ga=round(f['h_ga'], 3), xf=round(f['h_xf'], 3), xa=round(f['h_xa'], 3))),
                           at=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
    return model
