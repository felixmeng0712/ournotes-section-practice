// Drawing: perspective projection, notes (yatta's skin, or built-in slabs if it cannot load), ribbons, hit glows, HUD.
// The play view follows the yatta simulator: its lane, colours, note skin and draw order.
import {S, D, G, PTR, KEY_LABEL, JUDGE, lowerBound, noteViewTime} from './state.js';
import {evalPath} from './chart.js';
import {HAND_RGB} from './coach.js';
import {loadSkin, skinReady, paintNote} from './skin.js';
import {fxReady, makeEffect, drawFx, fxLife, laneFx, laneBlank, drawLanes, fxWarm} from './fx.js';
import {t} from './i18n.js';

export const K = {tint: '255,111,181'};
let cv, g;

// the game's numbers and judgement words: a narrow grotesque for the HUD, a regular-width one for COMBO and PERFECT
const NUM = '"Barlow Condensed", "PingFang SC", "Hiragino Sans", sans-serif';
const WORD = 'Barlow, "PingFang SC", "Hiragino Sans", sans-serif';
const TXT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans", sans-serif';
const NOTE_H = .6;    // note thickness at the judge line, in lane units

// flat slab notes: face top, face bottom, side light, side deep, rgb for effects
const PAL = {
  tap: ['#ffffff', '#d6f3ff', '#6fd2ff', '#2f8fe0', '110,200,255'],
  head: ['#ffffff', '#d6f3ff', '#6fd2ff', '#2f8fe0', '110,200,255'],
  flick: ['#fffbe6', '#ffe07a', '#ffbe2e', '#d98200', '255,200,70'],
  crit: ['#ffffff', '#ffe1f1', '#ff86c4', '#d63d8f', '255,120,190'],
  trace: ['#fbffe8', '#d9f78c', '#a6e04a', '#5f9e12', '190,240,100'],
};
// yatta play-view colours, except the long body, which is the game's blue (yatta draws it purple; sampled from a recording)
const YC = {bg: '#0f1320', laneLine: '#7283aa', outside: '#eefcff', judge: '#a83cf0', crit: '#ffc247',
  long: ['rgba(80,135,255,.58)', 'rgba(82,135,255,.95)'], guide: ['rgba(113,141,255,.10)', 'rgba(113,141,255,.50)']};
const GHOST = .35;   // notes outside the practice section (yatta's ghost opacity)

// yatta's background: the band's live stage (bands 1–5 have one)
const stage = {band: 0, img: null};
function stageImage() {
  const b = D.song?.bands?.find(x => x >= 1 && x <= 5) || 1;
  if (stage.band !== b) {
    stage.band = b; stage.img = null;
    const i = new Image();
    i.onload = () => { if (stage.band === b) stage.img = i; };
    i.src = `yatta/Assets/AddressableResources/Band/${b}/live_stage/lightweight_background.webp`;
  }
  return stage.img;
}
// The stage behind the lane, composed once per size / band / song. The stage picture's LED screens are cut out; in the
// game they show the members, here the song's jacket shows through them as a dotted LED image. Then the whole stage is
// dimmed, as in the game, so the notes stand out.
const bgc = {key: '', c: null, led: null};
function backdrop() {
  const img = stageImage(), jk = document.getElementById('jacket'), art = jk?.complete && jk.naturalWidth ? jk : null;
  const key = [stage.band, !!img, art?.src, K.W, K.H, K.dpr, S.keys, !!LANE.lane_base, !!LANE.lane_tap_area].join('|');
  if (bgc.key === key) return bgc.c;
  const c = bgc.c || (bgc.c = document.createElement('canvas'));
  c.width = Math.round(K.W * K.dpr); c.height = Math.round(K.H * K.dpr);
  const x = c.getContext('2d'), W = K.W, H = K.H;
  x.setTransform(K.dpr, 0, 0, K.dpr, 0, 0);
  const cover = (im, iw, ih) => { const k = Math.max(W / iw, H / ih); x.drawImage(im, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k); };
  const ground = x.createLinearGradient(0, 0, 0, H);
  ground.addColorStop(0, '#0a0f2c'); ground.addColorStop(1, '#141c48');
  x.fillStyle = ground; x.fillRect(0, 0, W, H);
  if (art) {
    x.save(); x.globalAlpha = .75;
    if ('filter' in x) x.filter = 'blur(3px) saturate(1.15)';
    cover(art, art.naturalWidth, art.naturalHeight);
    x.restore();
    if (!bgc.led) {   // LED grid: a dark line between dots every 4 px
      const p = document.createElement('canvas'); p.width = p.height = 4;
      const q = p.getContext('2d'); q.fillStyle = 'rgba(4,6,20,.55)'; q.fillRect(0, 3, 4, 1); q.fillRect(3, 0, 1, 3);
      bgc.led = p;
    }
    x.fillStyle = x.createPattern(bgc.led, 'repeat'); x.fillRect(0, 0, W, H);
  }
  if (img) cover(img, img.naturalWidth, img.naturalHeight);
  x.fillStyle = 'rgba(5,8,28,.34)'; x.fillRect(0, 0, W, H);
  const v = x.createLinearGradient(0, 0, 0, H);   // darker towards the HUD at the top
  v.addColorStop(0, 'rgba(5,8,28,.5)'); v.addColorStop(.3, 'rgba(5,8,28,0)'); v.addColorStop(1, 'rgba(5,8,28,.2)');
  x.fillStyle = v; x.fillRect(0, 0, W, H);
  const main = g; g = x; drawLane(); g = main;
  bgc.key = key;
  return c;
}

const THICK = 11 / 64.5;   // yatta widens every note by its 11px thickness (in lane units at the judge line)
// The game's notes stand up: measured from a recording they are ~1.3–1.5 lanes thick against yatta's flat 0.79.
const NOTE_SY = 1.7;
// K.band: half the judgement frame's height, in lane units at the judge line (set by resize from the tap_area sprite)

