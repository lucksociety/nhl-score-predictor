// Probability, EV and score agreement must all hold. Rejected old score-fit policy never leaks through.
const assert=require('node:assert/strict'),B=require('../js/bets'),{verifyExecution}=require('../js/execution');
const now=Date.parse('2099-01-01T12:00:00Z');
const quote=(ask,more={})=>({ask,bid:ask-.01,status:'open',includesOTSO:true,volume:500,...more});
const total=(ou,line,ask,more={})=>quote(ask,{type:'totals',ou,line,...more});
const spread=(team,line,ask)=>quote(ask,{type:'spreads',team,line});
const game=extra=>({away:'AWY',home:'HOM',startUTC:'2099-01-01T18:00:00Z',state:'FUT',market:{fetchedAt:new Date(now).toISOString(),sides:{away:quote(.46),home:quote(.56)},extra}});
const mar=Array(21).fill(0);mar[8]=.1;mar[9]=.25;mar[11]=.4;mar[12]=.25;
const o={pick:{away:2,home:3},n:400000,pHome:.65,pAway:.35,dist:{tot:[0,0,0,0,.25,.3,.15,.1,.1,.1],mar}};
const lines=[total('U',5.5,.49),total('U',6.5,.63),total('O',5.5,.3),total('O',4.5,.8),spread('AWY',1.5,.68),spread('HOM',-1.5,.2)];
assert.equal(B.POLICY,'probability-value-score-depth-v4');
const e=B.evaluate(game(lines),o,{now});
assert.equal(e.best.label,'AWY +1.5','rank by conservative probability, not cheapest payout');
assert.deepEqual(e.others.map(x=>x.label),['Under 6.5','HOM ML','Under 5.5']);
for(const c of[e.best,...e.others])assert(B.valuePass(c)&&B.scoreSupports(c,game(lines),o.pick));
assert(e.cands.some(c=>c.label==='Over 5.5'&&!c.value),'sub-50% cheap line is rejected');
for(const g of [{...game(lines),state:'LIVE'},{...game(lines),availability:{blockReason:'unavailable goalie'}}])assert.equal(B.evaluate(g,o,{now}).best,null);
assert.equal(B.evaluate(game(lines),o,{now:now+300001}).best,null);
const raw={type:'TOTAL',label:'Under 5.5',ask:.49,fee:.02,cost:.51,q:.6,sensitivityLower:.58,tokenId:'token',value:true};
for(const bad of [{q:.5},{q:.46905},{q:.55,cost:.57},{sensitivityLower:.5},{sensitivityLower:.519},{sensitivityLower:NaN},{sensitivityLower:.7},{cost:.49}])assert(!B.valuePass({...raw,...bad}),JSON.stringify(bad));
// All four posted Nov22 primaries are rejected regardless of their stale value flag or positive raw EV.
for(const[q,ask]of [[.46905,.43],[.4802475,.44],[.4578925,.46],[.478565,.45]])assert(!B.valuePass({...raw,q,ask,cost:ask+B.fee(ask),sensitivityLower:q-.01,value:true}));
(async()=>{
 const row=best=>({away:'AWY',home:'HOM',state:'FUT',start:'2099-01-01T18:00:00Z',quoteFetchedAt:new Date(now).toISOString(),pick:o.pick,best,others:[]});
 const valid=row({...raw});let calls=0;
 const fetchBook=async()=>{calls++;return{yes:[[48,100]],no:[[51,50]]}};
 await verifyExecution({games:[valid]},{now:()=>now,fetchBook});assert(valid.best.executionVerified);
 const bad=row({...raw,q:.4,sensitivityLower:.39});calls=0;
 await verifyExecution({games:[bad]},{now:()=>now,fetchBook});assert.equal(bad.best,null);assert.equal(calls,0,'invalid edge rejected before order-book calls');
 const{payloads,gameEmbed}=await import('../js/discord_embeds.mjs');
 const view={...row({...raw,executionVerified:true}),time:'7:00 PM ET',pHome:.65,pAway:.35,pOT:.2,xg:[2.7,3.1],leans:{},markets:{}};
 assert.match(gameEmbed(view).description,/BEST BET: Under 5.5/);assert.match(gameEmbed(view).description,/EV stays positive/);
 for(const best of [{...raw,q:.4,sensitivityLower:.39,executionVerified:true},{...raw,executionVerified:false},{...raw,executionVerified:undefined}]){
  const text=JSON.stringify(payloads({date:'2099-01-01',sims:400000,games:[{...view,best,quoteFetchedAt:new Date().toISOString()}]}));assert(!text.includes('BEST BET:'));
 }
 assert.equal(B.payText({ask:.47}),'$10 wins $10.73');assert.equal(B.payText({ask:.25,feeSchedule:{rate:0,exponent:1}}),'$10 wins $30.00');
 console.log('Probability/value/score policy, confidence ranking and final publication revalidation passed');
})().catch(e=>{console.error(e);process.exitCode=1});
