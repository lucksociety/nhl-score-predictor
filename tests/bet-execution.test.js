const assert = require('node:assert/strict');
const B = require('../js/bets');
const now = Date.parse('2026-11-01T17:00:00Z');
const base = () => ({ away: 'SEA', home: 'CGY', startUTC: '2026-11-01T18:00:00Z', state: 'FUT',
  market: { fetchedAt: new Date(now).toISOString(), active: true, live: false, sides: { away: { ask: .5, bid: .49, status: 'open', includesOTSO: true, volume: 1000 } } } });
const o = { pick: {away:4,home:2}, n: 400000, pAway: .6, pHome: .4, dist: { tot: [1], mar: [1] } };
const evaluate = g => B.evaluate(g, o, { now });
assert(evaluate(base()).best);
for (const mod of [
  g => { g.market.sides.away.bid = null; },
  g => { delete g.market.fetchedAt; },
  g => { g.market.fetchedAt = new Date(now - 300001).toISOString(); },
  g => { g.market.fetchedAt = new Date(now + 1).toISOString(); },
  g => { delete g.market.sides.away.includesOTSO; },
  g => { g.market.sides.away.includesOTSO = false; },
  g => { g.market.sides.away.periodType = '1st'; }, g => { g.market.sides.away.bid = .6; },
  g => { g.market.sides.away.bid = .2; }, g => { g.market.sides.away.status = 'closed'; },
  g => { g.market.sides.away.volume = 0; }, g => { g.market.live = true; },
  g => { g.market.active = false; }, g => { g.startUTC = '2026-11-01T17:00:00Z'; },
  g => { g.startUTC = null; }, g => { g.state = 'LIVE'; }
]) { const g = base(); mod(g); assert.equal(evaluate(g).best, null); }
const cheap = base(); cheap.market.sides.away.ask = .4; cheap.market.sides.away.bid = .39;
// The value test is information only since score-fit-best-price-v1: the line is still the best bet, flagged value:false.
assert.equal(B.evaluate(base(), o, { now }).best.value, true);
assert.equal(B.evaluate(cheap, { ...o, pAway: .5001 }, { now }).best.value, false, 'probability must clear numerical error above 50%');
assert.equal(B.evaluate(base(), { ...o, pAway: .5 }, { now }).best.value, false);
assert.equal(B.evaluate(base(), { ...o, pAway: .5176 }, { now }).best.value, false, '0.01pp edge is below 400k-sim sampling uncertainty');
assert.equal(B.evaluate(base(), { ...o, n: undefined }, { now }).best.value, false, 'unverified simulation count is never a value bet');
const totalGame = base();
totalGame.market.sides = {};
totalGame.market.extra = [{ type: 'totals', label: 'O 5.5', ou: 'O', line: 5.5,
  ask: .5, bid: .49, status: 'open', includesOTSO: true, volume: 100 }];
const totalOutput = { ...o, dist: { ...o.dist, tot: [0, 0, 0, 0, .4, 0, .6] } };
assert(B.evaluate(totalGame, totalOutput, { now }).best);
for (const mod of [
  x => { x.ou = 'unknown'; x.label = ''; },
  x => { x.line = 5.2; },
  x => { x.includesOTSO = false; },
  x => { x.periodType = '1st'; },
]) {
  const g = structuredClone(totalGame);
  mod(g.market.extra[0]);
  assert.equal(B.evaluate(g, totalOutput, { now }).best, null);
}
(async () => {
  const { payloads } = await import('../js/discord_embeds.mjs');
  const best = { type:'ML', label: 'SEA ML', q: .6, ask: .5, ev: .1 };
  const row = { id: 1, away: 'SEA', home: 'CGY', start: '2000-01-01T00:00:00Z',
    pick: { away: 3, home: 2 }, pAway: .6, pHome: .4, pOT: .2, xg: [3, 2],
    best, others: [best], leans: {}, markets: {} };
  const messages = payloads({ date: '2000-01-01', games: [row], sims: 400000 });
  assert(!JSON.stringify(messages).includes('SEA ML'));
  assert.equal(row.best, best, 'publishing must not rewrite frozen forecasts');
  const future = { ...row, start: new Date(Date.now() + 3600000).toISOString(),
    quoteFetchedAt: new Date(Date.now() - 300001).toISOString() };
  assert(!JSON.stringify(payloads({ date: '2026-11-05', games: [future], sims: 400000 })).includes('SEA ML'));
  const fresh = { ...future, quoteFetchedAt: new Date().toISOString() };
  assert(JSON.stringify(payloads({ date: '2026-11-05', games: [fresh], sims: 400000 })).includes('SEA ML'));
  console.log('NHL quote integrity, >50% probability, stale state/start and final publication-clock checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
