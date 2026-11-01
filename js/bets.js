/* Best-bet engine (shared by the dashboard and the Discord poster).
 * Candidates: every side of every Jupiter market on the game: moneyline, all O/U lines, all alt puck lines. Price = ask; fee = 0.07*p*(1-p).
 * EV per $1 = q/(p+fee) - 1. A side qualifies only if model prob q > 50% AND EV after fee > 0. Best bet = highest-EV qualifier,
 * else NO BET. Jupiter NHL resolution is the final result incl. OT/SO, so q uses the full simulated final score. */
(function (root) {
  const M = root.NHLModel || (typeof require !== 'undefined' ? require('./model.js') : null);
  const fee = p => 0.07 * p * (1 - p);
  const MIN_PROB = 0.5;
  const MAX_SPREAD = 0.10;
  function cand(type, label, q, x, extra) {
    if (!x || !Number.isFinite(q) || q < 0 || q > 1) return null;
    const p = x.ask, f = fee(p);
    if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
    const executable = (!x.status || x.status === 'open') && Number.isFinite(x.bid) && x.bid > 0 && x.bid <= p && p - x.bid <= MAX_SPREAD + 1e-9 && Number.isFinite(Number(x.volume)) && Number(x.volume) > 0;
    return Object.assign({ type, label, q, ask: p, bid: x.bid, volume: x.volume, executable,
      fee: f, cost: p + f, edge: q - (p + f), ev: q / (p + f) - 1, marketId: x.marketId }, extra || {});
  }
  /** o = runGameV4 output (needs o.dist); g = game with g.jupiter (sides + optional extra); returns {best, cands, reason, leans} */
  function evaluate(g, o, { now = Date.now() } = {}) {
    const j = g.jupiter, cands = [];
    if (j && j.sides) for (const s of ['away', 'home']) {
      const c = cand('ML', `${g[s]} ML`, s === 'home' ? o.pHome : o.pAway, j.sides[s], { side: s });
      if (c) cands.push(c);
    }
    for (const x of (j && j.extra) || []) {
      if (x.status && x.status !== 'open') continue;
      let ou = x.ou, line = x.line, team = x.team, m;
      const lab = String(x.label || x.title || '');
      if (x.type === 'totals' && !ou && (m = lab.match(/^\s*([OU])\w*\s*([\d.]+)/i))) { ou = m[1].toUpperCase(); line = +m[2]; }
      if (x.type === 'spreads' && !team && (m = lab.match(/([A-Z]{2,4})\s*([+-][\d.]+)/i))) { team = m[1].toUpperCase(); line = +m[2]; }
      if (line == null || Number.isInteger(line)) continue;   // half lines only (no pushes)
      if (x.type === 'totals') {
        const over = ou === 'O', q = over ? M.pOver(o.dist, line) : M.pUnder(o.dist, line);
        const c = cand('TOTAL', `${over ? 'Over' : 'Under'} ${line}`, q, x, { line }); if (c) cands.push(c);
      } else if (x.type === 'spreads') {
        const side = team === g.home ? 'home' : team === g.away ? 'away' : null;
        if (side) { const c = cand('PUCKLINE', `${g[side]} ${line > 0 ? '+' : ''}${line}`, M.pCover(o.dist, side, line), x, { side, line }); if (c) cands.push(c); }
      }
    }
    cands.sort((a, b) => b.ev - a.ev);
    const start = Date.parse(g.startUTC);
    const pregame = Number.isFinite(start) && now < start && ['FUT', 'PRE'].includes(g.state) && !j?.live && j?.active !== false;
    for (const c of cands) c.monteCarloSE = Number.isFinite(o.n) && o.n > 0 ? Math.sqrt(c.q * (1 - c.q) / o.n) : Infinity;
    // This only bounds numerical sampling noise; it does not claim the model itself is calibrated.
    const ok = pregame ? cands.filter(c => c.executable && c.q > MIN_PROB && c.ev > 0 && c.edge > 1.96 * c.monteCarloSE) : [];
    let reason = null;
    if (!ok.length) {
      if (!pregame) reason = 'game started, market live, or start unavailable — no pregame bet';
      else if (!cands.length) reason = 'no Jupiter market';
      else if (!cands.some(c => c.executable)) reason = 'no open two-sided quote within 10¢ with traded volume';
      else if (!cands.some(c => c.q > MIN_PROB)) reason = 'no side above 50%';
      else reason = 'no >50% side with positive edge after fees outside Monte Carlo sampling noise';
    }
    // model leans on standard lines (no Jupiter price -> informational only, never a bet)
    const leans = {
      o55: M.pOver(o.dist, 5.5), o65: M.pOver(o.dist, 6.5),
      homeM15: M.pCover(o.dist, 'home', -1.5), awayP15: M.pCover(o.dist, 'away', 1.5),
      awayM15: M.pCover(o.dist, 'away', -1.5), homeP15: M.pCover(o.dist, 'home', 1.5),
    };
    return { best: ok[0] || null, others: ok.slice(1, 4), qualifying: ok.length, cands, reason, leans, hasTotals: cands.some(c => c.type === 'TOTAL'), hasPL: cands.some(c => c.type === 'PUCKLINE') };
  }
  const api = { evaluate, fee, MIN_PROB };
  root.NHLBets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
