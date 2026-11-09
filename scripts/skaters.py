"""Market-free skater context: prior player production and team participation.
The fitted layer adjusts only the difference from the lineup mixture already in team ratings.
"""
import copy,datetime as dt,json,math,unicodedata,urllib.parse
from pathlib import Path
from v4_model import SCALE
DATA=Path(__file__).resolve().parents[1]/'data/v4'
POLICY=json.loads((Path(__file__).resolve().parents[1]/'research/skater-policy.json').read_text()) if (Path(__file__).resolve().parents[1]/'research/skater-policy.json').exists() else {}
OUT={'out','injured reserve','suspension','suspended','inactive'}
UNCERTAIN={'questionable','day-to-day','day to day','doubtful'}

def norm(s):return ''.join(c for c in unicodedata.normalize('NFKD',s or '').casefold() if c.isalnum())
def empty():return {'schema':1,'through':None,'season':None,'players':{},'teams':{},'league':{'D':[0.,0.],'F':[0.,0.]},'games':[]}
def quality(state,pid):
    p=state['players'].get(str(pid))
    if not p:return 0.
    total,n=state['league'][p['pos']];mu=total/n if n else 0.
    return (p['gc']-p['w']*mu)/(p['w']+20.)
def feature(state,team,ids):
    t=state['teams'].get(team)
    if not t or t['w']<=0:raise ValueError(f'{team} participation baseline unavailable')
    baseline=sum(quality(state,pid)*w for pid,w in t['players'].items())/t['w']
    return sum(quality(state,pid) for pid in ids)-baseline

def begin_season(state,season):
    if state['season'] and season!=state['season']:
        for p in state['players'].values():
            for k in ('w','gc','toi'):p[k]*=.7
        for t in state['teams'].values():
            t['w']*=.3;t['players']={pid:w*.3 for pid,w in t['players'].items()}
    state['season']=season

def advance(state,records):
    """Ingest completed game rows once, in date order. Caller provides dates before prediction day."""
    seen=set(state['games']);by={}
    for p in records:
        gid=int(p['gameId'])
        if gid in seen:continue
        by.setdefault((p['gameDate'],gid),[]).append(p)
    for (date,gid),ps in sorted(by.items()):
        if state['through'] and date<state['through']:raise ValueError('skater history gap needs chronological rebuild')
        counts={}
        for p in ps:
            if p['timeOnIcePerGame']>0:counts[p['teamAbbrev']]=counts.get(p['teamAbbrev'],0)+1
        if len(counts)!=2 or any(not 16<=v<=19 for v in counts.values()):raise ValueError(f'incomplete skater participation for {gid}')
        if len({p['playerId'] for p in ps})!=len(ps):raise ValueError('duplicate skater game rows')
        season=int(str(gid)[:4])
        begin_season(state,season)
        for team in counts:
            t=state['teams'].setdefault(team,{'w':0.,'players':{}});lam=.5**(1/25)
            t['w']=t['w']*lam+1;t['players']={pid:w*lam for pid,w in t['players'].items()}
            for row in ps:
                if row['teamAbbrev']!=team or row['timeOnIcePerGame']<=0:continue
                pid=str(row['playerId']);pos='D' if row['positionCode']=='D' else 'F'
                for k in ['timeOnIcePerGame','goals','assists']:
                    if not isinstance(row[k],(float,int)) or not math.isfinite(row[k]) or row[k]<0:raise ValueError('invalid skater statistic')
                p=state['players'].setdefault(pid,{'w':0.,'gc':0.,'toi':0.,'pos':pos})
                p['w']+=1;p['gc']+=row['goals']+.5*row['assists'];p['toi']+=row['timeOnIcePerGame']
                p.update(name=row['skaterFullName'],team=team,last=date)
                state['league'][pos][0]+=row['goals']+.5*row['assists'];state['league'][pos][1]+=1
                t['players'][pid]=t['players'].get(pid,0)+1
        state['through']=date;seen.add(gid)
    state['games']=sorted(seen)
    return state

def fetch_recent(state,rows,cutoff,get):
    """Always verify recent official game logs; accept only completed model-history games before cutoff."""
    lo=str(dt.date.fromisoformat(state['through'])-dt.timedelta(days=5))
    expected={r['id'] for r in rows if lo<=r['date']<cutoff}
    records=[];day=dt.date.fromisoformat(lo);end=dt.date.fromisoformat(cutoff)
    while day<end:
        nxt=min(day+dt.timedelta(days=10),end)
        query=urllib.parse.urlencode({'isAggregate':'false','isGame':'true','start':0,'limit':-1,'cayenneExp':f'gameDate>="{day}" and gameDate<"{nxt}" and gameTypeId=2'})
        body=get('https://api.nhle.com/stats/rest/en/skater/summary?'+query)
        if not isinstance(body,dict) or not isinstance(body.get('data'),list) or len(body['data'])!=body.get('total'):raise ValueError('official skater game-log feed incomplete')
        for p in body['data']:
            if not str(day)<=p['gameDate']<str(nxt):raise ValueError('skater feed returned dates outside request')
            if int(p['gameId']) in expected:records.append(p)
        day=nxt
    if {int(p['gameId']) for p in records}!=expected:raise ValueError('skater game logs missing completed team games')
    return advance(copy.deepcopy(state),records)

