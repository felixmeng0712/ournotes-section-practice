// Gameplay: attempts, judgement, pointer/keyboard input, hold logic, pause/resume.
import {S, D, G, ROUTE, PTR, WIN, CRIT_WIN, TRACE_WIN, FLICK_WIN, RELEASE_EARLY, STAMP_SLACK, INPUT_LAG, FLICK_PX, TOUCH_PAD, HOLD_PAD, KEYS, lowerBound} from './state.js';
import {evalPath} from './chart.js';
import {ac, musicGain, sfx, holdSe, ctxTimeAt, keepAlive, audioStalled, resetStall} from './audio.js';
import {K, laneX, render, hitEffect, laneEffect, laneMiss, resize, clear, measAt} from './render.js';
import {handOf} from './coach.js';

// UI callbacks, set by ui.js
export const hooks = {finish() {}, exit() {}, pause() {}, resume() {}};

export const songAt = perf => (ctxTimeAt(perf) - G.startCtx) * G.rate + G.songStart - S.offset / 1000 * G.rate;
const grade = dtReal => { const a = Math.abs(dtReal); return a <= WIN.perfect ? 'perfect' : a <= WIN.great ? 'great' : a <= WIN.good ? 'good' : a <= WIN.bad ? 'bad' : a <= WIN.miss ? 'miss' : null; };
const gradeFlick = d => { const F = FLICK_WIN; return d < -F.early ? null : d <= F.perfect ? 'perfect' : d <= F.great ? 'great' : d <= F.good ? 'good' : d <= F.bad ? 'bad' : d <= F.miss ? 'miss' : null; };
const gradeCrit = dtReal => { const a = Math.abs(dtReal); return a <= CRIT_WIN.perfect ? 'perfect' : dtReal > 0 && a <= CRIT_WIN.miss ? 'miss' : null; };
const gradeFor = (it, dtReal) => it.kind === 'flick' ? gradeFlick(dtReal) : it.crit ? gradeCrit(dtReal) : grade(dtReal);
// event time in the performance.now() domain, guarding against stale iOS timestamps (see STAMP_SLACK)
const stamp = ts => { const now = performance.now(); return Math.min(now, Math.max(ts, now - STAMP_SLACK * 1000)) + INPUT_LAG * 1000 - S.tin; };
const rangeAt = (it, t) => it.long ? evalPath(it.long.path, t) : [it.l, it.r];
const overlap = (p, l, r, pad) => p.x + p.half + pad >= l && p.x - p.half - pad <= r;
function pointerOver(l, r, pad) { for (const p of PTR.values()) if (overlap(p, l, r, pad)) return p; return null; }
// Notes the game plays by itself: everything in a demo; in a one-hand drill (G.solo = 'L' | 'R'), the other hand's.
const isAuto = it => G.auto || (G.solo && handOf(it) !== G.solo);
const measEnd = m => m < D.chart.mSec.length ? D.chart.mSec[m] : D.chart.end;   // end time of 1-based measure m

function stopSrc() { holdSe(false); if (G.src) { try { G.src.stop(); } catch {} G.src.disconnect(); G.src = null; } }

// play the song from song-time `from` (may be negative = silence first)
function playFrom(from) {
  stopSrc();
  const src = ac.createBufferSource();
  src.buffer = D.buffer; src.playbackRate.value = G.rate; src.connect(musicGain);
  const t0 = ac.currentTime + .1;
  if (from >= 0) src.start(t0, from); else src.start(t0 - from / G.rate, 0);
  G.src = src; G.startCtx = t0; G.songStart = from; G.checkClock = true; resetStall();
}

