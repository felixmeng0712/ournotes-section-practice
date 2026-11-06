// The game's note skin (skin001) and its way of assembling a note of any width from atlas pieces: tilted side caps, a
// 3-slice body, a centre decoration and the flick arrow (ported from the yatta play view). The atlas comes from the
// user's own game export (web/official/skin001, packed by tools/build_skin.py), or else the yatta simulator's copy
// through the /yatta proxy.
const BASE = 'yatta/_static/notes/live_assets_emblive_note_skin001', LOCAL = 'official/skin001';

let image = null, regions = null;
const cut = new Map(), boundsCache = new Map();
export const skinReady = () => !!regions;

const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const loadImage = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('skin texture')); i.src = src; });

// tools/build_skin.py's atlas: {name: [x, y, w, h, pivotX, pivotY, borderL, borderR, ppu]}, top-down, unrotated, untrimmed
async function loadLocal() {
  const [j, img] = await Promise.all([fetch(LOCAL + '.json').then(r => { if (!r.ok) throw new Error('local skin ' + r.status); return r.json(); }), loadImage(LOCAL + '.png')]);
  const map = new Map();
  for (const [name, [x, y, w, h, px, py, bl, br, ppu]] of Object.entries(j))
    map.set(name, {rect: {x, y: img.naturalHeight - y - h, width: w, height: h}, rot: 0, sourceSize: {width: w, height: h},
      offset: {x: 0, y: 0}, pivot: {x: px, y: py}, border: {left: bl, right: br}, ppu: Math.max(1, ppu)});
  return [img, map];
}

async function loadYatta() {
  const [j, img] = await Promise.all([
    fetch(BASE + '.json').then(r => { if (!r.ok) throw new Error('skin json ' + r.status); return r.json(); }), loadImage(BASE + '.webp')]);
  const meta = {};
  for (const s of Object.values(j.m_SpritesOverrides || {})) if (s?.m_Name) meta[s.m_Name] = s;
  const map = new Map(), rd = j.m_RenderDataMap || [];
  (j.m_PackedSpriteNamesToIndex || []).forEach((name, i) => {
    const r = Array.isArray(rd[i]) ? rd[i][1] : null; if (!r) return;
    const rect = {x: num(r.textureRect?.x), y: num(r.textureRect?.y), width: num(r.textureRect?.width), height: num(r.textureRect?.height)};
    if (rect.width <= 0 || rect.height <= 0) return;
    const m = meta[name], rot = (num(r.settingsRaw) >> 2) & 15;
    map.set(name, {
      rect, rot: rot <= 4 ? rot : 0,
      sourceSize: m ? {width: num(m.m_Rect?.width), height: num(m.m_Rect?.height)} : {width: rect.width, height: rect.height},
      offset: {x: num(r.textureRectOffset?.x ?? m?.m_Offset?.x), y: num(r.textureRectOffset?.y ?? m?.m_Offset?.y)},
      pivot: {x: m?.m_Pivot?.x ?? .5, y: m?.m_Pivot?.y ?? .5},
      border: {left: num(m?.m_Border?.x), right: num(m?.m_Border?.z)},
      ppu: Math.max(1, num(m?.m_PixelsToUnits, 100)),
    });
  });
  return [img, map];
}

export async function loadSkin() {
  for (const load of [loadLocal, loadYatta]) {
    try { [image, regions] = await load(); return true; } catch (e) { console.warn('note skin:', e.message); }
  }
  console.warn('note skin unavailable, using built-in notes');
  return false;
}

// ---------- atlas pieces ----------
const unpackedSize = r => r.rot === 4 ? {width: r.rect.height, height: r.rect.width} : {width: r.rect.width, height: r.rect.height};

