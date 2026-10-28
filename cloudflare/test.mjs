// Local test: generated keypair, mocked fetch (no network). node cloudflare/test.mjs
import W, { verify } from './worker.mjs';
const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('hex');
const env = { DISCORD_APP_ID: '123', DISCORD_PUBLIC_KEY: pub, GITHUB_REPO: 'o/r', GITHUB_TOKEN: 'x', SITE: 'https://example.test/' };
const calls = []; let ghStatus = 204;
globalThis.fetch = async (url, o = {}) => { calls.push([o.method || 'GET', String(url).replace(/webhooks\/123\/[^/]+/, 'webhooks/123/<tok>'), o.body]);
  if (String(url).includes('api.github.com')) return new Response(null, { status: ghStatus });
  if (String(url).includes('predictions')) return new Response((await import('fs')).readFileSync('data/predictions/2026-10-27.json'), { status: 200 });
  return new Response('{}', { status: 200 }); };
async function req(obj, bad) {
  const body = JSON.stringify(obj), ts = String(Math.floor(Date.now() / 1000));
  let sig = Buffer.from(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(ts + body))).toString('hex');
  if (bad) sig = sig.replace(/^./, c => c === 'a' ? 'b' : 'a');
  const w = []; const r = await W.fetch(new Request('https://w.test/', { method: 'POST', body, headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts } }), env, { waitUntil: p => w.push(p) });
  await Promise.all(w); return [r.status, await r.text()];
}
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
let r = await req({ type: 1 }); ok(r[0] === 200 && r[1] === '{"type":1}', 'PING -> PONG');
r = await req({ type: 1 }, true); ok(r[0] === 401, 'bad signature -> 401');
const nr = await W.fetch(new Request('https://w.test/', { method: 'POST', body: '{}' }), env, { waitUntil() {} }); ok(nr.status === 401, 'missing signature -> 401');
calls.length = 0; r = await req({ type: 2, token: 'TOK', data: { name: 'nhl' } });
ok(r[1] === '{"type":5}' && calls.length === 1 && calls[0][1].includes('/repos/o/r/dispatches') && JSON.parse(calls[0][2]).client_payload.token === 'TOK', '/nhl -> deferred + GitHub dispatch');
calls.length = 0; ghStatus = 401; r = await req({ type: 2, token: 'TOK', data: { name: 'nhl', options: [{ name: 'day', value: 'tomorrow' }] } });
ok(r[1] === '{"type":5}' && calls.some(c => c[0] === 'PATCH' && c[1].endsWith('@original')), 'dispatch failure -> fallback posts cached predictions');
console.log(calls.map(c => c[0] + ' ' + c[1]).join('\n'));