export function startAttempt() {
  const C = D.chart;
  G.rate = S.rate;
  G.A = C.mSec[D.secA - 1]; G.B = measEnd(D.secB);
  const inSec = t => t >= G.A - 1e-4 && t < G.B - 1e-4;
  for (const L of C.longs) { L.hold = null; L.inSec = inSec(L.head); }
  let last = G.B, total = 0;
  for (const it of C.items) {
    it.inSec = it.long ? it.long.inSec : inSec(it.t);
    it.res = null; it.dt = null; it.touched = false; it.claimed = false;
    if (it.inSec) { if (!it.free && (!G.solo || !isAuto(it))) total++; if (it.t > last) last = it.t; }
  }
  for (const L of C.longs) if (L.inSec && L.end > last) last = L.end;
  G.total = total;
  G.endT = last + .6 * G.rate;
  G.stats = {perfect: 0, great: 0, good: 0, bad: 0, miss: 0, combo: 0, maxCombo: 0, dts: []};
  G.attempt++;
  G.jt = null; G.effects = []; G.paused = false;
  G.jlog = G.auto ? null : newLog();
  G.fs = {last: 0, gap: [], work: []};
  PTR.forEach(p => { p.hist = []; p.claim = null; });
  playFrom(G.A - S.pre * G.rate);
}

// Diagnostics: one line per notable event, printed by the iOS debug build and visible in any browser console.
export const log = (...a) => console.log('[bdon]', ...a);

// Judgement log of the current attempt: every judged note and every touch event, saved as one file per attempt
// (api/log: data/logs on the Mac, Application Support/logs in the iOS app) for looking into judgement problems.
const ms = x => Math.round(x * 1000);
const fingers = () => [...PTR.values()].map(p => [p.id, +p.x.toFixed(2)]);
function jl(e, now, o) { if (G.jlog && !G.auto) G.jlog.ev.push({e, t: ms(now), ...o}); }
function newLog() {
  return {song: D.song?.id, title: D.song?.title, diff: D.diff, secA: D.secA, secB: D.secB, attempt: G.attempt, rate: G.rate,
    offset: S.offset, tin: S.tin, out: S.out, route: ROUTE.kind ? ROUTE : undefined, speed: S.speed, solo: G.solo, keys: S.keys, screen: [innerWidth, innerHeight], unit: +K.unit.toFixed(2),
    ua: navigator.userAgent, at: new Date().toISOString(), ev: []};
}
function saveLog(L) {
  if (!L || !L.ev.length) return;
  fetch('api/log', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(L)})
    .catch(e => log('log save failed', e.message));
}

// iOS suspends ("interrupts") the page's audio when the app is backgrounded, a call/Siri/Control Center comes up,
// or another app takes the audio. The song clock is the audio clock, so it freezes too. resume() must be called
// from a tap to work, so: wake it on every start/resume/restart tap, and pause the game whenever it stops.
async function wakeAudio() {
  const stalled = audioStalled();
  if (ac.state === 'running' && !stalled) { keepAlive(); return true; }
  log('audio', ac.state, stalled ? 'stalled' : '', '→ resume');
  const timeout = new Promise(r => setTimeout(r, 1500));
  if (stalled) await Promise.race([ac.suspend().catch(() => {}), timeout]);
  await Promise.race([ac.resume().catch(e => log('resume failed', e)), timeout]);
  log('audio now', ac.state);
  keepAlive();
  return ac.state === 'running';
}
ac.onstatechange = () => { log('audio state', ac.state); if (ac.state !== 'running' && G.on && !G.paused) pause('audio ' + ac.state); };

// opts: {auto, solo: 'L' | 'R', loop} for drills; otherwise the toggles on the song screen decide
export async function startPlay(opts = {}) {
  G.auto = opts.auto ?? S.auto; G.solo = opts.solo || null; G.loop = opts.loop ?? S.loop; G.hands = opts.hands ?? S.hands; G.drill = opts.label || '';
  await wakeAudio();
  resize();
  G.attempt = D.hist.length;
  startAttempt();
  G.on = true;
  try { G.wake = await navigator.wakeLock?.request('screen'); } catch {}
}

export function stopPlay() {
  G.on = false; G.paused = false; stopSrc(); PTR.clear(); clear();
  try { G.wake?.release(); } catch {} G.wake = null;
  hooks.exit();
}

