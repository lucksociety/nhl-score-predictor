/* Discord embed builder for /nhl (shared by scripts/discord_post.js and the Cloudflare Worker fallback). */
const GOLD = 0xE8B931, GREEN = 0x1F8A3A, GREY = 0x2A3A22;
const SITE = 'https://lucksociety.github.io/nhl-score-predictor/';
const LOGO = 'https://lucksociety.github.io/nhl-score-predictor/assets/logo-96.jpg';
const pct = x => (100 * x).toFixed(1) + '%';
const cents = x => (100 * x).toFixed(1).replace(/\.0$/, '') + '¢';
const last = n => (n || '').split(' ').slice(-1)[0];

export function gameEmbed(g) {
  const st = g.state === 'LIVE' || g.state === 'CRIT' ? ' · 🔴 LIVE (pre-game prediction)' : g.state === 'OFF' || g.state === 'FINAL' ? ' · Final' : '';
  const e = { title: `🍀 ${g.away} @ ${g.home} · ${g.time}${st}`, color: GREY };
  if (!g.pick) { e.description = `⚠️ ${g.error}`; return e; }
  const gk = s => { const x = (g.goalies || {})[s]; return x && x.name ? `${last(x.name)}${x.status && x.status !== 'Confirmed' ? ' (prob.)' : ''}` : 'TBD'; };
  const lines = [
    `**${g.away} ${g.pick.away} – ${g.pick.home} ${g.home}${g.pick.ot ? ' (OT/SO)' : ''}**`,
    `Win: ${g.away} ${pct(g.pAway)} · ${g.home} ${pct(g.pHome)} · P(OT) ${pct(g.pOT)}`,
    `Goalies: ${gk('away')} vs ${gk('home')} · xG ${g.xg[0].toFixed(2)}–${g.xg[1].toFixed(2)}`,
  ];
  if (g.best) {
    e.color = GOLD;
    lines.push(`✅ **BEST BET: ${g.best.label}** · model ${pct(g.best.q)} · Jupiter ${cents(g.best.ask)} (+${cents(g.best.fee)} fee) · EV **+${pct(g.best.ev)}**`);
    if (Number.isFinite(g.best.sensitivityMin)) lines.push(`Scoring sensitivity minimum: ${pct(g.best.sensitivityMin)} · EV remains positive after sensitivity and sampling checks (stress test, not a confidence interval).`);
    if (g.others && g.others.length) lines.push(`Also qualifies: ${g.others.map(c => `${c.label} ${pct(c.q)} @ ${cents(c.ask)} (+${pct(c.ev)})`).join(' · ')}`);
  } else {
    e.color = GREEN;
    lines.push(`⛔ **NO BET** — ${g.noBetReason}`);
  }
  const L = g.leans, mk = g.markets || {};
  lines.push(`-# Checked ${g.sidesChecked || 0} Jupiter sides (ML ${mk.ml || 0} · totals ${mk.totals || 0} · puck lines ${mk.puckline || 0}) · model O5.5 ${pct(L.o55)} · O6.5 ${pct(L.o65)} · ${g.home} −1.5 ${pct(L.homeM15)} · ${g.away} −1.5 ${pct(L.awayM15)}`);
  e.description = lines.join('\n');
  if (g.jupiterLink) e.url = g.jupiterLink;
  return e;
}

export function payloads(P) {
  // Refresh the clock after simulation/network work; a stale PRE flag is insufficient.
  const now = Date.now();
  P = { ...P, games: P.games.map(g => {
    const fetched = Date.parse(g.quoteFetchedAt);
    const reason = !Number.isFinite(Date.parse(g.start)) || now >= Date.parse(g.start)
      ? 'scheduled start passed or unavailable — no pregame bet'
      : !Number.isFinite(fetched) || fetched > now || now - fetched > 5 * 60 * 1000
        ? 'quote unavailable or older than five minutes — refresh before betting' : null;
    return reason ? { ...g, best: null, others: [], noBetReason: reason } : g;
  }) };
  const bets = P.games.filter(g => g.best);
  const head = {
    title: `🍀 Luck Society NHL — ${P.date}`, url: SITE, color: GOLD, thumbnail: { url: LOGO },
    description: `${P.games.length} games · model **v4-independent** (no Vegas input) · ${(P.sims / 1000).toFixed(0)}k Monte Carlo sims/game\n` +
      `Best bets: **${bets.length}** ${bets.length ? '— ' + bets.map(g => `${g.best.label} (+${pct(g.best.ev)})`).join(', ') : ''}\n` +
      `-# Every Jupiter market checked (moneyline, all O/U lines, all alt puck lines; settle on final score incl. OT/SO). Rule: bet only if model prob > 50% AND EV after Jupiter fee > 0. Prices as of ${P.jupiterFetchedAt ? new Date(P.jupiterFetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'n/a'}. Not financial advice.`,
    footer: { text: 'Luck Society · score = min-expected-error pick · OT/SO winner +1' },
  };
  const embeds = [head, ...P.games.map(gameEmbed)];
  const msgs = [];
  const size = e => (e.title || '').length + (e.description || '').length + (e.footer?.text || '').length
    + (e.fields || []).reduce((n, f) => n + (f.name || '').length + (f.value || '').length, 0);
  let batch = [], chars = 0;
  for (const e of embeds) {
    const n = size(e);
    if (batch.length && (batch.length === 10 || chars + n > 5800)) {
      msgs.push({ embeds: batch, allowed_mentions: { parse: [] } }); batch = []; chars = 0;
    }
    batch.push(e); chars += n;
  }
  if (batch.length) msgs.push({ embeds: batch, allowed_mentions: { parse: [] } });
  if (!P.games.length) msgs[0].embeds[0].description = `No NHL games on ${P.date}.`;
  return msgs;
}