// ---------- geometry ----------
// The game's camera (LiveGameView): LiveGameCamera 10 above the lane, pitched 29.6° down, vertical fov 54° at 16:9 and
// widened on narrower screens to keep the horizontal fov; judgement_root 9.62 ahead; the lane 19.12 wide in 24 positions.
// A pinhole camera puts a lane point at y = horizon + (judge − horizon)·r and x = centre + (u − 12)·unit·r, r being its
// depth scale (1 on the judge line), so R/X/Y below are that projection; resize() fits it to the screen. Portrait
// screens (the game has none) keep the yatta simulator's layout: judge line at 78% height, vanishing point 6% above,
// seen by a camera at the same height and distance pitched to fit (74° down on a phone).
export const CAM = {h: 10, jz: 9.62, wu: 19.12 / 24, pitch: 2 * Math.atan2(.25548336, .96681345)};
function aim(t) { Object.assign(CAM, {s: Math.sin(t), c: Math.cos(t), dj: CAM.h * Math.sin(t) + CAM.jz * Math.cos(t)}); }
const rOfZ = z => CAM.dj / (CAM.h * CAM.s + z * CAM.c);   // depth scale of the lane point z ahead of the camera
const zOfR = r => (CAM.dj / r - CAM.h * CAM.s) / CAM.c;
const TAP_LINE = -.65;   // the tap_area frame's line nearest the player, from the judgement position (texture row 40)
const clampN = n => Math.max(-.16, Math.min(1, n));
export const R = n => Math.pow(1.06500006, -45 * clampN(n));
export const X = (u, r) => K.cx + (u - 12) * K.unit * r;
export const Y = r => K.sy + (K.jy - K.sy) * r;
// screen x, y and pixels per world unit of a world point (x across the lane from its centre, y up, z ahead of the camera)
export function P3(x, y, z) {
  const k = K.F / (CAM.s * (CAM.h - y) + CAM.c * z);
  return [K.cx + x * k, K.cy - k * (CAM.c * (y - CAM.h) + CAM.s * z), k];
}
export const laneX = clientX => 12 + (clientX - K.cx) / K.unit;

function readSafe() {
  const el = document.getElementById('safe');
  if (!el) return {t: 0, r: 0, b: 0, l: 0};
  const cs = getComputedStyle(el);
  return {t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0};
}

export function initRender(canvas) {
  cv = canvas; g = cv.getContext('2d');
  resize();
  addEventListener('resize', resize);
  for (const f of ['800 20px Barlow', '600 20px "Barlow Condensed"', '700 20px "Barlow Condensed"', '800 20px "Barlow Condensed"'])
    document.fonts?.load(f).catch(() => {});
  loadSkin();
}

export function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  let jy = H * .78, sy = -H * .06, lw = Math.min(W * .96, H * 1.4331);
  if (W >= H) {   // the game camera: judge line at 0.791 H, lane 1.411 H wide there, horizon 0.058 H above the top (16:9)
    aim(CAM.pitch);
    const F = H / 2 / (Math.tan(27 * Math.PI / 180) * Math.max(1, 16 / 9 / (W / H)));
    sy = H / 2 - F * CAM.s / CAM.c; jy = sy + F * CAM.h / (CAM.c * CAM.dj); lw = F * 19.12 / CAM.dj;
  } else aim(Math.acos(Math.min(1, CAM.h * lw / (19.12 * (jy - sy)))));   // (judge − horizon) / lane width = h / (19.12 cos)
  Object.assign(K, {W, H, dpr, cx: W / 2, jy, sy, lw, unit: lw / 24, px: lw / 1548, safe: readSafe()});
  K.F = K.unit * CAM.dj / CAM.wu; K.cy = sy + K.F * CAM.s / CAM.c;   // focal length and centre row of the camera
  K.band = (Y(rOfZ(CAM.jz + TAP_LINE)) - jy) / K.unit;   // the frame's near line below the judge line, in lane units (0.64)
  buildSprites();
}

// ---------- sprites (pre-rendered once per resize; drawn as 3-slice so any note width works) ----------
const SPR = {};
function rrect(c, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function buildSprites() {
  const hs = Math.max(16, Math.ceil(K.unit * NOTE_H * K.dpr * 1.6));
  for (const [k, p] of Object.entries(PAL)) {
    const c = document.createElement('canvas'); c.width = hs * 4; c.height = hs;
    const x = c.getContext('2d'), w = c.width, h = hs, bev = h * .3, top = h * .64;
    // a flat slab seen from the front: bright face on top, coloured edge below, corners cut off
    const slab = y1 => { x.beginPath(); x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, y1 - bev); x.lineTo(w - bev, y1); x.lineTo(bev, y1); x.lineTo(0, y1 - bev); x.closePath(); };
    const side = x.createLinearGradient(0, 0, 0, h);
    side.addColorStop(0, p[2]); side.addColorStop(1, p[3]);
    slab(h); x.fillStyle = side; x.fill();
    const face = x.createLinearGradient(0, 0, 0, top);
    face.addColorStop(0, p[0]); face.addColorStop(1, p[1]);
    slab(top); x.fillStyle = face; x.fill();
    x.lineWidth = Math.max(1, h * .05); x.strokeStyle = p[2]; slab(h); x.stroke();
    x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(0, 0, w, Math.max(1, h * .06));
    SPR[k] = c;
  }
}

function drawSprite(key, x0, x1, y, h, alpha) {
  const spr = SPR[key], hs = spr.height, sw = spr.width, w = x1 - x0;
  if (w <= 1 || h <= .5) return;
  const cap = Math.min(h * .5, w / 2), sc = hs * .5;
  g.globalAlpha = alpha;
  g.drawImage(spr, 0, 0, sc, hs, x0, y - h / 2, cap, h);
  if (w > cap * 2) g.drawImage(spr, sc, 0, sw - sc * 2, hs, x0 + cap, y - h / 2, w - cap * 2, h);
  g.drawImage(spr, sw - sc, 0, sc, hs, x1 - cap, y - h / 2, cap, h);
  g.globalAlpha = 1;
}

function sparkle(cx, y, d, fill) {
  g.beginPath(); g.moveTo(cx, y - d); g.quadraticCurveTo(cx, y, cx + d, y); g.quadraticCurveTo(cx, y, cx, y + d);
  g.quadraticCurveTo(cx, y, cx - d, y); g.quadraticCurveTo(cx, y, cx, y - d); g.fillStyle = fill; g.fill();
}

function chevron(cx, y, a, rot, fill) {
  g.save(); g.translate(cx, y); g.rotate(rot);
  g.beginPath();
  g.moveTo(-a, a * .32); g.lineTo(0, -a * .5); g.lineTo(a, a * .32); g.lineTo(a * .58, a * .62); g.lineTo(0, a * .06); g.lineTo(-a * .58, a * .62);
  g.closePath(); g.fillStyle = fill; g.fill();
  g.lineWidth = Math.max(1, a * .1); g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke();
  g.restore();
}

