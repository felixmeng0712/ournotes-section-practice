// Song select screen, section timeline, settings, history, offline downloads, and in-game overlays.
import {BASE, DIFF, JUDGE, WIN, S, D, G, $, ROUTE, PROFILE_KEYS, store, asset, getJSON, saveSettings, useOutput, fmtTime, isFC, isAP, noteViewTime} from './state.js';
import {parseChart, evalPath} from './chart.js';
import {planHands, hardSections, analyze, handOf, HAND_RGB} from './coach.js';
import {ac, decode, applyVol, ctxTimeAt, SE_SETS, loadSeSet, sfx} from './audio.js';
import {K, initRender, measAt} from './render.js';
import {hooks, initGame, startPlay, stopPlay, pause, resume, restart} from './game.js';
import {t, lang, LANGS, setLang, applyDom} from './i18n.js';

applyDom();

const cv = $('cv');
initRender(cv);
initGame(cv);

function setStatus(msg, err) { const s = $('status'); s.textContent = msg || ''; s.classList.toggle('err', !!err); }
const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
{
  const sel = $('lang');
  for (const [k, name] of Object.entries(LANGS)) sel.append(el('option', {value: k, textContent: name, selected: k === lang}));
  sel.onchange = () => setLang(sel.value);
}

// ---------- song list ----------
const titleOf = s => s.title[1] || s.title[0];
// list entries carry tag ids; song detail carries {id: [names]}
const tagNames = s => {
  const tags = s.musicTags || [];
  return Array.isArray(tags) ? tags.map(id => ({id: String(id), n: D.refs?.musicTags?.[id]})) : Object.entries(tags).map(([id, n]) => ({id, n}));
};
const bandOf = s => tagNames(s).map(x => x.n?.[1] || x.n?.[0]).filter(Boolean).join(' / ');
let band = store.get('band', '');

async function loadSongs() {
  setStatus(t('st.songs'));
  try {
    const j = await getJSON(asset.songs());
    D.refs = j.refs;
    D.songs = Object.values(j.items).sort((a, b) => a.id - b.id);
    renderBands();
    renderSongList();
    setStatus('');
    const last = store.get('last', null);
    const pick = D.songs.find(s => String(s.id) === String(last?.id)) || D.songs.find(s => s.id === 100020) || D.songs[0];
    if (pick) selectSong(pick.id, last?.diff);
  } catch (e) {
    console.error(e);
    setStatus(e.offline ? t('st.songsOffline') : t('st.songsFail', {msg: e.message}), true);
  }
  refreshOffline();
}

function renderBands() {
  const used = new Map();
  for (const s of D.songs) for (const {id, n} of tagNames(s)) if (n && !used.has(id)) used.set(id, n[1] || n[0]);
  const box = $('bands'); box.innerHTML = '';
  const chip = (id, name) => {
    const b = el('button', {type: 'button', textContent: name, className: band === id ? 'on' : ''});
    b.onclick = () => { band = id; store.set('band', id); [...box.children].forEach(c => c.classList.toggle('on', c === b)); renderSongList(); };
    box.append(b);
  };
  if (!used.has(band)) band = '';
  chip('', t('all'));
  for (const [id, name] of used) chip(id, name);
}

function renderSongList() {
  const q = $('search').value.trim().toLowerCase();
  const ul = $('songList'); ul.innerHTML = '';
  for (const s of D.songs) {
    if (band && !tagNames(s).some(x => x.id === band)) continue;
    const hay = (s.title.join(' ') + ' ' + (s.ruby || '') + ' ' + bandOf(s)).toLowerCase();
    if (q && !hay.includes(q)) continue;
    const lv = el('span', {className: 'lv'});
    s.difficulties.forEach((d, i) => lv.append(el('span', {textContent: d, style: `color:${DIFF[i]?.col || '#fff'}`})));
    const li = el('li', {className: D.song?.id === s.id ? 'on' : ''},
      el('img', {loading: 'lazy', alt: '', src: BASE + asset.jacket(s.jacket)}),
      el('div', {className: 't'}, el('div', {textContent: titleOf(s)}), el('small', {textContent: bandOf(s)})),
      lv);
    li.dataset.id = s.id;
    li.onclick = () => selectSong(s.id);
    ul.append(li);
  }
  markOffline();
  if (!ul.children.length) ul.append(el('li', {className: 'emptyRow', textContent: t('noMatch')}));
}

// ---------- jacket colour → UI tint ----------
function tintFrom(img) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data, buckets = Array.from({length: 12}, () => ({w: 0, h: 0, s: 0}));
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dd = mx - mn;
      if (dd < .08) continue;
      const s = dd / (1 - Math.abs(2 * l - 1));
      let h = mx === r ? ((g - b) / dd + 6) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h *= 60;
      const w = s * s * Math.max(0, 1 - Math.abs(l - .55) * 1.6), k = buckets[Math.floor(h / 30) % 12];
      k.w += w; k.h += h * w; k.s += s * w;
    }
    const best = buckets.reduce((a, b) => b.w > a.w ? b : a);
    if (best.w < 2) return null;
    return hslToRgb(best.h / best.w, Math.max(.6, Math.min(.95, best.s / best.w)), .68);
  } catch { return null; }
}
function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return `${f(0)},${f(8)},${f(4)}`;
}
function applyTint(rgb) {
  rgb = rgb || '255,111,181';
  K.tint = rgb;
  document.documentElement.style.setProperty('--tint', rgb);
  drawTL(); drawSpark();
}

