// Deterministic production-simulator grid. Research only; no market inputs.
const fs=require('node:fs'),M=require('../js/model.js');
const lo=.5,step=.3,k=23,n=100000,B=17,cells=[];
for(let i=0;i<k;i++)for(let j=0;j<k;j++){
 const r=M.simulate(lo+i*step,lo+j*step,n,4242,{pull3:.4});const joint=Array(B*B).fill(0);
 for(let z=0;z<r.n;z++)joint[Math.min(B-1,r.a[z])*B+Math.min(B-1,r.h[z])]++;
 cells.push(joint.map(x=>x/n));
}
fs.writeFileSync(process.argv[2]||'research/uncertainty-grid-nov23.json',JSON.stringify({lo,step,k,n,B,cells}));