def expected_lineup(state,team,roster,injuries,extra_out=()):
    blocked={norm(x['name']) for x in injuries if str(x['status']).casefold() in OUT}|set(extra_out)
    selected=[]
    for position,count in [('F',12),('D',6)]:
        players=[p for p in roster if p.get('position') in ('C','L','R','F','D') and ('D' if p.get('position')=='D' else 'F')==position and norm(p['name']) not in blocked]
        def rank(p):
            s=state['players'].get(str(p['id']),{});return s.get('toi',0)/max(1,s.get('w',0))
        players.sort(key=lambda p:(-rank(p),str(p['id'])))
        if len(players)<count:raise ValueError(f'{team} insufficient verified roster depth for expected lineup')
        selected.extend(players[:count])
    if any(str(p['id']) not in state['players'] for p in selected):raise ValueError(f'{team} expected skater lacks NHL performance history')
    return selected

def apply_game(g,state,date,policy=POLICY):
    v=g.get('v4');a=g.get('availability') or {}
    if not v or v.get('frozen') or g.get('state') not in ('FUT','PRE',None):return
    if not state.get('through') or state['through']>=date:raise ValueError('skater context is not strictly pregame')
    if v.get('skaterAdjustment'):raise ValueError('skater adjustment already applied')
    contexts={};uncertain={};matched={}
    for side in ('away','home'):
        team=g[side];s=a.get('sides',{}).get(side) or {};roster=s.get('roster')
        if not isinstance(roster,list):raise ValueError(f'{team} current roster unavailable')
        injuries=s.get('injuries',[]);matched[side]=[]
        for x in injuries:
            if x['position']=='G' or str(x['status']).casefold() not in OUT|UNCERTAIN:continue
            candidates=[pid for pid,p in state['players'].items() if norm(p.get('name'))==norm(x['name'])]
            if not candidates and not any(norm(p['name'])==norm(x['name']) for p in roster):
                matched[side].append({'name':x['name'],'id':None,'status':x['status'],'baselineParticipation':0.,'productionAbovePositionMean':None,'note':'not on current official roster and no recorded participation; no baseline contribution to remove'})
                continue
            if len(candidates)!=1:raise ValueError(f"{team} cannot uniquely model skater {x['name']}")
            pid=candidates[0];t=state['teams'][team]
            matched[side].append({'name':x['name'],'id':int(pid),'status':x['status'],'baselineParticipation':round(t['players'].get(pid,0)/t['w'],4),'productionAbovePositionMean':round(quality(state,pid),4)})
        chosen=expected_lineup(state,team,roster,injuries)
        contexts[side]={'selected':chosen,'delta':feature(state,team,[p['id'] for p in chosen])}
        uncertain[side]=[x['name'] for x in injuries if x['position']!='G' and str(x['status']).casefold() in UNCERTAIN]
    beta=policy['coefficients'];base=[v['la'],v['lh']];d=[contexts[s]['delta'] for s in ('away','home')]
    def rates(delta):
        bounds=policy['feature_bounds']
        if any(not bounds[0]<=x<=bounds[1] for x in delta):raise ValueError('lineup change outside validated feature range')
        return [base[0]*math.exp(beta[0]*delta[0]+beta[1]*delta[1]),base[1]*math.exp(beta[0]*delta[1]+beta[1]*delta[0])]
    adjusted=rates(d);variants=[{'label':'unadjusted team baseline','rates':[v['ra'],v['rh']]}]
    for side in ('away','home'):
        if not uncertain[side]:continue
        s=a['sides'][side];chosen=expected_lineup(state,g[side],s['roster'],s['injuries'],[norm(n) for n in uncertain[side]])
        alternate=list(d);alternate[0 if side=='away' else 1]=feature(state,g[side],[p['id'] for p in chosen])
        variants.append({'label':g[side]+' questionable skaters OUT','rates':[r*SCALE for r in rates(alternate)]})
    v['skaterAdjustment']={'policy':policy['id'],'dataThrough':state['through'],'baseGoals':base,'adjustedGoals':adjusted,'featureDelta':d,'lineupStatus':'EXPECTED — ranked by prior ice time; not confirmed game-day actives','sides':{s:{'players':contexts[s]['selected'],'absences':matched[s]} for s in ('away','home')},'scenarios':variants}
    v.update(la=round(adjusted[0],4),lh=round(adjusted[1],4),ra=round(adjusted[0]*SCALE,4),rh=round(adjusted[1]*SCALE,4),version='v4-independent-skater-v1')
    a['skaterAdjustment']=v['skaterAdjustment']

def refresh_and_apply(slates,rows,get,now=None):
    now=now or dt.datetime.now(dt.timezone.utc)
    eligible=[(s,g) for s in slates for g in s['games'] if g.get('v4') and not g['v4'].get('frozen') and g.get('state') in ('FUT','PRE',None) and g.get('startUTC') and now<dt.datetime.fromisoformat(g['startUTC'].replace('Z','+00:00'))]
    if not eligible:return
    try:
        state=json.loads((DATA/'skaters.json').read_text())
        if state.get('schema')!=1:raise ValueError('unsupported skater context schema')
        cutoff=min(s['date'] for s,g in eligible)
        if state['through']>=cutoff:raise ValueError('saved skater context is newer than requested pregame date')
        state=fetch_recent(state,rows,cutoff,get)
        (DATA/'skaters.json').write_text(json.dumps(state,separators=(',',':'))+'\n')
        error=None
    except (ValueError,KeyError,TypeError,OSError) as e:error=str(e)
    for slate,g in eligible:
        a=g.setdefault('availability',{})
        try:
            if error:raise ValueError(error)
            apply_game(g,state,slate['date'])
            a['skaterModelStatus']='adjusted';a['skaterCheckedAt']=now.isoformat()
        except (ValueError,KeyError,TypeError) as e:
            a['skaterModelStatus']='unavailable';a['skaterModelReason']=str(e)