// ---------- song / difficulty ----------
async function selectSong(id, diff) {
  const tok = ++D.token;
  $('btnStart').disabled = true;
  setStatus(t('st.song'));
  try {
    const s = await getJSON(asset.song(id));
    if (tok !== D.token) return;
    D.song = s;
    document.querySelectorAll('#songList li').forEach(li => li.classList.toggle('on', li.dataset.id == id));
    $('title').textContent = titleOf(s);
    $('band').textContent = bandOf(s);
    $('facts').replaceChildren(...[`BPM ${s.meta[0]?.bpm || '?'}`, fmtTime(s.duration)].map(t => el('span', {textContent: t})));
    const jurl = BASE + asset.jacket(s.jacket);
    $('jacket').src = jurl;
    const bi = $('bgImg'); bi.classList.remove('on');
    const img = new Image();
    img.onload = () => { if (tok !== D.token) return; applyTint(tintFrom(img)); bi.style.backgroundImage = `url("${jurl}")`; bi.classList.add('on'); };
    img.onerror = () => applyTint(null);
    img.src = jurl;

    const dv = $('diffs'); dv.innerHTML = '';
    s.meta.forEach((m, i) => {
      const b = el('button', {type: 'button'}, el('b', {textContent: m.difficulty}), el('span', {textContent: DIFF[i]?.name || 'Lv'}), el('small', {textContent: m.noteCount + ' notes'}));
      b.style.setProperty('--c', DIFF[i]?.col || '#fff');
      b.onclick = () => selectDiff(i).catch(e => setStatus(t('st.chartFail', {msg: e.message}), true));
      dv.append(b);
    });
    const di = Number.isInteger(diff) && diff < s.meta.length ? diff : s.meta.length - 1;
    const audioP = loadAudio(s.filename, tok);
    await selectDiff(di);
    await audioP;
    refreshOffline();
  } catch (e) {
    console.error(e);
    if (tok === D.token) setStatus(e.offline ? t('st.notCached') : t('st.loadFail', {msg: e.message}), true);
  }
}

async function loadAudio(file, tok) {
  if (D.bufferFor === file && D.buffer) return;
  D.buffer = null; D.bufferFor = file;
  const r = await fetch(BASE + asset.audio(file));
  if (!r.ok) { const e = new Error(t('err.music', {status: r.status})); e.offline = r.status === 504; throw e; }
  const ab = await r.arrayBuffer();
  if (D.bufferFor !== file) return;
  setStatus(t('st.decode'));
  const buf = await decode(ab);
  if (D.bufferFor !== file) return;
  D.buffer = buf;
  if (tok === D.token) refreshReady();
}

async function selectDiff(i) {
  const s = D.song, m = s.meta[i];
  D.diff = i;
  [...$('diffs').children].forEach((b, k) => b.classList.toggle('on', k === i));
  store.set('last', {id: s.id, diff: i});
  const raw = await getJSON(asset.chart(m.filename));
  if (D.song !== s || D.diff !== i) return;
  D.chart = parseChart(raw);
  D.plan = planHands(D.chart);
  D.hard = hardSections(D.chart, D.plan);
  D.fn = m.filename;
  const sec = store.get('sec:' + D.fn, null);
  D.secA = D.secB = 0;
  setSection(sec ? sec.a : 1, sec ? sec.b : D.chart.mSec.length);
  refreshReady();
}

function refreshReady() {
  const ok = !!(D.chart && D.buffer && D.bufferFor === D.song?.filename);
  $('btnStart').disabled = !ok;
  if (ok) setStatus('');
  else if (D.chart) setStatus(t('st.music'));
}

// ---------- section ----------
const measEnd = m => m < D.chart.mSec.length ? D.chart.mSec[m] : D.chart.end;

function setSection(a, b) {
  const M = D.chart.mSec.length;
  a = Math.max(1, Math.min(M, Math.round(a) || 1));
  b = Math.max(a, Math.min(M, Math.round(b) || M));
  const changed = a !== D.secA || b !== D.secB;
  D.secA = a; D.secB = b;
  $('mA').value = a; $('mB').value = b; $('mA').max = $('mB').max = M;
  store.set('sec:' + D.fn, {a, b});
  if (changed) { D.hist = store.get(histKey(), []); renderHist(); }
  const t0 = D.chart.mSec[a - 1], t1 = measEnd(b);
  const n = D.chart.items.filter(it => it.role !== 'hold' && it.t >= t0 && it.t < t1).length;
  $('secInfo').textContent = t('secInfo', {t0: fmtTime(t0), t1: fmtTime(t1), n});
  $('startSub').textContent = a === 1 && b === M ? t('whole') : t('bars', {a, b});
  drawTL();
  renderHard();
  renderCoach();
}

function drawTL(selA, selB) {
  const c = $('tl'), C = D.chart; if (!C) return;
  const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = t => t / C.end * w, barH = h - 22;
  const a = selA ?? C.mSec[D.secA - 1], b = selB ?? measEnd(D.secB);
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.035)';
  for (const [fa, fb] of C.fever) g.fillRect(X(fa), 0, X(fb) - X(fa), barH);
  const bin = .5, nb = Math.ceil(C.end / bin), cnt = new Array(nb).fill(0);
  for (const it of C.items) if (it.role !== 'hold') cnt[Math.min(nb - 1, Math.floor(it.t / bin))]++;
  const mx = Math.max(4, ...cnt);
  for (let i = 0; i < nb; i++) {
    if (!cnt[i]) continue;
    const v = cnt[i] / mx, x0 = X(i * bin), x1 = X((i + 1) * bin), t = (i + .5) * bin, inside = t >= a && t < b;
    const hh = Math.max(2, v * (barH - 8));
    g.fillStyle = inside ? `rgba(${K.tint},${.55 + .45 * v})` : `rgba(220,210,255,${.18 + .3 * v})`;
    if (inside && v > .75) g.fillStyle = `rgb(255,${Math.round(235 - 40 * v)},${Math.round(235 - 40 * v)})`;
    g.fillRect(x0, barH - hh, Math.max(1, x1 - x0 - .6), hh);
  }
  const ms = C.mSec, pxPer = w / ms.length;
  const step = [1, 2, 4, 8, 16, 32].find(s => s * pxPer >= 30) || 64;
  g.font = '600 11px "Barlow Condensed", sans-serif'; g.textAlign = 'center';
  ms.forEach((t, i) => {
    const x = X(t);
    g.fillStyle = `rgba(200,190,240,${i % 4 === 0 ? .4 : .15})`;
    g.fillRect(x, barH + 2, 1, i % 4 === 0 ? 5 : 3);
    if (i % step === 0) { g.fillStyle = 'rgba(200,190,240,.75)'; g.fillText(String(i + 1), Math.max(8, Math.min(w - 8, x)), h - 3); }
  });
  // selection brackets
  const xa = X(a), xb = X(b);
  g.fillStyle = `rgba(${K.tint},.1)`; g.fillRect(xa, 0, xb - xa, barH);
  g.fillStyle = `rgb(${K.tint})`;
  for (const [x, s] of [[xa, 1], [xb, -1]]) { g.fillRect(x - (s < 0 ? 2 : 0), 0, 2, barH); g.fillRect(x - (s < 0 ? 8 : 0), 0, 8, 2); g.fillRect(x - (s < 0 ? 8 : 0), barH - 2, 8, 2); }
}

