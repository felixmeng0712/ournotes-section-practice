// The game's note hit effects (NoteEffect/effect001 prefabs, textures in web/official from the user's game files),
// drawn with Canvas 2D in the game camera's projection (render.js P3). One effect per judged note, as
// LiveAllNoteEffectView.PlayNoteEffect does: placed at the note's centre on the judgement line, as wide as the note,
// playing the clip of its judgement (tap_* / tap_slide_*); and the hold loop (note_slide_loop) over every held long.
//
// What each prefab draws:
//   wall    ef_wall_center: one mesh particle (tap_wall_effect: a front face and two sides reaching toward the player)
//           textured with ef_wall, flashing in and fading out over 0.3 s
//   frame   ef_tap_line: a thin outline lying on the lane around the note
//   pillars ef_tap_pillar: four upright beams at the note's edges, two behind it and two in front
//   point / star (/ splash): particles rising from just below the lane, textured with ef_tap_particle_star
// The materials are additive HDR colours (MobileAddHdrColor) under the game's bloom: colours above 1 are pushed
// toward white here (tone) instead.
import {K, P3, CAM} from './render.js';

const TEX = {};
for (const n of ['ef_wall', 'ef_tap_particle_star', 'ef_tap_pillar']) {
  const i = new Image(); i.onload = () => { TEX[n] = i; }; i.src = `official/${n}.png`;
}
export const fxReady = () => !!(TEX.ef_wall && TEX.ef_tap_particle_star && TEX.ef_tap_pillar);

// material tints (rgb × alpha of _TintColor): ef_tap_wall, ef_tap_normal_glow, ef_tap_strong_glow
const MAT = {wall: 1.059 * .718, glow: 2.996 * .616, strong: 4.237 * .549};
const WHITE = .4;   // how much of a channel's excess over 1 spills into the others (bloom)

// ---------- curves ----------
const lerpKeys = (ks, t) => {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i][0]) {
    const [t0, v0] = ks[i - 1], [t1, v1] = ks[i];
    return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
  }
  return ks[ks.length - 1][1];
};
const FLICKER = [[.033, 0], [.039, .487], [.074, 0], [.077, .459], [.115, 0], [.118, .422], [.157, 0], [.159, .392], [.192, 0],
  [.218, .356], [.232, 0], [.255, .345], [.27, 0], [.285, .335], [.306, 0], [.314, .321], [.335, 0], [.345, .312], [.366, 0],
  [.379, .289], [.397, 0], [.413, .279], [.429, 0], [.439, .266], [.458, 0], [.486, .232], [.491, 0], [.529, .179], [.553, .003],
  [.568, .17], [.604, .003], [.62, .127], [.644, .007], [.673, .144], [.687, 0], [.708, .134], [.724, 0], [.748, .123], [.77, 0],
  [.79, .085], [.811, 0], [.836, .073], [.858, 0], [.883, .041], [.901, 0], [.932, .037], [.951, 0], [1, 0]];
const GROW = [[0, 0], [.071, .915], [1, 1]];
const RATE_A = [[0, 0], [.093, 1], [.795, .194], [1, .088]], RATE_B = [[0, 0], [.093, 1], [.795, .194], [1, 0]];
// particle brightness over life (grey gradient with two dark blinks) and alpha
const BLINK = [[0, 1], [.253, .998], [.303, 0], [.344, .996], [.532, .994], [.585, 0], [.632, .985], [1, 0]];
const BLINK_A = [[0, 0], [.018, 1], [1, 1]];
// clip keys: on at 1/60 s, then a smoothstep fall to 0 at 0.4167 s
const fall = (t, d = .4) => { const u = Math.min(1, Math.max(0, t / d)); return 1 - u * u * (3 - 2 * u); };

// ---------- the prefabs ----------
// particle systems: len / sim (duration and simulation speed), rate × curve per simulated second, life, upward speed and
// start size (random between two constants), size over life (curve × multiplier per axis), emitter y, the box they
// start in (flat: on the lane, x ± (W + off) / 2, z ± .5; else upright: y ± .5), colour (rgba)
const POINT = o => ({len: 2, sim: 7, rate: 70, curve: RATE_A, life: [1, 2], vel: [1, 13], size: [.2, .8],
  sx: [FLICKER, 1], sy: [FLICKER, 3], y: -.53, flat: true, off: .08, ...o});
