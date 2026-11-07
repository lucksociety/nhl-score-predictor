"""Fresh market-free NHL availability. Goalies feed the existing fitted model;
new skater absences are disclosed and withheld from betting, not assigned invented goal penalties.
"""
import datetime as dt
from concurrent.futures import ThreadPoolExecutor
ALIASES = {'LA':'LAK','NJ':'NJD','SJ':'SJS','TB':'TBL','UTAH':'UTA','WAS':'WSH'}
UNAVAILABLE = {'Out','Injured Reserve','Suspension','Suspended','Inactive'}

def parse_injuries(body):
    if not isinstance(body,dict) or not isinstance(body.get('injuries'),list):
        raise ValueError('live injury feed unavailable')
    out={}
    for team in body['injuries']:
        for row in team.get('injuries',[]):
            a=row.get('athlete') or {};code=(a.get('team') or {}).get('abbreviation')
            if not code or not a.get('displayName'):continue
            code=ALIASES.get(code,code)
            out.setdefault(code,[]).append({'name':a['displayName'],'position':(a.get('position') or {}).get('abbreviation'),
                'status':row.get('status'),'updatedAt':row.get('date')})
    return out

def refresh(slates,get,now=None):
    at=(now or dt.datetime.now(dt.timezone.utc)).isoformat()
    try:injuries=parse_injuries(get('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries'));error=None
    except ValueError as exc:injuries={};error=str(exc)
    teams={g[s] for slate in slates for g in slate['games'] for s in ('away','home')}
    def roster(team):
        body=get(f'https://api-web.nhle.com/v1/roster/{team}/current')
        if not isinstance(body,dict) or not all(isinstance(body.get(k),list) for k in ('forwards','defensemen','goalies')):return team,None
        return team,[{'id':p['id'],'name':((p.get('firstName') or {}).get('default','')+' '+(p.get('lastName') or {}).get('default','')).strip()} for k in ('forwards','defensemen','goalies') for p in body[k]]
    with ThreadPoolExecutor(max_workers=8) as pool:rosters=dict(pool.map(roster,sorted(teams)))
    for slate in slates:
        for g in slate['games']:
            problems=[error] if error else [];sides={}
            for side in ('away','home'):
                team=g[side];rows=injuries.get(team,[]);sides[side]={'injuries':rows,'roster':rosters.get(team)}
                if rosters.get(team) is None:problems.append(f'{team} current roster unavailable')
                goalie=(g.get('goalies') or {}).get(side)
                if goalie and any(x['name'].casefold()==str(goalie.get('name','')).casefold() and x['status'] in UNAVAILABLE for x in rows):
                    g['goalies'][side]=None;problems.append(f'{team} listed goalie is unavailable; starter needs confirmation')
            g['availability']={'checkedAt':at,'source':'ESPN live injuries + NHL current rosters','sides':sides,'problems':problems}

def finalize(slates):
    for slate in slates:
        for g in slate['games']:
            a=g.get('availability') or {};reasons=list(a.get('problems',[]));through=(g.get('v4') or {}).get('trainedThrough')
            for side in ('away','home'):
                rows=(a.get('sides',{}).get(side) or {}).get('injuries',[])
                new=[x['name'] for x in rows if x['position']!='G' and x['status'] in UNAVAILABLE and through and str(x.get('updatedAt') or '')[:10]>through]
                if new:reasons.append(f"{g[side]} recent skater absences not individually modeled: {', '.join(new[:3])}")
            a['blockReason']='; '.join(reasons) or None
