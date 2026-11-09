"""Reproduce frozen 2024–November 8, 2026 official regular-season skater research inputs.
Usage: python research/fetch-skater-history.py --out /tmp/nhl-skater-research
"""
import urllib.request,urllib.parse,datetime as dt,json,gzip,time,concurrent.futures
from pathlib import Path
import argparse
ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);args=ap.parse_args();out=args.out;out.mkdir(parents=True,exist_ok=True)
ua={'User-Agent':'Mozilla/5.0 (luck-society-nhl-predictor; github.com/lucksociety/nhl-score-predictor)'}
def fetch(item):
 lo,hi=item;file=out/f'skaters-{lo}-{hi}.json.gz'
 if file.exists():return json.loads(gzip.decompress(file.read_bytes()))
 expr=f'gameDate>="{lo}" and gameDate<"{hi}" and gameTypeId=2'
 params={'isAggregate':'false','isGame':'true','start':0,'limit':-1,'cayenneExp':expr,'sort':json.dumps([{'property':'gameId','direction':'ASC'},{'property':'playerId','direction':'ASC'}])}
 url='https://api.nhle.com/stats/rest/en/skater/summary?'+urllib.parse.urlencode(params)
 for attempt in range(3):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers=ua),timeout=45) as r:x=json.load(r)
   rows=x['data']
   assert len(rows)<10000 and len(rows)>=x['total'],(lo,hi,len(rows),x['total'])
   keep=[{k:r[k] for k in ['gameId','gameDate','teamAbbrev','playerId','skaterFullName','positionCode','timeOnIcePerGame','goals','assists','shots']} for r in rows]
   file.write_bytes(gzip.compress(json.dumps(keep).encode(),mtime=0));print(lo,hi,len(keep),flush=True);return keep
  except Exception as e:
   if attempt==2:raise
   time.sleep(1)
periods=[]
for year in [2024,2025,2026]:
 end=dt.date(year+1,5,1) if year<2026 else dt.date(2026,11,9)
 d=dt.date(year,9,1)
 while d<end:
  nxt=min(end,d+dt.timedelta(days=10));periods.append((str(d),str(nxt)));d=nxt
with concurrent.futures.ThreadPoolExecutor(6) as pool:allrows=[r for part in pool.map(fetch,periods) for r in part]
(out/'skaters.json.gz').write_bytes(gzip.compress(json.dumps(allrows).encode(),mtime=0));print('TOTAL',len(allrows))