const STAR = o => ({len: 1.7, sim: 9, rate: 15, curve: RATE_B, life: [2, 3], vel: [1, 4], size: [.1, .6],
  sx: [GROW, 2], sy: [GROW, 2], y: -.531, flat: false, off: -.02, ...o});
const SLIDE = [.114, .118, .906];
const TYPES = {
  normal: {set: 'tap', wall: [0, .339, .868, .851], wallIn: [.032, .338], frame: [.078, .234, .868],
    pillar: [[0, .194, .443], [0, .194, .443]], pz: [.64, -.61],
    sys: {point: POINT({color: [.08, .364, 1, 1]}), star: STAR({color: [.064, .231, .594, 1]})}},
  slide: {set: 'slide', wall: [...SLIDE, .784], wallIn: [.094, .297], frame: SLIDE, pillar: [SLIDE, SLIDE], pz: [.64, -.54],
    sys: {point: POINT({rate: 60, color: [...SLIDE, 1]}), star: STAR({sim: 11, vel: [1, 4.5], flat: true, color: [...SLIDE, 1]})}},
  connect: {set: 'slide', wall: [...SLIDE, .784], wallIn: [.094, .297], frame: SLIDE, pillar: null,
    sys: {point: POINT({sim: 9, rate: 40, curve: RATE_B, vel: [1, 5], size: [.05, .2], sx: [GROW, 2], sy: [GROW, 2], color: [...SLIDE, 1]}),
      star: STAR({sim: 11, vel: [1, 4.5], flat: true, color: [...SLIDE, 1]}),
      splash: POINT({len: 3, rate: 60, size: [.2, 1], y: 0, color: [...SLIDE, 1]})}},
  flick: {set: 'tap', wall: [1, .46, .175, .784], wallIn: [.094, .297], frame: [.679, .306, .067],
    pillar: [[.377, .201, .087], [.434, .212, .072]], pz: [.64, -.54],
    sys: {point: POINT({len: 1.7, color: [.896, .392, .123, .863]}),
      star: STAR({sim: 12, rate: 10, vel: [1, 5], flat: true, sy: [GROW, 3], color: [.5, .228, .083, .863]})}},
};
// the judgement clips: frame alpha, pillar alpha (behind, in front), which particle systems play, Bad's grey
const CLIPS = {
  tap: {perfect: {dur: .4167, frame: 1, pill: [.3, .4], sys: ['point', 'star']},
    great: {dur: .4167, frame: 1, pill: [.3, .3], sys: ['point']},
    good: {dur: .4167, frame: 1, pill: null, sys: []},
    bad: {dur: .4167, frame: 1, pill: null, sys: [], grey: true}},
  slide: {perfect: {dur: .5833, frame: 1, pill: [.7, .7], sys: ['point', 'star', 'splash']},
    great: {dur: .4167, frame: 1, pill: [.5, .718], sys: ['point', 'splash']},
    good: {dur: .4167, frame: 1, pill: null, sys: []},
    bad: {dur: .4167, frame: .82, pill: null, sys: [], grey: true}},
};
const GREY_FRAME = [.4, .4, .4], GREY_WALL = .283;

// ---------- drawing ----------
let g = null;
const tone = c => { const m = Math.max(...c); return m <= 1 ? c : c.map(v => Math.min(1, v + (m - 1) * WHITE)); };
// a white texture lit with an HDR colour times k (0..1): quantised levels, cached, the remainder through globalAlpha
// (per texture and colour, its 16 levels in an array: a particle looks its level up without any string work)
const litCache = new Map();
function litLevels(name, c) {
  const key = name + '|' + c.map(v => v.toFixed(3)).join(',');
  let L = litCache.get(key);
  if (!L) { if (litCache.size > 64) litCache.clear(); litCache.set(key, L = {name, c, lv: []}); }
  return L;
}
function litAt(L, k) {
  const q = Math.min(16, Math.max(1, Math.ceil(k * 16)));
  let cv = L.lv[q];
  if (!cv) {
    const im = TEX[L.name], rgb = tone(L.c.map(v => v * q / 16)).map(v => Math.round(v * 255));
    cv = L.lv[q] = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const x = cv.getContext('2d'); x.drawImage(im, 0, 0);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = `rgb(${rgb})`; x.fillRect(0, 0, im.width, im.height);
  }
  g.globalAlpha = k * 16 / q;
  return cv;
}
const lit = (name, c, k) => litAt(litLevels(name, c), k);
const css = (c, k) => `rgb(${tone(c.map(v => v * k)).map(v => Math.round(v * 255))})`;

