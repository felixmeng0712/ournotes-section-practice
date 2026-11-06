// node tests/combo.mjs: our judged-item count per chart vs the official noteCount (cached charts in data/ only)
import fs from 'fs';
import {parseChart} from '../web/js/chart.js';
const root = new URL('../data/', import.meta.url).pathname;
const rows = [];
for (const f of fs.readdirSync(root + 'MasterParsed/songs')) {
  const s = JSON.parse(fs.readFileSync(root + 'MasterParsed/songs/' + f));
  for (const m of s.meta || []) {
    const p = root + 'Assets/AddressableResources/Live/MusicScore/' + m.filename + '.json';
    if (!fs.existsSync(p)) continue;
    const raw = JSON.parse(fs.readFileSync(p));
    const C = parseChart(raw);
    const ours = C.items.filter(it => !it.free).length;
    const by = {}; for (const it of C.items) { const k = it.kind + '/' + it.role; by[k] = (by[k] || 0) + 1; }
    rows.push({fn: m.filename, title: s.title[1], off: m.noteCount, ours, d: ours - m.noteCount, by});
  }
}
const bad = rows.filter(r => r.d);
console.log(`${rows.length} charts, ${bad.length} differ`);
for (const r of bad.sort((a, b) => Math.abs(b.d) - Math.abs(a.d))) console.log(r.fn, r.title, 'official', r.off, 'ours', r.ours, 'diff', r.d, JSON.stringify(r.by));
