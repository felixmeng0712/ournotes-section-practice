// Training aid: which hand should play each note, where a chart's hard passages are, and what makes them hard.
// The hand plan is a beam search over the notes with a cost for fast same-hand repeats, fast travel and crossed
// hands, assuming two thumbs (one finger per hand); a hand holding a long is busy until it ends.
import {evalPath} from './chart.js';
import {t} from './i18n.js';

const center = (l, r) => (l + r) / 2;

// Longs whose start was merged into another long's end continue it without a new touch: one chain, one hand.
function buildChains(C) {
  const prev = new Map();
  for (const L of C.longs) {
    if (L.guide || L.headItem) continue;
    const n0 = L.nodes[0];
    const P = C.longs.find(P => P !== L && !P.guide && Math.abs(P.end - L.head) < 1e-4 &&
      Math.abs(P.nodes[P.nodes.length - 1].l - n0.l) < 1e-3 && Math.abs(P.nodes[P.nodes.length - 1].r - n0.r) < 1e-3);
    if (P) prev.set(L, P);
  }
  const next = new Map([...prev].map(([L, P]) => [P, L]));
  const chains = [];
  for (const L of C.longs) {
    if (L.guide || prev.has(L)) continue;
    const ch = [L];
    while (next.has(ch[ch.length - 1])) ch.push(next.get(ch[ch.length - 1]));
    chains.push(ch);
  }
  return chains;
}
const chainEnd = ch => ch[ch.length - 1].end;
function chainPos(ch, t) {
  for (const L of ch) if (t <= L.end) return center(...evalPath(L.path, Math.max(t, L.head)));
  const Z = ch[ch.length - 1];
  return center(...evalPath(Z.path, Z.end));
}

// hand state: x = position after its last action, t = time of its last tap, busy = when the long it holds ends
const handAt = (h, t) => h.ch && t <= h.busy ? chainPos(h.ch, t) : h.x;

function handCost(h, side, x, t, kind) {
  if (h.ch && h.busy > t + .03) return null;   // still holding a long
  const fromHold = h.ch && h.busy >= h.t;      // lifting off a long's end and pressing again is one quick motion
  const dt = fromHold ? t - h.busy + .12 : t - h.t;
  const dist = Math.abs(x - h.x), speed = dist / Math.max(dt, .04);
  let c = 4e-4 * speed * speed;
  if (dt < .2) c += (kind === 'trace' ? .3 : 1.5) * ((.2 - dt) / .1) ** 2;
  c += .04 * Math.max(0, side === 'L' ? x - 12 : 12 - x);
  return c;
}

export function planHands(C) {
  const chains = buildChains(C);
  const acts = [];
  for (const it of C.items) if (it.role === 'single') acts.push({t: it.t, l: it.l, r: it.r, x: center(it.l, it.r), kind: it.kind, item: it});
  for (const ch of chains) {
    const L = ch[0], [l, r] = evalPath(L.path, L.head);
    acts.push({t: L.head, l, r, x: center(l, r), kind: L.headItem?.kind || 'tap', ch});
  }
  acts.sort((a, b) => a.t - b.t || a.x - b.x);
  const groups = [];
  for (const a of acts) {
    const g = groups[groups.length - 1];
    if (g && a.t - g[0].t < .004) g.push(a); else groups.push([a]);
  }

  const idle = x => ({x, t: -9, busy: -9, ch: null});
  let beam = [{L: idle(6), R: idle(18), cost: 0, node: null}];
  for (const g of groups) {
    const t = g[0].t, k = g.length;
    const masks = [];
    if (k <= 3) for (let m = 0; m < 1 << k; m++) masks.push(g.map((_, i) => m >> i & 1 ? 'R' : 'L'));
    else for (let s = 0; s <= k; s++) masks.push(g.map((_, i) => i < s ? 'L' : 'R'));   // sorted by x: split left/right
    const out = new Map();
    for (const st of beam) {
      for (const mask of masks) {
        let step = 0, extra = false;
        const nh = {L: st.L, R: st.R};
        for (const side of ['L', 'R']) {
          const mine = g.filter((_, i) => mask[i] === side);
          if (!mine.length) continue;
          const xs = mine.map(a => a.x), x = xs.reduce((s, v) => s + v, 0) / xs.length, span = Math.max(...xs) - Math.min(...xs);
          const kind = mine.every(a => a.kind === 'trace') ? 'trace' : 'tap';
          const c = handCost(st[side], side, x, t, kind);
          if (c == null) { step += 6; extra = true; continue; }   // a third finger: the holding hand stays where it is
          step += c + (mine.length - 1) + (span > 8 ? 3 : 0);   // one thumb on two notes
          const ch = mine.find(a => a.ch)?.ch;
          nh[side] = ch ? {x: chainPos(ch, chainEnd(ch)), t, busy: chainEnd(ch), ch} : {x, t, busy: -9, ch: null};
        }
        // crossed hands (weighted by how recently each hand was used)
        const recent = h => h.ch && h.busy > t ? 1 : Math.exp(-(t - Math.max(h.t, h.busy)) / .5);
        const pl = handAt(nh.L, t), pr = handAt(nh.R, t);
        if (pl > pr + 1) step += .25 * (pl - pr - 1) * (recent(nh.L) + recent(nh.R)) / 2;
        const cost = st.cost + step;
        const key = `${Math.round(nh.L.x)}|${Math.round(nh.R.x)}|${nh.L.busy > t}|${nh.R.busy > t}|${nh.L.t > nh.R.t}`;
        const old = out.get(key);
        if (!old || old.cost > cost) out.set(key, {L: nh.L, R: nh.R, cost, node: {mask, step, extra, up: st.node}});
      }
    }
    beam = [...out.values()].sort((a, b) => a.cost - b.cost).slice(0, 48);
  }

  // walk back the best path
  const nodes = [];
  for (let n = beam[0].node; n; n = n.up) nodes.push(n);
  nodes.reverse();
  groups.forEach((g, gi) => {
    const n = nodes[gi];
    g.forEach((a, i) => {
      a.hand = n.mask[i]; a.chord = g.length; a.extra = n.extra;
      a.score = .35 + n.step / g.length;   // difficulty share of this note
      if (a.item) a.item.hand = a.hand;
      if (a.ch) for (const L of a.ch) L.hand = a.hand;
    });
  });
  return {acts, groups};
}