export function pause(why = 'button') {
  if (!G.on || G.paused) return;
  log('pause:', typeof why === 'string' ? why : why?.type || 'button');
  G.pausedAt = songAt(performance.now());
  G.paused = true; stopSrc(); PTR.clear();
  hooks.pause();
}

// resume with a short lead-in before the paused moment; anything already judged stays judged
export async function resume() {
  if (!G.paused) return;
  if (!await wakeAudio()) { hooks.pause(); return; }   // still no audio: stay paused, the next tap tries again
  G.paused = false;
  playFrom(Math.max(G.A - S.pre * G.rate, G.pausedAt - 1.5 * G.rate));
  hooks.resume();
}

export async function restart() {
  log('restart');
  stopSrc();
  const ok = await wakeAudio();
  G.on = true; startAttempt();
  if (!ok) { stopSrc(); G.paused = true; G.pausedAt = G.A - S.pre * G.rate; hooks.pause(); return; }
  hooks.resume();
}

function finishAttempt() {
  const s = G.stats;
  const avg = s.dts.length ? s.dts.reduce((a, b) => a + b, 0) / s.dts.length * 1000 : null;
  const rec = {n: G.attempt, p: s.perfect, gr: s.great, gd: s.good, b: s.bad, m: s.miss, max: s.maxCombo, total: G.total, avg,
    auto: G.auto, solo: G.solo, rate: G.rate, off: S.offset, out: S.out, dts: s.dts.map(x => Math.round(x * 1000)), at: Date.now(),
    // the notes that weren't Perfect, as [chart item index, result, ms off] (for the trouble spots across attempts)
    miss: D.chart.items.flatMap((it, i) => it.inSec && !it.free && it.res && it.res !== 'perfect' && !(G.solo && isAuto(it)) ? [[i, it.res, it.dt]] : [])};
  if (G.jlog) { G.jlog.result = {...rec, dts: undefined}; G.jlog.frames = frameStats(); saveLog(G.jlog); rec.log = G.jlog; }
  if (G.loop) { hooks.finish(rec, true); startAttempt(); }
  else { G.on = false; stopSrc(); PTR.clear(); hooks.finish(rec, false); }
}

// via: what judged it — tap, key, flick, keyup, release (finger left a long's end), held (end reached while holding),
// touch (presence notes), timeout (nothing came in time), auto
// ms: median and 95th percentile of the frame gaps and draw times, and how many frames came late (gap over 25 ms)
function frameStats() {
  const f = G.fs; if (!f || !f.gap.length) return null;
  const q = (a, k) => { const b = [...a].sort((x, y) => x - y); return +b[Math.min(b.length - 1, Math.floor(b.length * k))].toFixed(1); };
  return {n: f.gap.length, gap50: q(f.gap, .5), gap95: q(f.gap, .95), late: f.gap.filter(x => x > 25).length,
    draw50: q(f.work, .5), draw95: q(f.work, .95), dpr: devicePixelRatio, w: innerWidth, h: innerHeight};
}

