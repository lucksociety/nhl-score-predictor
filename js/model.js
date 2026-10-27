/* NHL score-contest model v3 — JavaScript port of sim_v2.py / sim_v3.py / tonight.py (uncertainty layer off).
 * - Monte Carlo of a 60-minute game: 3-min steps to 57:00, then 10-sec steps; score effects all game,
 *   +20% for trailing team in the last 20 min, goalie pull + empty-net module, 3-on-3 OT (65% decided) else shootout.
 * - Final recorded-score convention: OT/SO winner gets +1 goal. No ties.
 * - v3 decision inputs: market weight 1.0 on de-vigged moneyline and total (if present), team ratings with prior n0=60,
 *   pick = argmin expected |error| over all non-tied scores 0..8, OT label when P(OT | pick) >= 55%.
 * Works in a browser (window.NHLModel / Web Worker via importScripts) and in Node (module.exports).
 */
(function (root) {
  'use strict';
  const VERSION = 'v3';
  const PARAMS = { st: 0.0, sl: -0.05, st_late: 0.2, pull_mult: 2.5, en_rate: 0.35, ot_goal_p: 0.65, ot_tilt: 0.6, so_tilt: 0.3 };
  const LG_A = 2.979, LG_H = 3.207, SCALE = 0.887;
  const EXPO = 0.8, SHRINK = 0.5, N0 = 60;
  const SV_LEAGUE = 0.889, GOALIE_W = 0.5;
  const MKT_W_TOTAL = 1.0, MKT_W_ML = 1.0;
  const OT_LABEL = 0.55;

  // ---------- RNG: sfc32 seeded via splitmix32 (deterministic: common random numbers in the market fit)
  function makeRng(seed) {
    let s = seed >>> 0;
    const sm = () => { s = (s + 0x9e3779b9) | 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) >>> 0; };
    let a = sm(), b = sm(), c = sm(), d = sm();
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  // Poisson by inversion with precomputed e^-lam
  function pois(lam, L, u) {
    let k = 0, p = L, F = p;
    while (u > F && k < 30) { k++; p *= lam / k; F += p; }
    return k;
  }

  /** Simulate n games with regulation rates la, lh (goals/60 at even state). Returns typed arrays. */
  function simulate(la, lh, n, seed, P) {
    P = Object.assign({}, PARAMS, P || {});
    const rnd = makeRng(seed);
    const A = new Int16Array(n), H = new Int16Array(n), TIE = new Uint8Array(n), OG = new Uint8Array(n), EN = new Int16Array(n);
    const ra = la / 60, rh = lh / 60;
    // 3-minute steps: factor states for each team: neutral 1, leading 1+sl, trailing early 1+st, trailing late 1+st+st_late
    const f = [1, 1 + P.sl, 1 + P.st, 1 + P.st + P.st_late];
    const lamA3 = f.map(x => ra * x * 3), lamH3 = f.map(x => rh * x * 3);
    const LA3 = lamA3.map(x => Math.exp(-x)), LH3 = lamH3.map(x => Math.exp(-x));
    const dts = 1 / 6;
    const lamA10 = f.map(x => ra * x * dts), lamH10 = f.map(x => rh * x * dts);
    const LA10 = lamA10.map(x => Math.exp(-x)), LH10 = lamH10.map(x => Math.exp(-x));
    const pA = P.pull_mult * ra * dts, pH = P.pull_mult * rh * dts, ePA = Math.exp(-pA), ePH = Math.exp(-pH);
    const enl = P.en_rate * dts, eEN = Math.exp(-enl);
    const share = 0.5 + P.ot_tilt * (la / (la + lh) - 0.5);
    const soP = 0.5 + P.so_tilt * (share - 0.5);
    for (let i = 0; i < n; i++) {
      const u1 = 1.0 + 1.5 * rnd(), u2 = 1.5 + 1.5 * rnd(), u3 = 0.75 + 0.75 * rnd();
      let a = 0, h = 0, en = 0, t = 0;
      for (let s = 0; s < 19; s++) {
        const rem = 60 - t, d = a - h, late = rem <= 20;
        const ia = d < 0 ? (late ? 3 : 2) : d > 0 ? 1 : 0;
        const ih = d > 0 ? (late ? 3 : 2) : d < 0 ? 1 : 0;
        const na = pois(lamA3[ia], LA3[ia], rnd()), nh = pois(lamH3[ih], LH3[ih], rnd());
        a += na; h += nh; t += 3;
      }
      for (let s = 0; s < 18; s++) {
        const rem = 60 - t, d = a - h;
        const ia = d < 0 ? 3 : d > 0 ? 1 : 0;
        const ih = d > 0 ? 3 : d < 0 ? 1 : 0;
        const pullA = (d === -1 && rem <= u1) || (d === -2 && rem <= u2) || (d === -3 && rem <= u3);
        const pullH = (d === 1 && rem <= u1) || (d === 2 && rem <= u2) || (d === 3 && rem <= u3);
        const na = pullA ? pois(pA, ePA, rnd()) : pois(lamA10[ia], LA10[ia], rnd());
        const nh = pullH ? pois(pH, ePH, rnd()) : pois(lamH10[ih], LH10[ih], rnd());
        const ea = pullH ? pois(enl, eEN, rnd()) : 0;   // away scores into home empty net
        const eh = pullA ? pois(enl, eEN, rnd()) : 0;
        a += na + ea; h += nh + eh; en += ea + eh; t += dts;
      }
      const tie = a === h;
      const og = rnd() < P.ot_goal_p;
      const u = rnd();
      if (tie) { const awin = og ? u < share : u < soP; if (awin) a++; else h++; }
      A[i] = a; H[i] = h; TIE[i] = tie ? 1 : 0; OG[i] = og ? 1 : 0; EN[i] = en;
    }
    return { a: A, h: H, tie: TIE, og: OG, en: EN, n };
  }

  // ---------- ratings (sim_v2.team_ratings): prior-season GF/GA shrunk 50% to league, Bayesian update with current results
  function teamRatings(base, results, n0) {
    n0 = n0 == null ? N0 : n0;
    const lg = (LG_A + LG_H) / 2, rat = {};
    for (const tm of Object.keys(base)) {
      const pf = lg + SHRINK * (base[tm].gf - lg), pa = lg + SHRINK * (base[tm].ga - lg);
      let sf = 0, sa = 0, k = 0;
      for (const r of results || []) {
        if (r.away === tm) { sf += r.a; sa += r.h; k++; } else if (r.home === tm) { sf += r.h; sa += r.a; k++; }
      }
      rat[tm] = { off: ((n0 * pf + sf) / (n0 + k)) / lg, def: ((n0 * pa + sa) / (n0 + k)) / lg, gp: k };
    }
    return rat;
  }
  const gfac = sv => sv == null ? 1.0 : 1 + GOALIE_W * ((1 - sv) / (1 - SV_LEAGUE) - 1);
  function baseRates(away, home, rat, svA, svH) {
    const ra = rat[away] || { off: 1, def: 1 }, rh = rat[home] || { off: 1, def: 1 };
    return [LG_A * SCALE * Math.pow(ra.off * rh.def, EXPO) * gfac(svH), LG_H * SCALE * Math.pow(rh.off * ra.def, EXPO) * gfac(svA)];
  }

  // ---------- market
  const mlProb = o => o < 0 ? -o / (-o + 100) : 100 / (o + 100);
  const devig2 = (o1, o2) => { const p1 = mlProb(o1), p2 = mlProb(o2); return p1 / (p1 + p2); };

  function fitMarket(la, lh, pHome, total, pOver, n, seed) {
    n = n || 120000; seed = seed == null ? 7 : seed;
    const probs = (s, t) => {
      const r = simulate(la * s * t, lh * s / t, n, seed);
      let hw = 0, ov = 0, np_ = 0;
      for (let i = 0; i < n; i++) {
        if (r.h[i] > r.a[i]) hw++;
        if (total != null) {
          const tb = r.a[i] + r.h[i] - ((r.tie[i] && !r.og[i]) ? 1 : 0);
          if (tb > total) ov++;
          if (tb !== total) np_++;
        }
      }
      let po = null;
      if (total != null) po = Number.isInteger(total) ? ov / Math.max(1, np_) : ov / n;
      return [hw / n, po];
    };
    let s = 1.0, t = 1.0;
    for (let it = 0; it < 3; it++) {
      if (total != null) {
        let lo = 0.7, hi = 1.4;
        for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (probs(mid, t)[1] > pOver) hi = mid; else lo = mid; }
        s = (lo + hi) / 2;
      }
      if (pHome != null) {
        let lo = 0.6, hi = 1.6;
        for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (probs(s, mid)[0] > pHome) lo = mid; else hi = mid; }
        t = (lo + hi) / 2;
      }
    }
    return [s, t];
  }

  // ---------- report
  function analyze(r) {
    const { a, h, tie, n } = r;
    const pa = new Float64Array(13), ph = new Float64Array(13);
    const cnt = new Map(), cntTie = new Map();
    let sa = 0, sh = 0, hw = 0, ot = 0, en = 0, og = 0;
    const tot = new Float64Array(10);
    for (let i = 0; i < n; i++) {
      const x = a[i], y = h[i];
      pa[Math.min(12, x)]++; ph[Math.min(12, y)]++;
      sa += x; sh += y; if (y > x) hw++; if (tie[i]) { ot++; if (r.og[i]) og++; } en += r.en[i];
      tot[Math.min(9, x + y)]++;
      const key = x * 100 + y;
      cnt.set(key, (cnt.get(key) || 0) + 1);
      if (tie[i]) cntTie.set(key, (cntTie.get(key) || 0) + 1);
    }
    for (let k = 0; k < 13; k++) { pa[k] /= n; ph[k] /= n; }
    const EA = [], EH = [];
    for (let x = 0; x < 13; x++) { let ea = 0, eh = 0; for (let k = 0; k < 13; k++) { ea += Math.abs(x - k) * pa[k]; eh += Math.abs(x - k) * ph[k]; } EA.push(ea); EH.push(eh); }
    let best = null;
    for (let x = 0; x <= 8; x++) for (let y = 0; y <= 8; y++) {
      if (x === y) continue;
      const c = EA[x] + EH[y];
      if (!best || c < best.err) best = { x, y, err: c };
    }
    const cell = (x, y) => { const k = x * 100 + y, c = cnt.get(k) || 0; return { x, y, p: c / n, potGiven: c ? (cntTie.get(k) || 0) / c : NaN, err: EA[Math.min(12, x)] + EH[Math.min(12, y)] }; };
    const top = [...cnt.entries()].filter(([k]) => Math.floor(k / 100) !== k % 100).sort((u, v) => v[1] - u[1]).slice(0, 10).map(([k]) => cell(Math.floor(k / 100), k % 100));
    const pick = cell(best.x, best.y);
    pick.otLabel = pick.potGiven >= OT_LABEL;
    pick.winner = pick.x > pick.y ? 'away' : 'home';
    return {
      n, ea: sa / n, eh: sh / n, pHome: hw / n, pAway: 1 - hw / n, pOT: ot / n, pOTgoal: ot ? og / ot : 0, enShare: en / (sa + sh),
      distA: Array.from(pa.slice(0, 7)).map((v, i) => i < 6 ? v : Array.from(pa.slice(6)).reduce((s, q) => s + q, 0)),
      distH: Array.from(ph.slice(0, 7)).map((v, i) => i < 6 ? v : Array.from(ph.slice(6)).reduce((s, q) => s + q, 0)),
      distTot: Array.from(tot).map(v => v / n), top, pick
    };
  }

  /**
   * Run the v3 protocol for one game.
   * g: {away, home, mlAway, mlHome, total, over, under, svAway, svHome}
   * ctx: {ratings}   opts: {n, nFit, seed}
   */
  function runGame(g, ratings, opts) {
    opts = opts || {};
    const n = opts.n || 400000, nFit = opts.nFit || 60000, seed = opts.seed == null ? 11 : opts.seed;
    const [la, lh] = baseRates(g.away, g.home, ratings, g.svAway, g.svHome);
    const hasML = g.mlAway != null && g.mlHome != null, hasTot = g.total != null;
    const pHome = hasML ? devig2(g.mlHome, g.mlAway) : null;
    const pOver = hasTot ? devig2(g.over != null ? g.over : -110, g.under != null ? g.under : -110) : null;
    let s = 1, t = 1;
    if (hasML || hasTot) [s, t] = fitMarket(la, lh, pHome, hasTot ? g.total : null, pOver, nFit, 7);
    const laB = la * Math.pow(s, MKT_W_TOTAL) * Math.pow(t, MKT_W_ML), lhB = lh * Math.pow(s, MKT_W_TOTAL) / Math.pow(t, MKT_W_ML);
    const r = simulate(laB, lhB, n, seed);
    const o = analyze(r);
    o.mode = hasML && hasTot ? 'market' : (hasML || hasTot) ? 'partial-market' : 'ratings-fallback';
    o.model = [la, lh]; o.rates = [laB, lhB]; o.fit = [s, t]; o.mkt = { pHome, pOver };
    o.version = VERSION;
    return o;
  }

  const api = { VERSION, PARAMS, simulate, teamRatings, baseRates, fitMarket, analyze, runGame, devig2, mlProb, OT_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NHLModel = api;
})(typeof self !== 'undefined' ? self : this);
