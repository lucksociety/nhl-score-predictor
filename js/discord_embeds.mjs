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
  } else {
    e.color = GREEN;
    const ml = (g.cands || []).filter(c => c.type === 'ML').map(c => `${c.label.replace(' ML', '')} ${cents(c.ask)} (EV ${c.ev >= 0 ? '+' : ''}${pct(c.ev)})`).join(' · ');
    lines.push(`⛔ **NO BET** — ${g.noBetReason}${ml ? `\nJupiter ML: ${ml}` : ''}`);
  }
  const L = g.leans;
  lines.push(`-# O5.5 ${pct(L.o55)} · O6.5 ${pct(L.o65)} · ${g.home} −1.5 ${pct(L.homeM15)} · ${g.away} −1.5 ${pct(L.awayM15)}${g.jupiterTotals || g.jupiterPuckLine ? '' : ' · totals/puck lines not on Jupiter'}`);
  e.description = lines.join('\n');
  if (g.jupiterLink) e.url = g.jupiterLink;
  return e;
}

export function payloads(P) {
  const bets = P.games.filter(g => g.best);
  const head = {
    title: `🍀 Luck Society NHL — ${P.date}`, url: SITE, color: GOLD, thumbnail: { url: LOGO },
    description: `${P.games.length} games · model **v4-independent** (no Vegas input) · ${(P.sims / 1000).toFixed(0)}k Monte Carlo sims/game\n` +
      `Best bets: **${bets.length}** ${bets.length ? '— ' + bets.map(g => `${g.best.label} (+${pct(g.best.ev)})`).join(', ') : ''}\n` +
      `-# Rule: bet only if model win prob > 50% AND EV after Jupiter fee > 0. Prices as of ${P.jupiterFetchedAt ? new Date(P.jupiterFetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'n/a'}. Not financial advice.`,
    footer: { text: 'Luck Society · score = min-expected-error pick · OT/SO winner +1' },
  };
  const embeds = [head, ...P.games.map(gameEmbed)];
  const msgs = [];
  for (let i = 0; i < embeds.length; i += 10) msgs.push({ embeds: embeds.slice(i, i + 10), allowed_mentions: { parse: [] } });
  if (!P.games.length) msgs[0].embeds[0].description = `No NHL games on ${P.date}.`;
  return msgs;
}

