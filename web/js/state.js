// Shared constants and mutable state. Every other module imports from here.
import {t} from './i18n.js';

export const BASE = 'yatta/';    // server.py proxies this to bdon.yatta.moe and caches it under data/
export const TPB = 480;          // chart ticks per beat (verified against audio)
// Real-time seconds, from MasterLiveJudgementTiming (assist level 0, via bdon.yatta.moe); the note → judgement type
// mapping follows the game's ConvertJudgementType. Taps and long starts (types 1, 10): a touch 125–130 ms off still
// takes the note, as a Miss.
export const WIN = {perfect: .050, great: .083, good: .100, bad: .125, miss: .130};
// Critical (gold) taps and long starts (types 2, 15): Perfect within 67 ms, otherwise Miss — no Great / Good / Bad.
// Trace notes and a long's relay nodes / hold ticks (types 21, 22): there within 67 ms of the note is Perfect.
export const CRIT_WIN = {perfect: .067, miss: .130};
export const TRACE_WIN = {perfect: .067, miss: .130};
// Flicks (judgement types 5 and 12 in that table, by their shape): Perfect from 83 ms early to 67 ms late; a swipe more
// than 83 ms early is not judged at all (the motion just continues into the window), late ones degrade to Miss at 130 ms.
export const FLICK_WIN = {early: .083, perfect: .067, great: .083, good: .117, bad: .125, miss: .130};
// A long's end released up to 84 ms early is Perfect (type 11); released earlier it stays open (re-grab or Miss).
export const RELEASE_EARLY = .084;
// iOS WebKit sometimes stamps a touch with the time of an older touch (seen up to 0.5 s back while another finger is
// down): pointer timestamps further back than this are replaced by the time the event is handled.
export const STAMP_SLACK = .034;
// The game shifts touches 20 ms later on iPhone 13 and newer (MasterLiveSettings IPhone13_greaterEqual_input_offset_ms);
// the web page cannot tell the model, so every iPhone gets it. Logs before this showed taps a steady ~22 ms early.
export const INPUT_LAG = /iPhone/.test(navigator.userAgent) ? .020 : 0;
export const FLICK_PX = 22, TOUCH_PAD = 1.0, HOLD_PAD = 2.5;
export const KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];
export const KEY_LABEL = ['A', 'S', 'D', 'F', 'J', 'K', 'L', ';'];
export const DIFF = [
  {name: 'Easy', col: '#5fd88a'}, {name: 'Normal', col: '#55b4ff'}, {name: 'Hard', col: '#ffb547'},
  {name: 'Expert', col: '#ff5a76'}, {name: 'Special', col: '#c77dff'},
];
// colours of the game's result screen: a: the word's fill, b: its edge (and the colour used alone)
export const JUDGE = {
  perfect: {label: 'PERFECT', a: '#f4fffb', b: '#74e6c8'},
  great: {label: 'GREAT', a: '#ffe4f0', b: '#ff5fa2'},
  good: {label: 'GOOD', a: '#e2ffe6', b: '#5ad67a'},
  bad: {label: 'BAD', a: '#e0e3ff', b: '#7b84ff'},
  miss: {label: 'MISS', a: '#ffffff', b: '#c3c7da'},
};

export const asset = {
  songs: () => 'MasterParsed/songs.json',
  song: id => 'MasterParsed/songs/' + id + '.json',
  chart: fn => 'Assets/AddressableResources/Live/MusicScore/' + fn + '.json',
  audio: f => 'Assets/AddressableResources/Cri/Sound/MusicScore/' + f + '.opus',
  jacket: j => 'Assets/AddressableResources/Image/Jacket/' + j + '.webp',
};

export const $ = id => document.getElementById(id);
export const store = {
  get(k, d) { try { const v = localStorage.getItem('bdonp:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bdonp:' + k, JSON.stringify(v)); } catch {} },
};
export const S = Object.assign({rate: 1, speed: 9, pre: 2, offset: 0, tin: 0, mvol: .8, svol: .6, se: 'default', loop: true, auto: false, keys: false, hands: false,
  out: 'normal', profiles: {}}, store.get('settings', {}));
S.speed = Math.min(12, Math.max(1, S.speed));
// Like the game, which keeps Bluetooth copies of chart position, note timing and the live volumes and uses them while a
// Bluetooth audio device is connected: the values in S are those of the output profile S.out ('normal' or 'bt'), and
// useOutput swaps them. offset is the chart position (moves notes and judgement), tin the note timing (touches only).
export const PROFILE_KEYS = ['offset', 'tin', 'mvol', 'svol'];
const profileOf = () => Object.fromEntries(PROFILE_KEYS.map(k => [k, S[k]]));
export const saveSettings = () => { S.profiles[S.out] = profileOf(); store.set('settings', S); };
// switch to another output's values; first: the values a profile starts with when it has none yet
// the audio output as the iOS app reports it (AudioRoute.swift); web: how much latency the page's clock already takes off
export const ROUTE = {kind: '', name: '', latency: 0, web: 0};
export function useOutput(out, first) {
  if (out === S.out) return false;
  S.profiles[S.out] = profileOf();
  Object.assign(S, S.profiles[out] || first || {});
  S.out = out;
  saveSettings();
  return true;
}

// D: what is selected on the song screen. G: the running game. PTR: active pointers / keys.
export const D = {songs: [], refs: null, song: null, diff: -1, chart: null, fn: null, buffer: null, bufferFor: null, secA: 1, secB: 1, hist: [], token: 0};
export const G = {on: false, paused: false, src: null, startCtx: 0, songStart: 0, rate: 1, A: 0, B: 0, endT: 0, total: 0,
  stats: null, attempt: 0, auto: false, solo: null, loop: true, effects: [], jt: null, comboPerf: 0, pausedAt: 0};
export const PTR = new Map();

export const fmtTime = t => { t = Math.max(0, t); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
export const lowerBound = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t < t) lo = m + 1; else hi = m; } return lo; };
export const isFC = r => !r.m && !r.b;   // Bad and Miss both break combo
export const isAP = r => isFC(r) && !r.gr && !r.gd;

// Note speed → seconds a note is on screen. Same curve as the game's speed setting (constants from the yatta simulator).
export function noteViewTime(speed) {
  const s = Math.min(12, Math.max(1, speed));
  return Math.ceil(1000 * (4 - 3.65 * (1 - Math.pow(1 - (s - 1) / 11, 1.30999994)))) / 1000;
}

export async function getJSON(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) {
    const e = new Error(r.status === 504 ? t('err.noCache') : 'HTTP ' + r.status);
    e.offline = r.status === 504;
    throw e;
  }
  return r.json();
}
