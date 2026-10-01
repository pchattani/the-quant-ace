/* The Quant Ace — head to head (#/<T>/h2h/<a>/<b>; #/<T>/h2h alone shows the pickers).
 *
 * History with a surface split, the model's matchup odds on every surface with the set-score
 * distribution, where the rivalry has run against the ratings, and the serve/return matchup.
 *
 * The matchup odds are computed in the browser from the published ratings with the same recipe
 * as models/predict.py: an Elo probability from the surface-blended ratings (elo.p_win), a
 * serve/return probability from the exact Markov chain fed with each player's hold against this
 * opponent, the two blended on the log-odds scale with the fitted weights, and the serve-point
 * probabilities shifted so the chain reproduces the blend (match_chain.solve_shift). It uses each
 * player's latest published hold and break by surface, so it can differ by a point or two from
 * the match-centre price, which uses the full fit.
 *
 * Data: data/<T>/players/<a>.json and <b>.json (results of the last two years, h2h tallies,
 * serve_return paths, elo), data/<T>/elo.json (current ratings), data/<T>/players.json (catalogue:
 * hold, break, real stats, tour mean hold), data/<T>/calibration.json (blend weights), and on demand
 * data/<T>/<year>/schedule.json + events.json for the full history. Uses TA.fk from players.js. */