// an upright quad at depth z, x0..x1, y0 (bottom) .. y1 (top), with the texture's columns c0..c1 (of its width) on
// that part of it
const upright = (img, x0, x1, y0, y1, z, n, c0 = 0, c1 = 1) => {
  const xa = x0 + (x1 - x0) * c0, xb = x0 + (x1 - x0) * c1;
  patch(img, img.width * c0, img.width * c1, 0, img.height, [xa, y1, z], [xb, y1, z], [xa, y0, z], [xb, y0, z], 1, n);
};
// a texture rectangle (sx0..sx1, sy0..sy1) onto a 3D quad given by its corners (a: tex top-left, b: top-right,
// c: bottom-left, d: bottom-right), in a grid of affine cells
let OX = 0, OY = 0;   // screen origin of the canvas patch() draws into (an offscreen sprite)
function patch(img, sx0, sx1, sy0, sy1, a, b, c, d, nu, nv) {
  const lerp3 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const pt = (u, v) => P3(...lerp3(lerp3(a, b, u), lerp3(c, d, u), v));
  const dpr = K.dpr, cw = (sx1 - sx0) / nu, ch = (sy1 - sy0) / nv;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    // the cell's axes through its centre, so perspective's error is split evenly over its edges
    const um = (i + .5) / nu, vm = (j + .5) / nv, l = pt(i / nu, vm), r = pt((i + 1) / nu, vm), t = pt(um, j / nv), b = pt(um, (j + 1) / nv);
    const ax = r[0] - l[0], ay = r[1] - l[1], bx = b[0] - t[0], by = b[1] - t[1];
    const ox = (l[0] + r[0]) / 2 - (ax + bx) / 2, oy = (t[1] + b[1]) / 2 - (ay + by) / 2;
    g.setTransform(ax * dpr, ay * dpr, bx * dpr, by * dpr, (ox - OX) * dpr, (oy - OY) * dpr);
    g.drawImage(img, sx0 + cw * i, sy0 + ch * j, cw, ch, 0, 0, 1, 1);
  }
  g.setTransform(dpr, 0, 0, dpr, -OX * dpr, -OY * dpr);
}

