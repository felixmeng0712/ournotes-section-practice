// node tests/perf.js [noshadow] [cpu]: auto-play a section and time every animation frame's callback (JS + canvas work)
// with the CPU slowed down `cpu` times (default 4, roughly a phone); noshadow turns canvas shadowBlur off to see its cost
const { chromium } = require('playwright-core');
const [mode = '', cpu = '4'] = process.argv.slice(2);
(async () => {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await br.newPage({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await p.addInitScript(m => {
    if (m === 'noshadow') Object.defineProperty(CanvasRenderingContext2D.prototype, 'shadowBlur', { set() {}, get() { return 0; } });
    const raf = window.requestAnimationFrame.bind(window);
    window.__ft = [];
    window.requestAnimationFrame = cb => raf(t => { const s = performance.now(); cb(t); window.__ft.push(performance.now() - s); });
  }, mode);
  await p.goto(process.env.URL || 'http://localhost:8765/');
  await p.waitForFunction(() => window.__bdon && !document.getElementById('btnStart').disabled, null, { timeout: 90000 });
  await p.evaluate(() => __bdon.selectSong(100020, 3));
  await p.waitForFunction(() => !document.getElementById('btnStart').disabled, null, { timeout: 90000 });
  await p.evaluate(() => __bdon.setSection(20, 27));
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: +cpu });
  await p.evaluate(() => { const o = document.getElementById('optAuto'); if (!o.checked) o.click(); __bdon.start(); });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { window.__ft.length = 0; });
  await p.waitForTimeout(6000);
  const ft = await p.evaluate(() => window.__ft.slice());
  ft.sort((a, b) => a - b);
  const q = k => ft[Math.floor(ft.length * k)].toFixed(1);
  console.log(mode || 'normal', 'cpu x' + cpu, 'frames', ft.length, 'median', q(.5), 'p90', q(.9), 'p99', q(.99), 'max', ft[ft.length - 1].toFixed(1), 'ms');
  await br.close();
})();