// kind: tap | flick | trace | head / node / end (a long's start, middle node, last node) | gnode (a guide's node)
function drawNote(l, r, n, kind, dir, crit, alpha, hand) {
  const rr = R(n), y = Y(rr), w = Math.max(.05, r - l);
  if (skinReady()) {
    // a long's start, middle nodes and end use the skin's slide sprites, as in the game (yatta draws them as taps);
    // guide nodes use the trace sprite; flicks by direction
    const sk = kind === 'flick' ? (dir === 'left' ? 'flick-left' : dir === 'right' ? 'flick-right' : 'flick')
      : kind === 'head' ? 'slide-start' : kind === 'end' ? 'slide-end' : kind === 'node' ? 'slide-node' : kind === 'gnode' ? 'trace' : 'tap';
    const d = (w + THICK) * K.unit * rr / w, cx = X((l + r) / 2, rr);
    g.globalAlpha = alpha;
    paintNote(g, sk, l, w, cx, y, d, NOTE_SY);
    if (crit) {   // yatta's critical mark: a gold wash over the note's thickness band
      const hw = w * d / 2, t = THICK / 2 * K.unit * rr * NOTE_SY;
      g.globalAlpha = alpha * .35; g.fillStyle = YC.crit; g.fillRect(cx - hw, y - t, hw * 2, t * 2);
    }
    g.globalAlpha = 1;
    if (hand && G.hands) { const h = K.unit * .79 * rr; handMark(X(l, rr) - h * .15, X(r, rr) + h * .15, y, h, rr, hand, alpha); }
    return;
  }
  const pal = crit ? 'crit' : kind === 'flick' ? 'flick' : kind === 'trace' || kind === 'node' || kind === 'gnode' ? 'trace' : 'tap';
  const h = K.unit * NOTE_H * rr * (kind === 'trace' || kind === 'node' || kind === 'gnode' ? .55 : kind === 'end' ? .8 : 1);
  const x0 = X(l + .1, rr), x1 = X(r - .1, rr), cx = (x0 + x1) / 2;
  drawSprite(pal, x0, x1, y, h, alpha);
  if (hand && G.hands) handMark(x0, x1, y, h, rr, hand, alpha);
  g.globalAlpha = alpha;
  sparkle(cx, y - h * .18, h * (kind === 'trace' ? .5 : .32), PAL[pal][3]);
  if (kind === 'flick') {
    const a = Math.min(h * 1.1, (x1 - x0) * .4), rot = dir === 'left' ? -.9 : dir === 'right' ? .9 : 0;
    chevron(cx, y - h * 1.05, a, rot, PAL[pal][2]);
  }
  g.globalAlpha = 1;
}

// which hand should play it: a round tab on that hand's end of the note, with its letter
function handMark(x0, x1, y, h, rr, hand, alpha) {
  const rad = Math.max(3, K.unit * .42 * rr), cx = hand === 'L' ? x0 - rad * .55 : x1 + rad * .55;
  g.globalAlpha = alpha;
  g.beginPath(); g.arc(cx, y, rad, 0, Math.PI * 2);
  g.fillStyle = `rgb(${HAND_RGB[hand]})`; g.fill();
  g.lineWidth = Math.max(1, rad * .14); g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke();
  if (rad >= 6) {
    g.font = `800 ${Math.round(rad * 1.15)}px ${NUM}`; g.textAlign = 'center'; g.fillStyle = '#1a1030';
    g.fillText(hand, cx, y + rad * .42);
  }
  g.globalAlpha = 1;
}

// ---------- ribbons ----------
// yatta's long/guide body: no edges, fading from 50% at the near end to 10% at the far end
function drawRibbon(L, now, view, cols, alpha, fromNow) {
  const t0 = fromNow ? Math.max(L.head, now) : L.head, t1 = Math.min(L.end, now + view * 1.05);
  if (t1 <= t0) return;
  const n = 40, ts = [];
  for (let i = 0; i <= n; i++) ts.push(t0 + (t1 - t0) * i / n);
  for (const nd of L.path) if (nd.t > t0 && nd.t < t1) ts.push(nd.t, nd.t + 1e-5);
  ts.sort((a, b) => a - b);
  const pts = ts.map(t => { const [l, r] = evalPath(L.path, t), rr = R((t - now) / view); return [X(l, rr), X(r, rr), Y(rr)]; });
  g.beginPath();
  pts.forEach(([l, , y], i) => i ? g.lineTo(l, y) : g.moveTo(l, y));
  for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][1], pts[i][2]);
  g.closePath();
  const a = pts[0], z = pts[pts.length - 1], gr = g.createLinearGradient(z[0], z[2], a[0], a[2]);
  gr.addColorStop(0, cols[0]); gr.addColorStop(1, cols[1]);
  g.globalAlpha = alpha; g.fillStyle = gr; g.fill();
  g.globalAlpha = 1;
}

// ---------- effects ----------
// The game's note effects (fx.js); until their textures load, a gradient stand-in (plainHit).
// type: normal | slide | connect | flick; res: perfect | great | good | bad
export function hitEffect(l, r, type, res = 'perfect') {
  const perf = performance.now();
  G.effects.push(fxReady() ? makeEffect(l, r, type, res, perf)
    : {l, r, perf, crit: false, weak: res !== 'perfect', seed: Math.random() * 1e4, plain: true});
}
// the lane flash under a note (lanes l..r, edges in lane units): normal | slide | flick | flick_left | flick_right;
// and the white one under a touch that found no note (lane position u)
export function laneEffect(l, r, type) { laneFx(Math.floor(l + .01), Math.ceil(r - .01) - 1, type, performance.now()); }
export function laneMiss(u) { if (u >= 0 && u < 24) laneBlank(Math.floor(u), performance.now()); }
const rAtY = y => (y - K.sy) / (K.jy - K.sy);
const rnd = s => { const x = Math.sin(s) * 43758.5453; return x - Math.floor(x); };
function drawEffects(perf, now) {
  G.effects = G.effects.filter(e => perf - e.perf < (e.plain ? 450 : fxLife(e)));
  const loops = [];
  if (fxReady()) D.chart.longs.forEach((L, i) => {
    if (L.guide || L.hold == null || !(now > L.head && now < L.end)) return;
    const [l, r] = evalPath(L.path, now);
    loops.push({key: i + 1, l, r, t: (now - L.head) / G.rate});
  });
  if (!G.effects.length && !loops.length) return;
  drawFx(g, G.effects.filter(e => !e.plain), loops, perf);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const e of G.effects) if (e.plain) plainHit(e, perf - e.perf, 450);
  g.restore(); g.globalAlpha = 1;
}

