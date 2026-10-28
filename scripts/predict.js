#!/usr/bin/env node
/* Runs the v4-independent Monte Carlo for every game on a slate and scores the Jupiter best bet.
 * usage: node scripts/predict.js [YYYY-MM-DD] [--n 400000] [--seed 11] [--check]
 * writes data/predictions/DATE.json. --check adds a seed-stability check (5 extra seeds on each game). */
const fs = require('fs'), path = require('path');
const M = require('../js/model.js'), B = require('../js/bets.js');
const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
function etDate(d = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d); }
function etTime(iso) { return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET'; }

function predictSlate(date, opts = {}) {
  const n = +(opts.n || 400000), seed = +(opts.seed || 11);
  const f = path.join(ROOT, 'data', 'days', date + '.json');
  if (!fs.existsSync(f)) return { date, games: [], note: 'no slate file' };
  const slate = JSON.parse(fs.readFileSync(f, 'utf8'));
  const t0 = Date.now(), games = [];
  for (const g of slate.games) {
    const row = { id: g.id, away: g.away, home: g.home, awayName: g.awayName, homeName: g.homeName, start: g.startUTC, time: etTime(g.startUTC),
                  state: g.state, final: g.final, goalies: g.goalies, jupiterLink: g.jupiter && g.jupiter.link };
    if (!g.v4) { row.error = 'no v4 rates (game already in the model history or data missing)'; games.push(row); continue; }
    const o = M.runGameV4(g, { n, seed });
    if (o.n !== n) throw new Error(`sim count mismatch ${o.n} != ${n}`);
    const e = B.evaluate(g, o);
    if (!['FUT', 'PRE'].includes(g.state)) { e.best = null; e.reason = 'game already started (pre-game prediction shown; no live bet)'; }
    Object.assign(row, {
      sims: o.n, simMs: Math.round(o.simMs), rates: o.rates.map(x => +x.toFixed(4)), xg: [+o.ea.toFixed(3), +o.eh.toFixed(3)],
      pick: { away: o.pick.x, home: o.pick.y, ot: !!o.pick.otLabel, winner: o.pick.winner, pScore: +o.pick.p.toFixed(4) },
      pAway: +o.pAway.toFixed(4), pHome: +o.pHome.toFixed(4), pOT: +o.pOT.toFixed(4),
      top: o.top.slice(0, 3).map(c => ({ a: c.x, h: c.y, p: +c.p.toFixed(4) })),
      v4goalies: { away: g.v4.goalies.away.name || 'team blend', home: g.v4.goalies.home.name || 'team blend' },
      best: e.best && { type: e.best.type, label: e.best.label, q: +e.best.q.toFixed(4), ask: e.best.ask, fee: +e.best.fee.toFixed(4), ev: +e.best.ev.toFixed(4), edge: +e.best.edge.toFixed(4) },
      noBetReason: e.best ? null : e.reason,
      cands: e.cands.map(c => ({ type: c.type, label: c.label, q: +c.q.toFixed(4), ask: c.ask, ev: +c.ev.toFixed(4) })),
      leans: Object.fromEntries(Object.entries(e.leans).map(([k, v]) => [k, +v.toFixed(4)])), jupiterTotals: e.hasTotals, jupiterPuckLine: e.hasPL,
    });
    if (opts.check) {
      const ph = [], ot = [], pk = [];
      for (const s of [1, 2, 3, 4, 5]) { const r = M.runGameV4(g, { n, seed: seed + 1000 * s }); ph.push(r.pHome); ot.push(r.pOT); pk.push(`${r.pick.x}-${r.pick.y}`); }
      const sd = a => Math.sqrt(a.reduce((s, x) => s + (x - a.reduce((p, q) => p + q, 0) / a.length) ** 2, 0) / (a.length - 1));
      row.seedCheck = { pHomeSD: +sd(ph).toFixed(5), pOTSD: +sd(ot).toFixed(5), picks: [...new Set(pk)] };
    }
    games.push(row);
  }
  return { date, model: 'v4-independent', sims: n, seed, generatedAt: new Date().toISOString(), totalMs: Date.now() - t0,
           jupiterFetchedAt: slate.games.map(g => g.jupiter && g.jupiter.fetchedAt).filter(Boolean).sort().pop() || null, games };
}
module.exports = { predictSlate, etDate };
if (require.main === module) {
  const date = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : etDate();
  const out = predictSlate(date, { n: arg('--n'), seed: arg('--seed'), check: process.argv.includes('--check') });
  fs.mkdirSync(path.join(ROOT, 'data', 'predictions'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'predictions', date + '.json'), JSON.stringify(out));
  for (const g of out.games) console.log(`${g.away}@${g.home} ${g.pick ? `${g.pick.away}-${g.pick.home}${g.pick.ot ? ' OT' : ''} pH=${g.pHome} sims=${g.sims} ${g.simMs}ms ${g.best ? 'BET ' + g.best.label + ' EV ' + g.best.ev : 'NO BET: ' + g.noBetReason}${g.seedCheck ? ' seedSD pH ' + g.seedCheck.pHomeSD + ' picks ' + g.seedCheck.picks : ''}` : g.error}`);
  console.log(`${out.games.length} games, ${out.totalMs} ms total`);
}
