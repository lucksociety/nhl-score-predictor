// Post-simulation only; prices and books never feed scoring rates or game outcomes.
const B=require('./bets');
function depthAtAsk(book,ask){
  if(!Array.isArray(book?.no)||!Array.isArray(book?.yes)||!Number.isFinite(ask)||ask<=0||ask>=1)return 0;
  const bids=book.yes.filter(r=>Array.isArray(r)&&r.length>=2).map(r=>r.map(Number)).filter(([p,n])=>p>0&&p<100&&Number.isFinite(n)&&n>0);
  if(!bids.length)return 0;
  const bid=Math.max(...bids.map(r=>r[0]))/100;
  if(bid>ask+1e-7 || ask-bid>.10+1e-7)return 0;
  return book.no.filter(r=>Array.isArray(r)&&r.length>=2).map(r=>r.map(Number)).reduce((sum,[p,n])=>p>0&&p<100&&Number.isFinite(n)&&n>0&&100-p<=ask*100+1e-7?sum+n:sum,0);
}
// Polymarket CLOB book of one outcome token -> the {yes, no} cent ladders depthAtAsk reads:
// yes = resting bids for the outcome; no = resting asks expressed as the opposite side's bid (100 - ask).
function clobBook(book){
 const rows=xs=>(Array.isArray(xs)?xs:[]).map(x=>[Number(x?.price),Number(x?.size)]).filter(([p,n])=>Number.isFinite(p)&&p>0&&p<1&&Number.isFinite(n)&&n>0);
 return {yes:rows(book?.bids).map(([p,n])=>[p*100,n]),no:rows(book?.asks).map(([p,n])=>[100-p*100,n])};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function liveBookFetcher(){
 let last=0;
 return async marketId=>{   // marketId here is the outcome's CLOB token id
  const pause=last+250-Date.now();if(pause>0)await wait(pause);last=Date.now();
  const r=await fetch('https://clob.polymarket.com/book?token_id='+encodeURIComponent(marketId),{cache:'no-store',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('order book HTTP '+r.status);return clobBook(await r.json());
 };
}
async function verifyExecution(P,{fetchBook=liveBookFetcher(),now=()=>Date.now()}={}){
 for(const g of P.games){
  const choices=[g.best,...(g.others||[])].filter(Boolean),valid=[];g.executionRejections=[];
  for(const c of choices){
   c.executionVerified=false;
   const fresh=()=>Number.isFinite(Date.parse(g.start)) && now()<Date.parse(g.start) && ['FUT','PRE'].includes(g.state) && Number.isFinite(Date.parse(g.quoteFetchedAt)) && now()>=Date.parse(g.quoteFetchedAt) && now()-Date.parse(g.quoteFetchedAt)<=300000 && !g.availability?.blockReason;
   if(!fresh() || !B.scoreSupports(c,g,g.pick) || !B.valuePass(c)){g.executionRejections.push({label:c.label,reason:'not verified pregame/fresh quote/displayed-score winner/value requirements'});continue;}
   const required=Math.max(10,Math.ceil(5/c.ask));c.requiredDepth=required;
   try{
    if(!c.tokenId)throw Error('no CLOB token for this contract');
    const book=await fetchBook(c.tokenId);c.executionDepth=depthAtAsk(book,c.ask);c.executionCheckedAt=new Date(now()).toISOString();
    if(!fresh() || c.executionDepth<required)throw Error('fresh executable depth below '+required+' contracts');
    c.executionVerified=true;valid.push(c);
   }catch(e){g.executionRejections.push({label:c.label,reason:e.message});}
  }
  g.best=valid[0]||null;g.others=valid.slice(1);g.qualifying=valid.length;
  if(!g.best&&choices.length)g.noBetReason='No qualifying value bet with fresh order-book depth: '+g.executionRejections.map(x=>x.label+' ('+x.reason+')').join('; ');
 }
 return P;
}
module.exports={depthAtAsk,verifyExecution,clobBook};
