"""One-off research fetch (runs only on the probe/model-data branch): richer MoneyPuck team-game data, ESPN closing
odds for past seasons, and a look at what the official skater game-log feed returns."""
import csv, gzip, io, json, sys, time, datetime as dt, concurrent.futures as cf, urllib.parse, functools
import requests
UA = {'User-Agent': 'Mozilla/5.0 (luck-society-nhl-predictor research)'}
def get(url, raw=False, timeout=120, tries=4):
    for k in range(tries):
        try:
            r = requests.get(url, headers=UA, timeout=timeout); r.raise_for_status()
            return r.content if raw else r.json()
        except Exception as e:
            print('fail', url[:150], e, file=sys.stderr); time.sleep(1 + 2 * k)
    return None

def skater_feed():
    import urllib.request
    out = []
    def probe(label, url, ua):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': ua, 'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read(); j = json.loads(body.decode())
                out.append(dict(label=label, status=r.status, bytes=len(body), keys=list(j)[:8] if isinstance(j, dict) else str(type(j)),
                                total=j.get('total') if isinstance(j, dict) else None, rows=len(j.get('data', [])) if isinstance(j, dict) and isinstance(j.get('data'), list) else None,
                                first=(j.get('data') or [None])[0] if isinstance(j, dict) else None))
        except Exception as e:
            body = ''
            try: body = e.read().decode('utf-8', 'replace')[:600]
            except Exception: pass
            out.append(dict(label=label, error=repr(e)[:300], body=body))
    base = 'https://api.nhle.com/stats/rest/en/skater/summary?'
    q = lambda lo, hi, start, limit: base + urllib.parse.urlencode({'isAggregate': 'false', 'isGame': 'true', 'start': start, 'limit': limit,
                                                                    'cayenneExp': f'gameDate>="{lo}" and gameDate<"{hi}" and gameTypeId=2'})
    ua = 'Mozilla/5.0 (nhl-score-predictor)'
    for d in ('2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'):
        nxt = str(dt.date.fromisoformat(d) + dt.timedelta(days=1))
        probe(f'{d} page 0', q(d, nxt, 0, 100), ua); probe(f'{d} page 100', q(d, nxt, 100, 100), ua); probe(f'{d} page 500', q(d, nxt, 500, 100), ua)
    probe('old style ten days limit -1', q('2026-11-13', '2026-11-21', 0, -1), ua)
    probe('19th limit -1', q('2026-11-19', '2026-11-20', 0, -1), ua)
    probe('19th browser UA', q('2026-11-19', '2026-11-20', 0, 100), 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')
    json.dump(out, open('research/probe/skater_feed.json', 'w'), indent=1, default=str)
    for o in out: print({k: v for k, v in o.items() if k != 'first'})

def moneypuck():
    raw = get('https://moneypuck.com/moneypuck/playerData/careers/gameByGame/all_teams.csv', raw=True, timeout=600)
    if not raw: print('moneypuck failed'); return
    rd = csv.DictReader(io.StringIO(raw.decode('utf-8', 'replace')))
    print('columns:', rd.fieldnames)
    keep_id = ['gameId', 'season', 'playerTeam', 'opposingTeam', 'home_or_away', 'gameDate', 'situation', 'iceTime']
    drop = {'team', 'name', 'position', 'playoffGame'}
    cols = keep_id + [c for c in rd.fieldnames if c not in keep_id and c not in drop]
    buf = io.StringIO(); w = csv.DictWriter(buf, cols, extrasaction='ignore', lineterminator='\n'); w.writeheader(); n = 0
    for r in rd:
        if int(r['season']) < 2019 or r.get('playoffGame') == '1': continue
        if r['situation'] not in ('all', '5on5', '5on4', '4on5'): continue
        for c in cols:
            v = r.get(c, '')
            try:
                f = float(v); r[c] = str(int(f)) if f == int(f) else f'{f:.3f}'
            except (TypeError, ValueError): pass
        w.writerow(r); n += 1
    with gzip.open('research/probe/mp_teams.csv.gz', 'wt') as f: f.write(buf.getvalue())
    print('moneypuck rows', n)

def espn_odds(first, last, out):
    days = []; d = first
    while d <= last: days.append(d); d += dt.timedelta(days=1)
    g = lambda o, *ks: functools.reduce(lambda x, k: x.get(k) if isinstance(x, dict) else None, ks, o)
    def board(d):
        j = get(f'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates={d.strftime("%Y%m%d")}', timeout=30)
        ev = []
        for e in (j or {}).get('events', []):
            c = e['competitions'][0]; s = {x['homeAway']: x for x in c['competitors']}
            if (e.get('season') or {}).get('type') != 2 or 'away' not in s or 'home' not in s: continue
            ev.append(dict(eid=e['id'], date=e['date'], away=s['away']['team']['abbreviation'], home=s['home']['team']['abbreviation'],
                           a=s['away'].get('score'), h=s['home'].get('score')))
        return ev
    def odds(ev):
        j = get(f"https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/{ev['eid']}/competitions/{ev['eid']}/odds", timeout=30)
        items = []
        for it in (j or {}).get('items', []):
            a, h = it.get('awayTeamOdds') or {}, it.get('homeTeamOdds') or {}
            items.append(dict(prov=g(it, 'provider', 'name'), mlA=a.get('moneyLine'), mlH=h.get('moneyLine'), ou=it.get('overUnder'),
                              over=it.get('overOdds'), under=it.get('underOdds'), spread=it.get('spread'),
                              openA=g(a, 'open', 'moneyLine', 'american'), openH=g(h, 'open', 'moneyLine', 'american'),
                              closeA=g(a, 'close', 'moneyLine', 'american'), closeH=g(h, 'close', 'moneyLine', 'american'), details=it.get('details')))
        ev['odds'] = items; return ev
    with cf.ThreadPoolExecutor(8) as ex:
        evs = [e for day in ex.map(board, days) for e in day]
        evs = list(ex.map(odds, evs))
    with gzip.open(out, 'wt') as f: json.dump(evs, f, separators=(',', ':'))
    print(out, len(evs), 'events,', sum(1 for e in evs if e['odds']), 'with odds')

def skater_code():
    """Run the production skater fetch against the live feed and report exactly where it stops."""
    import os, traceback, collections
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
    import skaters as S, v4_model as M, update_data as U
    rows = M.load_history(); state = json.loads((S.DATA / 'skaters.json').read_text())
    print('state through', state['through'], 'history through', rows[-1]['date'])
    calls = []
    def get(url):
        r = U.get(url); calls.append((url[-120:], None if r is None else (r.get('total'), len(r.get('data') or []))))
        return r
    for cutoff in ('2026-11-21', '2026-11-20'):
        try:
            out = S.fetch_recent(state, rows, cutoff, get); print('cutoff', cutoff, 'OK through', out['through'], 'games', len(out['games']))
        except Exception:
            print('cutoff', cutoff, 'FAILED'); traceback.print_exc(file=sys.stdout)
    for c in calls[-12:]: print(c)
    base = 'https://api.nhle.com/stats/rest/en/skater/summary?'
    for sort in (None, '[{"property":"gameId","direction":"ASC"},{"property":"playerId","direction":"ASC"}]'):
        for day in ('2026-11-14', '2026-11-19'):
            nxt = str(dt.date.fromisoformat(day) + dt.timedelta(days=1)); got = []; total = None
            while total is None or len(got) < total:
                q = {'isAggregate': 'false', 'isGame': 'true', 'start': len(got), 'limit': 100, 'cayenneExp': f'gameDate>="{day}" and gameDate<"{nxt}" and gameTypeId=2'}
                if sort: q['sort'] = sort
                b = U.get(base + urllib.parse.urlencode(q))
                if not b or not b.get('data'): print('stopped', day, len(got), total); break
                total = b['total']; got += b['data']
            keys = [(p['gameId'], p['playerId']) for p in got]
            exp = {r['id'] for r in rows if r['date'] == day}
            print('sort' if sort else 'no sort', day, 'rows', len(got), 'total', total, 'distinct', len(set(keys)), 'games in feed', len({k[0] for k in keys}), 'games in history', len(exp),
                  'feed-only', sorted({k[0] for k in keys} - exp)[:5], 'history-only', sorted(exp - {k[0] for k in keys})[:5],
                  'per-team counts', sorted(collections.Counter((p['gameId'], p['teamAbbrev']) for p in got).values())[:3], '..', sorted(collections.Counter((p['gameId'], p['teamAbbrev']) for p in got).values())[-3:])
            if got: print('  dates', sorted({p['gameDate'] for p in got}), 'sample', {k: got[0].get(k) for k in ('gameId', 'gameDate', 'teamAbbrev', 'playerId', 'timeOnIcePerGame', 'positionCode')})

if __name__ == '__main__':
    if sys.argv[1] == 'skatercode': skater_code(); sys.exit()
    what = sys.argv[1]
    if what == 'skaters': skater_feed()
    elif what == 'mp': moneypuck()
    else:
        for name, a, b in (('2022_23', '2022-10-07', '2023-04-14'), ('2023_24', '2023-10-10', '2024-04-18'),
                           ('2024_25', '2024-10-04', '2025-04-17'), ('2025_26', '2025-10-07', '2026-04-17')):
            espn_odds(dt.date.fromisoformat(a), dt.date.fromisoformat(b), f'research/probe/espn_odds_{name}.json.gz')
