// node tests/backup.js: export → change local data → import; checks the merge rules (attempts joined, local settings kept)
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const br = await chromium.launch({ channel: 'chrome', headless: true });
  const errs = [];
  const ctx = await br.newContext({ acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8765/');
  await p.waitForFunction(() => window.__bdon && !document.getElementById('btnStart').disabled, null, { timeout: 90000 });
  await p.evaluate(() => {
    localStorage.setItem('bdonp:hist:x:1-2', JSON.stringify([{ at: 3, p: 1 }, { at: 2, p: 1 }]));
    localStorage.setItem('bdonp:ladder:x:1-2', '0.8');
    localStorage.setItem('bdonp:settings', JSON.stringify({ offset: 40 }));
  });
  await p.evaluate(() => document.getElementById('backup').open = true);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btnExport')]);
  const file = path.join(os.tmpdir(), 'onp-backup-test.json');
  await dl.saveAs(file);
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  const msg1 = await p.textContent('#backupMsg');
  // this device: a newer attempt, one attempt lost, no drill progress, a different offset
  await p.evaluate(() => {
    localStorage.setItem('bdonp:hist:x:1-2', JSON.stringify([{ at: 4, p: 0 }, { at: 3, p: 1 }]));
    localStorage.removeItem('bdonp:ladder:x:1-2');
    localStorage.setItem('bdonp:settings', JSON.stringify({ offset: -20 }));
  });
  await p.setInputFiles('#importFile', file);
  await p.waitForFunction(() => /导入|没有新增/.test(document.getElementById('backupMsg').textContent));
  const after = await p.evaluate(() => ({
    hist: JSON.parse(localStorage.getItem('bdonp:hist:x:1-2')).map(r => r.at),
    ladder: localStorage.getItem('bdonp:ladder:x:1-2'),
    offset: JSON.parse(localStorage.getItem('bdonp:settings')).offset,
    msg: document.getElementById('backupMsg').textContent,
  }));
  await p.setInputFiles('#importFile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await p.waitForFunction(m => document.getElementById('backupMsg').textContent !== m, after.msg);
  const bad = await p.textContent('#backupMsg');
  console.log({ name: dl.suggestedFilename(), keys: Object.keys(exported.data).length, msg1, ...after, bad, errs });
  const ok = after.hist.join() === '4,3,2' && after.ladder === '0.8' && after.offset === -20 && /不是/.test(bad) && !errs.length;
  console.log(ok ? 'PASS' : 'FAIL');
  await br.close();
  process.exit(ok ? 0 : 1);
})();
