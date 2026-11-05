const assert = require('node:assert/strict');
const B = require('../js/bets');
const now = Date.parse('2026-11-01T17:00:00Z');
const base = () => ({ away: 'SEA', home: 'CGY', startUTC: '2026-11-01T18:00:00Z', state: 'FUT',
  jupiter: { fetchedAt: new Date(now).toISOString(), active: true, live: false, sides: { away: { ask: .5, bid: .49, status: 'open', includesOTSO: true, volume: 1000 } } } });
const o = { n: 400000, pAway: .6, pHome: .4, dist: { tot: [1], mar: [1] } };
const evaluate = g => B.evaluate(g, o, { now });
assert(evaluate(base()).best);
for (const mod of [
  g => { g.jupiter.sides.away.bid = null; },
  g => { delete g.jupiter.fetchedAt; },
  g => { g.jupiter.fetchedAt = new Date(now - 300001).toISOString(); },
  g => { g.jupiter.fetchedAt = new Date(now + 1).toISOString(); },
  g => { delete g.jupiter.sides.away.includesOTSO; },
  g => { g.jupiter.sides.away.includesOTSO = false; },
  g => { g.jupiter.sides.away.periodType = '1st'; }, g => { g.jupiter.sides.away.bid = .6; },
  g => { g.jupiter.sides.away.bid = .2; }, g => { g.jupiter.sides.away.status = 'closed'; },
  g => { g.jupiter.sides.away.volume = 0; }, g => { g.jupiter.live = true; },
  g => { g.jupiter.active = false; }, g => { g.startUTC = '2026-11-01T17:00:00Z'; },
  g => { g.startUTC = null; }, g => { g.state = 'LIVE'; }
]) { const g = base(); mod(g); assert.equal(evaluate(g).best, null); }
const cheap = base(); cheap.jupiter.sides.away.ask = .4; cheap.jupiter.sides.away.bid = .39;
assert.equal(B.evaluate(cheap, { ...o, pAway: .5001 }, { now }).best, null, 'probability must clear numerical error above 50%');
assert.equal(B.evaluate(base(), { ...o, pAway: .5 }, { now }).best, null);
assert.equal(B.evaluate(base(), { ...o, pAway: .5176 }, { now }).best, null, '0.01pp edge is below 400k-sim sampling uncertainty');
assert.equal(B.evaluate(base(), { ...o, n: undefined }, { now }).best, null, 'unverified simulation count must fail closed');
const totalGame = base();
totalGame.jupiter.sides = {};
totalGame.jupiter.extra = [{ type: 'totals', label: 'O 5.5', ou: 'O', line: 5.5,
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
  mod(g.jupiter.extra[0]);
  assert.equal(B.evaluate(g, totalOutput, { now }).best, null);
}
(async () => {
  const { payloads } = await import('../js/discord_embeds.mjs');
  const best = { label: 'STALE_SELECTION', q: .6, ask: .5, ev: .1 };
  const row = { id: 1, away: 'SEA', home: 'CGY', start: '2000-01-01T00:00:00Z',
    pick: { away: 3, home: 2 }, pAway: .6, pHome: .4, pOT: .2, xg: [3, 2],
    best, others: [best], leans: {}, markets: {} };
  const messages = payloads({ date: '2000-01-01', games: [row], sims: 400000 });
  assert(!JSON.stringify(messages).includes('STALE_SELECTION'));
  assert.equal(row.best, best, 'publishing must not rewrite frozen forecasts');
  const future = { ...row, start: new Date(Date.now() + 3600000).toISOString(),
    quoteFetchedAt: new Date(Date.now() - 300001).toISOString() };
  assert(!JSON.stringify(payloads({ date: '2026-11-05', games: [future], sims: 400000 })).includes('STALE_SELECTION'));
  const fresh = { ...future, quoteFetchedAt: new Date().toISOString() };
  assert(JSON.stringify(payloads({ date: '2026-11-05', games: [fresh], sims: 400000 })).includes('STALE_SELECTION'));
  console.log('NHL quote integrity, >50% probability, stale state/start and final publication-clock checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
