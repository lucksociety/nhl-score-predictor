// Every script the dashboard loads must at least parse. A single syntax error in js/app.js stops the whole page
// from loading games (21 Nov 2026: an apostrophe inside a single-quoted string).
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), dir = path.join(root, 'js'); let n = 0;
for (const f of fs.readdirSync(dir).filter(f => /\.(js|mjs)$/.test(f))) { execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' }); n++; }
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) if (!/^https?:/.test(m[1]) && !fs.existsSync(path.join(root, m[1].split('?')[0]))) throw new Error('index.html loads a missing script: ' + m[1]);
console.log('browser scripts parse ok (' + n + ' files)');
