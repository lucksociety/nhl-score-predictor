#!/usr/bin/env node
/* Registers (upserts) the global /nhl slash command. Needs env DISCORD_BOT_TOKEN (never commit it) and DISCORD_APP_ID.
 * usage: DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node scripts/register_command.js [--guild GUILD_ID]   (guild = instant, global ≈ instant-1h) */
const app = process.env.DISCORD_APP_ID || '1564789482514030672', tok = process.env.DISCORD_BOT_TOKEN;
if (!tok) { console.error('DISCORD_BOT_TOKEN not set'); process.exit(1); }
const gi = process.argv.indexOf('--guild'), guild = gi > 0 ? process.argv[gi + 1] : null;
const cmd = {
  name: 'nhl', type: 1, description: "Luck Society: simulate today's NHL slate, predicted scores + best Jupiter bet per game",
  options: [{ name: 'day', description: 'Which slate (default today, ET)', type: 3, required: false,
              choices: [{ name: 'today', value: 'today' }, { name: 'tomorrow', value: 'tomorrow' }] }],
  contexts: [0], integration_types: [0],
};
const url = `https://discord.com/api/v10/applications/${app}${guild ? `/guilds/${guild}` : ''}/commands`;
fetch(url, { method: 'POST', headers: { authorization: `Bot ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) { console.error('Discord', r.status, JSON.stringify(j).slice(0, 300)); process.exit(1); }
    console.log(`registered /${j.name} id=${j.id} ${guild ? 'in guild ' + guild : 'globally'}`); });
