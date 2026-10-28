#!/usr/bin/env node
/* Posts a predictions file to Discord as the reply to a /nhl interaction.
 * env: DISCORD_APP_ID, DISCORD_INTERACTION_TOKEN (15-min interaction token, no bot token needed)
 * usage: node scripts/discord_post.js data/predictions/DATE.json [--dry-run]   (dry run prints the JSON payloads) */
const fs = require('fs');
let payloads;
async function send(appId, token, msgs) {
  const base = `https://discord.com/api/v10/webhooks/${appId}/${token}`;
  for (let i = 0; i < msgs.length; i++) {
    const url = i === 0 ? `${base}/messages/@original` : base;
    const r = await fetch(url, { method: i === 0 ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msgs[i]) });
    if (!r.ok) throw new Error(`Discord ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
}
module.exports = { send };
if (require.main === module) (async () => {
  ({ payloads } = await import('../js/discord_embeds.mjs'));
  const P = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const msgs = payloads(P);
  for (const m of msgs) { const n = JSON.stringify(m.embeds).length; if (n > 6000 * 1.3) console.error('warning: large message', n); }
  if (process.argv.includes('--dry-run')) { console.log(JSON.stringify(msgs, null, 1)); process.exit(0); }
  send(process.env.DISCORD_APP_ID, process.env.DISCORD_INTERACTION_TOKEN, msgs).then(() => console.log(`posted ${msgs.length} message(s)`)).catch(e => { console.error(e.message); process.exit(1); });
})();
