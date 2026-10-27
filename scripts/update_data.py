#!/usr/bin/env python3
"""Refresh the dashboard's input data (run by .github/workflows/update.yml; stdlib only, no secrets).

Writes
  data/results_2026_27.json  every completed 2026-27 regular-season game (date, id, away, home, a, h, last period)
                             -> used by the browser to compute v3 team ratings as of any date
  data/days/YYYY-MM-DD.json  slate for that date: NHL schedule + ESPN odds (DraftKings via ESPN) + probable goalies
  data/today.json            copy of today's (America/New_York) slate, plus tomorrow's file for late-night viewing
Sources: api-web.nhle.com/v1/schedule (schedule + finals), site.api.espn.com NHL scoreboard (odds, goalies, status).
"""
import json, os, sys, time, urllib.request, datetime as dt
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ET = ZoneInfo('America/New_York')
SEASON_START = dt.date(2026, 9, 29)
ESPN2NHL = {'LA': 'LAK', 'NJ': 'NJD', 'SJ': 'SJS', 'TB': 'TBL', 'UTAH': 'UTA', 'WAS': 'WSH'}

def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (nhl-score-predictor)'})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            print(f'  fetch fail {url}: {e}', file=sys.stderr); time.sleep(2 * (i + 1))
    return None

def am(x):
    if x is None: return None
    if isinstance(x, (int, float)): return float(x)
    s = str(x).strip().upper()
    if s in ('EVEN', 'EV', 'PK'): return 100.0
    try: return float(s.replace('+', ''))
    except ValueError: return None

def write(path, obj):
    with open(path, 'w') as f: json.dump(obj, f, indent=1, sort_keys=False)

# ---------------------------------------------------------------- results (for ratings)
def update_results(today):
    path = os.path.join(DATA, 'results_2026_27.json')
    res = json.load(open(path)) if os.path.exists(path) else []
    by_id = {r['id']: r for r in res}
    start = SEASON_START
    if res:
        start = max(SEASON_START, dt.date.fromisoformat(max(r['date'] for r in res)) - dt.timedelta(days=3))
    d = start
    while d <= today:
        j = get(f'https://api-web.nhle.com/v1/schedule/{d.isoformat()}')
        if not j: break
        for day in j.get('gameWeek', []):
            for g in day.get('games', []):
                if g.get('gameType') != 2 or g.get('gameState') not in ('OFF', 'FINAL'): continue
                a, h = g['awayTeam'].get('score'), g['homeTeam'].get('score')
                if a is None or h is None: continue
                by_id[g['id']] = dict(date=day['date'], id=g['id'], away=g['awayTeam']['abbrev'], home=g['homeTeam']['abbrev'],
                                      a=int(a), h=int(h), last=(g.get('gameOutcome') or {}).get('lastPeriodType', 'REG'))
        d += dt.timedelta(days=7)
    res = sorted(by_id.values(), key=lambda r: (r['date'], r['id']))
    write(path, res)
    print(f'results: {len(res)} completed games through {res[-1]["date"] if res else "-"}')
    return res

# ---------------------------------------------------------------- one day's slate
def espn_odds(c):
    ods = c.get('odds') or []
    if not ods: return None
    o = ods[0]
    ml = o.get('moneyline') or {}; tot = o.get('total') or {}
    g = lambda d, *ks: (lambda v: v)(__import__('functools').reduce(lambda x, k: (x or {}).get(k), ks, d))
    mla = am(g(ml, 'away', 'close', 'odds')) or am((o.get('awayTeamOdds') or {}).get('moneyLine'))
    mlh = am(g(ml, 'home', 'close', 'odds')) or am((o.get('homeTeamOdds') or {}).get('moneyLine'))
    total = o.get('overUnder')
    line = g(tot, 'over', 'close', 'line')
    if total is None and line:
        try: total = float(str(line).lstrip('ou'))
        except ValueError: pass
    over = am(g(tot, 'over', 'close', 'odds')) or am(o.get('overOdds'))
    under = am(g(tot, 'under', 'close', 'odds')) or am(o.get('underOdds'))
    return dict(provider=(o.get('provider') or {}).get('name'), details=o.get('details'), mlAway=mla, mlHome=mlh,
                total=float(total) if total is not None else None, over=over, under=under,
                mlAwayOpen=am(g(ml, 'away', 'open', 'odds')), mlHomeOpen=am(g(ml, 'home', 'open', 'odds')))

def core_odds(eid):
    """ESPN core-API odds (still available after the game = closing line). Same feed the v3 backtest used."""
    j = get(f'https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/{eid}/competitions/{eid}/odds')
    for it in (j or {}).get('items', []):
        try:
            mla, mlh = am(it['awayTeamOdds'].get('moneyLine')), am(it['homeTeamOdds'].get('moneyLine'))
        except Exception:
            continue
        if mla is None and it.get('overUnder') is None: continue
        return dict(provider=(it.get('provider') or {}).get('name'), details=it.get('details'), mlAway=mla, mlHome=mlh,
                    total=it.get('overUnder'), over=am(it.get('overOdds')), under=am(it.get('underOdds')), closing=True)
    return None