function judge(it, res, dt, via) {
  it.res = res;
  if (it.free) return;   // not a note of the combo
  if (G.solo && isAuto(it)) return played(it);   // the drill's other hand: not scored
  const now = dt != null ? it.t + dt : songAt(performance.now());
  jl('j', now, {i: D.chart.items.indexOf(it), nt: ms(it.t), m: measAt(it.t), k: it.kind, ro: it.role, l: it.l, r: it.r, dir: it.dir,
    res, dt: dt == null ? null : ms(dt / G.rate), via, f: fingers(), hold: it.long ? it.long.hold : undefined});
  it.dt = dt == null ? null : ms(dt / G.rate);
  const s = G.stats;
  s[res]++;
  if (res === 'miss' || res === 'bad') {
    s.combo = 0;
    log(res, it.kind, it.role, 'dt', dt == null ? '-' : Math.round(dt / G.rate * 1000), 'note', it.l + '–' + it.r,
      'fingers', [...PTR.values()].map(p => p.x.toFixed(1)).join(' ') || '-', 'held', it.long ? it.long.hold : '-');
  }
  else { s.combo++; s.maxCombo = Math.max(s.maxCombo, s.combo); G.comboPerf = performance.now(); }
  if (it.role === 'hold' || it.role === 'conn') { if (res !== 'miss') played(it, res, false); return; }
  const dtReal = dt == null ? null : dt / G.rate;
  if (dtReal != null && (it.kind === 'tap' || it.kind === 'flick')) s.dts.push(dtReal);
  G.jt = {res, perf: performance.now(), fs: (res === 'great' || res === 'good' || res === 'bad') && dtReal != null ? (dtReal < 0 ? 'FAST' : 'SLOW') : ''};
  if (res === 'miss') return;
  played(it, res);
}
// the game's effect per note (FxEffectTypes.note): taps Normal, long heads and ends Slide, relay nodes and trace notes
// SlideLoopConnect, flicks Flick; hold ticks have none (the hold loop runs over a held long)
function played(it, res = 'perfect', sound = true) {
  const [l, r] = rangeAt(it, it.t);
  const type = it.kind === 'flick' ? 'flick' : it.role === 'hold' ? null : it.kind === 'trace' || it.role === 'conn' ? 'connect'
    : it.long ? 'slide' : 'normal';
  if (type) hitEffect(l, r, type, res);
  // the lane flash (LiveLaneEffectView): Good..Perfect taps, long heads / ends and flicks; relays, traces and ticks none
  if (res !== 'bad' && type && type !== 'connect')
    laneEffect(l, r, type !== 'flick' ? type : it.dir === 'left' ? 'flick_left' : it.dir === 'right' ? 'flick_right' : 'flick');
  // the game's note sound (LiveSoundPlayer.GetTapSeType): none for Bad; taps, heads and ends by grade
  if (!sound || it.role === 'hold' || it.role === 'conn' || res === 'bad') return;
  sfx(it.kind === 'flick' ? (it.dir === 'left' || it.dir === 'right' ? 'flick_side' : 'flick') : it.kind === 'trace' ? 'trace' : res);
}

// earliest judgeable item matching predicate
function findItem(now, pred) {
  const items = D.chart.items, bad = WIN.miss * G.rate;
  for (let i = lowerBound(items, now - bad); i < items.length && items[i].t <= now + bad; i++) {
    const it = items[i];
    if (it.inSec && !it.res && !isAuto(it) && pred(it)) return it;
  }
  return null;
}

function findNear(now, p) {
  const items = D.chart.items;
  for (let i = lowerBound(items, now - .4); i < items.length && items[i].t <= now + .4; i++) {
    const it = items[i];
    if (it.inSec && !it.res && (it.role === 'single' || it.role === 'head') && it.kind !== 'trace')
      return `${it.kind} ${it.role} ${it.l}–${it.r} dt ${Math.round((now - it.t) / G.rate * 1000)}`;
  }
  return null;
}

const playing = () => G.on && !G.paused && !G.auto;

function pDown(p, perf) {
  if (!playing()) return;
  const now = songAt(perf);
  // a long's end / relay flick belongs to the finger already holding it: only a swipe (or key release) judges it
  const it = findItem(now, it => (it.kind === 'tap' || it.kind === 'flick') && (it.role === 'single' || it.role === 'head') && !it.claimed && overlap(p, it.l, it.r, p.kb ? 0 : TOUCH_PAD)
    && (it.kind !== 'flick' || !p.kb || gradeFlick((now - it.t) / G.rate) != null) && (it.kind !== 'tap' || gradeFor(it, (now - it.t) / G.rate) != null));
  if (!it) {   // the lane's InVain flash; diagnostics: the nearest tap target, if one was close
    laneMiss(p.x); sfx('in_vain');
    const near = findNear(now, p);
    if (near) log('empty tap at', p.x.toFixed(1), near);
    jl('empty', now, {id: p.id, x: +p.x.toFixed(2), near});
    return;
  }
  // a touch landing on a flick claims it; the swipe judges it
  if (it.kind === 'flick' && !p.kb) { it.claimed = true; p.claim = it; jl('claim', now, {id: p.id, i: D.chart.items.indexOf(it)}); return; }
  const dt = now - it.t;
  judge(it, gradeFor(it, dt / G.rate), dt, p.kb ? 'key' : 'tap');
  if (it.role === 'head') it.long.hold = p.id;
}