(function tlInput() {
  const c = $('tl'); let drag = null;
  const tAt = e => { const r = c.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * D.chart.end; };
  c.addEventListener('pointerdown', e => { if (!D.chart) return; c.setPointerCapture(e.pointerId); drag = {x: e.clientX, t: tAt(e)}; });
  c.addEventListener('pointermove', e => {
    if (!drag) return;
    const t = tAt(e), ma = measAt(Math.min(drag.t, t)), mb = measAt(Math.max(drag.t, t));
    drawTL(D.chart.mSec[ma - 1], measEnd(mb));
  });
  c.addEventListener('pointerup', e => {
    if (!drag) return;
    const t = tAt(e);
    if (Math.abs(e.clientX - drag.x) < 6) { const m = measAt(t); setSection(m, m + 3); }
    else setSection(measAt(Math.min(drag.t, t)), measAt(Math.max(drag.t, t)));
    drag = null;
  });
  addEventListener('resize', () => drawTL());
})();

$('mA').onchange = () => setSection(+$('mA').value, Math.max(+$('mA').value, +$('mB').value));
$('mB').onchange = () => setSection(Math.min(+$('mA').value, +$('mB').value), +$('mB').value);
$('btnAll').onclick = () => setSection(1, D.chart.mSec.length);
$('btnShiftL').onclick = () => { const len = D.secB - D.secA; const a = Math.max(1, D.secA - len - 1); setSection(a, a + len); };
$('btnShiftR').onclick = () => { const len = D.secB - D.secA, M = D.chart.mSec.length; const a = Math.min(M - len, D.secB + 1); setSection(a, a + len); };
$('search').oninput = renderSongList;

// ---------- training: hard passages, what is in the selected one, drills ----------
function renderHard() {
  const row = $('hardRow');
  row.replaceChildren(row.firstElementChild);
  row.hidden = !D.hard?.length;
  for (const h of D.hard || []) {
    const b = el('button', {type: 'button', className: h.a === D.secA && h.b === D.secB ? 'on' : '', title: t('hard.title')},
      el('b', {textContent: `${h.a}–${h.b}`}), el('small', {textContent: t('hard.sub', {where: t('where.' + h.where), nps: h.nps.toFixed(1)})}),
      el('i', {style: `width:${Math.round(30 + 70 * Math.min(1, h.level))}%`}));
    b.onclick = () => setSection(h.a, h.b);
    row.append(b);
  }
}

const STRIP_MAX = 16;   // measures
// phone in landscape: a narrower strip leaves the tips beside it room to breathe
const COMPACT = matchMedia('(max-height: 500px) and (min-width: 761px)');
COMPACT.addEventListener?.('change', () => { if (D.chart && !$('coachPanel').hidden && !$('stripBox').parentElement.hidden) drawStrip(); });
function renderCoach() {
  const C = D.chart, A = analyze(C, D.plan, D.secA, D.secB);
  $('coachPanel').hidden = false;
  $('coachInfo').textContent = A.notes ? t('coachInfo', {n: A.notes, nps: A.nps.toFixed(1)}) : '';
  const ol = $('pats');
  ol.replaceChildren(...A.pats.map(p => el('li', {}, el('b', {textContent: p.title}), el('p', {textContent: p.text}), el('p', {className: 'tip', textContent: p.tip}))));
  if (!A.pats.length) ol.append(el('li', {className: 'none', textContent: A.notes ? t('coach.none') : t('coach.noNotes')}));
  const long = D.secB - D.secA + 1 > STRIP_MAX;
  $('stripBox').parentElement.hidden = long;
  if (long) ol.prepend(el('li', {className: 'none', textContent: t('coach.long', {n: STRIP_MAX})}));
  else drawStrip();
  const lr = store.get(ladderKey(), null);
  $('drillHint').textContent = t('drillHint', {pct: Math.round((lr || .7) * 100), last: !!lr});
}