// the same effect drawn with gradients
function plainHit(e, age, LIFE) {
  const u = K.px, k = age / LIFE, a = (1 - k) * (1 - k), ab = 1 - k, hb = K.band * K.unit;
  const rgb = e.crit ? '255,190,60' : '30,115,255', core = e.crit ? '255,240,190' : '200,235,255';
  const yb = K.jy + hb, top = K.jy - K.unit * (5.5 + 1.2 * k), rt = rAtY(top), rb = rAtY(yb);
  const l0 = X(e.l, rb), r0 = X(e.r, rb), l1 = X(e.l, rt), r1 = X(e.r, rt);
  const beam = g.createLinearGradient(0, yb, 0, top);
  beam.addColorStop(0, `rgba(${rgb},${ab})`); beam.addColorStop(.3, `rgba(${rgb},${.5 * ab})`); beam.addColorStop(.6, `rgba(${rgb},${.2 * ab})`); beam.addColorStop(1, `rgba(${rgb},0)`);
  g.globalAlpha = 1; g.beginPath(); g.moveTo(l0, yb); g.lineTo(r0, yb); g.lineTo(r1, top); g.lineTo(l1, top); g.closePath();
  g.fillStyle = beam; g.fill();
  const et = K.jy - K.unit * (2.2 + 1.2 * k), re = rAtY(et), edge = g.createLinearGradient(0, yb, 0, et);
  edge.addColorStop(0, `rgba(${core},${a})`); edge.addColorStop(1, `rgba(${core},0)`);
  g.strokeStyle = edge; g.lineWidth = Math.max(1.5, 4.5 * u);
  for (const x of [e.l, e.r]) { g.beginPath(); g.moveTo(X(x, rb), yb); g.lineTo(X(x, re), et); g.stroke(); }
  const n = Math.min(16, 4 + Math.round((e.r - e.l) * .9)), len = K.unit * .5;
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const fx = e.l + (e.r - e.l) * rnd(e.seed + i), sp = .6 + rnd(e.seed + i * 7.1), d0 = rnd(e.seed + i * 5.7) * .35;
    const prog = Math.max(0, k - d0 * .3) / (1 - d0 * .3), y = K.jy - K.unit * (.2 + 3.6 * sp * Math.sqrt(prog));
    const x = X(fx, rAtY(y)), al = a * (.55 + .45 * rnd(e.seed + i * 3.3)), L = len * (.6 + sp * .6);
    const tr = g.createLinearGradient(0, y + L, 0, y);
    tr.addColorStop(0, `rgba(${rgb},0)`); tr.addColorStop(1, `rgba(${core},${al})`);
    g.strokeStyle = tr; g.lineWidth = Math.max(1.2, 5 * u);
    g.beginPath(); g.moveTo(x, y + L); g.lineTo(x, y); g.stroke();
  }
}

// notes at the same moment are joined by a line through their centres
function simGroups(C) {
  if (C.sim) return C.sim;
  const at = new Map();
  const add = (t, l, r, it) => { const k = Math.round(t * 1000); if (!at.has(k)) at.set(k, {t, cs: [], items: []}); const e = at.get(k); e.cs.push((l + r) / 2); if (it) e.items.push(it); };
  for (const it of C.singles) add(it.t, it.l, it.r, it);
  for (const L of C.longs) {
    if (L.guide) continue;
    const a = L.nodes[0], z = L.nodes[L.nodes.length - 1];
    if (a.visible) add(a.t, a.l, a.r, L.headItem);
    if (z.visible) add(z.t, z.l, z.r, L.endItem);
  }
  C.sim = [...at.values()].filter(e => e.cs.length > 1 && Math.min(...e.cs) !== Math.max(...e.cs))
    .map(e => ({t: e.t, l: Math.min(...e.cs), r: Math.max(...e.cs), items: e.items}))
    .sort((a, b) => a.t - b.t);
  return C.sim;
}

function drawConnectors(C, now, view) {
  const sim = simGroups(C), hi = now + view * 1.05;
  g.save(); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(1.5, 3 * K.px); g.lineCap = 'round';
  for (let i = lowerBound(sim, now - .16 * view); i < sim.length && sim[i].t <= hi; i++) {
    const e = sim[i], inSec = e.items.some(it => it.inSec);
    if (inSec ? e.items.every(it => !it.inSec || it.res) : e.t < now) continue;
    const rr = R((e.t - now) / view), y = Y(rr);
    g.globalAlpha = inSec ? 1 : GHOST;
    g.beginPath(); g.moveTo(X(e.l, rr), y); g.lineTo(X(e.r, rr), y); g.stroke();
  }
  g.restore();
}

// ---------- scene ----------
// The lane and the judgement frame don't move: they are drawn into the backdrop once.
// The game's lane (LiveGameLane, lane skin 001, textures in web/official from the user's game files): the lane_base
// sprite on the camera's screen-space canvas, the guide lines (LiveLaneLineView) and the tap_area frame lying on the lane.
const LANE = {};
for (const n of ['lane_base', 'lane_tap_area']) {
  const i = new Image(); i.onload = () => { LANE[n] = i; }; i.src = `official/${n}.png`;
}
// the lane and guide-line opacity options (LaneOpacity, GuidelineOpacity): their defaults are not in the exported files,
// so these are measured from the skin's reference_image.png
const LANE_ALPHA = .75, LINE_ALPHA = .7;
const xw = (x, r) => X(x / CAM.wu + 12, r);   // screen x of world x on the lane, at depth scale r

// a line lying on the lane at world x from z0 to z1, its width going w0 → w1 and its alpha a0 → a1 (LineRenderer)
function laneLine(x, z0, z1, w0, w1, rgb, a0, a1) {
  const za = Math.max(z0, zOfR((K.H - K.sy) / (K.jy - K.sy))), N = 32;
  if (za >= z1) return;
  const ra = rOfZ(za), rb = rOfZ(z1), L = [], Rt = [], gr = g.createLinearGradient(0, Y(ra), 0, Y(rb));
  for (let i = 0; i <= N; i++) {   // steps even in r, so each covers about the same screen height
    const r = ra + (rb - ra) * i / N, f = (zOfR(r) - z0) / (z1 - z0), w = w0 + (w1 - w0) * f, y = Y(r);
    L.push([xw(x - w / 2, r), y]); Rt.push([xw(x + w / 2, r), y]);
    gr.addColorStop(i / N, `rgba(${rgb},${a0 + (a1 - a0) * f})`);
  }
  g.beginPath();
  L.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py));
  for (let i = N; i >= 0; i--) g.lineTo(Rt[i][0], Rt[i][1]);
  g.closePath(); g.fillStyle = gr; g.fill();
}

// tap_area: a 20.1 × 2.1 sliced sprite (borders 70 px at 100 px per unit) lying flat on the judgement position, its top
// edge towards the player; built once at 100 px per unit, then drawn one screen row at a time in perspective
let tapSprite = null;
function drawTapArea() {
  const T = LANE.lane_tap_area, hw = 10.05, hd = 1.05, P = 100;
  if (!tapSprite) {
    const c = document.createElement('canvas'), x = c.getContext('2d'), b = 70, w = hw * 2 * P, h = hd * 2 * P;
    c.width = w; c.height = h;
    const sx = [0, b, T.width - b, T.width], dx = [0, b, w - b, w], sy = [0, b, T.height - b, T.height], dy = [0, b, h - b, h];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++)
      x.drawImage(T, sx[i], sy[j], sx[i + 1] - sx[i], sy[j + 1] - sy[j], dx[i], dy[j], dx[i + 1] - dx[i], dy[j + 1] - dy[j]);
    tapSprite = c;
  }
  const zN = CAM.jz - hd, yF = Y(rOfZ(CAM.jz + hd)), yN = Y(rOfZ(zN)), step = 1 / K.dpr;
  for (let y = yF; y < yN; y += step) {
    const y1 = Math.min(y + step, yN), zt = zOfR(rAtY(y)), zb = zOfR(rAtY(y1)), r = rAtY((y + y1) / 2);
    const x0 = xw(-hw, r), x1 = xw(hw, r);
    g.drawImage(tapSprite, 0, (zb - zN) * P, tapSprite.width, (zt - zb) * P, x0, y, x1 - x0, y1 - y);
  }
}