// one sprite cut out of the atlas (un-rotated, un-flipped)
function piece(name) {
  let c = cut.get(name);
  if (c) return c;
  const r = regions.get(name); if (!r) return null;
  const {width: s, height: h} = unpackedSize(r), a = r.rect, sy = image.naturalHeight - a.y - a.height;
  c = document.createElement('canvas'); c.width = Math.max(1, Math.round(s)); c.height = Math.max(1, Math.round(h));
  const x = c.getContext('2d');
  switch (r.rot) {
    case 1: x.translate(s, 0); x.scale(-1, 1); break;
    case 2: x.translate(0, h); x.scale(1, -1); break;
    case 3: x.translate(s, h); x.scale(-1, -1); break;
    case 4: x.translate(0, h); x.rotate(-Math.PI / 2); break;
  }
  x.drawImage(image, a.x, sy, a.width, a.height, 0, 0, a.width, a.height);
  cut.set(name, c);
  return c;
}

// size and centre offset of a sprite, in skin units (1 unit = 1 lane)
function bounds(name) {
  let b = boundsCache.get(name);
  if (b) return b;
  const r = regions.get(name); if (!r) return null;
  const {width: w, height: h} = unpackedSize(r);
  b = {width: w / r.ppu, height: h / r.ppu,
    cx: (r.offset.x + w / 2 - r.pivot.x * r.sourceSize.width) / r.ppu,
    cy: (r.offset.y + h / 2 - r.pivot.y * r.sourceSize.height) / r.ppu};
  boundsCache.set(name, b);
  return b;
}

// horizontal 3-slice of the body sprite (fractions of its width)
function slices(name) {
  const r = regions.get(name), t = unpackedSize(r).width;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const a = clamp(r.border.left - r.offset.x, 0, t), b = clamp(r.sourceSize.width - r.border.right - r.offset.x, a, t);
  return [[0, a / t], [a / t, (b - a) / t], [b / t, (t - b) / t]];
}

// draw a piece centred at (x, y), w < 0 meaning mirrored; `sl` = [x, width] fraction of the source
function blit(g, name, x, y, w, h, sl) {
  if (!w || !h) return;
  const src = piece(name); if (!src) return;
  const sx = sl ? sl[0] * src.width : 0, sw = sl ? Math.max(0, sl[1] * src.width) : src.width;
  if (sw <= 0) return;
  g.save(); g.translate(x, y); g.scale(Math.sign(w) || 1, 1);
  g.drawImage(src, sx, 0, sw, src.height, -Math.abs(w) / 2, -h / 2, Math.abs(w), h);
  g.restore();
}

// ---------- note composition ----------
const SIDE = {tap: 'notes_tap_side', flick: 'notes_flick_side', 'flick-left': 'notes_flick_left_side', 'flick-right': 'notes_flick_right_side',
  'slide-start': 'notes_slide_side', 'slide-node': 'notes_slide_connection_side', 'slide-end': 'notes_slide_end_side', trace: 'notes_trace_side'};
const DECO = {tap: 'tap_decoration', flick: 'flick_decoration', 'flick-left': 'flick_left_decoration', 'flick-right': 'flick_right_decoration',
  'slide-start': 'slide_decoration', 'slide-node': 'slide_connection_icon', trace: 'note_trace_3'};
// how far each tilted side cap tucks under the body, by tilt step
const OVER_NOTE = {right: [0, .07, .08, .09, .11, .08, .18], left: [0, .21, .2, .19, .33, .31, 0]};
const OVER_END = {right: [.18, .19, .21, .24, .31, .32, .48], left: [.18, .31, .27, .41, .38, .31, 0]};
const OVER_NONE = {right: [0, 0, 0, 0, 0, 0, 0], left: [0, 0, 0, 0, 0, 0, 0]};
const overhangs = k => k === 'slide-end' ? OVER_END : k === 'slide-node' || k === 'trace' ? OVER_NONE : OVER_NOTE;
const ARROW_STEPS = [5, 7, 10, 13, 16, 19, 21, 99];

// edges further from the centre line use more strongly tilted side caps (perspective of the 3D lane)
const tilt = dist => Math.max(0, Math.min(6, Math.ceil(dist / 2 - 1e-9)));