function pFlick(p, perf, dx, dy, u0) {
  if (!playing()) return;
  const now = songAt(perf), d = Math.hypot(dx, dy);
  p.swipe = {t: now, dx};
  const probe = {x: u0, half: p.half};
  const dirOk = it => it.dir === 'left' ? dx < -.35 * d : it.dir === 'right' ? dx > .35 * d : true;
  const inWin = it => gradeFlick((now - it.t) / G.rate) != null;
  let it = p.claim && !p.claim.res && inWin(p.claim) && dirOk(p.claim) ? p.claim : null;
  it = it || findItem(now, it => it.kind === 'flick' && (!it.claimed || it === p.claim) && inWin(it) && overlap(probe, it.l, it.r, p.kb ? 0 : TOUCH_PAD) && dirOk(it));
  if (!it && p.claim && !p.claim.res && (now - p.claim.t) / G.rate < -FLICK_WIN.early) {   // too early: keep the claim for the next swipe
    jl('flick', now, {id: p.id, x0: +u0.toFixed(2), dx: Math.round(dx), dy: Math.round(dy), hit: -1, early: true});
    return;
  }
  p.claim = null;
  jl('flick', now, {id: p.id, x0: +u0.toFixed(2), dx: Math.round(dx), dy: Math.round(dy), hit: it ? D.chart.items.indexOf(it) : -1});
  if (!it) return;
  const dt = now - it.t;
  judge(it, gradeFlick(dt / G.rate), dt, 'flick');
  if (it.role === 'head') it.long.hold = p.id;
}

function pUp(p, perf) {
  PTR.delete(p.id);
  if (!playing()) return;
  const now = songAt(perf);
  jl('up', now, {id: p.id, x: +p.x.toFixed(2)});
  // lifted while still swiping: the swipe's flick (claimed, or ending the long it holds) counts now, if its earlier
  // motion came before the flick window opened
  if (p.swipe && now - p.swipe.t <= .1 * G.rate) {
    const ok = it => it && !it.res && it.inSec && it.kind === 'flick' && gradeFlick((now - it.t) / G.rate) != null
      && (it.dir === 'left' ? p.swipe.dx < 0 : it.dir === 'right' ? p.swipe.dx > 0 : true);
    const L = D.chart.longs.find(L => L.hold === p.id), it = ok(p.claim) ? p.claim : L && ok(L.endItem) ? L.endItem : null;
    if (it) { jl('liftflick', now, {id: p.id, i: D.chart.items.indexOf(it)}); judge(it, gradeFlick((now - it.t) / G.rate), now - it.t, 'flick'); }
  }
  for (const L of D.chart.longs) {
    if (L.hold !== p.id) continue;
    L.hold = null;
    leaveEnd(L, now);
    const E = L.endItem;
    if (E && !E.res && L.inSec && E.kind === 'flick' && p.kb && gradeFlick((now - E.t) / G.rate)) judge(E, gradeFlick((now - E.t) / G.rate), now - E.t, 'keyup');
  }
}

// A long's end the finger is leaving: like releasing it there (a slide off toward the next note shouldn't drop it).
function leaveEnd(L, now) {
  const E = L.endItem;
  if (!E || E.res || !L.inSec || E.kind !== 'end') return;
  const dt = now - E.t;
  if (dt >= -RELEASE_EARLY * G.rate) judge(E, 'perfect', dt, 'release');
}

