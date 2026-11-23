const assert=require('node:assert/strict');
const M=require('../js/model.js'), B=require('../js/bets.js');
const now=Date.parse('2099-01-01T12:00:00Z');
const goalie={gq:0,status:'Expected',candidates:[{gq:0},{gq:.8}]};
const g={away:'A',home:'H',startUTC:'2099-01-01T18:00:00Z',state:'FUT',
  goalies:{away:{status:'Confirmed'},home:{status:'Expected'}},
  market:{fetchedAt:new Date(now).toISOString(),sides:{away:{ask:.60,bid:.59,volume:1000,status:'open',includesOTSO:true}}},
  v4:{ra:3.5,rh:2.5,la:3.5,lh:2.5,betaGq:1,goalies:{away:structuredClone(goalie),home:structuredClone(goalie)}}};
const original=JSON.stringify(g);
const o=M.runGameV4(g,{n:20000,seed:11});
const base=M.runGameV4(g,{n:20000,seed:11,calibrationStress:false});
assert.equal(o.pHome,base.pHome,'point forecast must stay unchanged');
const scenarios=o.calibrationStress.filter(s=>s.label==='unconfirmed roster-goalie sensitivity');
assert.equal(scenarios.length,1,'confirmed away goalie has no alternatives');
assert(scenarios[0].pAway>base.pAway,'weaker home goalie increases away chances');
assert.equal(JSON.stringify(g),original,'input remains immutable');
g.goalies.away.status='Expected';
g.v4.goalies.away.candidates=[{gq:0},{gq:.8}];
const both=M.runGameV4(g,{n:20000,seed:11});
const alternatives=both.calibrationStress.filter(s=>s.label==='unconfirmed roster-goalie sensitivity');
assert.equal(alternatives.length,3,'include both-side switches as well as individual switches');
assert(alternatives.some(s=>s.pAway<base.pAway));
// Fragile away edge passes without starter uncertainty, fails under a stronger opposing goalie.
g.v4.goalies.home.candidates=[{gq:0},{gq:-.8}];
g.v4.goalies.away.candidates=[{gq:0}];
g.market.sides.away.ask=.52;g.market.sides.away.bid=.51;
const fragile=M.runGameV4(g,{n:20000,seed:11});
assert(B.evaluate(g,base,{now}).best.value,'the baseline edge is a value bet');
assert.equal(B.evaluate(g,fragile,{now}).best,null,'a starter-dependent edge is not a value bet');
const explicit=M.runGameV4(g,{n:1000,seed:11,gq:{home:0}});
assert(!explicit.calibrationStress.some(s=>s.label==='unconfirmed roster-goalie sensitivity'),'manual goalie override locks the scenario');
console.log('Roster-goalie sensitivity, simultaneous switches and fragile-edge rejection passed');
