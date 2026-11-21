// Helper for walkforward-nov21.py. stdin: {P, scale, n, games:[[la,lh,a,h],...]} -> per-game log-probabilities of the
// real result (exact score, winner, margin, total) under the production simulator with settings P.
// The simulator is run on a grid of scoring rates and interpolated, so 4,000+ games cost about a minute.
const M = require(require('path').join(__dirname, '..', 'js', 'model.js'));
const inp = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const lo = inp.lo || 1.6, st = inp.st || 0.45, K = inp.k || 7, N = inp.n || 50000, B = 11;
const ax = Array.from({ length: K }, (_, i) => lo + st * i);
const cells = [];
for (const ra of ax) for (const rh of ax) {
  const r = M.simulate(ra, rh, N, 4242, inp.P), J = new Float64Array(B * B), hw = [0], tie = [0];
  let w = 0, t = 0;
  for (let i = 0; i < r.n; i++) { const a = Math.min(B - 1, r.a[i]), h = Math.min(B - 1, r.h[i]); J[a * B + h]++; if (r.h[i] > r.a[i]) w++; if (r.tie[i]) t++; }
  for (let i = 0; i < B * B; i++) J[i] /= r.n;
  cells.push({ J, w: w / r.n, t: t / r.n });
}
const out = { ex: [], win: [], mar: [], tot: [], tie: [], ea: [], eh: [], dist: inp.dist ? [] : undefined };
for (const [la, lh, a, h] of inp.games) {
  const x = Math.max(0, Math.min(K - 1.001, (la * inp.scale - lo) / st)), y = Math.max(0, Math.min(K - 1.001, (lh * inp.scale - lo) / st));
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const W = [[i * K + j, (1 - fx) * (1 - fy)], [(i + 1) * K + j, fx * (1 - fy)], [i * K + j + 1, (1 - fx) * fy], [(i + 1) * K + j + 1, fx * fy]];
  const J = new Float64Array(B * B); let pw = 0, pt = 0;
  for (const [c, w] of W) { const C = cells[c]; for (let q = 0; q < B * B; q++) J[q] += w * C.J[q]; pw += w * C.w; pt += w * C.t; }
  const mar = new Float64Array(2 * B), tot = new Float64Array(2 * B); let ea = 0, eh = 0;
  for (let p = 0; p < B; p++) for (let q = 0; q < B; q++) { const v = J[p * B + q]; mar[q - p + B] += v; tot[p + q] += v; ea += p * v; eh += q * v; }
  const A = Math.min(B - 1, a), H = Math.min(B - 1, h), eps = 1e-5;
  out.ex.push(Math.log(J[A * B + H] + eps)); out.win.push(Math.log((h > a ? pw : 1 - pw) + eps));
  out.mar.push(Math.log(mar[Math.max(-6, Math.min(6, h - a)) === h - a ? h - a + B : (h > a ? 6 + B : -6 + B)] + (Math.abs(h - a) > 6 ? 0 : 0) + eps));
  out.tot.push(Math.log(tot[Math.min(2 * B - 1, a + h)] + eps)); out.tie.push(pt); out.ea.push(ea); out.eh.push(eh);
  if (inp.dist) out.dist.push([Array.from(mar), Array.from(tot), pw]);
}
process.stdout.write(JSON.stringify(out));