function update(now) {
  const C = D.chart, r = G.rate, good = WIN.good * r, bad = WIN.bad * r;
  if (G.auto || G.solo) {
    for (let i = lowerBound(C.items, now - 1); i < C.items.length && C.items[i].t <= now; i++) {
      const it = C.items[i];
      if (!it.inSec || it.res || !isAuto(it)) continue;
      judge(it, 'perfect', null, 'auto');
    }
    for (const L of C.longs) if (!L.guide && (G.auto || L.hand !== G.solo)) L.hold = L.inSec && now >= L.head && now < L.end ? 'auto' : null;
  }
  if (!G.auto) {
    // keep / lose / re-grab holds. A long whose start was merged into the previous long's end (or is hidden) has no head
    // to tap: it can be grabbed as soon as it starts.
    for (const L of C.longs) {
      if (!L.inSec || L.guide || now > L.end + good || (G.solo && L.hand !== G.solo)) continue;
      if (L.headItem ? !L.headItem.res : now < L.head) continue;
      const [l, rr] = evalPath(L.path, Math.min(now, L.end));
      if (L.hold != null) {
        const p = PTR.get(L.hold);
        if (!p || !overlap(p, l, rr, HOLD_PAD)) {
          jl('drop', now, {L: C.longs.indexOf(L), id: L.hold, x: p ? +p.x.toFixed(2) : null, at: [+l.toFixed(2), +rr.toFixed(2)], end: ms(L.end)});
          L.hold = null; if (p) leaveEnd(L, now);
        }
      }
      if (L.hold == null && now < L.end) { const p = pointerOver(l, rr, TOUCH_PAD); if (p) { L.hold = p.id; jl('grab', now, {L: C.longs.indexOf(L), id: p.id, x: +p.x.toFixed(2), at: [+l.toFixed(2), +rr.toFixed(2)]}); } }
    }
    for (let i = lowerBound(C.items, now - 1); i < C.items.length && C.items[i].t <= now + good; i++) {
      const it = C.items[i];
      if (!it.inSec || it.res || isAuto(it)) continue;
      const late = now - it.t;
      if ((it.kind === 'tap' || it.kind === 'flick') && it.role !== 'conn') {
        if (late > WIN.miss * r) judge(it, 'miss', null, 'timeout');
        continue;
      }
      if (it.kind === 'end') {
        if (late >= 0 && it.long.hold != null) judge(it, 'perfect', null, 'held');
        else if (late > good) judge(it, 'miss', null, 'timeout');
        continue;
      }
      // trace notes, hold ticks, relay nodes, guide nodes: presence-based
      let present;
      if (it.role === 'hold') present = late >= 0 && it.long.hold != null;
      else {
        const [l, rr] = rangeAt(it, now);
        present = !!pointerOver(l, rr, TOUCH_PAD) || ((it.role === 'end' || it.role === 'conn') && it.long.hold != null);
      }
      if (present && Math.abs(late) <= TRACE_WIN.perfect * r) it.touched = true;
      if (it.touched && late >= 0) {
        judge(it, 'perfect', null, 'touch');
        if (it.role === 'head') { const [l, rr] = rangeAt(it, now); const p = pointerOver(l, rr, TOUCH_PAD); if (p) it.long.hold = p.id; }
      } else if (late > TRACE_WIN.miss * r) judge(it, 'miss', null, 'timeout');
    }
  }
  holdSe(C.longs.some(L => !L.guide && L.hold != null && now >= L.head && now < L.end));
  if (now > G.endT) finishAttempt();
}

