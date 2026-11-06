// Chart parsing: timing, long-note paths, and the list of judged items.
import {TPB} from './state.js';

const EASE = {in: u => u * u, out: u => 1 - (1 - u) * (1 - u), linear: u => u};
function easePair(e) {
  if (Array.isArray(e)) return [EASE[e[0]] || EASE.linear, EASE[e[1]] || EASE.linear];
  const f = EASE[e] || EASE.linear; return [f, f];
}

// Long-note path: each node's ease applies to the segment that starts at it ([left edge, right edge] when given a pair).
export function evalPath(p, t) {
  if (t <= p[0].t) return [p[0].l, p[0].r];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1];
    if (t <= b.t) {
      const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return [a.l + (b.l - a.l) * a.ease[0](u), a.r + (b.r - a.r) * a.ease[1](u)];
    }
  }
  const z = p[p.length - 1]; return [z.l, z.r];
}

export function buildTiming(ev) {
  const bpms = [...ev.bpm].sort((a, b) => a.t - b.t);
  if (!bpms.length) bpms.push({t: 0, bpm: 120});
  if (bpms[0].t > 0) bpms.unshift({t: 0, bpm: bpms[0].bpm});
  const segs = [];
  for (const b of bpms) {
    const p = segs[segs.length - 1];
    segs.push({t: b.t, bpm: b.bpm, sec: p ? p.sec + (b.t - p.t) / TPB * 60 / p.bpm : 0});
  }
  const segAtTick = tick => { let s = segs[0]; for (const g of segs) { if (g.t <= tick) s = g; else break; } return s; };
  const segAtSec = sec => { let s = segs[0]; for (const g of segs) { if (g.sec <= sec) s = g; else break; } return s; };
  return {
    sec: tick => { const s = segAtTick(tick); return s.sec + (tick - s.t) / TPB * 60 / s.bpm; },
    bpmAt: sec => segAtSec(sec).bpm,
  };
}

const kindOf = (type, dflt) => type === 'flick' ? 'flick' : type === 'trace' ? 'trace' : dflt;

// Generated hold ticks every half beat, with the same filters as the official note count
// (reproduced from the yatta simulator; matches the published count on most charts).
function holdTicks(L, T) {
  const o = L.head, s = L.end;
  if (s <= o) return [];
  const mids = L.nodes.slice(1, -1).filter(n => n.visible);
  const stops = mids.map(n => n.t).concat(s);
  const fixed = mids.filter(n => !n.auto).map(n => n.t);
  const d = [o, ...fixed, s], f = [];
  for (let k = 0; k < d.length - 1; k++) {
    for (let t = d[k]; ;) {
      t += 30 / T.bpmAt(t);
      if (t >= d[k + 1] - 1e-9) break;
      f.push(t);
    }
  }
  return f.filter((t, j) => {
    const q = 15 / T.bpmAt(t);
    if (stops.some(x => Math.abs(x - t) < 1e-6)) return false;
    if (fixed.some(x => x - q <= t && t < x)) return false;
    if (j === 0 && t - o < q) return false;
    if (j === f.length - 1 && s - t < q) return false;
    return true;
  });
}

export function parseChart(raw) {
  const ev = raw.score.events, T = buildTiming(ev), toSec = T.sec;
  const items = [], singles = [], longs = [], ends = [];
  let maxTick = 0;
  for (const n of raw.score.notes) {
    if (!n.node) {
      maxTick = Math.max(maxTick, n.t);
      if (n.visible === false) continue;
      const it = {t: toSec(n.t), l: n.pos, r: n.pos + n.size, kind: kindOf(n.type, 'tap'), dir: n.dir || null, crit: !!n.crit, long: null, role: 'single'};
      items.push(it); singles.push(it);
      continue;
    }
    let prevSize = 6;
    const nodes = n.node.map(nd => {
      const size = typeof nd.size === 'number' ? nd.size : prevSize; prevSize = size;
      const auto = typeof nd.pos !== 'number';   // "auto": position follows the path
      maxTick = Math.max(maxTick, nd.t);
      return {t: toSec(nd.t), tick: nd.t, auto, l: auto ? 0 : nd.pos, r: auto ? 0 : nd.pos + size, ease: easePair(nd.ease),
        visible: nd.visible !== false, type: nd.type || null, dir: nd.dir || null, crit: !!nd.crit};
    }).sort((a, b) => a.tick - b.tick);
    const path = nodes.filter(x => !x.auto);
    if (!path.length) continue;
    for (const x of nodes) if (x.auto) [x.l, x.r] = evalPath(path, x.t);
    const L = {nodes, path, guide: n.type === 'guide', crit: !!nodes[0].crit, head: nodes[0].t, end: nodes[nodes.length - 1].t,
      hold: null, headItem: null, endItem: null};
    longs.push(L);
    const last = nodes.length - 1;
    nodes.forEach((nd, i) => {
      if (!nd.visible) return;
      const role = i === 0 ? 'head' : i === last ? 'end' : 'conn';
      const it = {t: nd.t, l: nd.l, r: nd.r, dir: nd.dir, crit: L.crit || nd.crit, long: L,
        role: L.guide ? 'guide' : role,
        // a guide's first and last node are drawn but not judged: the official note counts include only its middle nodes
        free: L.guide && role !== 'conn',
        kind: L.guide ? 'trace' : role === 'head' ? kindOf(nd.type, 'tap') : role === 'end' ? kindOf(nd.type, 'end') : kindOf(nd.type, 'trace')};
      if (role === 'conn') { items.push(it); nd.item = it; }
      else ends.push({key: nd.tick + ':' + nd.l.toFixed(3) + ':' + (nd.r - nd.l).toFixed(3), it, L, role});
    });
    if (!L.guide && nodes.length >= 2) for (const t of holdTicks(L, T)) items.push({t, kind: 'trace', long: L, role: 'hold'});
  }

  // Begin/end nodes at the same tick and position count once. When one long ends where the next begins,
  // keep the end: the player keeps holding through, and the next long's hold starts without a new tap.
  const groups = new Map();
  for (const e of ends) { if (!groups.has(e.key)) groups.set(e.key, []); groups.get(e.key).push(e); }
  const rank = e => (e.L.guide ? 2 : 0) + (e.role === 'end' ? 0 : 1);
  for (const g of groups.values()) {
    const keep = g.reduce((a, b) => rank(b) < rank(a) ? b : a);
    items.push(keep.it);
    if (keep.it.role === 'head') keep.L.headItem = keep.it;
    if (keep.it.role === 'end') keep.L.endItem = keep.it;
  }

  items.sort((a, b) => a.t - b.t);
  singles.sort((a, b) => a.t - b.t);
  longs.sort((a, b) => a.head - b.head);

  // measures
  const endTick = maxTick + TPB * 2;
  const sigs = [...ev.sig].sort((a, b) => a.t - b.t);
  if (!sigs.length || sigs[0].t > 0) sigs.unshift({t: 0, sig: [4, 4]});
  const mTicks = [];
  sigs.forEach((s, i) => {
    const next = i + 1 < sigs.length ? sigs[i + 1].t : endTick;
    const len = TPB * 4 * s.sig[0] / s.sig[1];
    for (let t = s.t; t < next; t += len) mTicks.push(t);
  });
  return {
    items, singles, longs,
    mSec: mTicks.map(toSec),
    fever: (ev.fever || []).map(([a, b]) => [toSec(a), toSec(b)]),
    end: toSec(endTick),
    bpmAt: T.bpmAt,
    noteCount: items.length,
  };
}
