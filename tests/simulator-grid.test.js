// The Simulator tab's single-game run must agree with the forecast engine and return a valid score grid.
const assert = require('assert');
const M = require('../js/model.js');
const v4 = { ra: 2.77, rh: 3.08, betaGq: 0.41, goalies: { away: { gq: -0.06 }, home: { gq: -0.15 } } };
const o = M.runGrid({ rates: [v4.ra, v4.rh], n: 60000, seed: 7 });
const ref = M.runGameV4({ away: 'AAA', home: 'HHH', v4 }, { n: 60000, seed: 7, calibrationStress: false });
assert.strictEqual(o.pHome, ref.pHome, 'same rates and seed give the same win probability as the forecast engine');
assert.strictEqual(o.ea, ref.ea);
assert.strictEqual(o.grid.length, 7);
const sum = o.grid.flat().reduce((a, b) => a + b, 0);
assert.ok(Math.abs(sum - 1) < 1e-9, 'grid sums to 1');
for (let k = 0; k < 6; k++) assert.strictEqual(o.grid[k][k], 0, 'a game cannot end level');
let home = 0; o.grid.forEach((r, x) => r.forEach((p, y) => { if (y > x) home += p; }));
assert.ok(Math.abs(home - o.pHome) < 0.01, 'grid agrees with the home win probability (6+ bucket aside)');
// a worse home goalie (higher gq) raises the away side's scoring, as in runGameV4
const worse = M.runGameV4({ away: 'AAA', home: 'HHH', v4 }, { n: 60000, seed: 7, calibrationStress: false, gq: { home: 0.1 } });
const mine = M.runGrid({ rates: [v4.ra * Math.exp(v4.betaGq * (0.1 - v4.goalies.home.gq)), v4.rh], n: 60000, seed: 7 });
assert.strictEqual(mine.pHome, worse.pHome, 'goalie change uses the same rule as the forecast engine');
assert.ok(mine.pHome < o.pHome);
console.log('simulator grid ok');
