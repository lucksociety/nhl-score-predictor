#!/usr/bin/env node
/* Posts a predictions file to Discord as the reply to a /nhl interaction.
 * env: DISCORD_APP_ID, DISCORD_INTERACTION_TOKEN (15-min interaction token, no bot token needed)
 * usage: node scripts/discord_post.js data/predictions/DATE.json [--dry-run]   (dry run prints the JSON payloads) */
const fs = require('fs');
let payloads;
async function post(url, method, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Discord ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
/** Reply to the /nhl interaction (edit "thinking…" + follow-ups). */
async function send(appId, token, msgs) {
  const base = `https://discord.com/api/v10/webhooks/${appId}/${token}`;
  for (let i = 0; i < msgs.length; i++) await post(i === 0 ? `${base}/messages/@original` : base, i === 0 ? 'PATCH' : 'POST', msgs[i]);
}
/** Post to the channel webhook (secret DISCORD_WEBHOOK_URL): fallback, or manual workflow_dispatch posts. */
async function sendWebhook(url, msgs) {
  for (const m of msgs) await post(url + (url.includes('?') ? '&' : '?') + 'wait=true', 'POST', Object.assign({ username: 'Luck Society NHL' }, m));
}
module.exports = { send, sendWebhook };
if (require.main === module) (async () => {
  ({ payloads } = await import('../js/discord_embeds.mjs'));
  const P = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const msgs = payloads(P);
  for (const m of msgs) { const n = JSON.stringify(m.embeds).length; if (n > 6000 * 1.3) console.error('warning: large message', n); }
  if (process.argv.includes('--dry-run')) { console.log(JSON.stringify(msgs, null, 1)); process.exit(0); }
  const E = process.env, wh = E.DISCORD_WEBHOOK_URL;
  try {
    if (process.argv.includes('--webhook')) { if (!wh) throw new Error('DISCORD_WEBHOOK_URL not set'); await sendWebhook(wh, msgs); console.log(`posted ${msgs.length} message(s) to the channel webhook`); return; }
    if (!E.DISCORD_APP_ID || !E.DISCORD_INTERACTION_TOKEN) throw new Error('no interaction token');
    await send(E.DISCORD_APP_ID, E.DISCORD_INTERACTION_TOKEN, msgs); console.log(`replied to /nhl with ${msgs.length} message(s)`);
  } catch (e) {
    console.error('interaction reply failed:', e.message);
    if (process.argv.includes('--webhook') || !wh) process.exit(1);
    try { await sendWebhook(wh, msgs); console.log('posted via channel webhook fallback'); }
    catch (e2) { console.error('webhook fallback failed:', e2.message); process.exit(1); }
  }
})();
