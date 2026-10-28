/* Luck Society /nhl — Discord HTTP interactions endpoint (Cloudflare Workers, free plan).
 * 1. verifies the Ed25519 signature (DISCORD_PUBLIC_KEY), answers PING
 * 2. /nhl -> responds "deferred" (type 5) within 3 s, then dispatches the GitHub Actions workflow (discord.yml), which runs the
 *    full v4 Monte Carlo with fresh Jupiter prices and edits this reply (interaction token valid 15 min)
 * 3. if the dispatch fails, posts the precomputed predictions (refreshed every Pages update) instead.
 * vars: DISCORD_APP_ID, DISCORD_PUBLIC_KEY, GITHUB_REPO, SITE   secret: GITHUB_TOKEN (fine-grained PAT, this repo, Contents: write)
 * The Worker never sees the bot token. */
import { payloads } from '../js/discord_embeds.mjs';

const hex = h => new Uint8Array(h.match(/../g).map(b => parseInt(b, 16)));
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

export async function verify(req, body, publicKey) {
  const sig = req.headers.get('x-signature-ed25519'), ts = req.headers.get('x-signature-timestamp');
  if (!sig || !ts || !/^[0-9a-f]{128}$/i.test(sig)) return false;
  try {
    const key = await crypto.subtle.importKey('raw', hex(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, hex(sig), new TextEncoder().encode(ts + body));
  } catch { return false; }
}

export function etDate(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() + offsetDays * 864e5));
}

async function dispatch(env, token, date) {
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'luck-society-nhl-worker',
               'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
    body: JSON.stringify({ event_type: 'nhl-command', client_payload: { token, application_id: env.DISCORD_APP_ID, date } }),
  });
  if (r.status !== 204) throw new Error(`GitHub dispatch ${r.status}`);
}

async function fallback(env, token, date, why) {
  const base = `https://discord.com/api/v10/webhooks/${env.DISCORD_APP_ID}/${token}`;
  let msgs;
  try {
    const r = await fetch(`${env.SITE}data/predictions/${date}.json?t=${Date.now()}`);
    if (!r.ok) throw new Error('no cached predictions ' + r.status);
    msgs = payloads(await r.json());
    msgs[0].content = `-# Live re-simulation unavailable (${why}); showing the latest precomputed run.`;
  } catch (e) {
    msgs = [{ content: `🍀 Couldn't run the simulator right now (${why}). See ${env.SITE}` }];
  }
  for (let i = 0; i < msgs.length; i++)
    await fetch(i ? base : `${base}/messages/@original`, { method: i ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msgs[i]) });
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'GET') return new Response('Luck Society NHL interactions endpoint 🍀');
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = await req.text();
    if (!(await verify(req, body, env.DISCORD_PUBLIC_KEY))) return new Response('invalid request signature', { status: 401 });
    const i = JSON.parse(body);
    if (i.type === 1) return json({ type: 1 });                                     // PING -> PONG
    if (i.type === 2 && i.data && i.data.name === 'nhl') {
      const opt = ((i.data.options || []).find(o => o.name === 'day') || {}).value;
      const date = etDate(opt === 'tomorrow' ? 1 : 0);
      ctx.waitUntil((async () => {
        try { await dispatch(env, i.token, date); }
        catch (e) { await fallback(env, i.token, date, e.message); }
      })());
      return json({ type: 5 });                                                     // "Bot is thinking…" (public)
    }
    return json({ type: 4, data: { content: 'Unknown command', flags: 64 } });
  },
};
