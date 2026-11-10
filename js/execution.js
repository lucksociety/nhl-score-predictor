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
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function liveBookFetcher(){
 let last=0;
 return async marketId=>{
  const pause=last+2100-Date.now();if(pause>0)await wait(pause);last=Date.now();
  const r=await fetch('https://api.jup.ag/prediction/v1/orderbook/'+encodeURIComponent(marketId),{cache:'no-store',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('order book HTTP '+r.status);return r.json();
 };
}
async function verifyExecution(P,{fetchBook=liveBookFetcher(),now=()=>Date.now()}={}){
 for(const g of P.games){
  const choices=[g.best,...(g.others||[])].filter(Boolean),valid=[];g.executionRejections=[];
  for(const c of choices){
   c.executionVerified=false;
   const fresh=()=>Number.isFinite(Date.parse(g.start)) && now()<Date.parse(g.start) && ['FUT','PRE'].includes(g.state) && Number.isFinite(Date.parse(g.quoteFetchedAt)) && now()>=Date.parse(g.quoteFetchedAt) && now()-Date.parse(g.quoteFetchedAt)<=300000 && !g.availability?.blockReason;
   if(!fresh() || !B.scoreSupports(c,g,g.pick)){g.executionRejections.push({label:c.label,reason:'not verified pregame/fresh quote/displayed-score winner'});continue;}
   const required=Math.max(10,Math.ceil(5/c.ask));c.requiredDepth=required;
   try{
    const book=await fetchBook(c.marketId);c.executionDepth=depthAtAsk(book,c.ask);c.executionCheckedAt=new Date(now()).toISOString();
    if(!fresh() || c.executionDepth<required)throw Error('fresh executable depth below '+required+' contracts');
    if(!(c.sensitivityLower>.5 && c.sensitivityLower>c.cost && c.quoteStressEV>0))throw Error('probability/EV not robust to fee or quote stress');
    c.executionVerified=true;valid.push(c);
   }catch(e){g.executionRejections.push({label:c.label,reason:e.message});}
  }
  g.best=valid[0]||null;g.others=valid.slice(1);g.qualifying=valid.length;
  if(!g.best&&choices.length)g.noBetReason='No qualifying bet with fresh executable order-book depth: '+g.executionRejections.map(x=>x.label+' ('+x.reason+')').join('; ');
 }
 return P;
}
module.exports={depthAtAsk,verifyExecution};
