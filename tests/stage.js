// node tests/stage.js <outdir> <prefix> [song diff a b w h]: auto-play a section and screenshot the stage a few times
const { chromium } = require('playwright-core');
const [out, pre, song = '100020', diff = '3', a = '20', b = '27', w = '932', h = '430'] = process.argv.slice(2);
(async () => {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const p = await br.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8765/');
  await p.waitForFunction(() => window.__bdon && !document.getElementById('btnStart').disabled, null, { timeout: 90000 });
  await p.evaluate(([s, d]) => __bdon.selectSong(+s, +d), [song, diff]);
  await p.waitForFunction(() => !document.getElementById('btnStart').disabled, null, { timeout: 90000 });
  await p.evaluate(([a, b]) => __bdon.setSection(+a, +b), [a, b]);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/${pre}_setup.png` });
  await p.evaluate(() => { const o = document.getElementById('optAuto'); if (!o.checked) o.click(); __bdon.start(); });
  for (const [i, t] of [[0, 3200], [1, 1700], [2, 1900]]) { await p.waitForTimeout(t); await p.screenshot({ path: `${out}/${pre}_play${i}.png` }); }
  console.log(errs);
  await br.close();
})();
