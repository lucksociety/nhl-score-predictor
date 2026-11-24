"""MoneyPuck goalie-specific expected goals; accept only NHL GA/SA-matched identities.

Public listed season ZIPs are cached as a minimal deterministic CSV gzip. Data
are used only when State.update ingests a completed prior game, never as pregame
knowledge of the current game's starter. Network failures retain the old cache.
"""
import csv,gzip,hashlib,io,json,math,time,zipfile
from pathlib import Path
URL='https://peter-tanner.com/moneypuck/downloads/seasonPlayersSummary/goalies/{year}.zip'
FIELDS=['game','player','goals','xga','shots']
def parse(raw,year):
 out={}
 with zipfile.ZipFile(io.BytesIO(raw))as archive:
  files=[f for f in archive.infolist()if f.filename.endswith('.csv')]
  if len(files)!=1 or files[0].file_size>50_000_000:raise ValueError('Unexpected goalie archive')
  for r in csv.DictReader(io.StringIO(archive.read(files[0]).decode('utf-8-sig'))):
   if r['situation']!='all' or float(r['icetime'])<=0:continue
   gid=int(r['gameId']);pid=int(r['playerId']);values=[float(r[k])for k in ['goals','xGoals','ongoal']]
   if int(str(gid)[:4])!=year or not 0<=values[0]<=values[2]<=100 or not 0<=values[1]<=30 or not all(math.isfinite(x)for x in values):raise ValueError('Invalid goalie game record')
   if(gid,pid)in out:raise ValueError('Duplicate goalie game identity')
   out[(gid,pid)]=values
 if not out:raise ValueError('Empty goalie archive')
 return out

def load(path):
 path=Path(path)
 if not path.exists():return {}
 with gzip.open(path,'rt',newline='')as f:
  out={}
  for r in csv.DictReader(f):
   values=[float(r[k])for k in ['goals','xga','shots']]
   if not all(math.isfinite(x)for x in values)or not 0<=values[0]<=values[2]<=100 or not 0<=values[1]<=30:raise ValueError('Invalid goalie cache')
   key=(int(r['game']),int(r['player']))
   if key in out:raise ValueError('Duplicate goalie cache identity')
   out[key]=values
  return out

def save(path,data):
 buf=io.StringIO();writer=csv.DictWriter(buf,FIELDS,lineterminator='\n');writer.writeheader()
 for(gid,pid),values in sorted(data.items()):writer.writerow(dict(zip(FIELDS,[gid,pid,*values])))
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
 with gzip.GzipFile(path,'wb',mtime=0)as f:f.write(buf.getvalue().encode())

def attach(rows,data):
 for r in rows:
  for side in ['a','h']:
   verified=[]
   for pid,shots,saves in r.get('gsa_'+side,[])or[]:
    values=data.get((r['id'],pid))
    if values and abs(values[0]-(shots-saves))<.1 and abs(values[2]-shots)<.1:verified.append([pid,*values])
   if verified:r['gxa_'+side]=verified
   else:r.pop('gxa_'+side,None)
 return rows

def refresh(rows,folder,get,now=None):
 folder=Path(folder);path=folder/'goalie_xga.csv.gz';meta_path=folder/'goalie_xga_meta.json';now=time.time()if now is None else now
 data=load(path);meta=json.loads(meta_path.read_text())if meta_path.exists()else {'years':{}}
 years=sorted({int(str(r['id'])[:4])for r in rows if r['season']>=20212022})
 for year in years:
  old=meta['years'].get(str(year));recent=year==max(years)
  if old and(not recent or now-old['fetched_at']<6*3600):continue
  raw=get(URL.format(year=year),raw=True,timeout=60)
  if not raw:continue
  try:parsed=parse(raw,year)
  except(ValueError,KeyError,zipfile.BadZipFile):continue
  # Replace a season only after validation; source removal never deletes an earlier accepted game.
  data.update(parsed);meta['years'][str(year)]={'fetched_at':now,'sha256':hashlib.sha256(raw).hexdigest(),'rows':len(parsed),'source':URL.format(year=year)}
 if data:save(path,data);meta_path.write_text(json.dumps(meta,indent=2)+'\n')
 return attach(rows,data)
