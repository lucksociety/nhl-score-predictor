/* Live ESPN fetch (CORS-enabled public endpoints) — same parsing as scripts/update_data.py */
(function (root) {
  const ESPN2NHL = { LA: 'LAK', NJ: 'NJD', SJ: 'SJS', TB: 'TBL', UTAH: 'UTA', WAS: 'WSH' };
  const am = x => { if (x == null) return null; if (typeof x === 'number') return x; const s = String(x).trim().toUpperCase(); if (['EVEN', 'EV', 'PK'].includes(s)) return 100; const v = parseFloat(s.replace('+', '')); return isNaN(v) ? null : v; };
  const dig = (o, ...ks) => ks.reduce((x, k) => (x == null ? undefined : x[k]), o);
  function parseOdds(c) {
    const o = (c.odds || [])[0]; if (!o) return null;
    const ml = o.moneyline || {}, tot = o.total || {};
    let total = o.overUnder;
    const line = dig(tot, 'over', 'close', 'line');
    if (total == null && line) total = parseFloat(String(line).replace(/^[ou]/, ''));
    return {
      provider: dig(o, 'provider', 'name'), details: o.details,
      mlAway: am(dig(ml, 'away', 'close', 'odds')) ?? am(dig(o, 'awayTeamOdds', 'moneyLine')),
      mlHome: am(dig(ml, 'home', 'close', 'odds')) ?? am(dig(o, 'homeTeamOdds', 'moneyLine')),
      total: total == null || isNaN(total) ? null : +total,
      over: am(dig(tot, 'over', 'close', 'odds')) ?? am(o.overOdds), under: am(dig(tot, 'under', 'close', 'odds')) ?? am(o.underOdds),
    };
  }
  async function coreOdds(eid) {
    const r = await fetch(`https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/${eid}/competitions/${eid}/odds`);
    if (!r.ok) return null; const j = await r.json();
    for (const it of j.items || []) {
      const mla = am(dig(it, 'awayTeamOdds', 'moneyLine')), mlh = am(dig(it, 'homeTeamOdds', 'moneyLine'));
      if (mla == null && it.overUnder == null) continue;
      return { provider: dig(it, 'provider', 'name'), details: it.details, mlAway: mla, mlHome: mlh, total: it.overUnder ?? null, over: am(it.overOdds), under: am(it.underOdds), closing: true };
    }
    return null;
  }
  async function scoreboard(dateISO) {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${dateISO.replace(/-/g, '')}`);
    if (!r.ok) throw new Error('ESPN ' + r.status);
    const j = await r.json(); const out = [];
    for (const e of j.events || []) {
      const c = e.competitions[0]; const side = {};
      for (const x of c.competitors) side[x.homeAway] = x;
      if (!side.away || !side.home) continue;
      const ab = s => ESPN2NHL[side[s].team.abbreviation] || side[s].team.abbreviation;
      const goalie = s => { const p = side[s].probables || []; const q = p.find(z => z.abbreviation === 'SG') || p[0]; return q ? { name: dig(q, 'athlete', 'displayName'), status: dig(q, 'status', 'name') } : null; };
      const st = dig(c, 'status', 'type') || {};
      let odds = parseOdds(c);
      if (!odds || odds.mlHome == null) { try { odds = (await coreOdds(e.id)) || odds; } catch (_) {} }
      const fin = st.completed;
      const per = dig(c, 'status', 'period');
      out.push({
        espnId: e.id, startUTC: e.date, away: ab('away'), home: ab('home'),
        awayName: side.away.team.displayName, homeName: side.home.team.displayName, venue: dig(c, 'venue', 'fullName'),
        state: st.state, detail: st.shortDetail, odds, goalies: { away: goalie('away'), home: goalie('home') },
        final: fin ? [+side.away.score, +side.home.score, per > 4 ? 'SO' : per === 4 ? 'OT' : 'REG'] : null,
      });
    }
    return out;
  }
  root.ESPNLive = { scoreboard, coreOdds };
})(self);