// the selected passage drawn flat, time going up like in the game, notes coloured by the hand that should play them
function drawStrip() {
  const C = D.chart, c = $('strip'), box = $('stripBox');
  const t0 = C.mSec[D.secA - 1], t1 = D.secB < C.mSec.length ? C.mSec[D.secB] : C.end;
  const gs = D.plan.groups.filter(g => g[0].t >= t0 && g[0].t < t1);
  let gap = .25;
  for (let i = 1; i < gs.length; i++) gap = Math.min(gap, Math.max(.04, gs[i][0].t - gs[i - 1][0].t));
  const pps = Math.min(Math.max(14 / gap, 90), 260, 6000 / (t1 - t0));
  const lane = COMPACT.matches ? 6 : 8, gx = 30, w = gx + lane * 24 + 10, h = Math.ceil((t1 - t0) * pps) + 24;
  const dpr = devicePixelRatio || 1;
  c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px';
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const Y = t => h - 12 - (t - t0) * pps, X = u => gx + u * lane;
  g.clearRect(0, 0, w, h);
  for (let k = 0; k <= 24; k += 3) { g.fillStyle = k % 12 === 0 ? 'rgba(220,215,255,.22)' : 'rgba(220,215,255,.08)'; g.fillRect(X(k), 0, 1, h); }
  g.font = '600 11.5px "Barlow Condensed", sans-serif'; g.textAlign = 'right';
  for (let mi = D.secA - 1; mi < D.secB; mi++) {
    const ms = C.mSec[mi], me = mi + 1 < C.mSec.length ? C.mSec[mi + 1] : C.end, beat = 60 / C.bpmAt(ms);
    for (let t = ms + beat; t < me - beat * .1; t += beat) { g.fillStyle = 'rgba(220,215,255,.07)'; g.fillRect(X(0), Y(t), lane * 24, 1); }
    g.fillStyle = 'rgba(220,215,255,.35)'; g.fillRect(X(0), Y(ms), lane * 24, 1);
    g.fillStyle = 'rgba(220,215,255,.7)'; g.fillText(String(mi + 1), gx - 5, Y(ms) + 4);
  }
  const col = (hand, a) => hand ? `rgba(${HAND_RGB[hand]},${a})` : `rgba(200,200,230,${a})`;
  // longs
  for (const L of C.longs) {
    if (L.end < t0 || L.head >= t1) continue;
    const a = Math.max(L.head, t0), b = Math.min(L.end, t1), pts = [];
    for (let t = a; ; t = Math.min(b, t + .02)) { pts.push([t, ...evalPath(L.path, t)]); if (t >= b) break; }
    g.beginPath();
    pts.forEach(([t, l], i) => i ? g.lineTo(X(l + .3), Y(t)) : g.moveTo(X(l + .3), Y(t)));
    for (let i = pts.length - 1; i >= 0; i--) g.lineTo(X(pts[i][2] - .3), Y(pts[i][0]));
    g.closePath(); g.fillStyle = col(L.guide ? null : L.hand, L.guide ? .15 : .35); g.fill();
  }
  // notes
  const note = (t, l, r, kind, hand, dir) => {
    const y = Y(t), th = kind === 'trace' ? 3 : 6;
    g.fillStyle = col(hand, kind === 'trace' ? .7 : 1);
    g.beginPath(); g.roundRect(X(l + .3), y - th / 2, (r - l - .6) * lane, th, th / 2); g.fill();
    if (kind === 'flick') {
      const cx = X((l + r) / 2), s = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx - 5 + s * 3, y - 5); g.lineTo(cx + s * 6, y - 11); g.lineTo(cx + 5 + s * 3, y - 5); g.closePath(); g.fill();
    }
  };
  // trouble spots first, so the note draws over its ring
  for (const sp of troubleSpots()) {
    const it = sp.it;
    if (it.t < t0 || it.t >= t1) continue;
    const {l, r} = it;
    g.strokeStyle = `rgba(255,90,118,${.45 + .55 * sp.ratio})`; g.lineWidth = 2;
    g.beginPath(); g.roundRect(X(l) - 1, Y(it.t) - 7, (r - l) * lane + 2, 14, 7); g.stroke();
  }
  for (const it of C.items) {
    if (it.t < t0 || it.t >= t1 || it.role === 'hold' || it.role === 'guide') continue;
    if (it.role === 'conn') { const x = X((it.l + it.r) / 2), y = Y(it.t); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x, y - 3); g.lineTo(x + 3, y); g.lineTo(x, y + 3); g.lineTo(x - 3, y); g.fill(); continue; }
    note(it.t, it.l, it.r, it.role === 'end' && it.kind === 'end' ? 'trace' : it.kind, it.long ? it.long.hand : it.hand, it.dir);
  }
  box.scrollTop = box.scrollHeight;
}

const ladderKey = () => `ladder:${D.fn}:${D.secA}-${D.secB}`;
const DRILL = {
  slow: {label: t('drill.label.slow'), opts: {}},
  demo: {label: t('drill.label.demo'), opts: {auto: true}},
  L: {label: t('drill.label.L'), opts: {solo: 'L'}},
  R: {label: t('drill.label.R'), opts: {solo: 'R'}},
};
async function drill(kind) {
  if ($('btnStart').disabled) return;
  const d = DRILL[kind];
  D.drill = {kind, prevRate: S.rate};
  S.rate = kind === 'demo' ? .75 : store.get(ladderKey(), .7);   // not saved: the slider value comes back after the drill
  showGame(true);
  await startPlay({...d.opts, loop: true, hands: true, label: d.label});
}
$('btnDrill').onclick = () => drill('slow');
$('btnDemo').onclick = () => drill('demo');
$('btnSoloL').onclick = () => drill('L');
$('btnSoloR').onclick = () => drill('R');

// after each looped drill attempt: faster when it was clean, slower when it fell apart
function ladder(rec) {
  const off = rec.b + rec.m, loose = rec.gr + rec.gd;
  let next = S.rate;
  if (!off && loose <= rec.total * .15) next += .05;
  else if (off >= Math.max(2, rec.total * .1)) next -= .05;
  next = Math.max(.5, Math.min(1, Math.round(next * 20) / 20));
  const msg = next > S.rate ? t('ladder.up', {pct: Math.round(next * 100)}) : next < S.rate ? t('ladder.down', {pct: Math.round(next * 100)}) : S.rate === 1 && !off ? t('ladder.done') : t('ladder.keep', {pct: Math.round(next * 100)});
  S.rate = next;
  if (D.drill.kind === 'slow') store.set(ladderKey(), next);
  return msg;
}

