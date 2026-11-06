// node tests/shots.js <outdir> <prefix> [w h]: the setup screen, scrolled through, plus portrait
const { chromium } = require('playwright-core');
const [out, pre, w = '932', h = '430'] = process.argv.slice(2);
(async () => {
  const br = await chromium.launch({ channel: 'chrome', headless: true });
  const errs = [];
  const p = await br.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8765/');
  await p.waitForFunction(() => window.__bdon && !document.getElementById('btnStart').disabled, null, { timeout: 90000 });
  await p.evaluate(() => __bdon.setSection(34, 41));
  await p.waitForTimeout(900);
  const H = await p.evaluate(() => { const s = document.getElementById('stage'); return [s.scrollHeight, s.clientHeight]; });
  const sh = await p.evaluate(() => getComputedStyle(document.getElementById('setup')).overflowY);
  let i = 0;
  for (let y = 0; ; y += Math.round(H[1] * .85), i++) {
    await p.evaluate(y => { document.getElementById('stage').scrollTop = y; document.getElementById('setup').scrollTop = y; }, y);
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${out}/${pre}_${i}.png` });
    if (y + H[1] >= H[0] || i > 8) break;
  }
  console.log(H, sh, errs);
  await br.close();
})();
