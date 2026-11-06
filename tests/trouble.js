// node tests/trouble.js <outdir> [w h]: fake history with repeated misses → trouble list, strip rings, offset hint
const { chromium } = require('playwright-core');
const [out = require('os').tmpdir(), w = '1280', h = '800'] = process.argv.slice(2);
(async () => {
  const br = await chromium.launch({ channel: 'chrome', headless: true });
  const errs = [];
  const p = await br.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8765/');
  await p.waitForFunction(() => window.__bdon && !document.getElementById('btnStart').disabled, null, { timeout: 90000 });
  const info = await p.evaluate(() => {
    const B = __bdon, C = B.D.chart;
    B.setSection(34, 41);
    const t0 = C.mSec[33], t1 = C.mSec[41];
    const idx = C.items.map((it, i) => [it, i]).filter(([it]) => it.t >= t0 && it.t < t1 && it.role !== 'hold').map(([, i]) => i);
    const pick = [idx[3], idx[10], idx[17]];
    const hist = [];
    for (let n = 0; n < 6; n++) {
      const miss = [];
      if (n % 3 !== 2) miss.push([pick[0], 'great', 30 + n]);
      if (n < 4) miss.push([pick[1], n ? 'miss' : 'good', n ? null : -60]);
      if (n === 1) miss.push([pick[2], 'great', 40]);
      hist.push({n: 6 - n, p: 50, gr: 1, gd: 0, b: 0, m: 1, max: 40, total: 59, avg: 22, auto: false, solo: null, rate: 1, off: 0, at: Date.now(), miss});
    }
    localStorage.setItem('bdonp:hist:' + B.D.fn + ':34-41', JSON.stringify(hist));
    B.setSection(1, 2); B.setSection(34, 41);
    return pick;
  });
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('coachPanel').scrollIntoView());
  await p.screenshot({ path: out + '/trouble_coach.png' });
  await p.evaluate(() => document.getElementById('histPanel').scrollIntoView());
  await p.screenshot({ path: out + '/trouble_hist.png' });
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes(':34-41')) localStorage.removeItem(k); });
  console.log(info, errs);
  await br.close();
})();
