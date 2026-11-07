const assert=require('node:assert/strict');
const B=require('../js/bets.js'),M=require('../js/model.js');
const now=Date.parse('2026-11-07T12:00:00Z');
const quote=(line,ask)=>({type:'totals',ou:'U',line,ask,bid:ask-.01,volume:100,status:'open',includesOTSO:true});
const g={away:'A',home:'H',startUTC:'2026-11-08T00:00:00Z',state:'FUT',jupiter:{fetchedAt:new Date(now).toISOString(),sides:{},extra:[quote(6.5,.60)]}};
const d=q=>({tot:[0,0,0,0,0,0,q,1-q],mar:[0]});
const o={n:400000,pHome:.5,pAway:.5,dist:d(.62)};
assert(B.evaluate(g,o,{now}).best,'baseline-only edge is positive');
const before=JSON.stringify(o);
assert(!B.evaluate(g,{...o,calibrationStress:[{n:100000,pHome:.5,pAway:.5,dist:d(.60)}]},{now}).best,'fragile edge must fail sensitivity check');
assert.equal(JSON.stringify(o),before,'forecast remains immutable');
const multi={...g,jupiter:{...g.jupiter,extra:[quote(6.5,.55),quote(8.5,.8)]}};
const dd={tot:[0,0,0,0,0,0,.62,.1,.18,.1],mar:[0]};
assert.equal(B.evaluate(multi,{...o,dist:dd},{now}).best.label,'Under 8.5','rank confidence among positive-EV qualifiers');
const game={away:'A',home:'H',v4:{ra:3,rh:3,la:3,lh:3,betaGq:0,goalies:{away:{gq:0},home:{gq:0}}}};
const base=M.runGameV4(game,{n:1000,seed:11,calibrationStress:false});const stressed=M.runGameV4(game,{n:1000,seed:11});
assert.deepEqual(stressed.pick,base.pick);assert.equal(stressed.pHome,base.pHome);assert.equal(stressed.calibrationStress.length,2);
console.log('Scoring parameter sensitivity and confidence-first positive-EV selection passed');

(async()=>{
 const {payloads}=await import('../js/discord_embeds.mjs');
 const rows=Array.from({length:16},(_,i)=>({away:'A'+i,home:'H'+i,start:'2099-11-08T00:00:00Z',quoteFetchedAt:new Date().toISOString(),error:'context '.repeat(130)}));
 const messages=payloads({date:'2099-11-07',sims:400000,games:rows});
 assert.equal(messages.reduce((n,m)=>n+m.embeds.length,0),17);
 for(const m of messages){assert(m.embeds.length<=10);assert(m.embeds.reduce((n,e)=>n+(e.title||'').length+(e.description||'').length+(e.footer?.text||'').length,0)<=6000);}
 console.log('Full-card Discord character and embed limits passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