function drawLane() {
  if (LANE.lane_base && LANE.lane_tap_area) gameLane(); else plainLane();
  if (S.keys) {
    g.font = `600 ${Math.round(K.unit * .45)}px ${NUM}`; g.textAlign = 'center'; g.fillStyle = 'rgba(230,225,255,.32)';
    for (let k = 0; k < 8; k++) g.fillText(KEY_LABEL[k], X(k * 3 + 1.5, R(-.07)), Y(R(-.07)) + K.unit * .2);
  }
}

function gameLane() {
  // lane_base (2048 × 1644 on the 1920 × 1080 canvas, 247 below its centre): its navy trapezoid's apex is texture row
  // −13.7 and the judge line row 444.5, 0.8313 px of half-width per row, so placing those on our horizon and judge line
  // puts it where the game does in landscape (and stretches it to fit in portrait)
  const B = LANE.lane_base, ky = (K.jy - K.sy) / 458.2, kx = K.lw / 2 / (.8313 * 458.2);
  g.globalAlpha = LANE_ALPHA;
  g.drawImage(B, K.cx - B.width / 2 * kx, K.sy + 13.7 * ky, B.width * kx, B.height * ky);
  g.globalAlpha = 1;
  // guide lines, split type 2: main lines every 4 positions over the whole lane (0.15 → 0.30 wide, the centre one to
  // 0.60), sub lines between them only across the judgement area (1.3 long), outside lines along both edges (0.17,
  // white, fading out with distance)
  const half = 19.12 / 2, far = 217.6, grey = '156,156,156';
  for (let i = 2; i < 24; i += 2) {
    const x = -half + i * CAM.wu;
    if (i % 4) laneLine(x, CAM.jz - .65, CAM.jz + .65, .15, .15, grey, LINE_ALPHA, LINE_ALPHA);
    else laneLine(x, 0, far, .15, i === 12 ? .6 : .3, grey, LINE_ALPHA, LINE_ALPHA);
  }
  for (const s of [-1, 1]) laneLine(s * (half + .085), 0, far, .17, .17, '255,255,255', 1, 0);
  drawTapArea();
}

// without the game's textures: a navy lane and a neon frame drawn with a blurred shadow
function plainLane() {
  const u = K.unit, px = K.px, half = y => K.lw / 2 * (y - K.sy) / (K.jy - K.sy), xAt = (y, k) => K.cx - half(y) + k * half(y) / 3;
  const top = 0, bot = K.H;
  g.beginPath(); g.moveTo(xAt(top, 0), top); g.lineTo(xAt(top, 6), top); g.lineTo(xAt(bot, 6), bot); g.lineTo(xAt(bot, 0), bot); g.closePath();
  const lg = g.createLinearGradient(0, top, 0, bot);   // the game's lane: near-opaque navy, lighter towards the player
  lg.addColorStop(0, 'rgba(8,13,34,.88)'); lg.addColorStop(.75, 'rgba(22,32,72,.86)'); lg.addColorStop(1, 'rgba(28,40,88,.86)');
  g.fillStyle = lg; g.fill();
  g.strokeStyle = YC.laneLine; g.lineWidth = Math.max(.5, px);
  for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(xAt(top, k), top); g.lineTo(xAt(bot, k), bot); g.stroke(); }
  g.strokeStyle = YC.outside; g.lineWidth = Math.max(1, 2 * px);
  for (const k of [0, 6]) { g.beginPath(); g.moveTo(xAt(top, k), top); g.lineTo(xAt(bot, k), bot); g.stroke(); }
  // judgement area, as in the game: a neon frame one note thick along the lane edges, open inside
  const hb = K.band * u, rAt = y => (y - K.sy) / (K.jy - K.sy), yt = K.jy - hb, yb = K.jy + hb;
  const fx = (k, y) => X(k, rAt(y)) + (k ? 1 : -1) * 2 * px;
  g.save(); g.lineJoin = 'round';
  g.beginPath(); g.moveTo(fx(0, yt), yt); g.lineTo(fx(24, yt), yt); g.lineTo(fx(24, yb), yb); g.lineTo(fx(0, yb), yb); g.closePath();
  g.strokeStyle = YC.judge; g.lineWidth = Math.max(2.5, 8 * px); g.shadowBlur = 28 * px; g.shadowColor = YC.judge; g.stroke(); g.stroke();
  g.shadowBlur = 0; g.strokeStyle = 'rgba(252,240,255,.97)'; g.lineWidth = Math.max(1.2, 3 * px); g.stroke();
  g.restore();
}

// a word drawn as the game draws COMBO and the judgements: a pale fill inside a coloured neon edge. The glow is a
// blurred shadow, slow on a phone, so each word is drawn once into a sprite and reused. fill: a colour or [top, bottom];
// edge: a colour or a list of colours across the word. Drawn centred on x, with y the baseline.
const neonCache = new Map();
function neonText(text, x, y, font, size, fill, edge, glow, track = 0, ew = .13) {
  const key = [text, font, size, fill, edge, glow, track, ew, K.dpr].join('|');
  let sp = neonCache.get(key);
  if (!sp) {
    const c = document.createElement('canvas'), q = c.getContext('2d');
    q.font = font;
    const ws = [...text].map(ch => q.measureText(ch).width), w = track ? ws.reduce((a, b) => a + b, 0) + track * (text.length - 1) : q.measureText(text).width;
    const pad = Math.ceil(size * .6), cw = Math.ceil(w + pad * 2), ch = Math.ceil(size * 1.3 + pad * 2), by = pad + size;
    c.width = Math.ceil(cw * K.dpr); c.height = Math.ceil(ch * K.dpr);
    q.scale(K.dpr, K.dpr); q.font = font; q.textAlign = 'center'; q.lineJoin = 'round';
    const draw = op => {
      if (!track) return op(text, cw / 2, by);
      let cx = cw / 2 - w / 2;
      [...text].forEach((t, i) => { op(t, cx + ws[i] / 2, by); cx += ws[i] + track; });
    };
    const grad = (cols, x0, y0, x1, y1) => { const gr = q.createLinearGradient(x0, y0, x1, y1); cols.forEach((c, i) => gr.addColorStop(i / (cols.length - 1), c)); return gr; };
    q.shadowColor = glow; q.shadowBlur = size * .35;
    q.lineWidth = size * ew; q.strokeStyle = Array.isArray(edge) ? grad(edge, cw / 2 - w / 2, 0, cw / 2 + w / 2, 0) : edge;
    draw((t, a, b) => q.strokeText(t, a, b));
    q.shadowBlur = 0;
    q.fillStyle = Array.isArray(fill) ? grad(fill, 0, by - size * .72, 0, by) : fill;
    draw((t, a, b) => q.fillText(t, a, b));
    sp = {c, w: cw, h: ch, ox: cw / 2, oy: by};
    if (neonCache.size > 160) neonCache.delete(neonCache.keys().next().value);
    neonCache.set(key, sp);
  }
  g.drawImage(sp.c, x - sp.ox, y - sp.oy, sp.w, sp.h);
}