// ---------- settings ----------
const SLIDERS = [
  ['speed', t('set.speed'), 1, 12, .1, v => v.toFixed(1)],
  ['rate', t('set.rate'), .5, 1, .05, v => Math.round(v * 100) + '%'],
  ['offset', t('set.offset'), -150, 300, 5, v => (v > 0 ? '+' : '') + v + ' ms'],
  ['tin', t('set.tin'), -150, 150, 5, v => (v > 0 ? '+' : '') + v + ' ms'],
  ['pre', t('set.pre'), 1, 5, .5, v => t('sec', {v})],
  ['mvol', t('set.mvol'), 0, 1, .05, v => Math.round(v * 100) + '%'],
  ['svol', t('set.svol'), 0, 1, .05, v => Math.round(v * 100) + '%'],
];
function setSummary() {
  $('setSummary').textContent = t('summary', {speed: S.speed.toFixed(1), rate: Math.round(S.rate * 100), offset: S.offset, bt: S.out === 'bt'});
}
const setSlider = {};
for (const [k, label, min, max, step, fmt] of SLIDERS) {
  const b = el('b');
  const inp = el('input', {type: 'range', min, max, step, value: S[k]});
  const upd = () => { S[k] = +inp.value; b.textContent = fmt(S[k]); applyVol(); saveSettings(); setSummary(); };
  inp.oninput = upd; upd();
  if (k === 'offset') inp.onchange = () => { if (D.chart) renderOffHint(); };
  setSlider[k] = v => { inp.value = v; upd(); };
  $('sliders').append(el('div', {}, el('label', {}, label, b), inp));
}
// the game's four hit sound sets; picking one plays its perfect sound
{
  const NAMES = {default: t('se.default'), solid: 'Solid', typing: 'Typing', wood: 'Wood'}, row = el('div', {className: 'chips'});
  const show = () => { for (const x of row.children) x.classList.toggle('on', x.dataset.se === S.se); };
  for (const k of SE_SETS) {
    const btn = el('button', {type: 'button'}, NAMES[k]); btn.dataset.se = k;
    btn.onclick = () => { S.se = k; saveSettings(); show(); loadSeSet(k); setTimeout(() => sfx('perfect'), 150); };
    row.append(btn);
  }
  show();
  $('sliders').append(el('div', {}, el('label', {}, t('se.label')), row));
}

// Audio output (iOS app only): while Bluetooth audio is connected the Bluetooth profile's offsets and volumes are used,
// as in the game. The first time, its offset starts from the normal one plus the headset's extra delay as iOS reports
// it, less what the page's clock already takes off for it.
const ROUTE_NAME = Object.fromEntries(['bluetooth', 'wired', 'speaker', 'airplay', 'other'].map(k => [k, t('route.' + k)]));
function renderOutInfo() {
  const p = $('outInfo');
  p.hidden = !ROUTE.kind;
  p.textContent = t('route.info', {name: ROUTE.name || ROUTE_NAME[ROUTE.kind], kind: ROUTE_NAME[ROUTE.kind], ms: ROUTE.latency, bt: S.out === 'bt'});
}
window.onAudioRoute = r => {
  const prev = {...ROUTE}, web = Math.max(0, ac.currentTime - ctxTimeAt(performance.now())) * 1000;
  Object.assign(ROUTE, r, {web: Math.round(web)});
  const out = r.kind === 'bluetooth' ? 'bt' : 'normal';
  let first;
  if (out === 'bt' && !S.profiles.bt) {
    const base = prev.kind && prev.kind !== 'bluetooth' ? prev : {latency: 0, web: 0};   // launched on Bluetooth: ~0
    const extra = (r.latency - base.latency) - (ROUTE.web - base.web);
    first = {offset: Math.max(-150, Math.min(300, S.offset + Math.max(0, Math.round(extra / 5) * 5)))};
  }
  if (useOutput(out, first)) {
    for (const k of PROFILE_KEYS) setSlider[k](S[k]);
    if (D.chart) renderOffHint();
  }
  renderOutInfo();
};
window.webkit?.messageHandlers?.audioRoute?.postMessage(0);

for (const [id, k] of [['optLoop', 'loop'], ['optAuto', 'auto'], ['optKeys', 'keys'], ['optHands', 'hands']]) {
  $(id).checked = S[k];
  $(id).onchange = () => { S[k] = $(id).checked; saveSettings(); };
}

// ---------- more: how to play the section, its history, settings, offline and backup, help ----------
// One sheet beside the song select, so the main screen keeps only song, difficulty, section and start.
let moreTab = store.get('moreTab', 'coach');
function openMore(tab = moreTab) {
  moreTab = tab; store.set('moreTab', tab);
  $('more').hidden = false;
  for (const b of document.querySelectorAll('#more [data-tab]')) { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); }
  for (const p of document.querySelectorAll('#more .pane')) p.classList.toggle('on', p.dataset.pane === tab);
  // both drew themselves while out of sight: draw again now that they have a size
  if (tab === 'coach' && D.chart && !$('coachPanel').hidden && !$('stripBox').parentElement.hidden) drawStrip();
  if (tab === 'hist' && D.chart) drawSpark();
}
function closeMore() { $('more').hidden = true; }
$('btnMore').onclick = () => openMore();
$('moreScrim').onclick = $('moreClose').onclick = closeMore;
for (const b of document.querySelectorAll('#more [data-tab]')) b.onclick = () => openMore(b.dataset.tab);

// ---------- history (kept per chart + section) ----------
const histKey = () => `hist:${D.fn}:${D.secA}-${D.secB}`;
const fmtAvg = avg => avg == null ? '' : t('avg', {avg});

function renderHist() {
  const ol = $('hist'); ol.innerHTML = '';
  for (const r of D.hist) {
    const li = el('li', {}, el('span', {className: 'n', textContent: '#' + r.n}));
    if (isAP(r)) li.append(el('span', {className: 'badge ap', textContent: 'AP'}));
    else if (isFC(r)) li.append(el('span', {className: 'badge fc', textContent: 'FC'}));
    for (const [c, t] of [['cP', 'P ' + r.p], ['cG', 'G ' + r.gr], ['cGd', 'Gd ' + r.gd], ['cB', 'B ' + (r.b || 0)], ['cM', 'M ' + r.m]]) li.append(el('span', {className: 'c ' + c, textContent: t}));
    li.append(el('span', {textContent: t('hist.combo', {max: r.max, total: r.total})}));
    if (r.rate && r.rate < 1) li.append(el('span', {className: 'rate', textContent: Math.round(r.rate * 100) + '%'}));
    li.append(el('span', {className: 'avg', textContent: fmtAvg(r.avg)}));
    ol.append(li);
  }
  const fc = D.hist.filter(isFC).length;
  $('histInfo').textContent = D.hist.length ? t('hist.info', {n: D.hist.length, fc}) : '';
  $('histEmpty').hidden = D.hist.length > 0;
  $('btnClearHist').hidden = !D.hist.length;
  drawSpark();
  renderOffHint();
  renderTrouble();
  if (D.plan && !$('coachPanel').hidden && !$('stripBox').parentElement.hidden) drawStrip();
}
$('btnClearHist').onclick = () => { D.hist = []; store.set(histKey(), []); renderHist(); };