// tap_wall_effect: the strip's (u, x, z) outline seen from above, from the left side's near end round to the right's
const WALL_STRIP = [[0, -1, -1], [.224, -1, -.033], [.274, -.967, 0], [.726, .967, 0], [.771, 1, -.033], [1, 1, -1]];
const WALL_TOP = 2.4085;
// size = startSize × sizeOverLifetime, pivot (0, -.21, -.5), x scaled by the note width - .15
// Every wall of one look (size, depth, colour) is the same mesh but for its centre xm and width, so it is drawn once,
// at x = 0 for a reference width, into three sprites (left side, front, right side), and each wall on screen is those
// three under an affine transform, exact up to the mesh's own cells:
// - a side face stands at x = xm ± xs, so its screen offset from the centre column is (xm ± xs)·k and k there is
//   (x − cx) / ±xs_ref in the sprite: a pure x scale about cx
// - the front face lies at one depth, where k is linear in screen y: a scale about cx plus a shear by xm·k(y)
const WALL_REF = () => 8 * CAM.wu;   // (CAM is only set once render.js has loaded)
const WALL_PARTS = [[0], [1, 2, 3], [4]];   // WALL_STRIP segments: left side, front (with its two corners), right side
const wallCache = new Map();
function wallSprites(z0, size, c) {
  const key = [z0, size, c.map(v => v.toFixed(3)), K.F.toFixed(2), K.W, K.H, K.dpr].join('|');
  let sp = wallCache.get(key);
  if (sp) return sp;
  const xs = (WALL_REF() - .15) * size[0], yb = -.21 * size[1], yt = (WALL_TOP - .21) * size[1], zz = mz => z0 + (mz - .5) * size[2];
  const img = lit('ef_wall', c, 1), T = img.width, keep = g;
  const parts = WALL_PARTS.map(ids => {
    const quads = ids.map(i => {
      const [u0, xa, za] = WALL_STRIP[i], [u1, xb, zb] = WALL_STRIP[i + 1];
      return {u0, u1, n: Math.abs(za - zb) < .1 ? 1 : 8,
        q: [[xa * xs, yt, zz(za)], [xb * xs, yt, zz(zb)], [xa * xs, yb, zz(za)], [xb * xs, yb, zz(zb)]]};
    });
    const ps = quads.flatMap(Q => Q.q.map(p => P3(...p))), xsS = ps.map(p => p[0]), ysS = ps.map(p => p[1]);
    const x0 = Math.floor(Math.min(...xsS)) - 2, x1 = Math.ceil(Math.max(...xsS)) + 2;
    const y0 = Math.floor(Math.min(...ysS)) - 2, y1 = Math.ceil(Math.max(...ysS)) + 2;
    const cv = document.createElement('canvas'); cv.width = (x1 - x0) * K.dpr; cv.height = (y1 - y0) * K.dpr;
    g = cv.getContext('2d'); g.globalCompositeOperation = 'lighter'; OX = x0; OY = y0;
    for (const {u0, u1, n, q} of quads) patch(img, u0 * T, u1 * T, 0, T * .996, ...q, n, 24);
    g = keep; OX = OY = 0;
    return {cv, x0, y0, w: x1 - x0, h: y1 - y0};
  });
  const zf = zz(0), [, ya, ka] = P3(0, yb, zf), [, yc, kc] = P3(0, yt, zf), k1 = (kc - ka) / (yc - ya);
  sp = {parts, xs, k1, k0: ka - k1 * ya};
  if (wallCache.size > 16) wallCache.clear();
  wallCache.set(key, sp);
  return sp;
}
const HIT_WALL = [.515, 3.3, 1.177], LOOP_WALL = [.5, 3, 1.308];   // the one-shot's and the hold loop's sizes
function drawWall(xm, W, z0, size, c, k) {
  if (k <= .002 || W <= .15) return;
  const sp = wallSprites(z0, size, c), d = K.dpr, cx = K.cx, f = (W - .15) / (WALL_REF() - .15);
  const put = (p, a, b, e) => { g.setTransform(d * a, 0, d * b, d, d * e, 0); g.drawImage(p.cv, p.x0, p.y0, p.w, p.h); };
  const aL = f - xm / sp.xs, aR = f + xm / sp.xs;
  g.globalAlpha = Math.min(1, k);
  put(sp.parts[0], aL, 0, cx * (1 - aL));
  put(sp.parts[1], f, xm * sp.k1, cx * (1 - f) + xm * sp.k0);
  put(sp.parts[2], aR, 0, cx * (1 - aR));
  g.setTransform(d, 0, 0, d, 0, 0);
}
// ef_tap_line: a sliced sprite whose 2 px line sits 0.2 in from its edges; size (W + .4) × 1.75, x scaled by 1.02
function drawFrame(xm, W, z, c, k) {
  if (k <= .002) return;
  const hx = 1.02 * W / 2, hz = .675, ps = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, dz]) => P3(xm + x, 0, z + dz));
  const lw = Math.max(1, .0156 * ps[0][2]);
  g.beginPath(); ps.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
  g.lineJoin = 'round';
  // bloom: wide faint strokes under the line
  g.globalAlpha = 1;
  g.strokeStyle = css(c, k * .18); g.lineWidth = lw * 7; g.stroke();
  g.strokeStyle = css(c, k * .35); g.lineWidth = lw * 3; g.stroke();
  g.strokeStyle = css(c, k); g.lineWidth = lw; g.stroke();
}
// ef_tap_pillar (pivot .497, .043): far pair at z + pz[0], 6 tall; near pair at z + pz[1], 4 tall; sx wide
function drawPillars(xm, W, z, cs, pz, al, sx) {
  for (let f = 0; f < 2; f++) {
    if (al[f] <= .002) continue;
    const img = lit('ef_tap_pillar', cs[f], al[f]), sy = f ? 4 : 6;
    for (const side of [-1, 1]) {
      const x = xm + side * W / 2;
      // only columns 55..71 of its 128 are not clear: just those are drawn
      upright(img, x - .497 * sx, x + .503 * sx, -.06 - .043 * sy, -.06 + .957 * sy, z + pz[f], 4, 54 / 128, 73 / 128);
    }
  }
}