// The game's in-play words and numbers (LiveUISpriteAssets in the user's game files, copied to web/official): the
// judgement atlas, and three combo atlases, N (blue) while the combo has a Great or Good in it, FC (pink) while there's
// been no Bad or Miss, AP (purple) while everything so far is Perfect. Each digit is a glow base with a gradient fill
// drawn over it. The atlases carry no sprite rects, so these were measured from the textures (alpha > 6, 2 px added).
const HUD = {};
for (const n of ['judgement', 'combo_n', 'combo_fc', 'combo_ap']) {
  const i = new Image(); i.onload = () => { HUD[n] = i; }; i.src = `official/hud_${n}.png`;
}
const JRECT = {perfect: [1, 811, 321, 87], great: [0, 732, 235, 76], good: [237, 732, 192, 77], bad: [0, 570, 155, 80],
  miss: [0, 652, 184, 77], SLOW: [18, 494, 273, 39], FAST: [18, 534, 273, 37]};
const FC_RECTS = {
  base: [[351, 360, 105, 149], [116, 45, 76, 148], [3, 49, 104, 148], [115, 202, 105, 148], [4, 364, 110, 145],
    [228, 202, 105, 148], [3, 206, 105, 149], [341, 204, 101, 146], [123, 360, 107, 149], [237, 360, 105, 149]],
  fill: [[627, 389, 74, 121], [541, 223, 44, 118], [708, 391, 74, 119], [544, 389, 76, 121], [196, 77, 81, 116],
    [789, 392, 74, 118], [463, 389, 75, 121], [463, 266, 72, 116], [283, 74, 77, 121], [366, 76, 76, 121]],
  title: [540, 344, 164, 42]};
const CRECT = {
  combo_n: {
    base: [[3, 217, 98, 143], [214, 65, 66, 141], [216, 216, 97, 141], [110, 215, 97, 143], [4, 370, 103, 140],
      [3, 67, 97, 141], [330, 366, 100, 143], [110, 67, 94, 139], [116, 366, 99, 143], [225, 366, 98, 143]],
    fill: [[521, 389, 75, 121], [602, 268, 43, 117], [602, 392, 74, 118], [439, 389, 75, 121], [321, 242, 81, 116],
      [490, 263, 74, 119], [369, 110, 75, 121], [451, 114, 72, 116], [287, 87, 76, 121], [409, 237, 75, 121]],
    title: [683, 477, 159, 35]},
  combo_fc: FC_RECTS, combo_ap: FC_RECTS};
// a sprite from an atlas, centred on (x, y), at scale s
function spr(img, [x, y, w, h], cx, cy, s, pad = 2) {
  const x0 = Math.max(0, x - pad), y0 = Math.max(0, y - pad), x1 = Math.min(img.width, x + w + pad), y1 = Math.min(img.height, y + h + pad);
  g.drawImage(img, x0, y0, x1 - x0, y1 - y0, cx + (x0 - x - w / 2) * s, cy + (y0 - y - h / 2) * s, (x1 - x0) * s, (y1 - y0) * s);
}

function drawCombo(perf) {
  const s = G.stats; if (!s || s.combo < 2) return;
  const k = Math.min(1, (perf - G.comboPerf) / 140), sc = 1 + .1 * (1 - k) * (1 - k);
  const wide = K.W > K.H * 1.2, m = Math.min(K.W, K.H);
  // landscape: to the right of the lane, like the game; portrait: centred above the notes
  const y = K.H * (wide ? .52 : .34), edge = X(24, (y - K.sy) / (K.jy - K.sy));
  const x = wide ? (edge + K.W - K.safe.r) / 2 : K.cx;
  const tier = !s.bad && !s.miss ? (!s.great && !s.good ? 'combo_ap' : 'combo_fc') : 'combo_n', img = HUD[tier];
  if (!img) return drawComboText(s, x, y, sc, wide);
  const yc = y - m * (wide ? .049 : .036);   // where the old text's middle was (y was its baseline)
  const R = CRECT[tier], sz = m * (wide ? .105 : .078) / 121, digits = [...String(s.combo)].map(Number);
  const gap = 6, adv = digits.map(d => R.fill[d][2] + gap), tw = adv.reduce((a, b) => a + b, 0) - gap;
  spr(img, R.title, x, yc - (60 + 8 + R.title[3] / 2) * sz, sz * .95);
  g.save(); g.translate(x, yc); g.scale(sc, sc);
  let cx = -tw / 2 * sz;
  for (let i = 0; i < digits.length; i++) {
    const d = digits[i], mid = cx + R.fill[d][2] / 2 * sz;
    spr(img, R.base[d], mid, 0, sz);
    spr(img, R.fill[d], mid, 0, sz);
    cx += adv[i] * sz;
  }
  g.restore();
}
// without the game's files: the same layout in neon text
function drawComboText(s, x, y, sc, wide) {
  const size = Math.round(Math.min(K.W, K.H) * (wide ? .135 : .1)), ls = Math.round(size * .25);
  g.save(); g.translate(x, y); g.textAlign = 'center';
  neonText('COMBO', 0, -size * .86, `800 ${ls}px ${WORD}`, ls, '#ffe6f3', '#ff5fb4', 'rgba(255,80,170,.9)', Math.round(size * .06));
  g.scale(sc, sc);
  neonText(String(s.combo), 0, 0, `800 ${size}px ${WORD}`, size, ['#fff6fb', '#ffc4e2'], '#ff4fae', 'rgba(255,70,170,.9)', 0, .075);
  g.restore();
}

