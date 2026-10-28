/* Best-bet engine (shared by the dashboard and the Discord poster).
 * Candidates: Jupiter moneyline sides (+ totals / spreads if Jupiter lists them for the game). Price = ask; fee = 0.07*p*(1-p).
 * EV per $1 = q/(p+fee) - 1. A side qualifies only if model prob q > 50% AND EV after fee > 0. Best bet = highest-EV qualifier,
 * else NO BET. Jupiter NHL resolution is the final result incl. OT/SO, so q uses the full simulated final score. */
(function (root) {
  const M = root.NHLModel || (typeof require !== 'undefined' ? require('./model.js') : null);
  const fee = p => 0.07 * p * (1 - p);
  const MIN_PROB = 0.5;
  function cand(type, label, q, x, extra) {
    if (!x || !x.ask || q == null) return null;
    const p = x.ask, f = fee(p);
    return Object.assign({ type, label, q, ask: p, fee: f, cost: p + f, edge: q - (p + f), ev: q / (p + f) - 1, marketId: x.marketId }, extra || {});
  }
  /** o = runGameV4 output (needs o.dist); g = game with g.jupiter (sides + optional extra); returns {best, cands, reason, leans} */
  function evaluate(g, o) {
    const j = g.jupiter, cands = [];
    if (j && j.sides) for (const s of ['away', 'home']) {
      const c = cand('ML', `${g[s]} ML`, s === 'home' ? o.pHome : o.pAway, j.sides[s], { side: s });
      if (c) cands.push(c);
    }
    for (const x of (j && j.extra) || []) {
      const lab = String(x.label || x.title || ''); let m;
      if (x.type === 'totals' && (m = lab.match(/^\s*([OU])\w*\s*([\d.]+)/i))) {
        const line = +m[2], over = m[1].toUpperCase() === 'O';
        const q = over ? M.pOver(o.dist, line) : M.pUnder(o.dist, line);
        if (typeof q === 'number') { const c = cand('TOTAL', `${over ? 'Over' : 'Under'} ${line}`, q, x); if (c) cands.push(c); }
      } else if (x.type === 'spreads' && (m = lab.match(/([A-Z]{2,4})\s*([+-][\d.]+)/i))) {
        const t = m[1].toUpperCase(), side = t === g.home ? 'home' : t === g.away ? 'away' : null;
        if (side) { const c = cand('PUCKLINE', `${g[side]} ${m[2]}`, M.pCover(o.dist, side, +m[2]), x, { side }); if (c) cands.push(c); }
      }
    }
    cands.sort((a, b) => b.ev - a.ev);
    const ok = cands.filter(c => c.q > MIN_PROB && c.ev > 0);
    let reason = null;
    if (!ok.length) {
      if (!cands.length) reason = 'no Jupiter market';
      else if (!cands.some(c => c.q > MIN_PROB)) reason = 'no side above 50%';
      else reason = 'no positive edge after fees on the >50% side';
    }
    // model leans on standard lines (no Jupiter price -> informational only, never a bet)
    const leans = {
      o55: M.pOver(o.dist, 5.5), o65: M.pOver(o.dist, 6.5),
      homeM15: M.pCover(o.dist, 'home', -1.5), awayP15: M.pCover(o.dist, 'away', 1.5),
      awayM15: M.pCover(o.dist, 'away', -1.5), homeP15: M.pCover(o.dist, 'home', 1.5),
    };
    return { best: ok[0] || null, cands, reason, leans, hasTotals: cands.some(c => c.type === 'TOTAL'), hasPL: cands.some(c => c.type === 'PUCKLINE') };
  }
  const api = { evaluate, fee, MIN_PROB };
  root.NHLBets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