// ---------- particles ----------
const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rr = (R, [a, b]) => a + (b - a) * R();
// one run of a system: emission times (real seconds) from the rate curve over its simulated duration
function emit(s, W, seed) {
  const R = rng(seed), out = [], N = 120, dt = s.len / N, hx = Math.max(0, W + s.off) / 2;
  let acc = R();
  for (let i = 0; i < N; i++) {
    acc += s.rate * lerpKeys(s.curve, (i + .5) / N) * dt;
    while (acc >= 1) {
      acc -= 1;
      const x = (R() * 2 - 1) * hx, e = (R() * 2 - 1) * .5;
      out.push({te: (i + R()) * dt / s.sim, life: rr(R, s.life), v: rr(R, s.vel), size: rr(R, s.size),
        x, y: s.flat ? 0 : e, z: s.flat ? e : 0});
    }
  }
  return out;
}
const sysLit = s => s.lit || (s.lit = litLevels('ef_tap_particle_star', s.color.slice(0, 3).map(v => v * s.color[3] * MAT.glow)));
// the particles of a system t real seconds after it started
function drawParticles(s, ps, t, xm, z0, k0) {
  const L = sysLit(s);
  for (const p of ps) {
    const age = (t - p.te) * s.sim; if (age < 0) continue;
    const a = age / p.life; if (a >= 1) continue;
    const k = k0 * lerpKeys(BLINK, a) * lerpKeys(BLINK_A, a);
    const w = p.size * lerpKeys(s.sx[0], a) * s.sx[1], h = p.size * lerpKeys(s.sy[0], a) * s.sy[1];
    if (k <= .004 || w <= .001 || h <= .001) continue;
    const y = s.y + p.y + p.v * age, z = z0 + p.z;
    const [sx, top, kk] = P3(xm + p.x, y + h / 2, z), [, bot] = P3(xm + p.x, y - h / 2, z);
    if (kk <= 0 || bot < -50) continue;
    const ww = w * kk;
    g.drawImage(litAt(L, k), sx - ww / 2, top, ww, bot - top);
  }
}

// ---------- one-shot effects ----------
const xOf = u => (u - 12) * CAM.wu;
// type: normal | slide | connect | flick; res: perfect | great | good | bad
export function makeEffect(l, r, type, res, perf) {
  const T = TYPES[type], clip = CLIPS[T.set][res] || CLIPS[T.set].perfect, W = (r - l) * CAM.wu, seed = (Math.random() * 2 ** 31) | 0;
  const sys = clip.sys.filter(n => T.sys[n]).map((n, i) => ({s: T.sys[n], ps: emit(T.sys[n], W, seed + i * 7919)}));
  return {xm: xOf((l + r) / 2), W, T, clip, sys, perf};
}

function drawOne(e, t) {
  const {xm, W, T, clip} = e, z = CAM.jz;
  // wall: one particle (0.3 s) whose brightness ramps in and out
  const wc = clip.grey ? [GREY_WALL, GREY_WALL, GREY_WALL] : T.wall.slice(0, 3);
  const wk = lerpKeys([[0, 0], [T.wallIn[0], 1], [T.wallIn[1], 1], [1, 0]], t / .3) * T.wall[3];
  if (t < .3) drawWall(xm, W, z + .05, HIT_WALL, wc.map(v => v * MAT.wall), wk);
  if (T.pillar && clip.pill) {
    const f = fall(t), sx = 3 + fall(t, clip.dur > .5 ? .483 : .4);
    drawPillars(xm, W, z, T.pillar.map(c => c.map(v => v * MAT.glow)), T.pz, clip.pill.map(a => a * f), sx);
  }
  drawFrame(xm, W, z, (clip.grey ? GREY_FRAME : T.frame).map(v => v * MAT.strong), clip.frame * fall(t));
  for (const {s, ps} of e.sys) drawParticles(s, ps, t, xm, z, 1);
}

// ---------- the hold loop (note_slide_loop) ----------
// frame alpha .6 ↔ .4 and pillars .114 ↔ .039 every 0.1 s, a steady wall, sparks rising from the frame's edges
const LOOP_SPARK = {len: 2, sim: 10, rate: 10, curve: RATE_B, life: [1, 3], vel: [1, 3], size: [.1, .3], sx: [GROW, 2], sy: [GROW, 2],
  y: -.531, flat: true, off: 0, color: [...SLIDE, 1]};
