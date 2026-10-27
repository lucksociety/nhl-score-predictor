// node tests/verify_oct26.js  -> compares JS v3 against python_ref_2026-10-26.json
const fs = require('fs'), path = require('path');
const M = require('../js/model.js');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/base_2025_26.json'))).teams;
const res = JSON.parse(fs.readFileSync(path.join(__dirname, 'results_through_2026-10-26.json')));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'python_ref_2026-10-26.json')));
const rat = M.teamRatings(base, res);
const specs = [
  { away: 'LAK', home: 'NYR', svAway: .902, svHome: .893, total: 5.5, over: -125, under: 105, mlAway: 114, mlHome: -132 },
  { away: 'TOR', home: 'CGY', svAway: .898, svHome: .903, total: 6.5, over: -120, under: 100, mlAway: -145, mlHome: 128 },
  { away: 'DET', home: 'EDM', svAway: .897, svHome: .893, total: 6.5, over: -120, under: 100, mlAway: 152, mlHome: -178 },
];
const pct = x => (100 * x).toFixed(1) + '%';
let ok = true; const rows = [];
for (const g of specs) {
  for (const seed of [11, 12]) {
    const t0 = Date.now();
    const o = M.runGame(g, rat, { n: 800000, nFit: 120000, seed });
    const py = ref.find(r => r.away === g.away && r.seed === seed);
    const same = o.pick.x === py.pick[0] && o.pick.y === py.pick[1] && o.pick.otLabel === py.ot_label;
    ok = ok && same;
    rows.push(`${g.away}@${g.home} seed ${seed}: JS ${o.pick.x}-${o.pick.y}${o.pick.otLabel ? ' OT' : ''} (P(OT|pick) ${pct(o.pick.potGiven)}, P(OT) ${pct(o.pOT)}, P(home) ${pct(o.pHome)}, xG ${o.ea.toFixed(2)}-${o.eh.toFixed(2)}, rates ${o.rates.map(v=>v.toFixed(3)).join('/')}) | PY ${py.pick.join('-')}${py.ot_label ? ' OT' : ''} (P(OT|pick) ${pct(py.pot_pick)}, P(OT) ${pct(py.p_ot)}, P(home) ${pct(py.p_home)}, xG ${py.ea.toFixed(2)}-${py.eh.toFixed(2)}, rates ${py.rates.map(v=>v.toFixed(3)).join('/')}) ${same ? 'MATCH' : 'DIFF'} [${Date.now() - t0} ms]`);
    console.log(rows[rows.length - 1]);
  }
}
console.log(ok ? 'ALL PICKS MATCH' : 'SOME PICKS DIFFER');
process.exit(ok ? 0 : 1);
