/* The Quant Ace — the hub (#/ and #/<T>).
 *
 *   band: the tour and year, tournaments in play with their favourites; at a glance (No. 1,
 *         Elo No. 1, Finals favourite, matches live);
 *   matches: live, today, next two days and recent results, each with the model against the
 *            market and the live win probability;
 *   the biggest model–market gaps (matches and futures);
 *   Elo top 10 with a surface toggle; the race to the Finals with qualification and year-end
 *   No. 1 odds; explore links and the sister sites.
 *
 * Reads index.json (tours[T]), <T>/markets.json, <T>/race.json (market ticks), <T>/<Y>/events.json. */
(function (TA) {
'use strict';

const esc = TA.esc;

function tile(v, label) { return '<div class="hb-tile"><span class="hb-v">' + v + '</span><span class="hb-l">' + esc(label) + '</span></div>'; }

function eventsNow(T, list) {
  if (!list || !list.length) return '';
  return '<div class="ev-now">' + list.map(e => {
    const info = TA.eventInfo(T, e.event);
    const col = TA.surfaceColour(e.surface || info.surface, info.indoor);
    const fav = e.favourite && e.favourite[0] ? '<span class="ev-fav">Favourite ' + esc(TA.playerShort(T, e.favourite[0])) + ' <b>' + TA.pct(e.favourite[1], 0) + '</b></span>' : '';
    return '<a class="ev-tile" href="' + TA.eventHref(T, e.event) + '" style="border-left-color:' + col + '">' +
      '<span class="ev-name">' + esc(e.name || TA.eventName(T, e.event)) + '</span>' +
      '<span class="ev-meta">' + esc(TA.levelLabel(e.level || info.level, T)) + ' · ' + esc(TA.surfaceLabel(e.surface || info.surface, info.indoor)) +
      (e.round_now ? ' · ' + esc(TA.roundLabel(e.round_now)) : '') + '</span>' + fav + '</a>';
  }).join('') + '</div>';
}

function eloTop(el, T, tops) {
  const keys = ['all', 'hard', 'clay', 'grass'].filter(k => (tops[k] || []).length);
  if (!keys.length) { el.innerHTML = TA.muted('The Elo ratings arrive with the first build.'); return; }
  let active = keys[0];
  const draw = () => {
    const rows = tops[active] || [];
    const max = Math.max.apply(null, rows.map(r => r[1])), min = Math.min.apply(null, rows.map(r => r[1]));
    const col = active === 'all' ? TA.C.ace : TA.surfaceColour(active);
    el.querySelector('.elo-rows').innerHTML = rows.map((r, i) => {
      const w = max > min ? 30 + 70 * (r[1] - min) / (max - min) : 100;
      return '<div class="rk-row"><span class="rk-n">' + (i + 1) + '</span><span class="rk-name">' + TA.playerLink(T, r[0], { rank: true }) + '</span>' +
        '<span class="rk-bar"><span style="width:' + w.toFixed(0) + '%;background:' + col + '"></span></span><span class="rk-v">' + TA.num(r[1], 0) + '</span></div>';
    }).join('');
  };
  el.innerHTML = '<div class="toggle-row">' + TA.toggles(keys.map(k => ({ key: k, label: k === 'all' ? 'Overall' : TA.surfaceLabel(k) })), active, 'data-sf') + '</div><div class="elo-rows"></div>' +
    '<a class="more-link" href="' + TA.href(T, 'elo') + '">Full Elo tables and all-time peaks →</a>';
  TA.wireToggles(el, 'data-sf', k => { active = k; draw(); });
  draw();
}

function raceTop(T, rows, race) {
  if (!rows || !rows.length) return TA.muted('The race simulation arrives with the first build.');
  const mq = TA.titleProbs(((race || {}).market || {}).finals_qual), m1 = TA.titleProbs(((race || {}).market || {}).year_end_no1);
  const cell = (p, m) => '<span class="v" title="' + (TA.isNum(m) ? 'Market ' + TA.pct(m, 0) : 'No market price') + '">' + (TA.isNum(p) ? TA.pct(p, 0) : '—') +
    (TA.isNum(m) && TA.isNum(p) ? '<span class="rk-sub"> ' + TA.edgeHTML(p, m, 0) + '</span>' : '') + '</span>';
  return '<div class="race-row head"><span></span><span>Player</span><span class="v">Finals</span><span class="v">No. 1</span></div>' +
    rows.map((r, i) => '<div class="race-row"><span class="rk-n">' + (i + 1) + '</span><span class="rk-name">' + TA.playerLink(T, r[0], { short: true }) + '</span>' +
      cell(r[1], mq[r[0]]) + cell(r[2], m1[r[0]]) + '</div>').join('') +
    '<div class="section-note">Model probabilities from the season simulation; the small figure is the model minus the market in points.</div>' +
    '<a class="more-link" href="' + TA.href(T, 'race') + '">The race, rank distributions and the market →</a>';
}

function gaps(T, cards, markets, race) {
  const out = [];
  const seen = {};
  cards.forEach(c => {
    if (seen[c.id] || TA.isFinished(c)) return;
    seen[c.id] = 1;
    const m = c.model || {}, mk = c.market || {};
    if (!TA.isNum(m.p1) || !TA.isNum(mk.p1)) return;
    const e = m.p1 - mk.p1;
    const side = e >= 0 ? c.p1 : c.p2;
    out.push({ abs: Math.abs(e), html: '<span class="what"><a href="' + TA.matchHref(T, c.id) + '">' + esc(TA.playerSurname(T, side)) + ' to beat ' + esc(TA.playerSurname(T, side === c.p1 ? c.p2 : c.p1)) + '</a>' +
      '<small>' + esc(TA.eventName(T, c.event)) + ' · ' + esc(TA.roundLabel(c.round, true)) + (mk.sources ? ' · ' + esc(mk.sources.join(', ')) : '') + '</small></span>',
      model: side === c.p1 ? m.p1 : 1 - m.p1, market: side === c.p1 ? mk.p1 : 1 - mk.p1 });
  });
  const fut = (markets && markets.futures) || {};
  const evs = fut.events || {};
  Object.keys(evs).forEach(eid => {
    const t = evs[eid];
    const pr = TA.titleProbs(t);
    const ev = TA.cached(TA.eventPath(T, eid));
    const sim = ev && ev.sim && ev.sim.players ? ev.sim.players : null;
    if (!sim) return;
    Object.keys(pr).forEach(pid => {
      const s = sim[pid];
      if (!s || !TA.isNum(s.p_title)) return;
      out.push({ abs: Math.abs(s.p_title - pr[pid]), html: '<span class="what"><a href="' + TA.eventHref(T, eid) + '">' + esc(TA.playerSurname(T, pid)) + ' to win ' + esc(TA.eventName(T, eid)) + '</a><small>title odds</small></span>',
        model: s.p_title, market: pr[pid] });
    });
  });
  const rq = TA.titleProbs(((race || {}).market || {}).finals_qual);
  Object.keys(rq).forEach(pid => {
    const p = ((race || {}).finals_qual || {})[pid];
    if (!TA.isNum(p)) return;
    out.push({ abs: Math.abs(p - rq[pid]), html: '<span class="what"><a href="' + TA.href(T, 'race') + '">' + esc(TA.playerSurname(T, pid)) + ' to qualify for the Finals</a><small>season simulation</small></span>', model: p, market: rq[pid] });
  });
  out.sort((a, b) => b.abs - a.abs);
  if (!out.length) return TA.muted('No market prices to compare yet.');
  return '<div class="gap-row head"><span>Outcome</span><span class="v">Model</span><span class="v">Market</span><span class="v">Gap</span></div>' +
    out.slice(0, 8).map(g => '<div class="gap-row">' + g.html + '<span class="v">' + TA.pct(g.model, 0) + '</span><span class="v">' + TA.pct(g.market, 0) + '</span><span class="v">' + TA.edgeHTML(g.model, g.market) + '</span></div>').join('') +
    '<div class="section-note">Gaps are model minus de-vigged market, in percentage points. They are not tips: markets know about injuries and withdrawals the model does not. 18+.</div>' +
    '<a class="more-link" href="' + TA.href(T, 'markets') + '">Every market against the model →</a>';
}

function explore(T) {
  const links = [
    ['calendar', 'Calendar', 'Every tournament of the year'], ['rankings', 'Rankings', 'Official against Elo; points to defend'],
    ['race', 'Race', 'Finals qualification and year-end No. 1'], ['elo', 'Elo', 'Surface ratings and all-time peaks'],
    ['players', 'Players', 'Serve, return, clutch, percentiles'], ['h2h', 'Head to head', 'Any two players, any surface'],
    ['lab', 'Lab', 'Scatter any two metrics'], ['markets', 'Markets', 'Model against the market'], ['calibration', 'Calibration', 'Against Pinnacle closing odds']
  ];
  return '<div class="hub-links pad">' + links.map(l => '<a href="' + TA.href(T, l[0]) + '"><b>' + esc(l[1]) + '</b><span>' + esc(l[2]) + '</span></a>').join('') +
    '<a href="#/methodology"><b>Methodology</b><span>How the models work</span></a>' +
    '<a href="' + TA.FOOTBALL_URL + '"><b>⚽ The Quant Footballer</b><span>The sister site for football</span></a>' +
    '<a href="' + TA.PADDOCK_URL + '"><b>🏁 The Quant Paddock</b><span>The sister site for Formula 1</span></a>' +
    '<a href="' + TA.HARDWOOD_URL + '"><b>🏀 The Quant Hardwood</b><span>The sister site for the NBA and WNBA</span></a></div>';
}

function pastYear(T, Y) {
  const ev = TA.EVENTS[T][String(Y)] || {};
  const ids = Object.keys(ev).filter(id => ['slam', 'finals', 'm1000'].indexOf(ev[id].level) >= 0 && ev[id].champion)
    .sort((a, b) => String(ev[a].start).localeCompare(String(ev[b].start)));
  if (!ids.length) return TA.muted('No champions recorded for ' + Y + '.');
  return TA.tableHTML([{ label: 'Tournament' }, { label: 'Level', cls: 'hide-sm' }, { label: 'Champion' }, { label: 'Runner-up', cls: 'hide-sm' }],
    ids.map(id => [{ v: ev[id].start, html: TA.eventLink(T, id, { surface: true }) }, { v: TA.levelRank(ev[id].level), html: esc(TA.levelLabel(ev[id].level, T)) },
      { v: TA.playerName(T, ev[id].champion), html: TA.playerLink(T, ev[id].champion) }, { v: TA.playerName(T, ev[id].runner_up), html: ev[id].runner_up ? TA.playerLink(T, ev[id].runner_up) : '—' }]), { compact: true });
}

function render(el, params) {
  const T = params.tour, Y = params.year;
  const info = TA.tourInfo(T);
  const isCurrent = Y === TA.currentYear(T);
  el.innerHTML = '<div class="ta-band" id="hub-band"></div><div class="hub-cols"><div id="hub-left"></div><div id="hub-right"></div></div>' +
    TA.card('Explore', 'the ' + TA.tourName(T) + ' pages and the sister sites', explore(T));
  const evNow = isCurrent ? (info.events_now || []) : [];
  return TA.loadAll([TA.tpath('markets.json', T), TA.tpath('race.json', T)].concat(evNow.map(e => TA.eventPath(T, e.event)))).then(arr => {
    if (!el.isConnected) return;
    const markets = TA.ok(arr[0]) ? arr[0] : null, race = TA.ok(arr[1]) ? arr[1] : null;
    const live = isCurrent ? (info.live || []) : [], today = isCurrent ? (info.today || []) : [];
    const upcoming = isCurrent ? (info.upcoming || []) : [], recent = isCurrent ? (info.recent || []) : [];
    const rk = (info.race_top || [])[0];
    const elo1 = ((info.elo_top || {}).all || [])[0];
    let no1 = null;
    Object.keys(TA.NAMES[T]).forEach(pid => { if (TA.NAMES[T][pid].rank === 1) no1 = pid; });

    // ── band
    let left = '<div class="card"><div class="pad"><div class="hb-kicker">' + esc(info.name || TA.tourName(T)) + (isCurrent && evNow.length ? ' · ' + evNow.length + ' tournament' + (evNow.length > 1 ? 's' : '') + ' in play' : '') + '</div>' +
      '<div class="hb-tour">' + esc(TA.tourName(T)) + ' <span class="hb-year">' + Y + '</span></div>';
    if (!isCurrent) left += '<div class="hb-sub">The ' + Y + ' season. <a href="' + TA.href(T, 'calendar', Y) + '">Every tournament →</a></div>' + '<div style="margin-top:10px">' + pastYear(T, Y) + '</div>';
    else if (evNow.length) left += '<div class="hb-sub">Tournaments in play, with the model’s title favourite. Open one for the interactive draw and path odds.</div>' + eventsNow(T, evNow);
    else left += '<div class="hb-sub">No tour-level tournament in play right now. <a href="' + TA.href(T, 'calendar') + '">The calendar →</a></div>';
    left += '</div></div>';
    const right = '<div class="card"><div class="card-header">At a glance</div><div class="pad"><div class="hub-mini-tiles">' +
      tile(no1 ? esc(TA.playerSurname(T, no1)) : '—', 'World No. 1') +
      tile(elo1 ? esc(TA.playerSurname(T, elo1[0])) + ' ' + TA.num(elo1[1], 0) : '—', 'Elo No. 1') +
      tile(rk ? esc(TA.playerSurname(T, rk[0])) + (TA.isNum(rk[2]) ? ' ' + TA.pct(rk[2], 0) : '') : '—', 'Year-end No. 1 favourite') + '</div>' +
      '<div class="lw-sub" style="margin-top:10px">' + (isCurrent ? (live.length ? '<span class="cd-live"><span class="live-dot"></span> ' + live.length + ' match' + (live.length > 1 ? 'es' : '') + ' live</span> · ' : '') +
        today.length + ' match' + (today.length === 1 ? '' : 'es') + ' today' : 'Season ' + Y) +
      (TA.index() && TA.index().updated_at ? ' · updated ' + esc(TA.fmtStamp(TA.index().updated_at)) : '') + '</div></div></div>';
    document.getElementById('hub-band').innerHTML = left + right;

    // ── left: matches and gaps
    const shown = {};
    const block = (title, list, opts) => {
      const l = list.filter(c => c && !shown[c.id]);
      if (!l.length) return '';
      l.forEach(c => { shown[c.id] = 1; });
      return '<div class="day-head">' + esc(title) + '</div><div class="gc-grid">' + l.map(c => TA.matchCard(c, Object.assign({ tour: T }, opts || {}))).join('') + '</div>';
    };
    let games = block('Live', live);
    // today: still to play first, then the latest results; capped (the calendar and draws have the rest)
    const todaySorted = today.filter(c => !TA.isFinished(c)).sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .concat(today.filter(TA.isFinished).sort((a, b) => String(b.date).localeCompare(String(a.date))));
    games += block('Today', todaySorted.slice(0, 12));
    games += block('Next two days', upcoming.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 12), { date: true });
    games += block('Recent results', recent.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6), { date: true });
    const lg = document.getElementById('hub-left');
    lg.innerHTML = TA.card(live.length ? 'Live and today' : 'Matches', 'model against the market · pre-match win % beside each player',
      (games || TA.muted(isCurrent ? 'No tour-level matches in the next few days.' : 'Browse the ' + Y + ' tournaments in the calendar.')) +
      '<a class="more-link" href="' + TA.href(T, 'calendar') + '">The calendar and every draw →</a>') +
      (isCurrent ? TA.card('Biggest model–market gaps', 'matches, title odds and the Finals race', gaps(T, live.concat(today, upcoming), markets, race)) : '');

    // ── right: Elo, race
    const rg = document.getElementById('hub-right');
    rg.innerHTML = TA.card('Elo top 10', 'surface-blended ratings · official rank in grey', '<div id="hub-elo"></div>') +
      (isCurrent ? TA.card('Race to the Finals', 'qualification and year-end No. 1 odds', raceTop(T, info.race_top, race)) : '');
    eloTop(document.getElementById('hub-elo'), T, info.elo_top || {});
    TA.sortable(el);
    TA.setMeta(race && race.n_sims ? TA.num(race.n_sims, 0) + ' season simulations' : '');
  });
}

TA.route('hub', render);
})(window.TA);
