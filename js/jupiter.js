/* Jupiter Predict (prediction markets on Solana) — NHL game moneyline markets.
 * Official API: https://api.jup.ag/prediction/v1 (docs: https://developers.jup.ag/docs/prediction). Keyless reads are
 * allowed (0.5 req/s) and CORS is enabled, so the browser fetches directly. Fallback host: prediction-market-api.jup.ag/api/v1
 * (the same API behind jup.ag). No key, no wallet.
 * NHL game markets are Polymarket-sourced; rules: "final score including any overtime periods and shootouts" -> compare with
 * the model's win probability INCLUDING OT/SO.
 * Fee (Jupiter docs, Polymarket-sourced markets): table matches 0.07 * p * (1 - p) per contract, rounded up to the cent per order.
 */
(function (root) {
  const HOSTS = ['https://api.jup.ag/prediction/v1', 'https://prediction-market-api.jup.ag/api/v1'];
  const AB = { cal: 'CGY', las: 'VGK', mon: 'MTL', nj: 'NJD', sj: 'SJS', tb: 'TBL', utah: 'UTA', la: 'LAK' };
  const toNHL = a => AB[String(a || '').toLowerCase()] || String(a || '').toUpperCase();
  const FEE_COEF = 0.07;
  const fee = p => FEE_COEF * p * (1 - p);

  async function fetchEvents() {
    let lastErr;
    for (const host of HOSTS) {
      try {
        const out = [];
        for (let start = 0; start < 600; start += 100) {
          const r = await fetch(`${host}/events?category=sports&subcategory=nhl&includeMarkets=true&start=${start}&end=${start + 100}`);
          if (!r.ok) throw new Error('Jupiter ' + r.status);
          const j = await r.json();
          out.push(...(j.data || []));
          if (!(j.pagination && j.pagination.hasNext)) break;
          await new Promise(res => setTimeout(res, 2100));  // keyless limit 0.5 req/s
        }
        return { host, events: out, fetchedAt: new Date().toISOString() };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Jupiter unavailable');
  }

  /** Parse one event into {eventId, date, away, home, link, live, sides:{away:{ask,bid,title}, home:{...}}} or null */
  function parseEvent(e) {
    const slug = (e.metadata && e.metadata.slug) || '';
    const m = slug.match(/^nhl-([a-z]+)-([a-z]+)-(\d{4}-\d{2}-\d{2})$/);
    if (!m) return null;
    const away = toNHL(m[1]), home = toNHL(m[2]), date = m[3];
    const sides = {};
    for (const mk of e.markets || []) {
      if (mk.sportsMarketType && mk.sportsMarketType !== 'moneyline') continue;
      const t = toNHL(mk.team && mk.team.abbreviation);
      const side = t === away ? 'away' : t === home ? 'home' : null;
      if (!side) continue;
      const pr = mk.pricing || {};
      sides[side] = {
        marketId: mk.marketId, title: mk.title, status: mk.status,
        ask: pr.buyYesPriceUsd ? pr.buyYesPriceUsd / 1e6 : null, bid: pr.sellYesPriceUsd ? pr.sellYesPriceUsd / 1e6 : null,
        volume: pr.volume, rules: mk.rulesPrimary,
      };
    }
    if (!sides.away && !sides.home) return null;
    const rules = (sides.away || sides.home).rules || '';
    return {
      eventId: e.eventId, slug, date, away, home, title: e.metadata.title, live: !!e.isLive, active: e.isActive,
      link: `https://jup.ag/prediction/${e.eventId}`, provider: (e.markets && e.markets[0] && e.markets[0].provider) || null,
      includesOTSO: /overtime/i.test(rules) && /shootout/i.test(rules), sides: { away: strip(sides.away), home: strip(sides.home) },
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
      const p = x.ask, f = fee(p), qq = q ? q[s] : null;
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

  root.Jupiter = { fetchEvents, parseEvent, edges, fee, FEE_COEF };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Jupiter;
})(typeof self !== 'undefined' ? self : globalThis);