const loopRuns = new Map();
function drawLoop(key, l, r, t) {
  const xm = xOf((l + r) / 2), W = (r - l) * CAM.wu, z = CAM.jz, ph = Math.cos(t / .1 * 2 * Math.PI);
  drawWall(xm, W, z, LOOP_WALL, SLIDE.map(v => v * MAT.wall), .8 * (.86 + .1 * Math.sin(t * 50)));
  drawPillars(xm, W, z, [SLIDE, SLIDE].map(c => c.map(v => v * MAT.glow)), [.64, -.54], [.0765 + .0375 * ph, .0765 + .0375 * ph], 4);
  drawFrame(xm, W, z, SLIDE.map(v => v * MAT.strong), .5 + .1 * ph);
  // sparks: the emitter loops every 0.2 s; each run is generated once, from the box edge (left / right x, or the z rims)
  const cyc = LOOP_SPARK.len / LOOP_SPARK.sim, n = Math.floor(t / cyc);
  for (let c = n - 2; c <= n; c++) {
    if (c < 0) continue;
    const id = key + ':' + c;
    let run = loopRuns.get(id);
    if (!run) {
      run = emit(LOOP_SPARK, W, (c * 2654435761) ^ key);
      const hx = Math.max(.05, W) / 2;
      for (const p of run) if (Math.abs(p.z) < .5 && Math.abs(p.x) < hx) { if (Math.random() < .5) p.x = Math.sign(p.x || 1) * hx; else p.z = Math.sign(p.z || 1) * .5; }
      if (loopRuns.size > 64) loopRuns.clear();
      loopRuns.set(id, run);
    }
    drawParticles(LOOP_SPARK, run, t - c * cyc, xm, z, 1);
  }
}

// ---------- lane effects (LaneEffect/effect001, LiveLaneEffectView) ----------
// One permanent effect per lane, replayed by every Good..Perfect note over the lane, and the white InVain one by a
// touch on a lane with no note (plus its pair lane i ^ 1). Each is one mesh particle: a quad lying on the lane,
// centred under the camera (world z 0), one lane wide and 70 × (0.946 → 2) long over its life, textured with
// lane_effect_white (opaque at the near end, clear at the far end; its alpha profile is LANE_TEX), additive
// (UIAdditive), coloured per type. Life 0.45 s at simulation speed 2; alpha 1 until 44% of it, then fading out.
const LANE_COL = {blank: [1, 1, 1, .51], normal: [.306, .61, 1, .588], slide: [.678, .486, 1, .588], flick: [1, .693, .486, .588],
  flick_left: [.486, 1, .61, .51], flick_right: [.926, .486, 1, .51]};