const RAINBOW = ['#6dff8e', '#6fe6ff', '#6f8bff', '#b36dff', '#ff6fc0'];
function drawJudgement(perf) {
  const j = G.jt; if (!j || perf - j.perf > 520) return;
  const age = perf - j.perf, pop = age < 90 ? 1.3 - .3 * (age / 90) : 1, fade = age < 360 ? 1 : 1 - (age - 360) / 160;
  const m = Math.min(K.W, K.H), img = HUD.judgement;
  g.save(); g.translate(K.cx, K.jy - K.unit * 2.2 - m * .0245); g.scale(pop, pop);   // centred where the old text's middle was
  g.globalAlpha = fade;
  if (img) {
    const sz = m * .068 / 70;   // PERFECT's letters (about 70 of its 87 rows) as tall as the old 0.068-high text
    spr(img, JRECT[j.res], 0, 0, sz);
    if (j.fs) spr(img, JRECT[j.fs], 0, (JRECT[j.res][3] / 2 + 26) * sz, sz * .62);
  } else {
    // the game's PERFECT: white letters, a rainbow edge from green to pink
    const size = Math.round(m * .068), J = JUDGE[j.res], perfect = j.res === 'perfect';
    g.translate(0, m * .0245);
    neonText(J.label, 0, 0, `800 ${size}px ${WORD}`, size, J.a, perfect ? RAINBOW : J.b, perfect ? 'rgba(130,120,255,.8)' : J.b, Math.round(size * .01), .1);
    if (j.fs) {
      const fs = Math.round(size * .36);
      neonText(j.fs, 0, size * .55, `700 ${fs}px ${NUM}`, fs, '#fff', j.fs === 'FAST' ? '#4fa8ff' : '#ff7a5a', 'rgba(0,0,0,0)', Math.round(size * .03));
    }
  }
  g.restore(); g.globalAlpha = 1;
}

export function measAt(t) { const ms = D.chart.mSec; let i = 0; while (i + 1 < ms.length && ms[i + 1] <= t) i++; return i + 1; }

// HUD laid out like the game's: top left the RANK box and its C–SS bar become the current measure and a bar through the
// section with its measures marked, LIVE SCORE becomes the Perfect count; top right, left of the pause button, the
// practice settings stand where the life gauge is. Only the bar's fill changes every frame: the rest is drawn into
// cached layers again when what it shows changes.
const layers = new Map();
function layer(name, key, x, y, w, h, paint) {
  let L = layers.get(name);
  if (!L) layers.set(name, L = {c: document.createElement('canvas'), key: ''});
  if (L.key !== key) {
    L.c.width = Math.max(1, Math.ceil(w * K.dpr)); L.c.height = Math.max(1, Math.ceil(h * K.dpr));
    const q = L.c.getContext('2d'); q.setTransform(K.dpr, 0, 0, K.dpr, -x * K.dpr, -y * K.dpr);
    const main = g; g = q; paint(); g = main;
    L.key = key;
  }
  g.drawImage(L.c, x, y, w, h);
}
// fonts arriving late: redraw everything that cached text
document.fonts?.addEventListener?.('loadingdone', () => { neonCache.clear(); layers.forEach(L => { L.key = ''; }); bgc.key = ''; });

