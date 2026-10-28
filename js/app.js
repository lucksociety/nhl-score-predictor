/* Luck Society NHL Predictor dashboard — UI + orchestration. Models live in js/model.js (v4-independent default, v3 optional); best-bet rules in js/bets.js. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const TZ = 'America/New_York';
  const PREC = { std: { n: 400000, nFit: 40000 }, full: { n: 800000, nFit: 120000 } };
  const state = { base: null, results: [], index: null, games: [], date: null, out: {}, snapshotAt: null, liveAt: null, liveOk: false, jup: null, jupAt: null, jupOk: false, jupHost: null, jupErr: null };

  const etDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const etTime = iso => iso ? new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) + ' ET' : 'TBD';
  const etStamp = iso => iso ? new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) + ' ET' : '—';
  const pct = (x, d = 0) => x == null || isNaN(x) ? '—' : (100 * x).toFixed(d) + '%';
  const odd = x => x == null ? '—' : (x > 0 ? '+' + x : '' + x);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const logo = ab => `https://assets.nhle.com/logos/nhl/svg/${ab}_dark.svg`;
  const key = g => g.away + '|' + g.home;
  const hasML = o => o && o.mlAway != null && o.mlHome != null;
  const hasTot = o => o && o.total != null;
  const pp = x => x == null || isNaN(x) ? '—' : Math.abs(x) < 0.0005 ? '0.0' : (x > 0 ? '+' : '−') + Math.abs(100 * x).toFixed(1);
  const cents = x => x == null ? '—' : (100 * x).toFixed(0) + '¢';
  const evp = x => x == null || isNaN(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(100 * x).toFixed(1) + '%';
  const TIP_V3 = 'Edge vs DraftKings-derived model: v3 fits the DraftKings moneyline at full weight, so model win % ≈ DraftKings no-vig. Edge = model win % (incl. OT/SO) − Jupiter YES ask. EV per $1 = model / (ask + fee) − 1, fee = 0.07·p·(1−p).';
  const TIP_V4 = 'Independent edge: v4 uses no betting-market input. Edge = model win % (incl. OT/SO) − Jupiter YES ask. EV per $1 = model / (ask + fee) − 1, fee = 0.07·p·(1−p). Bet only if model > 50% and EV > 0.';
  let EDGE_TIP = TIP_V4;
  const lastName = n => String(n || '').normalize('NFKD').replace(/[\u0300-\u036f.]/g, '').trim().toLowerCase().split(/\s+/).pop();
  // if the live/confirmed starter differs from the one the Action used, re-weight with that goalie's rating (gq)
  function gqOverride(g) {
    const ov = {}, notes = [];
    for (const sd of ['away', 'home']) {
      const used = g.v4.goalies[sd], live = g.goalies && g.goalies[sd] && g.goalies[sd].name;
      if (!live || (used.name && lastName(used.name) === lastName(live))) continue;
      const hit = (used.table || []).find(t => lastName(t.name) === lastName(live));
      if (hit) { ov[sd] = hit.gq; notes.push(`${g[sd]} goalie → ${live}`); }
    }
    return { ov, notes };
  }
  function betHTML(g, o) {
    if (!o || !o.dist || !window.NHLBets) return '';
    const e = NHLBets.evaluate(g, o), L = e.leans;
    const leans = `<div class="muted" style="font-size:11.5px;margin-top:4px">Model leans (no Jupiter market${e.hasTotals || e.hasPL ? ' unless listed above' : ''}): Over 5.5 ${pct(L.o55, 1)} · Over 6.5 ${pct(L.o65, 1)} · ${g.home} −1.5 ${pct(L.homeM15, 1)} · ${g.away} −1.5 ${pct(L.awayM15, 1)}</div>`;
    if (g.jupInGame) return `<div class="betbox nobet"><b>Best bet:</b> game started — in-game prices not compared with the pre-game model.${leans}</div>`;
    if (e.best) { const b = e.best; return `<div class="betbox bet">✅ <b>BEST BET: ${esc(b.label)}</b> · model ${pct(b.q, 1)} · Jupiter ${cents(b.ask)} (+${(100 * b.fee).toFixed(1)}¢ fee) · EV <b>${evp(b.ev)}</b>${leans}</div>`; }
    return `<div class="betbox nobet">⛔ <b>NO BET</b> — ${esc(e.reason)}${leans}</div>`;
  }

  async function getJSON(url, bust = true) {
    const r = await fetch(url + (bust ? (url.includes('?') ? '&' : '?') + 't=' + Date.now() : ''), { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }
  function setStatus(html) { $('status').innerHTML = html; }

  async function init() {
    try {
      const [base, results, index] = await Promise.all([getJSON('data/base_2025_26.json'), getJSON('data/results_2026_27.json'), getJSON('data/index.json').catch(() => null)]);
      state.base = base.teams; state.results = results; state.index = index;
    } catch (e) { setStatus('<span class="warn">Could not load model data: ' + esc(e.message) + '</span>'); return; }
    const today = etDate();
    $('date').value = today;
    $('date').addEventListener('change', () => loadDate($('date').value));
    $('simulate').addEventListener('click', simulate);
    $('model').addEventListener('change', () => { EDGE_TIP = $('model').value === 'v4' ? TIP_V4 : TIP_V3; state.out = {}; renderSlate(); });
    $('copy').addEventListener('click', copyPicks);
    const last = state.results.length ? state.results[state.results.length - 1].date : '—';
    $('datainfo').textContent = `Ratings data: 2025-26 base + ${state.results.length} completed 2026-27 games (through ${last}). Data refreshed ${state.index ? etStamp(state.index.updatedAt) : '—'}. Default model v4-independent (no Vegas input; JS sim verified against Python).`;
    await loadDate(today);
  }

  function mergeGames(snap, live) {
    const out = []; const lm = new Map((live || []).map(g => [key(g), g]));
    const seen = new Set();
    for (const s of (snap ? snap.games : [])) {
      const l = lm.get(key(s)); seen.add(key(s));
      const g = Object.assign({}, s, { goalies: Object.assign({ away: null, home: null }, s.goalies || {}) });
      g.oddsSource = s.odds && (hasML(s.odds) || hasTot(s.odds)) ? `${s.odds.provider || 'ESPN'} via Action snapshot (${etStamp(snap.generatedAt)})${s.odds.closing ? ', closing line' : ''}` : null;
      if (l) {
        const started = l.state === 'in' || l.state === 'post';
        const snapOK = s.odds && hasML(s.odds) && hasTot(s.odds);
        // once a game has started, keep the pre-game snapshot line (ESPN may switch to live in-game odds)
        if (l.odds && (hasML(l.odds) || hasTot(l.odds)) && !(started && snapOK)) { g.odds = l.odds; g.oddsSource = `${l.odds.provider || 'ESPN'} via ESPN live (${etStamp(state.liveAt)})${l.odds.closing ? ', closing line' : ''}`; }
        for (const sd of ['away', 'home']) if (l.goalies[sd] && l.goalies[sd].name) g.goalies[sd] = l.goalies[sd];
        if (l.final) g.final = l.final;
        g.detail = l.detail; g.espnState = l.state;
        if (!g.startUTC) g.startUTC = l.startUTC;
      }
      attachJup(g, snap);
      out.push(g);
    }
    for (const l of (live || [])) if (!seen.has(key(l))) {
      const g = Object.assign({}, l);
      g.oddsSource = l.odds && (hasML(l.odds) || hasTot(l.odds)) ? `${l.odds.provider || 'ESPN'} via ESPN live (${etStamp(state.liveAt)})` : null;
      attachJup(g, null);
      out.push(g);
    }
    out.sort((a, b) => (a.startUTC || '').localeCompare(b.startUTC || '') || a.away.localeCompare(b.away));
    return out;
  }

  // Jupiter: live browser fetch (CORS ok); falls back to the Action snapshot copy stored on each game.
  function attachJup(g, snap) {
    const started = g.espnState === 'in' || g.espnState === 'post' || g.state === 'LIVE' || g.state === 'CRIT' || g.state === 'FINAL' || g.state === 'OFF' || !!g.final;
    const snapJ = g.jupiter || null;
    const liveJ = state.jup ? state.jup.get(state.date + '|' + g.away + '|' + g.home) : null;
    const preGame = j => j && j.fetchedAt && g.startUTC && j.fetchedAt < g.startUTC;
    let j = null, src = null;
    if (started && preGame(snapJ)) { j = snapJ; src = 'snapshot'; }       // keep the last pre-game price once the game starts
    else if (liveJ) { j = liveJ; src = 'live'; }
    else if (snapJ) { j = snapJ; src = 'snapshot'; }
    g.jupiter = j; g.jupSrc = src;
    g.jupInGame = !!(j && started && !preGame(j));
    g.jupSource = j ? (src === 'live' ? `Jupiter live (${etStamp(j.fetchedAt)})` : `Jupiter via Action snapshot (${etStamp(j.fetchedAt)})`) : null;
  }
  async function fetchJupiter() {
    if (state.jup && state.jupAt && Date.now() - Date.parse(state.jupAt) < 60000) return;   // keyless API: be gentle
    try {
      const r = await Jupiter.fetchEvents();
      const m = new Map();
      for (const e of r.events) { const p = Jupiter.parseEvent(e); if (p) { p.fetchedAt = r.fetchedAt; p.host = r.host; m.set(p.date + '|' + p.away + '|' + p.home, p); } }
      state.jup = m; state.jupAt = r.fetchedAt; state.jupOk = true; state.jupHost = r.host; state.jupErr = null;
    } catch (e) { state.jupOk = false; state.jupErr = e.message; }
  }
  async function fetchSlate(date) {
    let snap = null, live = null;
    const [s, l] = await Promise.allSettled([getJSON(`data/days/${date}.json`), ESPNLive.scoreboard(date), fetchJupiter()]);
    if (s.status === 'fulfilled') { snap = s.value; state.snapshotAt = snap.generatedAt; } else state.snapshotAt = null;
    if (l.status === 'fulfilled') { live = l.value; state.liveOk = true; state.liveAt = new Date().toISOString(); } else state.liveOk = false;
    return mergeGames(snap, live);
  }

  async function loadDate(date) {
    state.date = date; state.out = {};
    $('simulate').disabled = true; $('summary').classList.add('hidden');
    setStatus('Loading slate for ' + esc(date) + '…');
    state.games = await fetchSlate(date);
    renderSlate();
    if (!state.games.length) { setStatus(`No NHL games found for ${esc(date)}.`); return; }
    const noOdds = state.games.filter(g => !(hasML(g.odds) && hasTot(g.odds))).length;
    const nj = state.games.filter(g => g.jupiter).length;
    setStatus(`${state.games.length} game${state.games.length > 1 ? 's' : ''} on ${esc(date)} · odds ${state.liveOk ? 'live from ESPN' : '<span class="warn">from Action snapshot (live ESPN fetch failed)</span>'}` +
      ` · Jupiter markets ${nj}/${state.games.length}${state.jupOk ? ' (live)' : ' <span class="warn">(live Jupiter fetch failed — snapshot only)</span>'}` +
      (state.snapshotAt ? ` · snapshot ${etStamp(state.snapshotAt)}` : '') + (noOdds ? ` · <span class="warn">${noOdds} without full odds → ratings fallback</span>` : '') + ' · press <b>Simulate</b>.');
    $('simulate').disabled = false;
  }

  function ratingsAsOf(date) {
    return NHLModel.teamRatings(state.base, state.results.filter(r => r.date < date));
  }

  // ---------- simulation (worker pool)
  function makePool(size) {
    const ws = []; try { for (let i = 0; i < size; i++) ws.push(new Worker('js/worker.js')); } catch (e) { return null; }
    return ws;
  }
  function runAll(jobs, onDone) {
    const size = Math.max(1, Math.min(jobs.length, (navigator.hardwareConcurrency || 4) - 1, 8));
    const pool = makePool(size);
    if (!pool) {   // no workers (e.g. file://): run on the main thread
      return jobs.reduce((p, j) => p.then(() => new Promise(res => setTimeout(() => { const t0 = performance.now(); const r = j.v4 ? NHLModel.runGameV4(j.v4, Object.assign({}, j.opts, { gq: j.v4.gqOverride })) : NHLModel.runGame(j.game, j.ratings, j.opts); r.ms = performance.now() - t0; onDone(j.id, r); res(); }, 20))), Promise.resolve());
    }
    return new Promise(resolve => {
      let next = 0, done = 0;
      const feed = w => { if (next >= jobs.length) return; const j = jobs[next++]; w.postMessage(j); };
      pool.forEach(w => {
        w.onmessage = ev => { const { id, ok, result, error } = ev.data; onDone(id, ok ? result : { error }); done++; if (done === jobs.length) { pool.forEach(x => x.terminate()); resolve(); } else feed(w); };
        w.onerror = ev => { console.error(ev); };
        feed(w);
      });
    });
  }

  async function simulate() {
    const btn = $('simulate'); btn.disabled = true; const date = state.date;
    setStatus('Refreshing live odds and goalies…');
    state.games = await fetchSlate(date); state.out = {}; renderSlate();
    const ratings = ratingsAsOf(date);
    const opts = PREC[$('precision').value] || PREC.std;
    const useV4 = $('model').value === 'v4'; EDGE_TIP = useV4 ? TIP_V4 : TIP_V3; renderSlate();
    const jobs = state.games.map((g, i) => {
      const j = { id: i, ratings, opts: Object.assign({ seed: 11 }, opts), game: { away: g.away, home: g.home, mlAway: g.odds && g.odds.mlAway, mlHome: g.odds && g.odds.mlHome, total: g.odds && g.odds.total, over: g.odds && g.odds.over, under: g.odds && g.odds.under } };
      if (useV4 && g.v4) { const o = gqOverride(g); j.v4 = { away: g.away, home: g.home, v4: g.v4, gqOverride: o.ov }; g.gkNotes = o.notes; }
      return j;
    });
    $('progress').classList.remove('hidden'); $('bar').style.width = '2%';
    document.querySelectorAll('.card').forEach(c => c.classList.add('running'));
    const t0 = performance.now(); let n = 0;
    setStatus(`Simulating ${jobs.length} games (${(opts.n / 1000)}k sims each, ${useV4 ? 'v4-independent' : 'v3 + market fit'})…`);
    await runAll(jobs, (id, r) => {
      state.out[id] = r; n++; $('bar').style.width = (100 * n / jobs.length) + '%';
      renderCard(id); renderSummary();
      setStatus(`Simulated ${n}/${jobs.length}…`);
    });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(`Done: ${jobs.length} games simulated in ${secs}s with model ${useV4 ? 'v4-independent' : 'v3'}${useV4 && jobs.some(j => !j.v4) ? ' (v3 fallback where v4 rates were missing)' : ''} (${opts.n / 1000}k sims/game, seed 11 — same inputs give the same picks). Odds ${state.liveOk ? 'live from ESPN at ' + etStamp(state.liveAt) : 'from Action snapshot'}; Jupiter prices ${state.jupOk ? 'live at ' + etStamp(state.jupAt) : 'from Action snapshot'}.`);
    setTimeout(() => $('progress').classList.add('hidden'), 800);
    btn.disabled = false;
  }

  // ---------- rendering
  function goalieHTML(g) {
    if (!g || !g.name) return '<span class="muted">TBD</span>';
    return `${esc(g.name)}<span class="badge ${esc(g.status || '')}">${esc(g.status || 'Unconfirmed')}</span>`;
  }
  function oddsHTML(g) {
    const o = g.odds;
    if (!(hasML(o) && hasTot(o))) {
      const part = o && (hasML(o) || hasTot(o)) ? ` (only ${hasML(o) ? 'moneyline' : 'total'} available — partial market fit)` : '';
      return (($('model') || {}).value === 'v3' ? `<div class="warnbox">⚠ No odds — v3 ratings fallback${part}. Pick uses team ratings only (weaker).</div>` : '') + (o && (hasML(o) || hasTot(o)) ? `<div class="odds">${hasML(o) ? `ML <b>${g.away} ${odd(o.mlAway)}</b> / <b>${g.home} ${odd(o.mlHome)}</b>` : ''} ${hasTot(o) ? `Total <b>${o.total}</b> (o ${odd(o.over)} / u ${odd(o.under)})` : ''}</div>` : '');
    }
    const ph = NHLModel.devig2(o.mlHome, o.mlAway), po = NHLModel.devig2(o.over ?? -110, o.under ?? -110);
    return `<div class="odds">ML <b>${g.away} ${odd(o.mlAway)}</b> / <b>${g.home} ${odd(o.mlHome)}</b> · Total <b>${o.total}</b> (o ${odd(o.over)} / u ${odd(o.under)})<br>No-vig: ${g.home} ${pct(ph, 1)} · Over ${pct(po, 1)} · <span class="muted">${esc(g.oddsSource || '')}</span></div>`;
  }
  function jupHTML(g, o) {
    const j = g.jupiter;
    if (!j) return `<div class="sect"><span>Jupiter edge</span></div><div class="odds"><span class="chip none">No Jupiter market</span> <span class="muted">No NHL game market on Jupiter Predict matched this game${state.jupOk ? '' : ' (live Jupiter fetch failed)'}.</span></div>`;
    const ed = Jupiter.edges(j, o ? { away: o.pAway, home: o.pHome } : null);
    const row = (s, ab) => {
      const e = ed[s];
      if (!e) return `<tr><td><b>${ab}</b></td><td colspan="6" class="muted">no price</td></tr>`;
      const good = e.ev != null && e.ev > 0 && !g.jupInGame, soft = !good && e.edge != null && e.edge > 0 && !g.jupInGame;
      return `<tr class="${good ? 'posbg' : ''}"><td><b>${ab}</b></td><td>${cents(e.ask)}${e.bid ? `<span class="muted"> / ${cents(e.bid)}</span>` : ''}</td><td>${pct(e.noVig, 1)}</td><td>${o ? pct(e.model, 1) : '—'}</td>` +
        `<td class="${good ? 'pos' : soft ? 'soft' : 'neg'}">${o ? pp(e.edge) : '—'}</td><td class="${good ? 'pos' : 'neg'}">${o ? evp(e.ev) : '—'}</td></tr>`;
    };
    const warn = g.jupInGame ? `<div class="warnbox">⚠ Game already started: this is an in-game Jupiter price, so the edge vs the pre-game model is not meaningful.</div>` : '';
    const otso = j.includesOTSO === false ? `<div class="warnbox">⚠ Market rules do not mention OT/shootout — check resolution before comparing.</div>` : '';
    return `<div class="sect"><span title="${esc(EDGE_TIP)}">Jupiter edge ⓘ</span><a href="${esc(j.link)}" target="_blank" rel="noopener">Open market ↗</a></div>${warn}${otso}
      <table class="edge"><thead><tr><th>Side</th><th title="YES ask / bid per $1 contract">Ask / bid</th><th title="Ask divided by the sum of both asks">No-vig</th><th title="Model win % incl. OT/SO">Model</th><th title="${esc(EDGE_TIP)}">Edge pp</th><th title="EV per $1 staked at the ask, after Jupiter fee 0.07·p·(1−p)">EV/$1</th></tr></thead>
      <tbody>${row('away', g.away)}${row('home', g.home)}</tbody></table>
      <div class="muted" style="font-size:11.5px;margin-top:3px">${esc(g.jupSource || '')} · overround ${ed.overround == null ? '—' : pp(ed.overround) + ' pp'} · ${EDGE_TIP === TIP_V4 ? 'independent edge (v4, no Vegas input)' : 'edge vs DraftKings-derived model (v3)'}</div>`;
  }
  function bestEdge(g, o) {
    if (!g.jupiter || !o || o.error) return null;
    const ed = Jupiter.edges(g.jupiter, { away: o.pAway, home: o.pHome });
    const c = ['away', 'home'].filter(s => ed[s]).map(s => Object.assign({ side: s, ab: g[s] }, ed[s]));
    if (!c.length) return null;
    c.sort((a, b) => b.ev - a.ev);
    return { best: c[0], ed };
  }
  function cardShell(g, i) {
    const status = g.final ? `Final${g.final[2] && g.final[2] !== 'REG' ? '/' + g.final[2] : ''}: ${g.away} ${g.final[0]}–${g.final[1]} ${g.home}` : (g.detail && g.espnState === 'in' ? 'LIVE · ' + esc(g.detail) : '');
    return `<div class="card" id="card${i}">
      <div class="matchup">
        <div class="team"><img src="${logo(g.away)}" alt="" onerror="this.style.visibility='hidden'"><div class="ab">${g.away}</div><div class="nm">${esc(g.awayName || '')}</div></div>
        <div class="mid"><div class="at">@</div><div>${etTime(g.startUTC)}</div><div>${esc(g.venue || '')}</div><div>${esc(status)}</div></div>
        <div class="team"><img src="${logo(g.home)}" alt="" onerror="this.style.visibility='hidden'"><div class="ab">${g.home}</div><div class="nm">${esc(g.homeName || '')}</div></div>
      </div>
      <div class="goalies"><div>🥅 ${goalieHTML(g.goalies && g.goalies.away)}</div><div>${goalieHTML(g.goalies && g.goalies.home)} 🥅</div></div>
      ${oddsHTML(g)}
      <div id="jup${i}">${jupHTML(g, null)}</div>
      <div class="res" id="res${i}"><p class="muted" style="text-align:center;margin:14px 0">Press Simulate to run the model.</p></div>
    </div>`;
  }
  function renderSlate() {
    $('slate').innerHTML = state.games.map(cardShell).join('');
    renderSummary();
  }
  function pickText(g, o) {
    const p = o.pick; const win = p.x > p.y ? g.away : g.home;
    return `${g.away} ${p.x} – ${g.home} ${p.y}` + (p.otLabel ? ` OT (${win})` : '');
  }
  function renderCard(i) {
    const g = state.games[i], o = state.out[i], el = $('res' + i);
    $('card' + i).classList.remove('running');
    if (!o || o.error) { el.innerHTML = `<div class="warnbox">Simulation error: ${esc(o && o.error)}</div>`; return; }
    const p = o.pick, win = p.x > p.y ? g.away : g.home;
    const fallback = o.mode !== 'market' && o.mode !== 'v4-independent';
    const res = g.final ? (() => { const fa = g.final[0], fh = g.final[1]; const err = Math.abs(fa - p.x) + Math.abs(fh - p.y); const right = (fa > fh) === (p.x > p.y); return `<div class="result">Actual: <b>${g.away} ${fa} – ${g.home} ${fh}</b>${g.final[2] && g.final[2] !== 'REG' ? ' (' + g.final[2] + ')' : ''} · error <b>${err}</b> · winner ${right ? '✓' : '✗'}</div>`; })() : '';
    $('jup' + i).innerHTML = jupHTML(g, o) + betHTML(g, o);
    el.innerHTML = `
      <div class="pickbox"><div class="lbl">Final pick${fallback ? ' · ratings fallback' : ''}</div>
        <div class="score">${g.away} ${p.x} – ${p.y} ${g.home}${p.otLabel ? `<span class="ot">OT · ${win}</span>` : ''}</div>
        <div class="meta">P(game goes to OT/SO) <b>${pct(o.pOT, 1)}</b> · P(OT | this score) ${pct(p.potGiven)} · exact-score chance ${pct(p.p, 1)} · E|error| ${p.err.toFixed(2)}</div></div>
      <div class="wp"><div class="wa" style="width:${(100 * o.pAway).toFixed(1)}%">${g.away} ${pct(o.pAway)}</div><div class="wh">${g.home} ${pct(o.pHome)}</div></div>
      <div class="kv"><div><span>xG ${g.away}</span><b>${o.ea.toFixed(2)}</b></div><div><span>xG ${g.home}</span><b>${o.eh.toFixed(2)}</b></div><div><span>xG total</span><b>${(o.ea + o.eh).toFixed(2)}</b></div></div>
      <table class="top5"><thead><tr><th>#</th><th>Top exact scores</th><th>Prob</th><th>P(OT|score)</th><th>E|err|</th></tr></thead><tbody>
      ${o.top.slice(0, 5).map((t, k) => `<tr class="${t.x === p.x && t.y === p.y ? 'is-pick' : ''}"><td>${k + 1}</td><td>${g.away} ${t.x}–${t.y} ${g.home}</td><td>${pct(t.p, 1)}</td><td>${pct(t.potGiven)}</td><td>${t.err.toFixed(2)}</td></tr>`).join('')}
      </tbody></table>
      ${res}
      <details><summary>Model details</summary>
        Inputs: ${o.mode === 'v4-independent' ? 'v4-independent: team goals/xG/shots form, starting goalies, home ice, rest & travel — no betting-market input' + (g.gkNotes && g.gkNotes.length ? ' (' + esc(g.gkNotes.join(', ')) + ')' : '') : o.mode === 'market' ? 'market (ML + total, weight 1.0)' : o.mode === 'partial-market' ? 'partial market + ratings' : 'team ratings only'} · regulation rates ${o.rates[0].toFixed(2)} / ${o.rates[1].toFixed(2)} goals/60 (${o.mode === 'v4-independent' ? 'final-goal λ' : 'ratings-only'} ${o.model[0].toFixed(2)} / ${o.model[1].toFixed(2)}) ·
        ${g.away} goals 0–5,6+: ${o.distA.map(v => pct(v)).join(' / ')} · ${g.home}: ${o.distH.map(v => pct(v)).join(' / ')} ·
        empty-net share ${pct(o.enShare, 1)} · OT decided in 3-on-3 ${pct(o.pOTgoal)} of OT games · ${(o.n / 1000)}k sims in ${(o.ms / 1000).toFixed(1)}s
      </details>`;
  }
  function renderSummary() {
    const ids = Object.keys(state.out);
    if (!ids.length) { $('summary').classList.add('hidden'); return; }
    $('summary').classList.remove('hidden');
    let tot = 0, nf = 0, wins = 0;
    const rows = state.games.map((g, i) => {
      const o = state.out[i];
      if (!o) return `<tr><td>${etTime(g.startUTC)}</td><td>${g.away} @ ${g.home}</td><td colspan="10" class="muted">simulating…</td></tr>`;
      if (o.error) return `<tr><td>${etTime(g.startUTC)}</td><td>${g.away} @ ${g.home}</td><td colspan="10" class="muted">error</td></tr>`;
      const p = o.pick; let r = '', e = '';
      if (g.final) { const err = Math.abs(g.final[0] - p.x) + Math.abs(g.final[1] - p.y); tot += err; nf++; if ((g.final[0] > g.final[1]) === (p.x > p.y)) wins++; r = `${g.final[0]}–${g.final[1]}${g.final[2] && g.final[2] !== 'REG' ? ' ' + g.final[2] : ''}`; e = err; }
      const fav = o.pHome >= 0.5 ? `${g.home} ${pct(o.pHome)}` : `${g.away} ${pct(o.pAway)}`;
      const be = bestEdge(g, o);
      let jp = '<span class="chip none">No Jupiter market</span>', jb = '—';
      if (be) {
        const j = g.jupiter;
        jp = `<a href="${esc(j.link)}" target="_blank" rel="noopener">${g.away} ${cents(be.ed.away && be.ed.away.ask)} / ${g.home} ${cents(be.ed.home && be.ed.home.ask)}</a>`;
      }
      if (g.jupInGame) jb = `<span class="chip live" title="Game started: in-game price">in-game</span>`;
      else if (o.dist && window.NHLBets) { const ev = NHLBets.evaluate(g, o); jb = ev.best ? `<span class="chip pos" title="model ${pct(ev.best.q, 1)} vs ask ${cents(ev.best.ask)}">✅ ${esc(ev.best.label)} · EV ${evp(ev.best.ev)}</span>` : `<span class="neg" title="${esc(ev.reason)}">NO BET</span>`; }
      return `<tr><td>${etTime(g.startUTC)}</td><td>${g.away} @ ${g.home}</td><td class="pick">${pickText(g, o)}</td><td>${p.otLabel ? 'OT' : '—'}</td><td>${pct(o.pOT)}</td><td>${fav}</td><td>${jp}</td><td>${jb}</td><td>${o.ea.toFixed(2)}–${o.eh.toFixed(2)}</td><td>${o.mode === 'v4-independent' ? 'v4 (indep.)' : o.mode === 'market' ? 'v3 Market' : '<span style="color:var(--warn)">v3 ratings fallback</span>'}</td><td>${r}</td><td>${e}</td></tr>`;
    }).join('');
    const foot = nf ? `<tr><td colspan="10" class="muted">Graded games: ${nf} · winners right ${wins}/${nf}</td><td><b>Total err</b></td><td><b>${tot}</b></td></tr>` : '';
    $('sumnote').innerHTML = EDGE_TIP === TIP_V4 ? 'Edge is <b>independent</b>: v4 uses no betting-market input, so a positive EV is a genuine disagreement with Jupiter. Best bet = highest-EV Jupiter side with model &gt; 50% and EV &gt; 0 after fee; otherwise NO BET. Jupiter lists NHL moneylines only (no totals / puck lines), so those are shown as model leans.' : 'Edge is <b>vs a DraftKings-derived model</b> (v3 uses the DraftKings line at full weight), so it mostly measures Jupiter vs DraftKings, not an independent read.';
    $('sumtable').innerHTML = `<thead><tr><th>Puck drop</th><th>Game</th><th>Pick</th><th>OT?</th><th>P(OT)</th><th>Win prob</th><th title="Jupiter Predict YES ask per $1 contract (away / home)">Jupiter</th><th title="Bet only if model > 50% and EV after Jupiter fee > 0; highest EV qualifying side">Best bet</th><th>xG</th><th>Inputs</th><th>Result</th><th>Err</th></tr></thead><tbody>${rows}${foot}</tbody>`;
  }
  function copyPicks() {
    const lines = state.games.map((g, i) => { const o = state.out[i]; if (!o || o.error) return null; const be = bestEdge(g, o); return `${etTime(g.startUTC)}  ${g.away} @ ${g.home}: ${pickText(g, o)}  · P(OT) ${pct(o.pOT)}` + (o.dist && window.NHLBets && !g.jupInGame ? (ev => ev.best ? `  · BEST BET ${ev.best.label} (model ${pct(ev.best.q, 1)}, EV ${evp(ev.best.ev)})` : '  · NO BET')(NHLBets.evaluate(g, o)) : ''); }).filter(Boolean);
    const txt = `Luck Society NHL ${$('model').value === 'v4' ? 'v4-independent' : 'v3'} picks · ${state.date}\n` + lines.join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => { $('copy').textContent = 'Copied ✓'; setTimeout(() => $('copy').textContent = 'Copy picks', 1500); }).catch(() => prompt('Copy picks:', txt));
  }
  init();
})();