// ---------- input ----------
function ptrDown(e) {
  if (!G.on || G.paused) return;
  e.preventDefault();
  const ts = stamp(e.timeStamp);
  const p = {id: e.pointerId, x: laneX(e.clientX), half: 0, kb: false, hist: [{x: e.clientX, y: e.clientY, t: ts}]};
  PTR.set(p.id, p);
  if (playing()) jl('down', songAt(ts), {id: p.id, x: +p.x.toFixed(2), lag: Math.round(performance.now() - e.timeStamp)});
  pDown(p, ts);
}
function ptrMove(e) {
  const p = PTR.get(e.pointerId); if (!p) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  const held = G.on && D.chart.longs.find(L => L.hold === p.id);
  const pathX = t => { const [l, r] = evalPath(held.path, Math.min(songAt(t), held.end)); return (l + r) / 2 * K.unit; };
  for (const ev of (evs.length ? evs : [e])) {
    const ts = stamp(ev.timeStamp);
    p.x = laneX(ev.clientX);
    p.hist.push({x: ev.clientX, y: ev.clientY, t: ts});
    while (p.hist.length > 1 && ts - p.hist[0].t > 90) p.hist.shift();
    const h0 = p.hist[0], dy = ev.clientY - h0.y;
    // while following a slide, only motion beyond the slide's own movement counts as a flick
    const dx = ev.clientX - h0.x - (held ? pathX(ts) - pathX(h0.t) : 0);
    if (Math.hypot(dx, dy) >= FLICK_PX) {
      pFlick(p, ts, dx, dy, laneX(h0.x));
      p.hist = [{x: ev.clientX, y: ev.clientY, t: ts}];
    }
  }
}
function ptrUp(e) { const p = PTR.get(e.pointerId); if (p) pUp(p, stamp(e.timeStamp)); }

export function initGame(cv) {
  cv.addEventListener('pointerdown', ptrDown);
  cv.addEventListener('pointermove', ptrMove);
  cv.addEventListener('pointerup', ptrUp);
  cv.addEventListener('pointercancel', e => { log('pointercancel', e.pointerId); ptrUp(e); });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  // iOS: a finger resting on the canvas (a hold) would otherwise start text selection (the loupe) or another
  // system gesture, which cancels the touch and drops the hold
  for (const t of ['touchstart', 'touchmove', 'touchend']) cv.addEventListener(t, e => e.preventDefault(), {passive: false});

  addEventListener('keydown', e => {
    if (!G.on) return;
    if (e.code === 'Space' || e.code === 'Escape') { e.preventDefault(); if (!e.repeat) G.paused ? resume() : pause(); return; }
    if (e.code === 'KeyR') { e.preventDefault(); restart(); return; }
    if (G.paused) return;
    const k = KEYS.indexOf(e.code);
    if (k < 0 || e.repeat) return;
    e.preventDefault();
    const p = {id: 'k' + k, x: k * 3 + 1.5, half: 1.5, kb: true};
    PTR.set(p.id, p);
    pDown(p, e.timeStamp);
  });
  addEventListener('keyup', e => {
    const k = KEYS.indexOf(e.code);
    const p = k >= 0 && PTR.get('k' + k);
    if (p) pUp(p, e.timeStamp);
  });
  addEventListener('blur', () => pause('window blur'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause('hidden'); });

  (function frame() {
    requestAnimationFrame(frame);
    if (!G.on || !D.chart) return;
    if (G.paused) { render(G.pausedAt); return; }
    if (ac.state !== 'running') { pause('audio ' + ac.state); return; }   // in case no statechange event came
    if (audioStalled()) { pause('audio stalled'); return; }
    const now = songAt(performance.now());
    if (G.checkClock) { G.checkClock = false; if (Math.abs(now - G.songStart) > .6) log('clock jumped: at', now.toFixed(2), 'expected', G.songStart.toFixed(2), 'ctx', ac.currentTime.toFixed(2), G.startCtx.toFixed(2)); }
    update(now);
    const t0 = performance.now();
    if (G.on) render(now);
    const f = G.fs;   // frame timing for the judgement log: time between frames, and how long drawing took
    if (f && f.gap.length < 20000) { if (f.last) f.gap.push(t0 - f.last); f.work.push(performance.now() - t0); f.last = t0; }
  })();

  // test hooks (used by the automated bots)
  window.__bdon = {S, D, G, K, PTR, ptrDown, ptrMove, ptrUp, songAt, evalPath, KEYS};
}