export const handOf = it => it.long ? it.long.hand : it.hand;

// ---------- hard passages ----------
const measOf = (C, t) => { let i = 0; while (i + 1 < C.mSec.length && C.mSec[i + 1] <= t + 1e-6) i++; return i + 1; };
const measEnd = (C, m) => m < C.mSec.length ? C.mSec[m] : C.end;

export function hardSections(C, plan) {
  const M = C.mSec.length, sc = new Array(M).fill(0);
  for (const a of plan.acts) sc[measOf(C, a.t) - 1] += a.score;
  const per = sc.map((s, i) => s / Math.max(.3, measEnd(C, i + 1) - C.mSec[i]));
  const peak = Math.max(...per), used = new Array(M).fill(false), out = [];
  while (out.length < 4) {
    let seed = -1;
    for (let i = 0; i < M; i++) if (!used[i] && (seed < 0 || per[i] > per[seed])) seed = i;
    if (seed < 0 || per[seed] < .45 * peak) break;
    let a = seed, b = seed;
    const ok = i => i >= 0 && i < M && !used[i] && per[i] >= .6 * per[seed];
    const free = i => i >= 0 && i < M && !used[i];
    while (b - a < 7) {   // grow toward the harder side: at least 4 measures, up to 8 while it stays hard
      const L = (b - a < 3 ? free : ok)(a - 1) ? per[a - 1] : -1, R = (b - a < 3 ? free : ok)(b + 1) ? per[b + 1] : -1;
      if (L < 0 && R < 0) break;
      if (R >= L) b++; else a--;
    }
    for (let i = a; i <= b; i++) used[i] = true;
    const t0 = C.mSec[a], t1 = measEnd(C, b + 1);
    const notes = plan.acts.filter(x => x.t >= t0 && x.t < t1).length;
    out.push({a: a + 1, b: b + 1, level: per.slice(a, b + 1).reduce((s, v) => s + v, 0) / (b - a + 1) / peak, nps: notes / (t1 - t0),
      where: a + 1 <= Math.max(2, M * .12) ? 'start' : b + 1 >= M * .88 ? 'end' : 'mid'});
  }
  return out.sort((x, y) => x.a - y.a);
}

// ---------- what is in a passage ----------
const DIV = [[2, 8], [3, 3], [4, 16], [6, 6], [8, 32]];   // notes per beat → subdivision key (div.<key> names it)
function division(C, t, gap) {
  const beat = 60 / C.bpmAt(t), q = beat / gap;
  const best = DIV.reduce((a, b) => Math.abs(Math.log(b[0] / q)) < Math.abs(Math.log(a[0] / q)) ? b : a);
  return Math.abs(Math.log(best[0] / q)) < .08 ? best[1] : null;
}
const seqText = gs => gs.map(g => t(g.length > 1 ? 'hand1.both' : 'hand1.' + g[0].hand)).join(t('seq.join'));

