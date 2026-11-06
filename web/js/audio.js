// Audio: context, volume, the game's hit sounds (synthesized stand-ins until they load), Opus decoding, and the clock used for judgement.
import {S} from './state.js';
import {t} from './i18n.js';

const AC = window.AudioContext || window.webkitAudioContext;
// iPhone: keep playing with the ring/silent switch on (Safari 16.4+, and the iOS app)
if (navigator.audioSession) navigator.audioSession.type = 'playback';
export const ac = new AC({latencyHint: 'interactive'});
export const musicGain = ac.createGain();
const sfxGain = ac.createGain();
musicGain.connect(ac.destination); sfxGain.connect(ac.destination);
export const applyVol = () => { musicGain.gain.value = S.mvol; sfxGain.gain.value = S.svol; };
applyVol();

const SFX = {};
// Stand-in hit sounds, synthesized: a short band-passed noise "tick" for the attack plus a quick high ping, so they cut
// through the music without a boomy tail.
(function synth() {
  const sr = ac.sampleRate;
  const buf = (dur, peak, fill) => {
    const n = Math.floor(sr * dur), d = new Float32Array(n);
    fill(d);
    let m = 0; for (const v of d) m = Math.max(m, Math.abs(v));
    const b = ac.createBuffer(1, n, sr), out = b.getChannelData(0);
    for (let i = 0; i < n; i++) out[i] = d[i] / (m || 1) * peak * Math.min(1, (n - i) / (sr * .004));   // 4 ms fade-out
    return b;
  };
  // band-passed white noise with an envelope; f(t) may sweep
  const noise = (d, f, q, env, gain = 1) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0, b2, a1, a2;
    for (let i = 0; i < d.length; i++) {
      if (i % 16 === 0) { const w = 2 * Math.PI * f(i / sr) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al; b0 = al / a0; b2 = -al / a0; a1 = -2 * Math.cos(w) / a0; a2 = (1 - al) / a0; }
      const x = Math.random() * 2 - 1, y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      d[i] += y * env(i / sr) * gain;
    }
  };
  const ping = (d, f, decay, gain) => { for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * decay) * gain; } };
  const tick = d => { noise(d, () => 4200, .8, t => Math.exp(-t * 300)); ping(d, 2350, 110, .32); ping(d, 4700, 190, .12); };
  SFX.perfect = buf(.07, .9, tick);
  SFX.flick = SFX.flick_side = buf(.13, .75, d => { noise(d, t => 2600 + 70000 * t, 1.1, t => Math.min(1, t / .006) * Math.exp(-t * 32)); ping(d, 3100, 150, .25); });
  SFX.trace = buf(.04, .45, d => { noise(d, () => 6500, 1.4, t => Math.exp(-t * 420)); ping(d, 3500, 160, .2); });
})();
// The game's note sounds (Cri/Sound, exported from the user's game files into web/official/se as WAV), one of its four
// sets (default | solid | typing | wood, the game's NoteSePatternId): perfect / great / good for taps and holds'
// heads and ends by grade, flick, flick_side for a directional flick, trace, in_vain for a touch that found no note,
// and the hold loop long_1 (+ long_2: only default's cue has two layers).
export const SE_SETS = ['default', 'solid', 'typing', 'wood'];
const SE_NAMES = ['perfect', 'great', 'good', 'flick', 'flick_side', 'trace', 'in_vain', 'long_1', 'long_2'];
const LOOP = [['long_1', .85], ['long_2', .75]];
let seSet = null;
export function loadSeSet(set) {
  if (!SE_SETS.includes(set)) set = 'default';
  if (set === seSet) return;
  if (seSet) holdSe(false);   // (not on the first call: holdSe's state is declared below)
  seSet = set;
  for (const n of SE_NAMES) {
    if (n === 'long_2' && set !== 'default') { SFX.long_2 = null; continue; }
    const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(ab => decodeShort(ab));
    // without the game's files (web/official is not distributed): yatta's default set, else the synthesized stand-in
    get(`official/se/${set}_${n}.wav`)
      .catch(e => { if (!YATTA_SE.includes(n)) throw e; return get(`yatta/_static/sounds/default_${n}.opus`); })
      .then(b => { if (seSet === set) SFX[n] = b; })
      .catch(e => console.log('[bdon] hit sound', set, n, 'not loaded:', e.message || e));
  }
}
const YATTA_SE = ['perfect', 'flick', 'flick_side', 'trace', 'long_1', 'long_2'];
loadSeSet(S.se);
// as the game: a sound plays once per frame however many notes asked for it
const lastAt = {};
export function sfx(name) {
  const b = SFX[name] || (name === 'great' || name === 'good' ? SFX.perfect : null), now = performance.now();
  if (!b || now - (lastAt[name] || -1e9) < 12) return;
  lastAt[name] = now;
  const s = ac.createBufferSource(); s.buffer = b; s.connect(sfxGain); s.start();
}
// the looped hold sound, on while any long is held (the game's UpdateLongLineSe)
let loop = null;
export function holdSe(on) {
  if (!on) { if (loop) { for (const s of loop) { try { s.stop(); } catch {} s.disconnect(); } loop = null; } return; }
  if (loop || !SFX.long_1) return;
  loop = LOOP.filter(([n]) => SFX[n]).map(([n, v]) => {
    const s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = SFX[n]; s.loop = true; g.gain.value = v; s.connect(g); g.connect(sfxGain); s.start();
    return s;
  });
}