// ---------- backup ----------
// Everything this app keeps (bdonp:* in localStorage) as one JSON file. Import merges: attempts are joined by their
// time, other keys (settings, drill progress, last song) are only filled in where this device has none.
const BACKUP = 'ournotes-practice';
function backupMsg(msg, err) { const m = $('backupMsg'); m.textContent = msg; m.hidden = !msg; m.classList.toggle('err', !!err); }
$('btnExport').onclick = () => {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('bdonp:')) try { data[k.slice(6)] = JSON.parse(localStorage.getItem(k)); } catch {}
  }
  const n = Object.entries(data).reduce((a, [k, v]) => a + (k.startsWith('hist:') ? v.length : 0), 0);
  const d = new Date(), pad = x => String(x).padStart(2, '0');
  const name = t('backup.file', {date: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`});
  const text = JSON.stringify({app: BACKUP, v: 1, at: Date.now(), data});
  const ios = window.webkit?.messageHandlers?.exportFile;
  if (ios) ios.postMessage({name, text});   // the app shows the share sheet (save to Files, AirDrop…)
  else {
    const a = el('a', {href: URL.createObjectURL(new Blob([text], {type: 'application/json'})), download: name});
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  backupMsg(t('backup.exported', {n}));
};
$('btnImport').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  let file;
  try { file = JSON.parse(await f.text()); } catch { return backupMsg(t('backup.unreadable'), true); }
  if (file?.app !== BACKUP || !file.data || typeof file.data !== 'object') return backupMsg(t('backup.wrongApp'), true);
  let added = 0, keys = 0, settings = false;
  for (const [k, v] of Object.entries(file.data)) {
    if (k.startsWith('hist:')) {
      if (!Array.isArray(v)) continue;
      const cur = store.get(k, []), seen = new Set(cur.map(r => r.at));
      const fresh = v.filter(r => r && typeof r === 'object' && !seen.has(r.at));
      if (!fresh.length) continue;
      added += fresh.length;
      store.set(k, [...cur, ...fresh].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 60));
    }
    else if (store.get(k, undefined) === undefined) { store.set(k, v); keys++; if (k === 'settings') settings = true; }
  }
  if (settings) {   // the sliders and toggles were built from the old settings: reload, then say how it went
    try { sessionStorage.setItem('bdonp-msg', t('backup.importedReload', {n: added})); } catch {}
    return location.reload();
  }
  D.hist = store.get(histKey(), []); renderHist();
  backupMsg(added || keys ? t('backup.imported', {n: added, keys}) : t('backup.nothing'));
};
try { const m = sessionStorage.getItem('bdonp-msg'); if (m) { sessionStorage.removeItem('bdonp-msg'); backupMsg(m); openMore('backup'); } } catch {}

// Notes that keep going wrong: over the last attempts of this section (that recorded per-note results), the ones that
// weren't Perfect in at least 2 attempts and in at least 30% of them.
const TROUBLE_OF = 10;
function troubleSpots() {
  const recs = D.hist.filter(r => r.miss).slice(0, TROUBLE_OF);
  if (recs.length < 2 || !D.chart) return [];
  const by = new Map();
  for (const r of recs) for (const [i, res, dt] of r.miss) {
    const it = D.chart.items[i];
    if (!it) continue;
    const e = by.get(i) || by.set(i, {it, n: 0, res: {}, dts: []}).get(i);
    e.n++; e.res[res] = (e.res[res] || 0) + 1;
    if (dt != null) e.dts.push(dt);
  }
  const need = Math.max(2, Math.ceil(recs.length * .3));
  return [...by.values()].filter(e => e.n >= need).map(e => ({...e, of: recs.length, ratio: e.n / recs.length}))
    .sort((a, b) => b.n - a.n || a.it.t - b.it.t);
}
function renderTrouble() {
  const box = $('trouble'), spots = troubleSpots();
  box.hidden = !spots.length;
  if (!spots.length) return;
  box.querySelector('h4').textContent = t('trouble.head', {of: spots[0].of});
  const C = D.chart;
  box.querySelector('ol').replaceChildren(...spots.slice(0, 5).map(sp => {
    const it = sp.it, m = measAt(it.t), ms = C.mSec[m - 1], beat = Math.round((1 + (it.t - ms) * C.bpmAt(ms) / 60) * 4) / 4;
    const name = noteName(it.role, it.kind) || it.kind, h = handOf(it);
    const res = ['miss', 'bad', 'good', 'great'].filter(k => sp.res[k]).map(k => `${JUDGE[k].label} ${sp.res[k]}`).join(', ');
    const avg = sp.dts.length >= 2 ? sp.dts.reduce((a, b) => a + b, 0) / sp.dts.length : null;
    return el('li', {}, el('b', {textContent: t('trouble.at', {m, beat})}),
      ...(h ? [el('span', {className: 'h' + h, textContent: t('hand.' + h)})] : []),
      el('span', {textContent: t('trouble.text', {name, n: sp.n, of: sp.of, res, avg})}));
  }));
}

// Offset from the recent attempts: each one's average (Tap / Flick, in real ms) was measured with the offset of the
// time, so offset + average is where that attempt would have centred; suggest the mean of those.
function renderOffHint() {
  const box = $('offHint'), rs = D.hist.filter(r => r.off != null && r.avg != null && (r.out || 'normal') === S.out).slice(0, 8);
  const want = rs.length >= 3 ? Math.round(rs.reduce((a, r) => a + r.off + r.avg, 0) / rs.length / 5) * 5 : null;
  const to = want == null ? null : Math.max(-150, Math.min(300, want));
  box.hidden = to == null || Math.abs(to - S.offset) < 10;
  if (box.hidden) return;
  const d = to - S.offset, fmt = v => `${v > 0 ? '+' : ''}${v} ms`;
  const btn = el('button', {className: 'btn sm', textContent: t('offset.set', {v: fmt(to)})});
  btn.onclick = () => { setSlider.offset(to); box.replaceChildren(el('span', {textContent: t('offset.done', {v: fmt(to)})})); };
  box.replaceChildren(el('span', {textContent: t('offset.drift', {n: rs.length, late: d > 0, ms: Math.abs(d)})}), btn);
}

function drawSpark() {
  const svg = $('spark'), rs = [...D.hist].reverse().slice(-40);
  svg.hidden = rs.length < 2;
  if (svg.hidden) return;
  const w = svg.clientWidth || 600, h = 56, pad = 8, v = rs.map(r => (r.b || 0) + r.m), mx = Math.max(1, ...v);
  const x = i => pad + i * (w - pad * 2) / (rs.length - 1), y = n => pad + 10 + (1 - n / mx) * (h - pad * 2 - 10);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const pts = v.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
  svg.innerHTML = `<text x="0" y="10" fill="#aea4d0" font-size="11">${t('spark', {mx})}</text>
    <polyline points="${pts}" fill="none" stroke="rgb(${K.tint})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${v.map((n, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(n).toFixed(1)}" r="${n ? 2.5 : 4}" fill="${n ? 'rgb(' + K.tint + ')' : '#ffc23d'}"/>`).join('')}`;
}

// ---------- offline cache ----------
D.offline = null;
async function refreshOffline() {
  try {
    const r = await fetch('api/offline');
    if (!r.ok) throw new Error();
    D.offline = await r.json();
  } catch {
    D.offline = null;
    $('offInfo').textContent = t('off.needServer');
    $('btnDl').hidden = true;
    return;
  }
  markOffline();
  if (!dl.running) {
    const n = D.songs.filter(s => fullOff(s.id)).length;
    $('offInfo').textContent = D.songs.length ? t('off.count', {n, total: D.songs.length}) : '';
    $('btnDl').hidden = !D.songs.length || n === D.songs.length;
  }
}
const fullOff = id => { const o = D.offline?.[id]; return o && o.have >= o.need; };
function markOffline() {
  for (const li of document.querySelectorAll('#songList li[data-id]')) {
    li.querySelector('.off')?.remove();
    const o = D.offline?.[li.dataset.id];
    if (!o || !o.have) continue;
    const full = o.have >= o.need;
    li.append(el('span', {className: 'off' + (full ? '' : ' part'), title: full ? t('off.full') : t('off.part')}));
  }
}

const dl = {running: false};
$('btnDl').onclick = async () => {
  if (dl.running) { dl.running = false; return; }
  dl.running = true;
  const btn = $('btnDl'), bar = $('dlBar');
  btn.textContent = t('off.stop'); bar.parentElement.hidden = false;
  const queue = D.songs.filter(s => !fullOff(s.id)).map(s => s.id), total = queue.length;
  let done = 0, fail = 0;
  const show = () => { $('offInfo').textContent = t('off.progress', {done, total, fail}); bar.style.width = (total ? done / total * 100 : 100) + '%'; };
  show();
  const worker = async () => {
    while (queue.length && dl.running) {
      const id = queue.shift();
      try {
        const s = await getJSON(asset.song(id));
        for (const p of [asset.jacket(s.jacket), ...s.meta.map(m => asset.chart(m.filename)), asset.audio(s.filename)]) {
          const r = await fetch(BASE + p);
          if (!r.ok) throw new Error(r.status);
          await r.arrayBuffer();
        }
      } catch { fail++; }
      done++; show();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const stopped = !dl.running;
  dl.running = false;
  btn.textContent = t('dlAll'); bar.parentElement.hidden = true;
  await refreshOffline();
  if (fail) setStatus(t('off.failed', {n: fail}), true);
  else if (stopped) setStatus(t('off.stopped'));
};

// ---------- playing ----------
function showGame(on) {
  $('setup').hidden = on; cv.hidden = !on; $('btnPause').hidden = !on;
  if (on) closeMore();
  document.body.classList.toggle('playing', on);
  if (!on) { $('pause').hidden = $('result').hidden = $('toast').hidden = true; }
}
async function start() {
  if ($('btnStart').disabled) return;
  showGame(true);
  await startPlay();
}
$('btnStart').onclick = start;
$('btnPause').onclick = pause;
$('btnResume').onclick = resume;
$('btnRestart').onclick = restart;
$('btnExit').onclick = stopPlay;
$('btnAgain').onclick = restart;
$('btnBack').onclick = stopPlay;

hooks.exit = () => {
  if (D.drill) { S.rate = D.drill.prevRate; D.drill = null; renderCoach(); }
  showGame(false); renderHist(); drawTL();
};
hooks.pause = () => { $('pauseInfo').textContent = t('pauseInfo', {m: measAt(Math.max(0, G.pausedAt))}); $('pause').hidden = false; };
hooks.resume = () => { $('pause').hidden = true; $('result').hidden = true; };

let toastTimer = 0;
hooks.finish = (rec, looped) => {
  const step = D.drill && D.drill.kind !== 'demo' && looped ? ladder(rec) : '';
  if (!rec.auto && !rec.solo) {
    D.hist.unshift({...rec, dts: undefined, log: undefined});
    D.hist.length = Math.min(D.hist.length, 60);
    store.set(histKey(), D.hist);
  }
  const badge = rec.auto ? t('demoDone') : isAP(rec) ? 'ALL PERFECT' : isFC(rec) ? 'FULL COMBO' : [rec.b && `Bad ${rec.b}`, rec.m && `Miss ${rec.m}`].filter(Boolean).join(t('join'));
  const cls = rec.auto ? '' : isAP(rec) ? 'ap' : isFC(rec) ? 'fc' : '';
  if (looped) {
    // a quiet line in the HUD's own type, under the practice info, so it never sits over the lanes
    const t = $('toast'), a = K.info || {side: true, x: K.W - 70, y: 60, z: 1};
    t.replaceChildren(el('span', {className: 'big ' + cls, textContent: (rec.auto ? '' : `#${rec.n}  `) + badge}));
    if (!rec.auto) t.append(el('span', {textContent: `P ${rec.p}  G ${rec.gr}  Gd ${rec.gd}`}));
    if (step) t.append(el('span', {className: 'rate', textContent: step}));
    t.className = a.side ? 'side' : 'below';
    t.style.fontSize = Math.round(12 * a.z) + 'px';
    t.style.left = a.side ? '' : a.x + 'px';
    t.style.right = a.side ? K.W - a.x + 'px' : '';
    t.style.top = a.side ? a.y + 8 * a.z + 'px' : '';
    t.style.bottom = a.side ? '' : K.H - a.y + 20 * a.z + 'px';
    t.hidden = false;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
    return;
  }
  const b = $('resBadge'); b.className = cls;
  b.replaceChildren(badge, el('small', {textContent: rec.auto ? t('res.bars', {a: D.secA, b: D.secB}) : t('res.run', {n: rec.n, a: D.secA, b: D.secB})}));
  $('resCounts').replaceChildren(...[['perfect', rec.p], ['great', rec.gr], ['good', rec.gd], ['bad', rec.b], ['miss', rec.m]].map(([k, v]) =>
    el('div', {}, el('span', {className: 'j' + k, textContent: JUDGE[k].label}), el('b', {textContent: v}))));
  $('resMeta').replaceChildren(el('span', {}, t('maxCombo'), el('b', {textContent: `${rec.max} / ${rec.total}`})), ...(rec.avg == null ? [] : [el('span', {textContent: fmtAvg(rec.avg)})]));
  // consistently early/late: offer to fold the average into the offset (taps late → raise it)
  const fix = rec.avg == null || rec.dts.length < 8 ? 0 : Math.round(rec.avg / 5) * 5;
  if (Math.abs(fix) >= 10) {
    const to = Math.max(-150, Math.min(300, S.offset + fix));
    const btn = el('button', {className: 'btn sm', textContent: t('offset.set', {v: `${to > 0 ? '+' : ''}${to} ms`})});
    btn.onclick = () => { setSlider.offset(to); btn.replaceWith(el('span', {textContent: t('offset.done', {v: `${to > 0 ? '+' : ''}${to} ms`})})); };
    $('resMeta').append(btn);
  }
  renderMisses(rec.log);
  const dist = $('resDist').parentElement;
  dist.hidden = !rec.dts.length;
  $('result').hidden = false;
  if (rec.dts.length) drawDist(rec.dts);
};

// non-Perfect notes of the attempt, from its judgement log
// a note's role (single, head, end, conn, hold, guide) and kind (tap, flick, trace) as the player calls it
const noteName = (role, kind) => role === 'single' ? (['tap', 'flick', 'trace'].includes(kind) ? t('note.' + kind) : '') : ['head', 'end', 'conn', 'hold', 'guide'].includes(role) ? t('note.' + role) : '';
const why = via => ['timeout', 'release', 'tap', 'key', 'flick', 'keyup'].includes(via) ? t('via.' + via) : '';
function renderMisses(L) {
  const box = $('resMiss'), bad = (L?.ev || []).filter(e => e.e === 'j' && e.res !== 'perfect');
  box.hidden = !bad.length;
  if (!bad.length) return;
  box.querySelector('summary').textContent = t('miss.summary', {n: bad.length});
  box.querySelector('ol').replaceChildren(...bad.map(e => {
    const name = noteName(e.ro, e.k) || e.k + ' ' + e.ro;
    const dt = e.dt == null ? '' : `${e.dt > 0 ? '+' : ''}${e.dt} ms`;
    return el('li', {}, el('b', {textContent: JUDGE[e.res].label, style: `color:${JUDGE[e.res].b}`}),
      el('span', {textContent: t('miss.row', {m: e.m, name, l: e.l, r: e.r, via: why(e.via)})}), el('span', {textContent: dt}));
  }));
}

function drawDist(dts) {
  const c = $('resDist'), dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const lim = WIN.bad * 1000, bw = 8, nb = Math.ceil(lim * 2 / bw), cnt = new Array(nb).fill(0);
  for (const d of dts) cnt[Math.max(0, Math.min(nb - 1, Math.floor((d + lim) / bw)))]++;
  const mx = Math.max(1, ...cnt), colW = w / nb;
  for (let i = 0; i < nb; i++) {
    const mid = Math.abs(-lim + (i + .5) * bw) / 1000;
    const k = mid <= WIN.perfect ? 'perfect' : mid <= WIN.great ? 'great' : mid <= WIN.good ? 'good' : 'bad';
    g.fillStyle = JUDGE[k].b; g.globalAlpha = cnt[i] ? 1 : .18;
    const hh = cnt[i] ? Math.max(3, cnt[i] / mx * (h - 4)) : 2;
    g.fillRect(i * colW + 1, h - hh, colW - 2, hh);
  }
  g.globalAlpha = 1; g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(w / 2 - .5, 0, 1, h);
}

addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName) && !['range', 'checkbox'].includes(document.activeElement.type);
  if (!$('result').hidden) {
    if (e.code === 'Enter' || e.code === 'KeyR' || e.code === 'Space') { e.preventDefault(); restart(); }
    else if (e.code === 'Escape') { e.preventDefault(); stopPlay(); }
    return;
  }
  if (!$('more').hidden) { if (e.code === 'Escape') { e.preventDefault(); closeMore(); } return; }
  if (!G.on && !$('setup').hidden && e.code === 'Space' && !typing && !$('btnStart').disabled) { e.preventDefault(); start(); }
});

// test hooks
Object.assign(window.__bdon, {selectSong, setSection, start, noteViewTime, drill});

loadSongs();
