/* Polymarket NHL game markets: moneyline, every totals line and every alt puck line, read from Polymarket's public
 * Gamma API (https://gamma-api.polymarket.com, no key, CORS enabled, so the browser fetches directly).
 * Prices are each market's best bid/ask; the second outcome of a binary market is the complement of the first
 * (buying it at its ask is selling the first at its bid). Executable depth is checked separately against the CLOB book.
 * Rules: "final score including any overtime periods and shootouts" -> compare with the model's win probability INCLUDING OT/SO.
 * Fee: Polymarket taker fee rate * (p * (1 - p)) ^ exponent per contract, from each market's own feeSchedule (sports default 0.05).
 */
(function (root) {
  const GAMMA = 'https://gamma-api.polymarket.com', CLOB = 'https://clob.polymarket.com', NHL_TAG = '899';
  const AB = { cal: 'CGY', las: 'VGK', mon: 'MTL', nj: 'NJD', sj: 'SJS', tb: 'TBL', utah: 'UTA', la: 'LAK' };
  const toNHL = a => AB[String(a || '').toLowerCase()] || String(a || '').toUpperCase();
  const DEFAULT_FEE = { rate: 0.05, exponent: 1 };
  const feeOf = gm => gm.feesEnabled === false ? { rate: 0, exponent: 1 } : gm.feeSchedule && gm.feeSchedule.rate != null
    ? { rate: Number(gm.feeSchedule.rate), exponent: Number(gm.feeSchedule.exponent == null ? 1 : gm.feeSchedule.exponent) } : null;
  const fee = (p, sched) => { const f = sched && sched.rate != null ? sched : DEFAULT_FEE; return Number(f.rate) * Math.pow(p * (1 - p), Number(f.exponent == null ? 1 : f.exponent)); };
  const list = v => { if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return []; } } return Array.isArray(v) ? v : []; };
  const num = x => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };
  const px = x => (x != null && x > 0 && x < 1 ? Math.round(x * 1e6) / 1e6 : null);

  /** Open NHL game events from 12 h ago (in play) to 3 days ahead, with all their markets. */
  async function fetchEvents(opts) {
    opts = opts || {}; const now = opts.now ? new Date(opts.now) : new Date(), fetchFn = opts.fetch || fetch;
    const lo = new Date(now.getTime() - 12 * 36e5).toISOString(), hi = new Date(now.getTime() + 3 * 864e5).toISOString();
    const out = [];
    for (let off = 0; off < 1000; off += 100) {
      const r = await fetchFn(`${GAMMA}/events?tag_id=${NHL_TAG}&closed=false&limit=100&offset=${off}&order=id&ascending=true&start_time_min=${encodeURIComponent(lo)}&start_time_max=${encodeURIComponent(hi)}`);
      if (!r.ok) throw new Error('Polymarket ' + r.status);
      const page = await r.json(); if (!Array.isArray(page)) throw new Error('Polymarket events page is not a list');
      out.push(...page);
      if (page.length < 100) break;
    }
    return { host: GAMMA, events: out, fetchedAt: now.toISOString() };
  }

  /** Parse one Gamma event into {eventId, date, away, home, link, live, sides:{away:{ask,bid,title,...}, home}, extra:[...]} or null */
  function parseEvent(e) {
    const slug = e.slug || '';
    const m = slug.match(/^nhl-([a-z]+)-([a-z]+)-(\d{4}-\d{2}-\d{2})$/);
    if (!m) return null;
    const away = toNHL(m[1]), home = toNHL(m[2]), date = m[3];
    const byName = {};
    // outcomes are labelled with a team's name or its alias (Utah's markets say "Utah", its team name is "Mammoth")
    for (const t of e.teams || []) { const ab = toNHL(t.abbreviation); if (ab === away || ab === home) for (const k of [t.name, t.alias]) if (k) byName[String(k)] = ab; }
    const sideOf = name => { const ab = byName[String(name)]; return ab === away ? 'away' : ab === home ? 'home' : null; };
    const sides = {}, extra = []; let xr = true, mlRules = '';
    for (const mk of e.markets || []) {
      const smt = mk.sportsMarketType;
      if (smt !== 'moneyline' && smt !== 'totals' && smt !== 'spreads') continue;
      const outs = list(mk.outcomes), toks = list(mk.clobTokenIds).map(String);
      if (outs.length !== 2 || toks.length !== 2) continue;
      const bid = num(mk.bestBid), ask = num(mk.bestAsk), line = num(mk.line);
      const quotes = [[ask, bid], [bid == null ? null : 1 - bid, ask == null ? null : 1 - ask]];
      const rules = String(mk.description || ''), r = rules.toLowerCase();
      const status = !mk.closed && mk.active !== false && mk.acceptingOrders !== false ? 'open' : 'closed';
      const common = i => ({ marketId: `POLY-${mk.id}-${i}`, tokenId: toks[i], status, periodType: null,
        ask: px(quotes[i][0]), bid: px(quotes[i][1]), volume: num(mk.volumeNum), fee: feeOf(mk) });
      if (smt === 'moneyline') {
        if (mk.slug !== slug) continue;
        const sd = outs.map(sideOf);
        if (!(sd.includes('away') && sd.includes('home'))) continue;
        mlRules = rules;
        sd.forEach((s, i) => { sides[s] = Object.assign({ title: String(outs[i]), includesOTSO: /overtime/.test(r) && /shootout/.test(r), rules }, common(i)); });
        continue;
      }
      const otso = /overtime/.test(r) && /shootout/.test(r) && /one goal will be added/.test(r);
      if (line == null) continue;
      if (smt === 'totals') {
        if (String(outs[0]) !== 'Over' || String(outs[1]) !== 'Under') continue;
        xr = xr && otso;
        ['O', 'U'].forEach((ou, i) => extra.push(Object.assign({ type: 'totals', label: `${ou} ${line}`, includesOTSO: otso, ou, line }, common(i))));
      } else {
        const teams = outs.map(o => byName[String(o)]);
        if (!teams[0] || !teams[1] || teams[0] === teams[1]) continue;
        xr = xr && otso;
        teams.forEach((team, i) => { const l = i === 0 ? line : -line; extra.push(Object.assign({ type: 'spreads', label: `${team} ${l > 0 ? '+' : ''}${l}`, includesOTSO: otso, team, line: l }, common(i))); });
      }
    }
    if (!sides.away && !sides.home) return null;
    return {
      eventId: `POLY-${e.id}`, slug, date, away, home, title: e.title, live: !!(e.live || e.ended), active: !e.closed,
      link: `https://polymarket.com/event/${slug}`, provider: 'polymarket',
      includesOTSO: /overtime/i.test(mlRules) && /shootout/i.test(mlRules), sides: { away: strip(sides.away), home: strip(sides.home) },
      extra, extraIncludesOTSO: extra.length ? xr : null,
    };
  }
  const strip = s => s ? (({ rules, ...rest }) => rest)(s) : null;

  /** Edge math for one game. q = model win probs {away, home} incl. OT/SO. */
  function edges(jm, q) {
    if (!jm) return null;
    const a = jm.sides.away, h = jm.sides.home;
    const sum = a && h && a.ask && h.ask ? a.ask + h.ask : null;
    const res = {};
    for (const s of ['away', 'home']) {
      const x = jm.sides[s];
      if (!x || !x.ask) { res[s] = null; continue; }
      const p = x.ask, f = fee(p, x.fee), qq = q ? q[s] : null;
      res[s] = {
        ask: p, bid: x.bid, noVig: sum ? p / sum : null, fee: f, model: qq,
        edge: qq == null ? null : qq - p,                       // vs ask (price you pay)
        edgeNoVig: qq == null || !sum ? null : qq - p / sum,    // vs no-vig market prob
        edgeAfterFee: qq == null ? null : qq - (p + f),
        ev: qq == null ? null : qq / (p + f) - 1,               // per $1 staked, after fee
        evNoFee: qq == null ? null : qq / p - 1,
      };
    }
    res.overround = sum ? sum - 1 : null;
    return res;
  }

  root.Polymarket = { GAMMA, CLOB, DEFAULT_FEE, fetchEvents, parseEvent, edges, fee };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Polymarket;
})(typeof self !== 'undefined' ? self : globalThis);