const LANE_ORDER = ['normal', 'slide', 'flick', 'flick_left', 'flick_right'];   // container order: the first type requested wins
const LANE_TEX = [.997, 1, 1, .995, .981, .947, .882, .789, .674, .562, .439, .33, .23, .153, .093, .039, .004];   // v = 0 … 1
const LANE_LIFE = 225, LANE_BUSY = 450;   // ms: visible life; how long the instance counts as playing (the base system)
const lanes = Array(24).fill(null);
const laneTex = v => { const f = Math.min(1, Math.max(0, v)) * 16, i = Math.min(15, Math.floor(f)); return LANE_TEX[i] + (LANE_TEX[i + 1] - LANE_TEX[i]) * (f - i); };
export function laneFx(from, to, type, perf) {
  for (let i = Math.max(0, from); i <= Math.min(23, to); i++) {
    const p = lanes[i], busy = p && p.type !== 'blank' && perf - p.perf < LANE_BUSY;
    if (type === 'blank' ? busy : busy && perf - p.perf < 8 && LANE_ORDER.indexOf(p.type) < LANE_ORDER.indexOf(type)) continue;
    lanes[i] = {type, perf};
  }
}
export const laneBlank = (i, perf) => { laneFx(i, i, 'blank', perf); laneFx(i ^ 1, i ^ 1, 'blank', perf); };
// the lane depth z seen at screen row y (inverse of P3 on the lane plane)
const zAtY = y => { const d = K.cy - y; return -CAM.h * (K.F * CAM.c + d * CAM.s) / (d * CAM.c - K.F * CAM.s); };
function laneQuad(l, r, type, u) {
  const [cr, cg, cb, ca] = LANE_COL[type], a = ca * (u < .444 ? 1 : 1 - (u - .444) / .556);
  const S = 140 * (.473 + .527 * u), z0 = -S / 2, zf = S / 2, zn = Math.max(z0, zAtY(K.H + 4));
  const x0 = (l - 12) * CAM.wu, x1 = (r - 12) * CAM.wu;
  const A = P3(x0, 0, zn), B = P3(x1, 0, zn), C = P3(x1, 0, zf), D = P3(x0, 0, zf);
  const gr = g.createLinearGradient(0, A[1], 0, D[1]), rgb = `${Math.round(cr * 255)},${Math.round(cg * 255)},${Math.round(cb * 255)}`;
  for (let k = 0; k <= 16; k++) {   // stops evenly down the screen, each at its lane depth (the perspective)
    const y = A[1] + (D[1] - A[1]) * k / 16;
    gr.addColorStop(k / 16, `rgba(${rgb},${(a * laneTex((zAtY(y) - z0) / S)).toFixed(3)})`);
  }
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.lineTo(C[0], C[1]); g.lineTo(D[0], D[1]); g.closePath(); g.fill();
}
export function drawLanes(ctx, perf) {
  g = ctx;
  let on = false;
  for (let i = 0; i < 24;) {
    const e = lanes[i], u = e ? (perf - e.perf) / LANE_LIFE : 1;
    if (u >= 1 || u < 0) { if (e && perf - e.perf >= LANE_BUSY) lanes[i] = null; i++; continue; }
    let j = i + 1;   // one quad for adjacent lanes started together
    while (j < 24 && lanes[j] && lanes[j].type === e.type && lanes[j].perf === e.perf) j++;
    if (!on) { g.save(); g.globalCompositeOperation = 'lighter'; on = true; }
    laneQuad(i, j, e.type, u);
    i = j;
  }
  if (on) g.restore();
}
export const lanesClear = () => lanes.fill(null);

// effects: [{xm, W, T, clip, sys, perf}]; loops: [{key (number), l, r, t (seconds held)}]
export function drawFx(ctx, effects, loops, perf) {
  g = ctx;
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const L of loops) drawLoop(L.key, L.l, L.r, L.t);
  for (const e of effects) drawOne(e, (perf - e.perf) / 1000);
  g.restore(); g.globalAlpha = 1;
}
export const fxLife = e => e.clip.dur * 1000;

// Every tinted texture level and wall sprite the effects use, made (and the levels drawn once, 1 px, under the next
// frame's opaque backdrop) a few at a time while nothing is being hit yet: made on first use instead, the first hits of
// a run stall (~0.2–0.4 s).
let warmTodo = null;
export function fxWarm(ctx, budgetMs) {
  if (!fxReady()) return false;
  if (!warmTodo) {
    const sets = [], walls = [], glow = c => c.map(v => v * MAT.glow), wall = c => c.map(v => v * MAT.wall);
    for (const T of Object.values(TYPES)) {
      walls.push([CAM.jz + .05, HIT_WALL, wall(T.wall.slice(0, 3))]);
      if (T.pillar) for (const c of T.pillar) sets.push(litLevels('ef_tap_pillar', glow(c)));
      for (const sy of Object.values(T.sys)) sets.push(sysLit(sy));
    }
    walls.push([CAM.jz + .05, HIT_WALL, wall([GREY_WALL, GREY_WALL, GREY_WALL])], [CAM.jz, LOOP_WALL, wall(SLIDE)]);
    sets.push(litLevels('ef_tap_pillar', glow(SLIDE)), sysLit(LOOP_SPARK));
    warmTodo = [...new Set(sets)].flatMap(L => Array.from({length: 16}, (_, i) => () => g.drawImage(litAt(L, (i + 1) / 16), 0, 0, 1, 1)))
      .concat(walls.map(w => () => wallSprites(...w)));
  }
  g = ctx;
  const t0 = performance.now();
  while (warmTodo.length && performance.now() - t0 < budgetMs) warmTodo.shift()();
  g.globalAlpha = 1;
  return !warmTodo.length;
}