def espn_day(d):
    j = get(f'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates={d.strftime("%Y%m%d")}')
    out = {}
    for e in (j or {}).get('events', []):
        c = e['competitions'][0]
        side = {x['homeAway']: x for x in c['competitors']}
        if 'away' not in side or 'home' not in side: continue
        ab = lambda s: ESPN2NHL.get(side[s]['team']['abbreviation'], side[s]['team']['abbreviation'])
        def goalie(s):
            p = (side[s].get('probables') or [])
            p = [q for q in p if q.get('abbreviation') == 'SG' or 'Goalie' in (q.get('displayName') or '')] or p
            if not p: return None
            return dict(name=(p[0].get('athlete') or {}).get('displayName'), status=(p[0].get('status') or {}).get('name'))
        st = c.get('status', {}).get('type', {})
        odds = espn_odds(c)
        if not odds or odds.get('mlHome') is None:
            odds = core_odds(e['id']) or odds
        out[(ab('away'), ab('home'))] = dict(espnId=e['id'], odds=odds, goalies=dict(away=goalie('away'), home=goalie('home')),
                                            espnState=st.get('state'), espnDetail=st.get('shortDetail'),
                                            espnScore=[side['away'].get('score'), side['home'].get('score')])
    return out

def day_slate(d):
    j = get(f'https://api-web.nhle.com/v1/schedule/{d.isoformat()}')
    games = []
    day = next((x for x in (j or {}).get('gameWeek', []) if x['date'] == d.isoformat()), None)
    esp = espn_day(d)
    for g in (day or {}).get('games', []):
        if g.get('gameType') not in (2, 3): continue
        A, H = g['awayTeam']['abbrev'], g['homeTeam']['abbrev']
        e = esp.get((A, H), {})
        fin = g.get('gameState') in ('OFF', 'FINAL')
        games.append(dict(id=g['id'], startUTC=g['startTimeUTC'], away=A, home=H,
                          awayName=' '.join(filter(None, [(g['awayTeam'].get('placeName') or {}).get('default'), (g['awayTeam'].get('commonName') or {}).get('default')])),
                          homeName=' '.join(filter(None, [(g['homeTeam'].get('placeName') or {}).get('default'), (g['homeTeam'].get('commonName') or {}).get('default')])),
                          venue=(g.get('venue') or {}).get('default'), state=g.get('gameState'),
                          final=[g['awayTeam'].get('score'), g['homeTeam'].get('score'), (g.get('gameOutcome') or {}).get('lastPeriodType')] if fin else None,
                          espnId=e.get('espnId'), odds=e.get('odds'), goalies=e.get('goalies') or dict(away=None, home=None)))
    if not games and esp:   # NHL API down: fall back to ESPN slate
        for (A, H), e in esp.items():
            games.append(dict(id=None, startUTC=None, away=A, home=H, awayName=A, homeName=H, venue=None, state=e['espnState'], final=None,
                              espnId=e['espnId'], odds=e['odds'], goalies=e['goalies']))
    games.sort(key=lambda g: (g['startUTC'] or '', g['away']))
    return dict(date=d.isoformat(), generatedAt=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                source='api-web.nhle.com schedule + ESPN scoreboard (odds: ' + ', '.join(sorted({(g['odds'] or {}).get('provider') or 'none' for g in games})) + ')',
                games=games)

def main():
    os.makedirs(os.path.join(DATA, 'days'), exist_ok=True)
    now_et = dt.datetime.now(ET); today = now_et.date()
    if len(sys.argv) == 4 and sys.argv[1] == '--backfill':   # python3 scripts/update_data.py --backfill 2026-09-29 2026-10-25
        d, end = dt.date.fromisoformat(sys.argv[2]), dt.date.fromisoformat(sys.argv[3])
        while d <= end:
            s = day_slate(d)
            if s['games']: write(os.path.join(DATA, 'days', f'{d.isoformat()}.json'), s); print(d, len(s['games']))
            d += dt.timedelta(days=1)
        return write_index()
    update_results(today)
    for d in (today - dt.timedelta(days=1), today, today + dt.timedelta(days=1)):
        s = day_slate(d)
        if d == today - dt.timedelta(days=1) and not s['games']: continue
        prev_path = os.path.join(DATA, 'days', f'{d.isoformat()}.json')
        if os.path.exists(prev_path):   # keep last-known odds / goalies if a feed drops them (e.g. after puck drop)
            prev = {(g['away'], g['home']): g for g in json.load(open(prev_path)).get('games', [])}
            for g in s['games']:
                p = prev.get((g['away'], g['home']))
                if not p: continue
                started = g.get('state') not in ('FUT', 'PRE', None)
                if p.get('odds') and p['odds'].get('mlHome') is not None and (started or not g.get('odds') or g['odds'].get('mlHome') is None):
                    g['odds'] = p['odds']   # keep last pre-game line once the puck has dropped (or if the feed dropped it)
                for side in ('away', 'home'):
                    if not g['goalies'].get(side) and (p.get('goalies') or {}).get(side): g['goalies'][side] = p['goalies'][side]
        write(os.path.join(DATA, 'days', f'{d.isoformat()}.json'), s)
        n_odds = sum(1 for g in s['games'] if g['odds'] and g['odds'].get('mlHome') is not None)
        print(f'{d}: {len(s["games"])} games, {n_odds} with moneyline')
        if d == today: write(os.path.join(DATA, 'today.json'), s)
    write_index()

def write_index():
    idx = sorted(f[:-5] for f in os.listdir(os.path.join(DATA, 'days')) if f.endswith('.json'))
    write(os.path.join(DATA, 'index.json'), dict(days=idx, updatedAt=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')))

if __name__ == '__main__':
    main()
