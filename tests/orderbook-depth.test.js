const assert=require('node:assert/strict');
const {depthAtAsk,verifyExecution}=require('../js/execution');
const B=require('../js/bets');
assert.equal(B.fee(.25),.02,'single-contract published rounding is a conservative bound for all order quantities');
assert.equal(depthAtAsk({yes:[[64,100]],no:[[35,9],[34,1000]]},.65),9,'depth a cent above the ask cannot count');
assert.equal(depthAtAsk({yes:[[64,100]],no:[[35,10]]},.65),10);
assert.equal(depthAtAsk({yes:[[10,100]],no:[[35,100]]},.65),0,'wide current book fails closed');
const now=Date.parse('2099-01-01T12:00:00Z');
const cand=(label,q=.7)=>({type:'PUCKLINE',label,ask:.65,cost:.67,sensitivityLower:q,quoteStressEV:q/.68-1,marketId:label});
const game=()=>({away:'A',home:'H',state:'FUT',start:'2099-01-01T14:00:00Z',quoteFetchedAt:new Date(now).toISOString(),pick:{away:3,home:2},xg:[3,2],best:cand('A +1.5'),others:[cand('H +1.5',.69)]});
(async()=>{
 const g=game(),before=JSON.stringify({pick:g.pick,xg:g.xg});
 await verifyExecution({games:[g]},{now:()=>now,fetchBook:async id=>({yes:[[64,100]],no:[[35,id==='A +1.5'?9:10]]})});
 assert.equal(g.best.label,'H +1.5');assert(g.best.executionVerified);assert.equal(g.best.executionDepth,10);assert.equal(g.requiredDepth,undefined);
 assert.equal(JSON.stringify({pick:g.pick,xg:g.xg}),before,'book checks never alter scoring forecasts');
 const fail=game();await verifyExecution({games:[fail]},{now:()=>now,fetchBook:async()=>{throw Error('offline')}});assert.equal(fail.best,null);assert.deepEqual(fail.others,[]);
 const expired=game();let time=now;await verifyExecution({games:[expired]},{now:()=>time,fetchBook:async()=>{time=Date.parse('2099-01-01T14:01Z');return {yes:[[64,100]],no:[[35,100]]}}});assert.equal(expired.best,null);
 // A sub-cent paper edge fails a real one-cent quote stress, despite high win probability.
 const raw={away:'A',home:'H',state:'FUT',startUTC:'2099-01-01T14:00Z',jupiter:{fetchedAt:new Date(now).toISOString(),sides:{away:{ask:.86,bid:.85,status:'open',includesOTSO:true,volume:1000}}}};
 const o={pick:{away:3,home:2},n:400000,pAway:.8745,pHome:.1255,dist:{tot:[1],mar:[1]}};
 assert.equal(B.evaluate(raw,o,{now}).best,null);
 console.log('Rounded-fee bound, one-cent quote stress, exact-ask depth, fallback selection and expired-book failure passed');
})().catch(e=>{console.error(e);process.exitCode=1});
