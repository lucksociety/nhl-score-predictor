// Verify exact quantiles from the same simulations, including uncapped tails.
const assert=require('node:assert/strict'),M=require('../js/model.js');
const r=M.simulate(2.7,2.9,30000,19,{pull3:.4});
const out=M.analyze(r);
const interval=v=>{v.sort((a,b)=>a-b);return [.1,.9].map(q=>v[Math.ceil(q*v.length)-1]);};
assert.deepEqual(out.scoreIntervals.total80,interval(Array.from(r.a,(v,i)=>v+r.h[i])));
assert.deepEqual(out.scoreIntervals.margin80,interval(Array.from(r.h,(v,i)=>v-r.a[i])));
const extreme={a:Int16Array.from([0,0,0,0,0,0,0,0,0,30]),h:Int16Array.from([1,1,1,1,1,1,1,1,25,0]),tie:new Uint8Array(10),og:new Uint8Array(10),en:new Int16Array(10),n:10};
assert.deepEqual(M.analyze(extreme).scoreIntervals.total80,[1,25]);
assert.deepEqual(M.analyze(extreme).scoreIntervals.margin80,[-30,1]);
console.log('NHL exact simulation interval and tail tests passed');