export function analyze(C, plan, a, b) {
  const t0 = C.mSec[a - 1], t1 = measEnd(C, b), m = t => measOf(C, t);
  const inSec = t => t >= t0 - 1e-4 && t < t1 - 1e-4;
  const groups = plan.groups.filter(g => inSec(g[0].t)), acts = groups.flat();
  const dur = t1 - t0, nps = acts.length / dur;
  const pats = [];
  const add = (id, weight, title, text, tip) => pats.push({id, weight, title, text, tip});
  if (!acts.length) return {notes: 0, nps: 0, pats};

  // fast runs
  const FAST = .17, runs = [];
  for (let i = 0, s = 0; i < groups.length; i++) {
    const gap = i + 1 < groups.length ? groups[i + 1][0].t - groups[i][0].t : 9;
    if (gap > FAST) { if (i - s + 1 >= 6) runs.push(groups.slice(s, i + 1)); s = i + 1; }
  }
  if (runs.length) {
    const best = runs.reduce((x, y) => y.length > x.length ? y : x);
    const gaps = best.slice(1).map((g, i) => g[0].t - best[i][0].t);
    const fast = Math.min(...gaps), slow = Math.max(...gaps), div = division(C, best[0][0].t, fast);
    const range = slow - fast > .01 ? `${Math.round(fast * 1000)}–${Math.round(slow * 1000)} ms` : `${Math.round(fast * 1000)} ms`;
    const singles = best.filter(g => g.length === 1);
    let alt = 0;
    for (let i = 1; i < singles.length; i++) if (singles[i][0].hand !== singles[i - 1][0].hand) alt++;
    const seq = seqText(best.slice(0, 16)) + (best.length > 16 ? '…' : '');
    add('stream', 3 + best.length / 4, t('c.stream'),
      t('c.stream.text', {m: m(best[0][0].t), n: best.length, range, div: div && t('div.' + div), runs: runs.length, seq}),
      t('c.stream.tip') + (alt < singles.length - 1 ? ' ' + t('c.stream.tip2') : ''));
    const fl = best.flat().filter(x => x.kind === 'flick').length;
    if (fl) add('flickRun', 2, t('c.flickRun'), t('c.flickRun.text', {n: fl}), t('c.flickRun.tip'));
  }

  // chords moving together
  let crun = null;
  for (let i = 0, s = 0; i < groups.length; i++) {
    const g = groups[i], h = groups[i + 1];
    const cont = h && g.length >= 2 && h.length >= 2 && h[0].t - g[0].t <= .35;
    if (!cont) { if (g.length >= 2 && i - s + 1 >= 3 && (!crun || i - s + 1 > crun.n)) crun = {n: i - s + 1, t: groups[s][0].t}; s = i + 1; }
  }
  if (crun) add('chordRun', 2 + crun.n / 3, t('c.chordRun'), t('c.chordRun.text', {m: m(crun.t), n: crun.n}), t('c.chordRun.tip'));

  // a long on one side and a flick on the other, at once
  const hf = groups.filter(g => g.some(x => x.ch) && g.some(x => x.kind === 'flick'));
  if (hf.length) add('holdFlick', 2 + hf.length / 2, t('c.holdFlick'), t('c.holdFlick.text', {n: hf.length}), t('c.holdFlick.tip'));

  // chords
  const chords = groups.filter(g => g.length >= 2);
  if (chords.length) {
    const wide = chords.filter(g => g[g.length - 1].x - g[0].x >= 14);
    const lead = chords.filter((g, i) => { const j = groups.indexOf(g); return groups[j + 1] && groups[j + 1][0].t - g[0].t <= FAST; });
    add('chord', 1 + chords.length / 3 + wide.length / 3, t(wide.length >= chords.length / 2 ? 'c.chordWide' : 'c.chord'),
      t('c.chord.text', {n: chords.length, wide: wide.length, lead: lead.length}),
      t(wide.length ? 'c.chord.tipWide' : 'c.chord.tip') + (lead.length ? ' ' + t('c.chord.tipLead') : ''));
  }
  const triple = groups.filter(g => g.length >= 3);
  const extra = acts.filter(x => x.extra);
  if (triple.length || extra.length) add('fingers', 3, t('c.fingers'), t('c.fingers.text', {triple: triple.length, extra: extra.length}), t('c.fingers.tip'));

  // big moves by one hand
  const byHand = {L: [], R: []};
  for (const x of acts) if (!x.extra) byHand[x.hand].push(x);
  const jumps = [];
  for (const s of ['L', 'R']) for (let i = 1; i < byHand[s].length; i++) {
    const p = byHand[s][i - 1], q = byHand[s][i], from = p.ch ? chainPos(p.ch, chainEnd(p.ch)) : p.x;
    const dt = Math.max(.05, q.t - (p.ch ? chainEnd(p.ch) : p.t));
    if (Math.abs(q.x - from) >= 10 && dt <= .3) jumps.push({s, dist: Math.abs(q.x - from), dt, t: q.t});
  }
  if (jumps.length) {
    const w = jumps.reduce((x, y) => y.dist / y.dt > x.dist / x.dt ? y : x);
    add('jump', 1 + jumps.length / 2, t('c.jump'),
      t('c.jump.text', {n: jumps.length, m: m(w.t), hand: w.s, ms: Math.round(w.dt * 1000), dist: Math.round(w.dist)}), t('c.jump.tip'));
  }

  // jacks: the same place over and over
  let jack = null;
  for (let i = 0, s = 0; i < groups.length; i++) {
    const g = groups[i], h = groups[i + 1];
    const same = h && g.length === 1 && h.length === 1 && Math.abs(g[0].x - h[0].x) < 1.5 && h[0].t - g[0].t <= .2;
    if (!same) { if (i - s + 1 >= 3 && (!jack || i - s + 1 > jack.n)) jack = {n: i - s + 1, g: groups.slice(s, i + 1)}; s = i + 1; }
  }
  if (jack) {
    const ms = Math.round((jack.g[1][0].t - jack.g[0][0].t) * 1000);
    add('jack', 2 + jack.n / 3, t('c.jack'), t('c.jack.text', {m: m(jack.g[0][0].t), n: jack.n, ms, seq: seqText(jack.g)}), t('c.jack.tip'));
  }

  // a hand busy holding while the other plays
  const holds = acts.filter(x => x.ch);
  let busy = 0, busyMax = null, slides = 0;
  for (const h of holds) {
    const end = chainEnd(h.ch), other = acts.filter(x => x.hand !== h.hand && x.t > h.t + .01 && x.t < end - .01).length;
    if (other >= 2) { busy++; if (!busyMax || other > busyMax.n) busyMax = {n: other, h}; }
    let lo = 24, hi = 0;
    for (let t = h.t; t <= end; t += .05) { const x = chainPos(h.ch, t); lo = Math.min(lo, x); hi = Math.max(hi, x); }
    if (hi - lo >= 4) slides++;
  }
  if (busy) add('holdTap', 2 + busy, t('c.holdTap'), t('c.holdTap.text', {n: busy, m: m(busyMax.h.t), hand: busyMax.h.hand, k: busyMax.n}), t('c.holdTap.tip'));
  if (slides) add('slide', 1 + slides / 2, t('c.slide'), t('c.slide.text', {n: slides}), t('c.slide.tip'));

  const flickEnds = holds.filter(h => h.ch[h.ch.length - 1].endItem?.kind === 'flick').length;
  if (flickEnds) add('flickEnd', 1 + flickEnds / 2, t('c.flickEnd'), t('c.flickEnd.text', {n: flickEnds}), t('c.flickEnd.tip'));

  // one long ends exactly where (when) the next starts
  const relays = holds.filter(h => plan.acts.some(x => x.ch && x !== h && Math.abs(chainEnd(x.ch) - h.t) < .03));
  if (relays.length) add('relay', 2 + relays.length / 2, t('c.relay'), t('c.relay.text', {n: relays.length}), t('c.relay.tip'));

  // rhythm changes: triplets next to straight notes
  const divs = new Set();
  for (let i = 1; i < groups.length; i++) {
    const gap = groups[i][0].t - groups[i - 1][0].t;
    if (gap < .3) { const d = division(C, groups[i][0].t, gap); if (d) divs.add(d); }
  }
  if ((divs.has(3) || divs.has(6)) && (divs.has(16) || divs.has(8)))
    add('rhythm', 2.5, t('c.rhythm'), t('c.rhythm.text', {list: [...divs].map(d => t('div.' + d))}), t('c.rhythm.tip'));

  pats.sort((x, y) => y.weight - x.weight);
  return {notes: acts.length, nps, pats};
}

export const HAND_RGB = {L: '176,124,255', R: '255,156,64'};