// WebKit on iOS interrupts an AudioContext that has had nothing to play for about a second: its clock stops and
// only a tap can restart it (that is what the song list → play, pause → 从头再来 transitions ran into). An inaudible
// (−100 dB) loop keeps it busy for as long as the app is in front.
let keep = null;
export function keepAlive() {
  if (keep || ac.state !== 'running') return;
  const b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() - .5) * 2e-5;
  keep = ac.createBufferSource(); keep.buffer = b; keep.loop = true; keep.connect(ac.destination); keep.start();
}

// The context can also stop rendering while still saying 'running' (seen on iOS): currentTime then stands still.
let ctSeen = -1, ctPerf = 0;
export const resetStall = () => { ctSeen = -1; };   // when (re)starting playback: the time spent paused doesn't count
export function audioStalled() {
  const pn = performance.now();
  if (ac.currentTime !== ctSeen) {
    if (ctSeen >= 0 && pn - ctPerf > 250) console.log('[bdon] audio clock paused for', Math.round(pn - ctPerf), 'ms');
    ctSeen = ac.currentTime; ctPerf = pn; return false;
  }
  return ac.state === 'running' && pn - ctPerf > 1000;
}

// Map a performance.now()-domain timestamp to the AudioContext clock *as heard*. getOutputTimestamp is the precise
// source, but after the context stalls iOS keeps returning the old timestamp for a while, and extrapolating from it
// runs seconds ahead of the real clock; so it is only trusted while it agrees with currentTime.
let lastWarn = 0;
export function ctxTimeAt(perf) {
  const pn = performance.now(), coarse = ac.currentTime - (ac.outputLatency || ac.baseLatency || 0);
  let t = coarse;
  const ts = ac.state === 'running' && ac.getOutputTimestamp ? ac.getOutputTimestamp() : null;
  if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
    const fine = ts.contextTime + (pn - ts.performanceTime) / 1000;
    if (Math.abs(fine - coarse) < .06) t = fine;
    else if (pn - lastWarn > 1000) { lastWarn = pn; console.log('[bdon] clock: output timestamp off by', Math.round((fine - coarse) * 1000), 'ms, using currentTime'); }
  }
  return t + (perf - pn) / 1000;
}

// Safari cannot decode Ogg Opus natively; fall back to a bundled WebAssembly decoder.
let wasm = null;
function loadWasm() {
  wasm = wasm || new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'vendor/ogg-opus-decoder.min.js';
    s.onload = () => ok(window['ogg-opus-decoder']);
    s.onerror = () => fail(new Error(t('err.opus')));
    document.head.append(s);
  });
  return wasm;
}
async function decodeWasm(ab) {
  const {OggOpusDecoder} = await loadWasm();
  const dec = new OggOpusDecoder();
  await dec.ready;
  try {
    const {channelData, samplesDecoded, sampleRate} = await dec.decodeFile(new Uint8Array(ab));
    if (!samplesDecoded) throw new Error(t('err.opusEmpty'));
    const buf = ac.createBuffer(channelData.length, samplesDecoded, sampleRate);
    channelData.forEach((d, i) => buf.copyToChannel(d.subarray(0, samplesDecoded), i));
    return buf;
  } finally { dec.free(); }
}
async function decodeShort(ab) {
  try {
    const buf = await new Promise((ok, fail) => { const p = ac.decodeAudioData(ab.slice(0), ok, fail); if (p && p.catch) p.catch(fail); });
    if (buf && buf.duration > 0) return buf;
  } catch {}
  return decodeWasm(ab);
}
export let decoderUsed = 'native';
export async function decode(ab) {
  if (!new URLSearchParams(location.search).has('wasm')) {
    try {
      const buf = await new Promise((ok, fail) => { const p = ac.decodeAudioData(ab.slice(0), ok, fail); if (p && p.catch) p.catch(fail); });
      if (buf && buf.duration > 1) { decoderUsed = 'native'; return buf; }
    } catch {}
  }
  decoderUsed = 'wasm';
  return decodeWasm(ab);
}