// The game's score underline (Songtitle_base, a blue-to-violet hairline) and the ring at its end (SP_score_underline_deco)
for (const n of ['line', 'deco']) {
  const i = new Image(); i.onload = () => { HUD[n] = i; layers.forEach(L => { L.key = ''; }); }; i.src = `official/hud_${n}.png`;
}
function drawHUD(now) {
  const {W, H, safe} = K, s = G.stats, z = Math.max(.8, Math.min(1.5, H / 430)), C = D.chart;
  const x0 = safe.l + 18 * z, top = safe.t, my = top + 36 * z;
  // a hairline through the section, its measures ticked; the measure we're in to its left
  const bx = x0 + 66 * z, bwid = Math.min(230 * z, W * .3), by = my - 8 * z, bht = 3 * z;
  const span = G.endT - G.A, at = t => bx + bwid * Math.max(0, Math.min(1, (t - G.A) / span));
  g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(bx, by, bwid, bht);
  const prog = Math.max(0, Math.min(1, (now - G.A) / span));
  if (prog > 0) {
    const pg = g.createLinearGradient(bx, 0, bx + bwid, 0);
    pg.addColorStop(0, 'rgba(200,225,255,.85)'); pg.addColorStop(1, '#ffffff');
    g.fillStyle = pg; g.fillRect(bx, by, bwid * prog, bht);
  }
  const meas = measAt(Math.max(0, now)), ny = my + 40 * z;
  const lw = safe.l + Math.max(bx + bwid - safe.l + 14 * z, 300 * z);
  layer('hud', [meas, s.perfect, s.great, s.good, s.bad, s.miss, G.total, D.secA, D.secB, W, H, safe.l, safe.t, K.dpr, !!HUD.line].join('|'), 0, 0, lw, ny + 30 * z, () => {
    g.textAlign = 'left'; g.fillStyle = '#fff';
    g.font = `700 ${Math.round(28 * z)}px ${NUM}`;
    const ms = String(meas), mw = g.measureText(ms).width; g.fillText(ms, x0, my + 3 * z);
    g.font = `600 ${Math.round(10.5 * z)}px ${TXT}`; g.fillStyle = 'rgba(225,230,255,.6)';
    g.fillText(t('hud.bar'), x0 + mw + 4 * z, my + 2 * z);
    g.textAlign = 'center'; g.font = `600 ${Math.round(11 * z)}px ${NUM}`; g.fillStyle = 'rgba(225,230,255,.6)';
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1;
    // numbered every 1, 2, 4 or 8 measures, whichever keeps the numbers apart; the others a fainter tick
    const n = D.secB - D.secA, step = [1, 2, 4, 8, 16].find(k => bwid / Math.max(1, n) * k >= 24 * z) || 32;
    for (let m = D.secA + 1; m <= D.secB; m++) {
      const x = Math.round(at(C.mSec[m - 1])) + .5, num = (m - D.secA) % step === 0;
      g.globalAlpha = num ? 1 : .45;
      g.beginPath(); g.moveTo(x, by - (num ? 2 : 0) * z); g.lineTo(x, by + bht + (num ? 2 : 0) * z); g.stroke();
      if (num && bx + bwid - x >= 8 * z) g.fillText(String(m), x, by - 6 * z);
    }
    g.globalAlpha = 1;
    // Perfect count over the section's notes; the other judgements only once there are any
    g.textAlign = 'left'; g.font = `600 ${Math.round(28 * z)}px ${NUM}`;
    const pStr = String(s.perfect), tStr = '/' + G.total;
    g.fillStyle = '#fff'; g.fillText(pStr, x0, ny);
    const pw = g.measureText(pStr).width;
    g.font = `600 ${Math.round(15 * z)}px ${NUM}`; g.fillStyle = 'rgba(225,230,255,.55)'; g.fillText(tStr, x0 + pw + 2 * z, ny);
    let lx = x0 + pw + g.measureText(tStr).width + 16 * z;
    g.font = `700 ${Math.round(12 * z)}px ${NUM}`;
    for (const k of ['great', 'good', 'bad', 'miss']) {
      if (!s[k]) continue;
      g.fillStyle = JUDGE[k].b; g.fillText(JUDGE[k].label, lx, ny - 1 * z); lx += g.measureText(JUDGE[k].label).width + 4 * z;
      g.fillStyle = '#fff'; g.fillText(String(s[k]), lx, ny - 1 * z); lx += g.measureText(String(s[k])).width + 12 * z;
    }
    const ly = ny + 8 * z, ll = 170 * z;
    if (HUD.line) { g.globalAlpha = .9; g.drawImage(HUD.line, x0, ly - .75 * z, ll, 1.5 * z); g.globalAlpha = 1; }
    else { const lg = g.createLinearGradient(x0, 0, x0 + ll, 0); lg.addColorStop(0, 'rgba(255,255,255,.8)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.fillRect(x0, ly - .6 * z, ll, 1.2 * z); }
    if (HUD.deco) g.drawImage(HUD.deco, x0 - 6 * z, ly - 6 * z, 12 * z, 12 * z);
    g.font = `600 ${Math.round(10.5 * z)}px ${NUM}`; g.fillStyle = 'rgba(225,230,255,.6)'; g.fillText('PERFECT', x0 + 8 * z, ly + 14 * z);
  });
  // practice settings, beside the pause button; on a narrow screen below the judgement line
  const info = [t('hud.info.bars', {a: D.secA, b: D.secB}), t('hud.info.rate', {pct: Math.round(G.rate * 100)}), G.drill || (G.auto ? t('hud.autoplay') : '')].filter(Boolean).join('   ');
  const font = `500 ${Math.round(12 * z)}px ${TXT}`;
  g.font = font;
  const iw = g.measureText(info).width, rx = W - safe.r - 12 - 46 - 12 * z, side = rx - iw - 16 * z >= bx + bwid;
  const ry = side ? top + 12 + 23 : H - safe.b - 18 * z;
  const ix = side ? rx - iw - 40 * z : K.cx - iw / 2 - 4, iwid = side ? iw + 40 * z + 30 : iw + 8;
  K.info = {side, x: side ? rx : K.cx, y: ry + 4.5 * z, z}; // the loop summary lines up under (or above) this text
  layer('info', [info, W, H, safe.r, safe.b, safe.t, K.dpr, z].join('|'), ix, ry - 15 * z, iwid, 30 * z, () => {
    g.font = font; g.textAlign = side ? 'right' : 'center'; g.fillStyle = 'rgba(232,236,255,.62)';
    g.fillText(info, side ? rx : K.cx, ry + 4.5 * z);
  });
  if (now < G.A) {
    const left = (G.A - now) / G.rate, m = Math.min(W, H);
    g.textAlign = 'center';
    g.font = `700 ${Math.round(m * .034)}px ${TXT}`; g.fillStyle = 'rgba(255,255,255,.88)';
    g.fillText(t('hud.startsAt', {a: D.secA}), K.cx, H * .24);
    const cs = Math.round(m * .1);
    neonText(String(Math.ceil(left)), K.cx, H * .24 + m * .11, `800 ${cs}px ${WORD}`, cs, '#f2fbff', '#5f8bff', 'rgba(90,130,255,.8)');
  }
}

let warm = false;
export function render(now) {
  const perf = performance.now(), view = noteViewTime(S.speed), C = D.chart;
  const lo = now - .16 * view, hi = now + view * 1.05;
  if (!warm) warm = fxWarm(g, 4);   // the backdrop covers what it draws
  g.drawImage(backdrop(), 0, 0, K.W, K.H);
  drawLanes(g, perf);
  drawCombo(perf);

  // yatta's order: long and guide bodies, simultaneous lines, long heads, then single notes and guide nodes
  const vis = C.longs.filter(L => L.head <= hi && L.end >= lo);
  const alphaOf = L => !L.inSec ? GHOST : G.solo && L.hand !== G.solo ? .4 : 1;
  for (const L of vis) {
    const ghost = !L.inSec, alpha = alphaOf(L);
    // the body starts at the judge line, or at the head while the head is still waiting to be hit
    const waiting = !ghost && L.headItem && !L.headItem.res;
    drawRibbon(L, now, view, L.guide ? YC.guide : YC.long, alpha, !waiting);
  }
  drawConnectors(C, now, view);
  for (const L of vis) {
    if (L.guide) continue;
    const ghost = !L.inSec, alpha = alphaOf(L);
    for (let i = 1; i < L.nodes.length - 1; i++) {
      const nd = L.nodes[i];
      if (!nd.visible || (ghost ? nd.t < now : nd.item?.res) || nd.t > hi) continue;
      drawNote(nd.l, nd.r, (nd.t - now) / view, 'node', null, L.crit || nd.crit, alpha);
    }
    const E = L.endItem;
    if (E && (ghost ? E.t >= now : !E.res) && E.t <= hi) drawNote(E.l, E.r, (E.t - now) / view, E.kind === 'flick' ? 'flick' : 'end', E.dir, E.crit, alpha);
    const Hd = L.headItem;
    if (Hd && (ghost ? Hd.t >= now : !Hd.res)) {
      drawNote(Hd.l, Hd.r, (Hd.t - now) / view, Hd.kind === 'flick' ? 'flick' : 'head', Hd.dir, Hd.crit, alpha, ghost ? null : L.hand);
    }
  }
  for (const L of vis) {
    if (!L.guide) continue;
    const alpha = alphaOf(L);
    for (const nd of L.nodes) {
      if (!nd.visible || nd.t < now || nd.t > hi) continue;
      drawNote(nd.l, nd.r, (nd.t - now) / view, nd.type === 'flick' ? 'flick' : 'gnode', nd.dir, L.crit || nd.crit, alpha * .9);
    }
  }
  // far notes first so nearer ones overlap them
  const sg = C.singles, i0 = lowerBound(sg, lo);
  let i1 = i0; while (i1 < sg.length && sg[i1].t <= hi) i1++;
  for (let i = i1 - 1; i >= i0; i--) {
    const it = sg[i];
    if (it.inSec ? it.res : it.t < now) continue;
    const alpha = !it.inSec ? GHOST : G.solo && it.hand !== G.solo ? .4 : 1;
    drawNote(it.l, it.r, (it.t - now) / view, it.kind, it.dir, it.crit, alpha, it.inSec ? it.hand : null);
  }
  drawEffects(perf, now);
  drawJudgement(perf);
  drawHUD(now);
}

export function clear() { g.clearRect(0, 0, K.W, K.H); }
