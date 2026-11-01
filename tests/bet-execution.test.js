const assert = require('node:assert/strict');
const B = require('../js/bets');
const now = Date.parse('2026-11-01T17:00:00Z');
const base = () => ({ away: 'SEA', home: 'CGY', startUTC: '2026-11-01T18:00:00Z', state: 'FUT',
  jupiter: { active: true, live: false, sides: { away: { ask: .5, bid: .49, status: 'open', volume: 1000 } } } });
const o = { n: 400000, pAway: .6, pHome: .4, dist: { tot: [1], mar: [1] } };
const evaluate = g => B.evaluate(g, o, { now });
assert(evaluate(base()).best);
for (const mod of [
  g => { g.jupiter.sides.away.bid = null; }, g => { g.jupiter.sides.away.bid = .6; },
  g => { g.jupiter.sides.away.bid = .2; }, g => { g.jupiter.sides.away.status = 'closed'; },
  g => { g.jupiter.sides.away.volume = 0; }, g => { g.jupiter.live = true; },
  g => { g.jupiter.active = false; }, g => { g.startUTC = '2026-11-01T17:00:00Z'; },
  g => { g.startUTC = null; }, g => { g.state = 'LIVE'; }
]) { const g = base(); mod(g); assert.equal(evaluate(g).best, null); }
assert.equal(B.evaluate(base(), { ...o, pAway: .5 }, { now }).best, null);
assert.equal(B.evaluate(base(), { ...o, pAway: .5176 }, { now }).best, null, '0.01pp edge is below 400k-sim sampling uncertainty');
assert.equal(B.evaluate(base(), { ...o, n: undefined }, { now }).best, null, 'unverified simulation count must fail closed');
(async () => {
  const { payloads } = await import('../js/discord_embeds.mjs');
  const best = { label: 'STALE_SELECTION', q: .6, ask: .5, ev: .1 };
  const row = { id: 1, away: 'SEA', home: 'CGY', start: '2000-01-01T00:00:00Z',
    pick: { away: 3, home: 2 }, pAway: .6, pHome: .4, pOT: .2, xg: [3, 2],
    best, others: [best], leans: {}, markets: {} };
  const messages = payloads({ date: '2000-01-01', games: [row], sims: 400000 });
  assert(!JSON.stringify(messages).includes('STALE_SELECTION'));
  assert.equal(row.best, best, 'publishing must not rewrite frozen forecasts');
  console.log('NHL quote integrity, >50% probability, stale state/start and final publication-clock checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