(function (TA) {
'use strict';

const K = () => TA.fk;
// Committed fits (models/fitted/*.json) and code defaults, used when the payloads do not carry them.
const W_SURF = { atp: 0.45931, wta: 0.5 };          // elo_params_atp.json w_surf; elo.DEFAULT_PARAMS for the WTA
const BO5 = { atp: 1.36582, wta: 1.1 };             // elo_params_atp.json bo5; DEFAULT_PARAMS
const BLEND = { atp: { w_elo: 0.72621, w_sr: 0.19541 }, wta: { w_elo: 0.6, w_sr: 0.4 } };   // predict_atp.json; predict.DEFAULT_BLEND
// Surface terms of the hold model (serve_return_atp.json base: clay -0.167, grass +0.322, hard 0), centred on the
// tour's surface mix (hard .566, clay .307, grass .127) so they shift the tour-average hold to each surface.
const SURF_OFF = { hard: 0.0104, clay: -0.1566, grass: 0.3328 };
const DEFAULT_HOLD = { atp: 0.79, wta: 0.64 };

function matchupModel(T, ctx, A, B, surface, bestOf, rule) {
  const k = K(), CH = k.chain;
  const out = { surface: surface, bestOf: bestOf };
  // Elo.
  const eA = ctx.elo[A], eB = ctx.elo[B];
  if (eA && eB && k.isNum(eA.all) && k.isNum(eB.all)) {
    const w = W_SURF[T], m = e => w * (k.isNum(e[surface]) ? e[surface] : e.all) + (1 - w) * e.all;
    const f = bestOf === 5 ? BO5[T] : 1;
    out.elo_p = 1 / (1 + Math.pow(10, -f * (m(eA) - m(eB)) / 400));
  }
  // Serve/return: hold of A against B on this surface.
  const hA = ctx.hb(A, surface), hB = ctx.hb(B, surface);
  if (hA && hB) {
    const L0 = k.logit(ctx.h0) + (SURF_OFF[surface] || 0);
    const holdAB = k.sigmoid(k.logit(hA.hold) + k.logit(1 - hB.brk) - L0);
    const holdBA = k.sigmoid(k.logit(hB.hold) + k.logit(1 - hA.brk) - L0);
    out.holdAB = holdAB; out.holdBA = holdBA; out.h0 = k.sigmoid(L0);
    out.pa = CH.inv(holdAB); out.pb = CH.inv(holdBA);
    out.sr_p = CH.match(out.pa, out.pb, bestOf, rule).p;
  }
  const bl = ctx.blend;
  if (k.isNum(out.elo_p) && k.isNum(out.sr_p)) { out.p = k.sigmoid(bl.w_elo * k.logit(out.elo_p) + bl.w_sr * k.logit(out.sr_p)); out.basis = 'blend'; }
  else if (k.isNum(out.elo_p)) { out.p = out.elo_p; out.basis = 'elo'; }
  else if (k.isNum(out.sr_p)) { out.p = out.sr_p; out.basis = 'serve/return'; }
  if (k.isNum(out.p)) {
    let pa = out.pa, pb = out.pb;
    if (!k.isNum(pa)) { pa = 0.62; pb = 0.62; }
    const d = CH.shift(pa, pb, bestOf, rule, out.p);
    const m = CH.match(pa + d, pb - d, bestOf, rule);
    out.dist = m; out.p_srv = [pa + d, pb - d];
  }
  return out;
}
K.matchup = matchupModel;

/* Per-player hold/break by surface: the latest serve_return row on that surface, else on any, else the catalogue. */
function hbOf(career, catRow) {
  const rows = ((career || {}).serve_return || []).filter(r => Array.isArray(r) && K().isNum(r[4]) && K().isNum(r[5]));
  const last = {};
  rows.forEach(r => { if (!last[r[1]] || String(r[0]) >= String(last[r[1]][0])) last[r[1]] = r; });
  const anyRow = rows.length ? rows.reduce((a, r) => (String(r[0]) > String(a[0]) ? r : a), rows[0]) : null;
  return surface => {
    const r = last[surface] || last.all || anyRow;
    if (r) return { hold: r[4], brk: r[5], src: last[surface] ? surface : (last.all ? 'all' : r[1]), date: r[0] };
    const v = (catRow || {}).values || {};
    if (K().isNum(v.hold) && K().isNum(v.brk)) return { hold: v.hold, brk: v.brk, src: 'catalogue' };
    return null;
  };
}
K.hbOf = hbOf;
function tourHold(T, cat) {
  const k = K(), P = ((cat || {}).players) || {};
  let s = 0, w = 0;
  Object.keys(P).forEach(id => { const v = (P[id].values || {}).hold, n = P[id].matches || 0; if (k.isNum(v) && v > 0 && v < 1 && n > 0) { s += n * k.logit(v); w += n; } });
  return w > 50 ? k.sigmoid(s / w) : DEFAULT_HOLD[T];
}
K.tourHold = tourHold;

function render(el, params, state) {
  const k = K(), T = k.T(params, state);
  const a = String(params.a || (params.rest || [])[0] || ''), b = String(params.b || (params.rest || [])[1] || '');
  el.innerHTML = '<div class="card"><div class="card-header">Head to head · ' + k.TN(T) + ' <span class="card-sub">Pick two players; the address updates so a matchup can be shared.</span></div>' +
    '<div class="controls af-pickrow"><span class="cmp-pill-a"></span><span id="h2-pa"></span><span class="muted-inline">v</span><span class="cmp-pill-b"></span><span id="h2-pb"></span>' +
    '<button type="button" id="h2-swap" class="af-btn">⇄ swap</button>' + (a && b ? '<a class="af-btn" href="' + k.compareHref(T, a, b) + '">Compare profiles →</a>' : '') + '</div></div><div id="h2-body"></div>';
  return k.ready().then(() => k.loadNames(T)).then(() => {
    if (!k.alive(el)) return null;
    const go = (x, y) => { if (x && y && x !== y) location.hash = k.h2hHref(T, x, y); };
    let pa = a, pb = b;
    k.picker(document.getElementById('h2-pa'), { T: T, value: a, placeholder: 'First player…', onPick: id => { pa = id; go(pa, pb); } });
    k.picker(document.getElementById('h2-pb'), { T: T, value: b, placeholder: 'Second player…', onPick: id => { pb = id; go(pa, pb); } });
    document.getElementById('h2-swap').onclick = () => { if (a && b) location.hash = k.h2hHref(T, b, a); };
    const body = document.getElementById('h2-body');
    if (!a || !b) return suggest(T, body, a);
    body.innerHTML = k.muted('Loading…');
    return Promise.all([TA.load(T + '/players/' + a + '.json'), TA.load(T + '/players/' + b + '.json'), TA.load(T + '/elo.json'), TA.load(T + '/players.json'), TA.load(T + '/calibration.json')]).then(res => {
      if (!k.alive(el)) return null;
      k.learnCat(T, res[3]);
      const years = Array.from(new Set(((k.ok(res[0]) ? res[0].results : null) || []).map(r => String(r.date || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y))));
      return k.loadEvents(T, years).then(() => { if (k.alive(el)) build(T, a, b, res, body); });
    });
  });
}

/* Without two players: the first player's most frequent opponents, else the top of the Elo list. */
function suggest(T, body, a) {
  const k = K();
  return Promise.all([a ? TA.load(T + '/players/' + a + '.json') : Promise.resolve(null), TA.load(T + '/elo.json')]).then(res => {
    const c = res[0], E = res[1];
    let pairs = [];
    if (c && k.ok(c) && (c.h2h || []).length) pairs = c.h2h.slice(0, 12).map(r => [a, r[0], r[1] + '–' + r[2]]);
    else if (k.ok(E) && E.current) {
      const top = Object.keys(E.current).sort((x, y) => E.current[y].all - E.current[x].all).slice(0, 6);
      for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) pairs.push([top[i], top[j], '']);
      pairs = pairs.slice(0, 12);
    }
    body.innerHTML = k.card('Matchups to try', a ? 'Most frequent opponents of ' + k.esc(k.name(T, a)) + '.' : 'Pairs from the top of the Elo list.',
      pairs.length ? '<div class="af-pairs">' + pairs.map(p => '<a class="af-pair" href="' + k.h2hHref(T, p[0], p[1]) + '"><strong>' + k.esc(k.surname(k.name(T, p[0]))) + '</strong> v <strong>' + k.esc(k.surname(k.name(T, p[1]))) + '</strong>' + (p[2] ? '<span>' + k.esc(p[2]) + '</span>' : '') + '</a>').join('') + '</div>' : k.muted('Pick two players above.'));
  });
}

function build(T, a, b, res, body) {
  const k = K();
  const cA = k.ok(res[0]) ? res[0] : null, cB = k.ok(res[1]) ? res[1] : null;
  const E = k.ok(res[2]) ? res[2] : {}, cat = k.ok(res[3]) ? res[3] : {}, cal = k.ok(res[4]) ? res[4] : {};
  const P = cat.players || {};
  const nA = (cA && cA.name) || k.name(T, a), nB = (cB && cB.name) || k.name(T, b);
  const sA = k.surname(nA), sB = k.surname(nB);
  // Tally: A's h2h entry for B, else B's for A, else the listed matches.
  const met = ((cA || {}).results || []).filter(r => r.opp === b).map(r => Object.assign({ src: 'career' }, r));
  const hA = ((cA || {}).h2h || []).find(r => r[0] === b), hB = ((cB || {}).h2h || []).find(r => r[0] === a);
  const tally = hA ? { w: hA[1], l: hA[2], last: hA[3] } : hB ? { w: hB[2], l: hB[1], last: hB[3] } : { w: met.filter(r => r.won).length, l: met.filter(r => !r.won).length, last: (met[0] || {}).date };
  const n = (tally.w || 0) + (tally.l || 0);
  const blend = (cal.blend_all_years && k.isNum(cal.blend_all_years.w_elo)) ? { w_elo: cal.blend_all_years.w_elo, w_sr: cal.blend_all_years.w_sr, src: 'calibration.json' } : Object.assign({ src: 'committed fit' }, BLEND[T]);
  const eloOf = (pid, c) => {
    const cur = (E.current || {})[pid];
    if (cur) return cur;
    const r = ((c || {}).elo || []).slice(-1)[0];
    return r ? { all: r[1], hard: r[2], clay: r[3], grass: r[4] } : null;
  };
  const hbA = hbOf(cA, P[a]), hbB = hbOf(cB, P[b]);
  const ctx = { elo: {}, h0: tourHold(T, cat), blend: blend, hb: (pid, s) => (pid === a ? hbA(s) : hbB(s)) };
  ctx.elo[a] = eloOf(a, cA); ctx.elo[b] = eloOf(b, cB);

  const card = (pid, c, i) => {
    const p = P[pid] || {}, e = ctx.elo[pid] || {};
    return '<div class="cmp-id ' + (i ? 'b' : 'a') + '"><div class="cmp-id-body"><div class="cmp-id-name">' + k.playerLink(T, pid, i ? nB : nA) + '</div>' +
      '<div class="cmp-id-sub">' + k.ctry(p.country || (c || {}).country || k.country(T, pid)) + (k.isNum(p.rank) ? ' · No. ' + p.rank : '') + (k.isNum(p.age) ? ' · age ' + Math.floor(p.age) : '') + '</div>' +
      '<div class="cmp-id-facts">' + [['Elo', k.num(e.all, 0)], ['Hard', k.num(e.hard, 0)], ['Clay', k.num(e.clay, 0)], ['Grass', k.num(e.grass, 0)], ['Hold %', k.fmtV((p.values || {}).hold, 'pct')], ['Break %', k.fmtV((p.values || {}).brk, 'pct')]]
        .map(f => '<div class="cmp-fact"><span>' + f[0] + '</span><strong>' + f[1] + '</strong></div>').join('') + '</div></div></div>';
  };
  let h = '<div class="af-h2h-top">' + card(a, cA, 0) +
    '<div class="af-h2h-score"><div class="af-h2h-n"><span class="a">' + (tally.w || 0) + '</span><span class="dash">–</span><span class="b">' + (tally.l || 0) + '</span></div>' +
    '<div class="cmp-wins"><span class="a" style="width:' + (n ? 100 * tally.w / n : 50) + '%"></span><span class="b" style="width:' + (n ? 100 * tally.l / n : 50) + '%"></span></div>' +
    '<div class="cmp-score-sub">' + (n ? n + ' tour-level meeting' + (n === 1 ? '' : 's') + (tally.last ? ' · last ' + k.esc(k.fmtDate(tally.last, { weekday: false })) : '') : 'they have not met at tour level') + '</div></div>' +
    card(b, cB, 1) + '</div>';
  h += '<div class="card"><div class="card-header">Matchup odds <span class="card-sub">If they met today: the model\'s probability on each surface and the set scores it implies.</span>' +
    k.toggle('h2-fmt', T === 'atp' ? [['3', 'Best of 3'], ['5', 'Best of 5 (Slam)']] : [['3', 'Tour event'], ['slam', 'Slam (deciding-set tiebreak to 10)']], '3') + '</div><div id="h2-odds"></div></div>';
  h += '<div class="grid-2"><div class="card"><div class="card-header">Serve against return <span class="card-sub">Each player\'s chance of holding against this opponent, against the tour average, from the inferred ratings.</span></div><div id="h2-sr"></div></div>' +
    '<div class="card"><div class="card-header">Against the ratings <span class="card-sub">Did the rivalry go the way the pre-match prices said?</span></div><div id="h2-dev"></div></div></div>';
  h += '<div class="card"><div class="card-header">History <span class="card-sub" id="h2-hist-sub"></span><span class="pg-ctl"><button type="button" class="af-btn" id="h2-full">Load every year</button></span></div>' +
    '<div id="h2-surf"></div><div id="h2-hist"></div></div>';
  if (T === 'wta') h += '<div class="card"><div class="card-header">Real serve and return stats <span class="card-sub">This year\'s point-level figures from the WTA match stats.</span></div><div id="h2-real"></div></div>';
  body.innerHTML = h;

  // Odds.
  const drawOdds = fmt => {
    const host = document.getElementById('h2-odds');
    const bo = fmt === '5' ? 5 : 3, rule = fmt === '5' || fmt === 'slam' ? 'tb10' : 'tb7';
    const ms = k.SURFACES.map(s => matchupModel(T, ctx, a, b, s, bo, rule));
    if (!ms.some(m => k.isNum(m.p))) { host.innerHTML = k.muted('Not enough rating data to price this matchup.'); return; }
    const keys = Object.keys((ms.find(m => m.dist) || {}).dist ? ms.find(m => m.dist).dist.sets : {}).sort((x, y) => {
      const px = x.split('-').map(Number), py = y.split('-').map(Number);
      return (py[0] - py[1]) - (px[0] - px[1]);
    });
    host.innerHTML = '<div class="af-odds">' + ms.map(m => '<div class="af-odds-col" style="--sc:' + k.surfColour(m.surface) + '"><div class="af-odds-h">' + k.SURF_LABEL[m.surface] + '</div>' +
      (k.isNum(m.p) ? '<div class="af-odds-p"><span class="a">' + k.pct(m.p, 0) + '</span><span class="b">' + k.pct(1 - m.p, 0) + '</span></div><div class="cmp-wins"><span class="a" style="width:' + (100 * m.p).toFixed(1) + '%"></span><span class="b" style="width:' + (100 * (1 - m.p)).toFixed(1) + '%"></span></div>' +
        '<div class="af-odds-sub">Elo ' + k.pct(m.elo_p, 0) + ' · serve/return ' + k.pct(m.sr_p, 0) + '</div>' +
        (m.dist ? '<div class="af-odds-sub">straight sets ' + k.pct(m.dist.straight, 0) + ' · ' + k.num(m.dist.games, 1) + ' games</div>' : '') : k.muted('No price.')) + '</div>').join('') + '</div>' +
      '<div id="h2-sets" style="height:300px"></div>' +
      k.table([{ label: 'Set score (' + sA + ' first)' }].concat(ms.map(m => ({ label: k.SURF_LABEL[m.surface], align: 'right' }))),
        keys.map(s => [{ v: s, html: '<strong>' + k.esc(s) + '</strong> <span class="muted-inline">' + (Number(s.split('-')[0]) > Number(s.split('-')[1]) ? sA : sB) + '</span>' }].concat(ms.map(m => ({ v: m.dist ? m.dist.sets[s] : null, html: m.dist ? k.pct(m.dist.sets[s], 1) : '—' })))), { compact: true }) +
      '<div class="pg-note">Computed in the browser with the model\'s recipe: Elo on the surface-blended ratings (surface weight ' + W_SURF[T] + (bo === 5 ? ', best-of-5 stretch ' + BO5[T] : '') + '), the serve/return chain fed with each player\'s hold against this opponent, ' +
      'blended as logit p = ' + k.num(blend.w_elo, 3) + ' × logit(Elo) + ' + k.num(blend.w_sr, 3) + ' × logit(serve/return) (' + k.esc(blend.src) + '), then the serve-point probabilities shifted so the exact chain reproduces that price; the set scores come from the shifted chain with the first server a coin toss. ' +
      'It uses the latest published hold and break per surface, so it can differ by a point or two from a match-centre price. ' + (T === 'wta' ? 'The WTA runs on the code-default constants until its own fits are committed. ' : '') + '<a href="#/methodology/match-chain">How the chain works →</a></div>';
    if (keys.length) {
      k.plot('h2-sets', ms.filter(m => m.dist).map(m => ({ type: 'bar', name: k.SURF_LABEL[m.surface], x: keys, y: keys.map(s => m.dist.sets[s]), marker: { color: k.surfColour(m.surface) }, hovertemplate: k.SURF_LABEL[m.surface] + ' %{x}: %{y:.1%}<extra></extra>' })),
        k.layout(Object.assign(k.legendTop(), { barmode: 'group', margin: { l: 44, r: 10, t: 30, b: 40 }, xaxis: { type: 'category', title: 'Sets (' + sA + '–' + sB + ')' }, yaxis: { tickformat: '.0%' } })));
    }
    drawSR(ms);
  };
  const drawSR = ms => {
    const host = document.getElementById('h2-sr');
    const rows = ms.filter(m => k.isNum(m.holdAB));
    if (!rows.length) { host.innerHTML = k.muted('No serve/return ratings for one of them.'); return; }
    host.innerHTML = k.table([{ label: 'Surface' }, { label: sA + ' holds', align: 'right' }, { label: 'v average', align: 'right' }, { label: sB + ' holds', align: 'right' }, { label: 'v average', align: 'right' }, { label: 'Tour average', align: 'right' }],
      rows.map(m => {
        const avA = (hbA(m.surface) || {}).hold, avB = (hbB(m.surface) || {}).hold;
        return [{ v: m.surface, html: k.surfChip(m.surface) }, { v: m.holdAB, html: '<strong>' + k.pct(m.holdAB, 1) + '</strong>' }, { v: avA, html: k.pct(avA, 1) + ' <span class="muted-inline">(' + k.signed(100 * (m.holdAB - avA), 1) + ')</span>' },
          { v: m.holdBA, html: '<strong>' + k.pct(m.holdBA, 1) + '</strong>' }, { v: avB, html: k.pct(avB, 1) + ' <span class="muted-inline">(' + k.signed(100 * (m.holdBA - avB), 1) + ')</span>' }, { v: m.h0, html: k.pct(m.h0, 1) }];
      }), { compact: true }) +
      '<div class="pg-note">Hold against this opponent = the hold model\'s log-odds, the server\'s serve strength minus the returner\'s return strength plus the surface baseline, recovered from each player\'s hold and break against the average opponent: logit h<sub>AB</sub> = logit hold<sub>A</sub> + logit(1 − break<sub>B</sub>) − logit h<sub>tour</sub>. ' +
      'The bracket is the change from facing an average returner; a negative number means the opponent returns better than the tour average.</div>';
  };
  drawOdds('3');
  k.wireToggle(body, 'h2-fmt', drawOdds);

  // Against the ratings.
  const drawDev = list => {
    const host = document.getElementById('h2-dev');
    const withP = list.filter(r => k.isNum(r.p_pre));
    if (!withP.length) { host.innerHTML = k.muted(list.length ? 'No pre-match model prices for these meetings.' : 'No listed meetings to score.'); return; }
    const w = withP.filter(r => r.won).length, ex = withP.reduce((s, r) => s + r.p_pre, 0), v = withP.reduce((s, r) => s + r.p_pre * (1 - r.p_pre), 0);
    const z = v > 0 ? (w - ex) / Math.sqrt(v) : 0;
    const bySurf = {};
    withP.forEach(r => { const s = r.surface || 'hard'; const o = bySurf[s] || (bySurf[s] = { w: 0, n: 0, ex: 0 }); o.n++; o.ex += r.p_pre; if (r.won) o.w++; });
    const mk = withP.filter(r => k.isNum(r.market_pre));
    host.innerHTML = '<div class="af-kv">' + [[sA + ' won', w + ' of ' + withP.length], ['Model expected', k.num(ex, 1)], ['Difference', '<span class="' + (w - ex > 0 ? 'pg-up' : w - ex < 0 ? 'pg-down' : '') + '">' + k.signed(w - ex, 1) + '</span>'], ['z-score', k.num(z, 1)]]
      .map(x => '<div class="af-kv-i"><span>' + k.esc(x[0]) + '</span><strong>' + x[1] + '</strong></div>').join('') + '</div>' +
      k.table([{ label: 'Surface' }, { label: 'Meetings', align: 'right' }, { label: sA + ' won', align: 'right' }, { label: 'Expected', align: 'right' }, { label: 'Over', align: 'right' }],
        Object.keys(bySurf).map(s => [{ v: s, html: k.surfChip(s) }, bySurf[s].n, bySurf[s].w, { v: bySurf[s].ex, html: k.num(bySurf[s].ex, 1) }, { v: bySurf[s].w - bySurf[s].ex, html: k.signed(bySurf[s].w - bySurf[s].ex, 1) }]), { compact: true }) +
      '<div class="pg-note">Expected = the sum of the model\'s pre-match probabilities for ' + k.esc(sA) + ' in the meetings listed below. ' +
      (Math.abs(z) >= 2 ? 'A gap of ' + k.num(Math.abs(z), 1) + ' standard deviations: the rivalry has run ' + (w > ex ? 'for ' + k.esc(sA) : 'for ' + k.esc(sB)) + ' beyond what the ratings explain, which can be a stylistic edge or chance.' : 'Within two standard deviations of what the ratings predicted, so nothing here a coin could not do.') +
      (mk.length ? ' The closing market gave ' + k.esc(sA) + ' ' + k.num(mk.reduce((s, r) => s + r.market_pre, 0), 1) + ' expected wins in the ' + mk.length + ' meetings it priced.' : '') + '</div>';
  };

  // History.
  let list = met.slice();
  const drawHist = (note) => {
    const host = document.getElementById('h2-hist');
    list.sort((x, y) => String(y.date).localeCompare(String(x.date)));
    const surf = {};
    list.forEach(r => { const s = r.surface || '?'; const o = surf[s] || (surf[s] = { w: 0, l: 0 }); if (r.won) o.w++; else o.l++; });
    document.getElementById('h2-surf').innerHTML = list.length ? '<div class="af-surfsplit">' + k.SURFACES.concat(Object.keys(surf).filter(s => k.SURFACES.indexOf(s) < 0)).filter(s => surf[s]).map(s => {
      const o = surf[s], t = o.w + o.l;
      return '<div class="af-ss" style="--sc:' + k.surfColour(s) + '"><div class="af-ss-h">' + k.esc(k.SURF_LABEL[s] || s) + '</div><div class="af-ss-n"><span class="a">' + o.w + '</span>–<span class="b">' + o.l + '</span></div>' +
        '<div class="cmp-wins"><span class="a" style="width:' + (100 * o.w / t) + '%"></span><span class="b" style="width:' + (100 * o.l / t) + '%"></span></div></div>';
    }).join('') + '</div>' : '';
    document.getElementById('h2-hist-sub').innerHTML = list.length ? list.length + ' meeting' + (list.length === 1 ? '' : 's') + ' listed' + (list.length < n ? ' of the ' + n + ' in the tally (' + (note || 'the career files list the last two years; load every year for the rest') + ')' : '') : '';
    host.innerHTML = list.length ? k.table([{ label: 'Date' }, { label: 'Event' }, { label: 'Rd' }, { label: 'Winner' }, { label: 'Score' }, { label: sA + ' model', align: 'right', title: 'The model\'s pre-match probability for ' + sA }, { label: 'Market', align: 'right' }],
      list.map(r => ({ _href: r.match ? k.matchHref(T, r.match) : undefined, cells: [{ v: r.date, html: k.esc(k.fmtDate(r.date, { weekday: false })) }, { v: k.eventName(T, r.event), html: k.surfChip(r.surface) + ' ' + k.eventLink(T, r.event) },
        { v: k.ROUND_ORDER.indexOf(r.round), html: k.esc(r.round || '') }, { v: r.won ? 1 : 0, html: '<span class="' + (r.won ? 'af-a' : 'af-b') + '">' + k.esc(r.won ? sA : sB) + '</span>' },
        { v: r.score || '', html: '<span class="pg-mono">' + k.esc(r.score || '') + '</span>' }, { v: r.p_pre, html: k.pct(r.p_pre, 0) }, { v: r.market_pre, html: k.isNum(r.market_pre) ? k.pct(r.market_pre, 0) : '—' }] })), { compact: true })
      : k.muted(n ? 'The meetings are older than the two years the career files list. Load every year to see them.' : 'No tour-level meeting on file.');
    k.sortable(host);
    drawDev(list);
  };
  drawHist();
  const full = document.getElementById('h2-full');
  const yrsOf = c => ((c || {}).seasons || []).map(s => Number(s.year)).filter(k.isNum);
  const ya = yrsOf(cA), yb = yrsOf(cB);
  const years = ya.filter(y => yb.indexOf(y) >= 0 && y >= k.FIRST_YEAR[T]).sort((x, y) => y - x);
  if (!years.length || (list.length >= n && n > 0)) full.style.display = 'none';
  full.onclick = () => {
    full.disabled = true;
    full.textContent = 'Scanning ' + years.length + ' seasons…';
    Promise.all(years.map(y => Promise.all([TA.load(T + '/' + y + '/schedule.json'), TA.load(T + '/' + y + '/events.json')]))).then(rs => {
      if (!body.isConnected) return;
      const seen = {};
      list.forEach(r => { seen[r.match] = 1; });
      let found = 0, missing = 0;
      rs.forEach((pair, i) => {
        const sch = pair[0], evs = pair[1] || {};
        if (!k.ok(sch) || !Array.isArray(sch.matches)) { missing++; return; }
        Object.keys(evs || {}).forEach(e => { if (evs[e] && typeof evs[e] === 'object') k.EVENTS[T + ':' + e] = evs[e]; });
        sch.matches.forEach(m => {
          if (!m || seen[m.id]) return;
          if (!((m.p1 === a && m.p2 === b) || (m.p1 === b && m.p2 === a))) return;
          if (!m.winner) return;
          seen[m.id] = 1; found++;
          const flip = m.p1 !== a;
          const sets = (m.sets || []).map(s => (flip ? [s[1], s[0], s[3], s[2]] : s));
          const ev = evs[m.event] || {};
          list.push({ match: m.id, date: String(m.date || '').slice(0, 10), event: m.event, round: m.round, surface: ev.surface || m.surface, won: m.winner === a,
            score: sets.map(s => s[0] + '-' + s[1] + (k.isNum(s[2]) && k.isNum(s[3]) ? '(' + Math.min(s[2], s[3]) + ')' : '')).join(' '),
            p_pre: m.model && k.isNum(m.model.p1) ? (flip ? 1 - m.model.p1 : m.model.p1) : null, market_pre: m.market && k.isNum(m.market.p1) ? (flip ? 1 - m.market.p1 : m.market.p1) : null, src: 'schedule' });
        });
      });
      full.textContent = found ? 'Added ' + found + ' older meeting' + (found === 1 ? '' : 's') : 'No older meetings found';
      drawHist(missing ? missing + ' season file' + (missing === 1 ? '' : 's') + ' not published' : '');
    });
  };

  // WTA real stats.
  if (T === 'wta') {
    const host = document.getElementById('h2-real');
    const meta = k.metaOf(cat.metrics || []);
    const keys = (cat.metrics || []).filter(m => m.scope === 'wta_stats').map(m => m.key);
    const va = (P[a] || {}).values || {}, vb = (P[b] || {}).values || {};
    const ks = keys.filter(x => k.isNum(va[x]) || k.isNum(vb[x]));
    host.innerHTML = ks.length ? k.table([{ label: 'Metric' }, { label: sA, align: 'right' }, { label: 'Pct', align: 'center' }, { label: sB, align: 'right' }, { label: 'Pct', align: 'center' }],
      ks.map(x => { const m = meta[x]; const better = k.isNum(va[x]) && k.isNum(vb[x]) && va[x] !== vb[x] ? ((m.lower ? va[x] < vb[x] : va[x] > vb[x]) ? 0 : 1) : -1;
        return [{ v: m.label, html: k.glossLink(x, k.esc(m.label)) + (m.lower ? ' ↓' : '') }, { v: va[x], html: (better === 0 ? '<strong>' : '') + k.fmt(m, va[x]) + (better === 0 ? '</strong>' : '') }, { v: 0, html: k.pill(((P[a] || {}).pct || {})[x]) },
          { v: vb[x], html: (better === 1 ? '<strong>' : '') + k.fmt(m, vb[x]) + (better === 1 ? '</strong>' : '') }, { v: 0, html: k.pill(((P[b] || {}).pct || {})[x]) }]; }), { compact: true })
      : k.muted('No WTA match stats for these players this year.');
  }
}

if (typeof TA.route === 'function') TA.route('h2h', render);
})(window.TA || (window.TA = {}));
