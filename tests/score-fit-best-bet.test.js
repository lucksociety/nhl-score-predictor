// Rule score-fit-best-price-v1 (owner decision, 21 Nov 2026): the best bet is the line that wins at the predicted
// score and pays the most. The model's probability and EV are shown but decide nothing.
const assert = require('node:assert/strict');
const B = require('../js/bets'), { verifyExecution } = require('../js/execution');
const now = Date.parse('2099-01-01T12:00:00Z');
const q = (ask, more) => Object.assign({ ask, bid: +(ask - 0.01).toFixed(2), status: 'open', includesOTSO: true, volume: 500 }, more);
const tot = (ou, line, ask, more) => q(ask, Object.assign({ type: 'totals', ou, line, label: `${ou} ${line}` }, more));
const pl = (team, line, ask, more) => q(ask, Object.assign({ type: 'spreads', team, line, label: `${team} ${line > 0 ? '+' : ''}${line}` }, more));
const game = extra => ({ away: 'AWY', home: 'HOM', startUTC: '2099-01-01T18:00:00Z', state: 'FUT',
  market: { fetchedAt: new Date(now).toISOString(), active: true, live: false, sides: { away: q(0.46), home: q(0.56) }, extra } });
const flat = { tot: Array(14).fill(1 / 14), mar: Array(21).fill(1 / 21) };
const out = (a, h) => ({ pick: { x: a, y: h }, n: 400000, pAway: a > h ? 0.55 : 0.45, pHome: h > a ? 0.55 : 0.45, dist: flat });
assert.equal(B.POLICY, 'score-fit-best-price-v1');

// Predicted 2-3 (home by one, five goals). Fits: HOM ML, Over 4.5, Under 5.5, AWY +1.5, and looser lines.
const lines = [tot('O', 4.5, 0.74), tot('U', 4.5, 0.27), tot('O', 5.5, 0.52), tot('U', 5.5, 0.49), tot('U', 6.5, 0.70),
  pl('HOM', -1.5, 0.30), pl('AWY', 1.5, 0.71), pl('AWY', -1.5, 0.22), pl('HOM', 1.5, 0.79)];
let e = B.evaluate(game(lines), out(2, 3), { now });
assert.equal(e.best.label, 'Under 5.5', 'cheapest line that wins at 2-3');
assert.deepEqual(e.others.map(c => c.label), ['HOM ML', 'Under 6.5', 'AWY +1.5'], 'the rest that fit, best-paying first');
const fits = e.cands.filter(c => c.scoreConsistent).map(c => c.label).sort();
assert.deepEqual(fits, ['AWY +1.5', 'HOM +1.5', 'HOM ML', 'Over 4.5', 'Under 5.5', 'Under 6.5'].sort());
for (const c of [e.best, ...e.others]) assert(B.scoreSupports(c, { away: 'AWY', home: 'HOM' }, { away: 2, home: 3 }));
// cheaper lines that lose at the predicted score are never chosen
for (const bad of ['Under 4.5', 'HOM -1.5', 'AWY -1.5', 'AWY ML', 'Over 5.5']) assert(![e.best, ...e.others].some(c => c.label === bad), bad);

// When the moneyline is the cheapest fitting line, it is the best bet.
e = B.evaluate(game([tot('U', 5.5, 0.60), tot('O', 4.5, 0.74)]), out(2, 3), { now });
assert.equal(e.best.label, 'HOM ML');
// A two-goal win brings the puck line in: predicted 4-2 fits AWY -1.5.
e = B.evaluate(game([pl('AWY', -1.5, 0.31), tot('O', 5.5, 0.50), tot('U', 6.5, 0.66)]), out(4, 2), { now });
assert.equal(e.best.label, 'AWY -1.5');

// A fitting line only counts with a takeable quote.
for (const broken of [{ bid: null }, { bid: 0.15 }, { volume: 0 }, { includesOTSO: false }, { status: 'closed' }, { periodType: '1st' }]) {
  e = B.evaluate(game([tot('U', 5.5, 0.30, broken), tot('O', 4.5, 0.74)]), out(2, 3), { now });
  assert.equal(e.best.label, 'HOM ML', JSON.stringify(broken));
}
// It is not a value bet: a line the model rates below its price is still the best bet, and says so.
e = B.evaluate(game([tot('U', 5.5, 0.49)]), { ...out(2, 3), dist: { tot: [0, 0, 0, 0, 0.2, 0.2, 0.6], mar: flat.mar } }, { now });
assert.equal(e.best.label, 'Under 5.5'); assert(e.best.ev < 0); assert.equal(e.best.value, false);
// No pregame bet once the game has started, on a stale quote, or with an availability block.
assert.equal(B.evaluate({ ...game(lines), state: 'LIVE' }, out(2, 3), { now }).best, null);
assert.equal(B.evaluate(game(lines), out(2, 3), { now: now + 300001 }).best, null);
const blocked = B.evaluate({ ...game(lines), availability: { blockReason: 'HOM listed goalie is unavailable' } }, out(2, 3), { now });
assert.equal(blocked.best, null); assert.equal(blocked.reason, 'HOM listed goalie is unavailable');
const none = B.evaluate(game([]), { ...out(2, 3), pick: { x: 2, y: 3 } }, { now: now }); assert(none.best, 'moneyline alone still fits');
const g0 = game([]); g0.market.sides.home.bid = null; const r0 = B.evaluate(g0, out(2, 3), { now });
assert.equal(r0.best, null); assert.match(r0.reason, /no line that wins at the predicted score/);

// Depth check for Discord keeps a negative-EV score-fit bet when the book has the size, and drops it when it has not.
(async () => {
  const row = (depth) => ({ away: 'AWY', home: 'HOM', state: 'FUT', start: '2099-01-01T18:00:00Z', quoteFetchedAt: new Date(now).toISOString(), pick: { away: 2, home: 3 },
    best: { type: 'TOTAL', label: 'Under 5.5', ask: 0.49, cost: 0.51, q: 0.40, ev: -0.2, sensitivityLower: 0.39, quoteStressEV: -0.25, tokenId: 't1' }, others: [], depth });
  const book = d => async () => ({ yes: [[48, 100]], no: [[51, d]] });
  const ok = row(50); await verifyExecution({ games: [ok] }, { now: () => now, fetchBook: book(50) });
  assert.equal(ok.best.label, 'Under 5.5'); assert(ok.best.executionVerified);
  const thin = row(2); await verifyExecution({ games: [thin] }, { now: () => now, fetchBook: book(2) });
  assert.equal(thin.best, null); assert.match(thin.noBetReason, /No score-fitting line/);
  const { gameEmbed } = await import('../js/discord_embeds.mjs');
  const text = gameEmbed({ ...ok, time: '7:00 PM ET', pAway: 0.45, pHome: 0.55, pOT: 0.2, xg: [2.7, 3.1], leans: {}, markets: {}, best: { ...ok.best, fee: 0.02 } }).description;
  assert.match(text, /BEST BET: Under 5\.5\*\* · Polymarket 49¢ \(2¢ fee allowance\) · pays \*\*\$0\.96\*\* per \$1 if it wins · model 40\.0%/);
  assert.match(text, /Fits the predicted score AWY 2–3 HOM/); assert.doesNotMatch(text, /EV/);
  console.log('score-fit best bet ok');
})().catch(e => { console.error(e); process.exitCode = 1; });
