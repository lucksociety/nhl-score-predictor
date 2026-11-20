/* Simulator tab: one game at a time. Pick the game and the starting goalies, run the model, and compare with the market.
 * Uses the same model as the Forecasts tab (js/model.js). Each run uses a fresh random seed, so repeat runs differ slightly;
 * the Forecasts tab and Discord keep the fixed seed that the bet rule is defined on. */
(function () {
  'use strict';
  const D = window.NHLDash; if (!D) return;
  const { state, $, esc, pct, etTime, etStamp, lastName } = D;
  let cur = -1, runs = 0, running = false, worker = null, last = null, mk = { away: '', home: '' };
  const game = () => state.games[cur] || null;
  const useV4 = g => $('model').value === 'v4' && g && g.v4;
  const short = n => String(n || '').replace(/^(\S)\S*\s+/, '$1. ');

  // ---------- goalie choices (the model's rated goalies for each club)
  function goalieOptions(g, side) {
    const v = g.v4.goalies[side], ov = D.gqOverride(g).ov;
    const liveName = g.goalies && g.goalies[side] && g.goalies[side].name, listedName = (ov[side] != null && liveName) || v.name || liveName;
    const listedGq = ov[side] != null ? ov[side] : v.gq, opts = [];
    const status = (g.goalies && g.goalies[side] && g.goalies[side].status) || v.status || 'Unconfirmed';
    opts.push({ name: listedName || 'Listed starter', gq: listedGq, listed: true, status });
    for (const t of v.table || []) if (!listedName || lastName(t.name) !== lastName(listedName)) opts.push({ name: t.name, gq: t.gq, share: t.share });
    return opts;
  }
  function fillGoalies(g) {
    for (const side of ['away', 'home']) {
      const sel = $('sim-goalie-' + side); $(side === 'away' ? 'sim-ga-lbl' : 'sim-gh-lbl').textContent = (g ? g[side] : side) + ' goalie';
      if (!useV4(g)) { sel.innerHTML = '<option value="">' + (g && g.goalies && g.goalies[side] && g.goalies[side].name ? esc(g.goalies[side].name) : 'Not rated') + '</option>'; sel.disabled = true; continue; }
      sel.disabled = false;
      sel.innerHTML = goalieOptions(g, side).map((o, i) => `<option value="${i}">${esc(o.name)}${o.listed ? ' (listed, ' + esc(String(o.status).toLowerCase()) + ')' : ''}</option>`).join('');
    }
  }
  // -> {rates, base, changed:[text]} : away scoring depends on the HOME goalie and vice versa (same rule as runGameV4)
  function rates(g) {
    const v = g.v4, ov = D.gqOverride(g).ov, pickGq = {}, baseGq = {}, changed = [];
    for (const side of ['away', 'home']) {
      const o = goalieOptions(g, side), i = +$('sim-goalie-' + side).value || 0;
      baseGq[side] = o[0].gq; pickGq[side] = (o[i] || o[0]).gq;
      if (i > 0 && o[i]) changed.push(`${g[side]}: ${o[i].name} in goal instead of ${o[0].name}`);
    }
    const f = gq => [v.ra * Math.exp(v.betaGq * (gq.home - v.goalies.home.gq)), v.rh * Math.exp(v.betaGq * (gq.away - v.goalies.away.gq))];
    return { rates: f(pickGq), base: f(baseGq), changed };
  }

  // ---------- running
  function post(job) {
    return new Promise((resolve, reject) => {
      try {
        if (!worker) worker = new Worker('js/worker.js');
        worker.onmessage = ev => ev.data.ok ? resolve(ev.data.result) : reject(new Error(ev.data.error));
        worker.onerror = e => reject(new Error(e.message || 'worker failed'));
        worker.postMessage({ id: 0, grid: job });
      } catch (e) { setTimeout(() => { try { resolve(NHLModel.runGrid(job)); } catch (x) { reject(x); } }, 20); }   // no workers (file://)
    });
  }
  async function run() {
    const g = game(); if (!g || running) return;
    running = true; const btn = $('sim-run'); btn.disabled = true; btn.textContent = 'Running…';
    const n = (D.PREC[$('precision').value] || D.PREC.std).n, seed = 1 + Math.floor(Math.random() * 2147483000), t0 = performance.now(), idx = cur;
    $('sim-info').textContent = `Simulating ${n.toLocaleString()} games…`;
    try {
      let o, base = null, changed = [];
      if (useV4(g)) {
        const r = rates(g); changed = r.changed;
        o = await post({ rates: r.rates, n, seed });
        if (changed.length) base = await post({ rates: r.base, n, seed });   // same seed: the difference is the goalie, not chance
      } else {
        const od = g.odds || {};
        o = await post({ game: { away: g.away, home: g.home, mlAway: od.mlAway, mlHome: od.mlHome, total: od.total, over: od.over, under: od.under }, ratings: D.ratingsAsOf(state.date), opts: { nFit: 40000, seed: 11 }, n, seed });
      }
      if (idx !== cur) { running = false; btn.disabled = false; btn.textContent = 'Run simulation'; return run(); }
      runs++; last = { o, base, changed, n };
      $('sim-info').textContent = `Run ${runs} finished ${new Date().toLocaleTimeString()} · ${n.toLocaleString()} simulated games in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      render();
    } catch (e) { $('sim-info').textContent = 'The simulation failed: ' + e.message; }
    running = false; btn.disabled = false; btn.textContent = 'Run simulation again';
  }

  // ---------- rendering
  function render() {
    const g = game(); if (!g || !last) return; const { o, base, changed, n } = last, M = NHLModel;
    $('sim-title').textContent = `${g.away} at ${g.home}`;
    $('sim-bar').innerHTML = `<div class="wa" style="width:${(100 * o.pAway).toFixed(1)}%">${g.away} ${pct(o.pAway, 1)}</div><div class="wh">${g.home} ${pct(o.pHome, 1)}</div>`;
    const od = g.odds || {}, fairHome = od.mlAway != null && od.mlHome != null ? M.devig2(od.mlHome, od.mlAway) : null;
    const rows = [['away', `${g.awayName || g.away} win`, o.pAway, fairHome == null ? null : 1 - fairHome], ['home', `${g.homeName || g.home} win`, o.pHome, fairHome]];
    $('sim-odds').innerHTML = rows.map(([k, nm, p, fair]) => `<tr><td>${esc(nm)}</td><td><b>${pct(p, 1)}</b></td><td>${fair == null ? '—' : pct(fair, 1)}</td><td><input id="sim-mkt-${k}" type="number" min="1" max="99" step="0.5" value="${esc(mk[k])}" aria-label="Polymarket price for ${esc(nm)} in cents"></td><td id="sim-gap-${k}">—</td></tr>`).join('');
    rows.forEach(([k, , p]) => { const f = () => { mk[k] = $('sim-mkt-' + k).value; const v = parseFloat(mk[k]), el = $('sim-gap-' + k);
        if (!(v > 0)) { el.textContent = '—'; el.className = ''; return; } const d = p * 100 - v; el.textContent = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + ' pts'; el.className = d > 0 ? 'pos' : 'neg'; };
      $('sim-mkt-' + k).addEventListener('input', f); f(); });
    const se = (100 * 0.5 / Math.sqrt(n) * 1.96).toFixed(2);
    $('sim-kv').innerHTML = [[`${o.ea.toFixed(2)} – ${o.eh.toFixed(2)}`, 'Average score'], [pct(o.pOT, 1), 'Goes to OT/shootout'], [pct(M.pOver(o.dist, 5.5), 1), 'Over 5.5 goals'], [pct(M.pOver(o.dist, 6.5), 1), 'Over 6.5 goals'],
      [pct(M.pCover(o.dist, 'home', -1.5), 1), `${g.home} by 2 or more`], [pct(M.pCover(o.dist, 'away', -1.5), 1), `${g.away} by 2 or more`]].map(([b, l]) => `<div><span>${esc(l)}</span><b>${b}</b></div>`).join('');
    let mx = 0; o.grid.forEach(r => r.forEach(p => { mx = Math.max(mx, p); }));
    const lab = k => (k === 6 ? '6+' : k);
    let h = `<div class="hd"></div>` + [0, 1, 2, 3, 4, 5, 6].map(k => `<div class="hd">${lab(k)}</div>`).join('');
    for (let x = 0; x < 7; x++) { h += `<div class="hd">${lab(x)}</div>`;
      for (let y = 0; y < 7; y++) { const p = o.grid[x][y]; h += x === y && x < 6 ? `<div class="c na" title="Games cannot end level">–</div>` : `<div class="c" style="background:rgba(232,185,49,${(p / mx * 0.7).toFixed(3)})">${(100 * p).toFixed(1)}</div>`; } }
    $('sim-heat').innerHTML = h;
    $('sim-heat-note').textContent = `Rows are ${g.away} goals, columns are ${g.home} goals, values in percent. Final scores include the overtime or shootout winner's extra goal, so a game cannot end level. Sampling error is at most ±${se} points.`;
    $('sim-top').innerHTML = o.top.slice(0, 6).map(t => `<tr><td>${g.away} ${t.x} – ${t.y} ${g.home}</td><td>${pct(t.p, 1)}</td><td>${pct(t.potGiven)}</td></tr>`).join('');
    note(base ? `<b class="on">Goalie change applied.</b> ${esc(changed.join('; '))}. ${g.home} win chance ${pct(base.pHome, 1)} with the listed starters, ${pct(o.pHome, 1)} with your choice.` : null);
  }
  function note(extra) {
    const g = game(); if (!g) { $('sim-note').textContent = 'No game selected.'; return; }
    const model = useV4(g) ? '<b>v4-independent</b>: team form, shot quality, starting goalies, home ice, rest and travel. No betting-market input.'
      : ($('model').value === 'v4' ? '<b>No v4 forecast for this game yet</b>, so this uses the older v3 model, which copies the sportsbook line.' : '<b>v3</b>: fitted to the DraftKings moneyline and total, so it mostly repeats the sportsbook.');
    const fin = g.final ? ` This game is over: ${g.away} ${g.final[0]} – ${g.final[1]} ${g.home}.` : '';
    $('sim-note').innerHTML = `${esc(g.awayName || g.away)} at ${esc(g.homeName || g.home)} · ${etTime(g.startUTC)}${g.venue ? ' · ' + esc(g.venue) : ''}.${fin}<br>Model: ${model}${extra ? '<br>' + extra : ''}`;
  }
  function lineups(g) {
    const av = (g.availability && g.availability.sides) || {}, v = g.v4 || {};
    $('sim-xi').innerHTML = ['away', 'home'].map(side => {
      const gl = (g.goalies && g.goalies[side]) || {}, inj = (av[side] && av[side].injuries) || [], rest = v.rest && v.rest[side], b2b = v.b2b && v.b2b[side];
      return `<div><b>${esc(g[side + 'Name'] || g[side])}</b>
        <div>Goalie: ${gl.name ? esc(gl.name) + ` <span class="badge ${esc(gl.status || '')}">${esc(gl.status || 'Unconfirmed')}</span>` : '<span class="muted">not announced</span>'}</div>
        ${rest != null ? `<div class="muted">${rest} day${rest === 1 ? '' : 's'} since last game${b2b ? ' · second night of a back-to-back' : ''}</div>` : ''}
        ${inj.length ? `<ul>${inj.map(p => `<li>${esc(p.name)}${p.position ? ' (' + esc(p.position) + ')' : ''}: ${esc(p.status || 'out')}</li>`).join('')}</ul>` : '<div class="muted">No absences listed.</div>'}</div>`;
    }).join('') + (g.availability && g.availability.checkedAt ? `<div class="muted" style="grid-column:1/-1;font-size:12px">Absences from ${esc(g.availability.source || 'ESPN')}, checked ${etStamp(g.availability.checkedAt)}. They are listed for reference; only the starting goalie changes the numbers here.</div>` : '');
  }
  function clear(msg) {
    ['sim-bar', 'sim-odds', 'sim-kv', 'sim-heat', 'sim-top', 'sim-xi'].forEach(i => { $(i).innerHTML = ''; });
    $('sim-heat-note').textContent = ''; $('sim-info').textContent = ''; $('sim-title').textContent = 'Simulation'; $('sim-note').textContent = msg;
  }
  function pick(i) {
    cur = i; last = null; const g = game();
    if (!g) { fillGoalies(null); clear(`No NHL games on ${state.date}. Choose another date above.`); $('sim-run').disabled = true; return; }
    $('sim-run').disabled = false;
    const s = (g.market && g.market.sides) || {}, c = x => (x && x.ask != null ? (100 * x.ask).toFixed(1) : '');
    mk = g.jupInGame ? { away: '', home: '' } : { away: c(s.away), home: c(s.home) };
    fillGoalies(g); note(); lineups(g); run();
  }
  window.NHLSim = {
    setGames() {
      const sel = $('sim-game'), gs = state.games, now = Date.now();
      sel.innerHTML = gs.length ? gs.map((g, i) => `<option value="${i}">${esc(etTime(g.startUTC) + ' · ' + (g.awayName || g.away) + ' at ' + (g.homeName || g.home) + (g.final ? ' (final)' : ''))}</option>`).join('') : '<option value="">No games on this date</option>';
      let i = gs.findIndex(g => !g.final && Date.parse(g.startUTC) > now); if (i < 0) i = gs.length ? 0 : -1;
      if (i >= 0) sel.value = String(i);
      pick(i);
    },
    open(i) { if (state.games[i]) { $('sim-game').value = String(i); pick(i); } },
  };
  $('sim-game').addEventListener('change', () => pick($('sim-game').value === '' ? -1 : +$('sim-game').value));
  for (const s of ['away', 'home']) $('sim-goalie-' + s).addEventListener('change', run);
  $('model').addEventListener('change', () => { if (game()) pick(cur); });
  $('sim-run').addEventListener('click', run);
  if (state.games.length || state.date) window.NHLSim.setGames();
})();
