/* Best-bet engine (shared by the dashboard and the Discord poster).
 * Candidates: every side of every Polymarket market on the game: moneyline, all O/U lines, all alt puck lines. Price = ask;
 * fee = the market's own Polymarket taker schedule rate*(p*(1-p))^exponent (sports default 0.05).
 *
 * Rule `score-fit-best-price-v1` (owner decision, 21 Nov 2026): the best bet is the line that WINS AT THE PREDICTED SCORE
 * and PAYS THE MOST, i.e. the lowest cost (ask + fee) among every line the predicted score satisfies. It is not a value
 * bet: the model's probability and expected value are shown for information and no longer decide anything.
 * A line still needs a real, takeable quote (open, full game incl. OT/SO, two-sided within 10 cents, traded volume, fresh).
 * Polymarket NHL resolution is the final result incl. OT/SO, so the predicted final score is compared directly. */
  // POLICY names the rule in every published slate so the bet record keeps the two rules apart.
(function (root) {
  const M = root.NHLModel || (typeof require !== 'undefined' ? require('./model.js') : null);
  // Per-contract upper bound: published order fees round UP to cents. For every
  // integer quantity, ceil(quantity * fee)/quantity <= ceil(fee).
  const DEFAULT_FEE = { rate: 0.05, exponent: 1 };
  const fee = (p, sched) => { const f = sched && sched.rate != null ? sched : DEFAULT_FEE;
    return Math.max(0, Math.ceil(100 * Number(f.rate) * Math.pow(p * (1 - p), Number(f.exponent == null ? 1 : f.exponent)) - 1e-10)) / 100; };
  const MIN_PROB = 0.5;
  // What a stake wins, in plain money. Uses Polymarket's actual fee for the price (rate * (p*(1-p))^exponent per
  // contract), not the rounded-up allowance used for the cautious cost. 47 cents with the sports fee: $10 wins $10.73.
  const exactFee = (p, sched) => { const f = sched && sched.rate != null ? sched : DEFAULT_FEE; return Math.max(0, Number(f.rate) * Math.pow(p * (1 - p), Number(f.exponent == null ? 1 : f.exponent))); };
  function winnings(c, stake) { stake = stake == null ? 10 : stake; const cost = c.ask + exactFee(c.ask, c.feeSchedule); return stake * (1 - cost) / cost; }
  const payText = (c, stake) => { stake = stake == null ? 10 : stake; return `$${stake} wins $${winnings(c, stake).toFixed(2)}`; };
  const POLICY = 'score-fit-best-price-v1';
  const MAX_SPREAD = 0.10;
  const MAX_QUOTE_AGE_MS = 5 * 60 * 1000;
  function scoreSupports(c, g, pick) {
    const a = pick?.away ?? pick?.x, h = pick?.home ?? pick?.y;
    if (![a,h].every(x => Number.isInteger(x) && x >= 0)) return false;
    const label = String(c.label || '').replace(/−/g, '-');
    if (c.type === 'ML') return label === `${g.home} ML` ? h > a : label === `${g.away} ML` ? a > h : false;
    const total = /^(Over|Under) ([0-9]+(?:\.[0-9]+)?)$/.exec(label);
    if (c.type === 'TOTAL' && total) return total[1] === 'Over' ? a+h > +total[2] : a+h < +total[2];
    const spread = /^([A-Z0-9]+) ([+-][0-9]+(?:\.[0-9]+)?)$/.exec(label);
    if (c.type === 'PUCKLINE' && spread) return spread[1] === g.home ? h + +spread[2] > a : spread[1] === g.away ? a + +spread[2] > h : false;
    return false;
  }
  function cand(type, label, q, x, extra) {
    if (!x || !Number.isFinite(q) || q < 0 || q > 1) return null;
    const p = x.ask, f = fee(p, x.fee);
    if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
    const executable = x.includesOTSO === true && !x.periodType && x.status === 'open' && Number.isFinite(x.bid) && x.bid > 0 && x.bid <= p && p - x.bid <= MAX_SPREAD + 1e-9 && Number.isFinite(Number(x.volume)) && Number(x.volume) > 0;
    return Object.assign({ type, label, q, ask: p, bid: x.bid, volume: x.volume, executable,
      fee: f, feeSchedule: x.fee || null, cost: p + f, edge: q - (p + f), ev: q / (p + f) - 1, marketId: x.marketId, tokenId: x.tokenId || null }, extra || {});
  }
  /** o = runGameV4 output (needs o.dist); g = game with g.market (sides + optional extra); returns {best, cands, reason, leans} */
  function evaluate(g, o, { now = Date.now() } = {}) {
    const j = g.market || g.jupiter, cands = [];   // g.jupiter: day files written before 2026-11-16
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
      if (!Number.isFinite(line) || Math.abs(line % 1) !== 0.5) continue;   // half lines only (no pushes)
      if (x.type === 'totals') {
        if (!['O', 'U'].includes(ou)) continue;
        const over = ou === 'O', q = over ? M.pOver(o.dist, line) : M.pUnder(o.dist, line);
        const c = cand('TOTAL', `${over ? 'Over' : 'Under'} ${line}`, q, x, { line }); if (c) cands.push(c);
      } else if (x.type === 'spreads') {
        const side = team === g.home ? 'home' : team === g.away ? 'away' : null;
        if (side) { const c = cand('PUCKLINE', `${g[side]} ${line > 0 ? '+' : ''}${line}`, M.pCover(o.dist, side, line), x, { side, line }); if (c) cands.push(c); }
      }
    }
    for (const c of cands) c.scoreConsistent = scoreSupports(c, g, o.pick);
    cands.sort((a, b) => b.ev - a.ev);
    const start = Date.parse(g.startUTC);
    const pregame = Number.isFinite(start) && now < start && ['FUT', 'PRE'].includes(g.state) && !j?.live && j?.active !== false;
    const fetched = Date.parse(j?.fetchedAt);
    const quoteFresh = Number.isFinite(fetched) && fetched <= now && now - fetched <= MAX_QUOTE_AGE_MS;
    for (const c of cands) {
      c.monteCarloSE = Number.isFinite(o.n) && o.n > 0 ? Math.sqrt(c.q * (1 - c.q) / o.n) : Infinity;
      const variants = [{ q: c.q, n: o.n }, ...(o.calibrationStress || []).map(s => ({ n: s.n,
        q: c.type === 'ML' ? (c.side === 'home' ? s.pHome : s.pAway)
          : c.type === 'TOTAL' ? (c.label.startsWith('Over') ? M.pOver(s.dist, c.line) : M.pUnder(s.dist, c.line))
          : M.pCover(s.dist, c.side, c.line) }))];
      c.sensitivityMin = Math.min(...variants.map(s => s.q));
      c.sensitivityLower = Math.min(...variants.map(s => Number.isFinite(s.n) && s.n > 0
        ? s.q - 1.96 * Math.sqrt(s.q * (1 - s.q) / s.n) : -Infinity));
      c.sensitivityEV = c.sensitivityLower / c.cost - 1;
      c.quoteStressAsk=Math.min(1,c.ask+.01);
      c.quoteStressCost=c.quoteStressAsk+Math.max(c.fee,fee(c.quoteStressAsk,c.feeSchedule));
      c.quoteStressEV=c.sensitivityLower/c.quoteStressCost-1;
    }
    // This only bounds numerical sampling noise; it does not claim the model itself is calibrated.
    const availabilityOK = !g.availability?.blockReason;
    // value: what the old rule required. Kept on each candidate as information only.
    for (const c of cands) c.value = c.sensitivityLower > MIN_PROB && c.ev > 0 && c.sensitivityEV > 0 && c.quoteStressEV > 0;
    const ok = pregame && quoteFresh && availabilityOK ? cands.filter(c => c.scoreConsistent && c.executable) : [];
    ok.sort((a, b) => a.cost - b.cost || b.q - a.q);   // pays the most first; the likelier line breaks a tie
    let reason = null;
    if (!ok.length) {
      if (!availabilityOK) reason = g.availability.blockReason;
      else if (!pregame) reason = 'game started, market live, or start unavailable — no pregame bet';
      else if (!quoteFresh) reason = 'Polymarket quote is missing, from the future, or older than five minutes';
      else if (!cands.length) reason = 'no Polymarket market';
      else if (!cands.some(c => c.executable)) reason = 'no verified full-game OT/SO two-sided quote within 10¢ with traded volume';
      else reason = 'no line that wins at the predicted score has a two-sided quote';
    }
    // model leans on standard lines (no Polymarket price -> informational only, never a bet)
    const leans = {
      o55: M.pOver(o.dist, 5.5), o65: M.pOver(o.dist, 6.5),
      homeM15: M.pCover(o.dist, 'home', -1.5), awayP15: M.pCover(o.dist, 'away', 1.5),
      awayM15: M.pCover(o.dist, 'away', -1.5), homeP15: M.pCover(o.dist, 'home', 1.5),
    };
    return { best: ok[0] || null, others: ok.slice(1, 4), qualifying: ok.length, cands, reason, leans, hasTotals: cands.some(c => c.type === 'TOTAL'), hasPL: cands.some(c => c.type === 'PUCKLINE') };
  }
  const api = { evaluate, fee, exactFee, winnings, payText, MIN_PROB, POLICY, scoreSupports };
  root.NHLBets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