function parts(kind, lane, width) {
  const n = SIDE[kind] || SIDE.tap, ov = overhangs(kind);
  const r0 = lane, r1 = lane + width, mid = lane + (width - 1) / 2;
  const o = tilt(Math.abs(r0 - 12)), s = tilt(Math.abs(r1 - 12));
  const R = (t, flip) => ({name: t === 0 ? n + '_R' : n + '_' + t, over: ov.right[t] ?? 0, flip});
  const L = (t, flip) => ({name: t === 0 ? n + '_L' : n + '_' + (t === 6 ? -4 : -t), over: ov.left[t] ?? 0, flip});
  const sides = r0 < 12 && r1 > 12 ? [R(o, true), R(s, false)] : mid < 11.5 ? [R(o, true), L(s, true)] : [L(o, false), R(s, false)];
  return {main: n + '_0', left: sides[0], right: sides[1]};
}

function arrowName(kind, width) {
  if (kind === 'flick') return 'notes_flick_arrow_upper_' + (width < 5 ? 'S' : width < 12 ? 'M' : width < 17 ? 'L' : 'LL');
  if (kind !== 'flick-left' && kind !== 'flick-right') return null;
  const i = ARROW_STEPS.findIndex(t => width < t);
  return `notes_flick_arrow_${kind === 'flick-left' ? 'left' : 'right'}_${String(i < 0 ? 8 : i + 1).padStart(2, '0')}`;
}

// kind: tap | flick | flick-left | flick-right | trace | slide-*; (cx, cy) note centre in px; d = px per lane unit;
// sy stretches the note vertically (the game shows notes standing up, ~1.7x as thick as yatta's flat ones)
export function paintNote(g, kind, lane, width, cx, cy, d, sy = 1) {
  const P = parts(kind, lane, width), lb = bounds(P.left.name), rb = bounds(P.right.name), mb = bounds(P.main);
  if (!lb || !rb || !mb) return false;
  const mr = regions.get(P.main);
  const n = lb.width, r = rb.width, s = P.left.over, c = P.right.over;
  const p = Math.max(.001, width - n - r + s + c), m = (n - r + c - s) / 2;
  let hL = Math.max(0, mr.border.left) / mr.ppu, hR = Math.max(0, mr.border.right) / mr.ppu;
  const k = hL + hR > p && hL + hR > 0 ? p / (hL + hR) : 1; hL *= k; hR *= k;
  const mid = Math.max(0, p - hL - hR), sl = slices(P.main);
  const at = (x, y) => [cx + x * d, cy - y * d * sy];
  let [x, y] = at(-width / 2 + n / 2 - s + (P.left.flip ? -lb.cx : lb.cx), lb.cy);
  blit(g, P.left.name, x, y, (P.left.flip ? -n : n) * d, lb.height * d * sy);
  [x, y] = at(width / 2 - r / 2 + c + (P.right.flip ? -rb.cx : rb.cx), rb.cy);
  blit(g, P.right.name, x, y, (P.right.flip ? -r : r) * d, rb.height * d * sy);
  for (const [qx, qw, slice] of [[m - p / 2 + hL / 2, hL, sl[0]], [m + (hL - hR) / 2, mid, sl[1]], [m + p / 2 - hR / 2, hR, sl[2]]]) {
    [x, y] = at(qx, 0);
    blit(g, P.main, x, y, qw * d, mb.height * d * sy, slice);
  }
  const deco = DECO[kind], db = deco && bounds(deco), ds = Math.sqrt(sy);   // the centre mark grows less than the note
  if (db) { [x, y] = at(db.cx, db.cy); blit(g, deco, x, y, db.width * d * ds, db.height * d * ds); }
  const an = arrowName(kind, width), ab = an && bounds(an);
  if (ab) {
    const up = kind === 'flick', sc = up ? .8 : 1, rot = kind === 'flick-left' ? Math.PI : 0;
    const lx = ab.cx * sc, ly = ab.cy * sc, cs = Math.cos(rot), sn = Math.sin(rot);
    // the arrow keeps its size; it only moves up by the extra half thickness of a stretched note
    x = cx + (lx * cs - ly * sn) * d; y = cy - ((up ? 1.15 : 1) + lx * sn + ly * cs + (sy - 1) * .4) * d;
    g.save(); g.translate(x, y); g.rotate(-rot);
    blit(g, an, 0, 0, ab.width * sc * d, ab.height * sc * d);
    g.restore();
  }
  return true;
}
