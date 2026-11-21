// v4.1: a forecast's own simulator settings (v4.sim) are used everywhere it is simulated, and forecasts without
// them (frozen before v4.1, or the v3 path) are simulated exactly as before.
const assert = require('assert');
const M = require('../js/model.js');
const share = (r, k) => { let c = 0; for (let i = 0; i < r.n; i++) if (Math.abs(r.h[i] - r.a[i]) === k) c++; return c / r.n; };
const same = (x, y) => x.n === y.n && x.a.every((v, i) => v === y.a[i]) && x.h.every((v, i) => v === y.h[i]);

// 1. default settings are untouched: pull3 = 1 is the original timing, draw for draw
assert(same(M.simulate(2.7, 2.9, 50000, 5), M.simulate(2.7, 2.9, 50000, 5, { pull1: 1, pull2: 1, pull3: 1 })), 'defaults changed');

// 2. a later goalie pull when trailing by three leaves more 3-goal wins and fewer 4-goal wins
const old = M.simulate(2.7, 2.9, 300000, 5), fix = M.simulate(2.7, 2.9, 300000, 5, { pull3: 0.4 });
assert(share(fix, 3) > share(old, 3) + 0.02, 'three-goal margins should rise');
assert(share(fix, 4) < share(old, 4) - 0.02, 'four-goal margins should fall');
assert(Math.abs(share(fix, 1) - share(old, 1)) < 0.004 && Math.abs(share(fix, 2) - share(old, 2)) < 0.004, 'one- and two-goal games are not affected');

// 3. runGameV4 and runGrid both honour v4.sim, and agree with each other
const v4 = { ra: 2.7, rh: 2.9, betaGq: 0.4, goalies: { away: { gq: 0 }, home: { gq: 0 } } };
const g0 = { away: 'AAA', home: 'HHH', goalies: { away: { status: 'Confirmed' }, home: { status: 'Confirmed' } }, v4 };
const g1 = Object.assign({}, g0, { v4: Object.assign({}, v4, { sim: { pull3: 0.4 }, version: 'v4.1-independent' }) });
const o0 = M.runGameV4(g0, { n: 200000, seed: 9 }), o1 = M.runGameV4(g1, { n: 200000, seed: 9 });
assert.strictEqual(o0.version, 'v4-independent'); assert.strictEqual(o1.version, 'v4.1-independent');
assert.strictEqual(o0.sim, null); assert.deepStrictEqual(o1.sim, { pull3: 0.4 });
const by4 = o => M.pCover(o.dist, 'home', -3.5) + M.pCover(o.dist, 'away', -3.5);
assert(by4(o1) < by4(o0) - 0.02, 'forecast with v4.sim should show fewer 4+ goal wins');
for (const s of o1.calibrationStress) assert(s.dist, 'stress scenarios present');
const grid = M.runGrid({ rates: [v4.ra, v4.rh], n: 200000, seed: 9, sim: { pull3: 0.4 } });
assert(Math.abs(grid.pHome - o1.pHome) < 1e-12, 'Simulator tab and forecast must agree at the same seed');
console.log('simulator settings ok');
