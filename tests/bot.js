// node tests/bot.js <songId> <diff> <mA|all> <mB> <rate> [port]
const { chromium } = require('playwright-core');
const [song, diff, a, b, rate, port = '8765'] = process.argv.slice(2);
(async () => {
  const br = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
  const p = await br.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`http://localhost:${port}/`);
  await p.waitForFunction(() => window.__bdon && !document.getElementById('btnStart').disabled, null, { timeout: 90000 });
  await p.evaluate(async ([song, diff]) => { await __bdon.selectSong(+song, +diff); }, [song, diff]);
  await p.waitForFunction(() => !document.getElementById('btnStart').disabled, null, { timeout: 90000 });
  await p.evaluate(([a, b, rate]) => { const B = __bdon; const M = B.D.chart.mSec.length;
    B.setSection(a === 'all' ? 1 : +a, a === 'all' ? M : +b); B.S.auto = false; B.S.loop = false; B.S.rate = +rate; B.S.pre = 1; }, [a, b, rate]);
  await p.evaluate(() => {
    const B = __bdon, K = B.K;
    const sx = u => K.cx + (u - 12) * K.unit, sy = () => K.jy;
    let pid = 100; const done = new Set(); const live = [];
    const ev = (id, u, dy = 0, dxpx = 0) => ({ pointerId: id, clientX: sx(u) + dxpx, clientY: sy() + dy, timeStamp: performance.now(), preventDefault() {} });
    const off = 0.004;
    function tick() {
      if (!B.G.on) return;
      requestAnimationFrame(tick);
      const now = B.songAt(performance.now()), C = B.D.chart;
      for (const it of C.items) {
        if (!it.inSec || done.has(it) || it.role === 'hold' || it.role === 'end' || it.role === 'conn') continue;
        if (it.t > now + off) continue;
        done.add(it);
        const u = (it.l + it.r) / 2, id = pid++;
        if (it.kind === 'trace' && it.role !== 'head') {   // presence only: slide a finger there, no fresh press
          B.PTR.set(id, { id, x: u, half: 0, kb: false, hist: [] }); setTimeout(() => B.PTR.delete(id), 60); continue;
        }
        B.ptrDown(ev(id, u));
        if (it.kind === 'flick') {
          const dx = it.dir === 'left' ? -40 : it.dir === 'right' ? 40 : 0, dy = it.dir ? -10 : -40;
          B.ptrMove(Object.assign(ev(id, u, dy, dx), { getCoalescedEvents: null }));
        }
        if (it.role === 'head') { live.push({ id, L: it.long }); it.long.bot = true; }
        else setTimeout(() => B.ptrUp(ev(id, u)), 50);
      }
      for (const L of C.longs) {   // longs with no head to tap (hidden start)
        if (!L.inSec || L.guide || L.headItem || L.bot || now < L.head - off) continue;
        L.bot = true; const [l, r] = B.evalPath(L.path, L.head), id = pid++;
        B.ptrDown(ev(id, (l + r) / 2)); live.push({ id, L });
      }
      for (let i = live.length - 1; i >= 0; i--) {
        const { id, L } = live[i];
        const [l, r] = B.evalPath(L.path, Math.min(now, L.end)), u = (l + r) / 2;
        if (now >= L.end - off) {
          const next = C.longs.find(L2 => !L2.guide && !L2.headItem && !L2.bot && L2.inSec && Math.abs(L2.head - L.end) < 1e-4 && Math.abs((L2.nodes[0].l + L2.nodes[0].r) / 2 - u) < 3);
          if (next && L.endItem?.kind !== 'flick') { next.bot = true; live[i].L = next; continue; }
          if (L.endItem?.kind === 'flick') { const d = L.endItem.dir; B.ptrMove(ev(id, u, d ? -10 : -40, d === 'left' ? -40 : d === 'right' ? 40 : 0)); }
          B.ptrUp(ev(id, u)); live.splice(i, 1);
        } else B.ptrMove(ev(id, u));
      }
    }
    window.__bot = tick;
  });
  await p.click('#btnStart');
  await p.evaluate(() => requestAnimationFrame(__bot));
  await p.waitForFunction(() => !__bdon.G.on, null, { timeout: 600000, polling: 500 });
  const r = await p.evaluate(() => {
    const D = __bdon.D;
    const bad = D.chart.items.filter(i => i.inSec && i.res !== 'perfect').map(i => ({ res: i.res, kind: i.kind, role: i.role, t: +i.t.toFixed(3), dir: i.dir }));
    const h = { ...D.hist[0] }; delete h.dts;
    return { song: D.song.id, sec: [D.secA, D.secB], hist: h, nonPerfect: bad.slice(0, 8), kinds: bad.reduce((m, x) => (m[x.res + ':' + x.kind + '/' + x.role] = (m[x.res + ':' + x.kind + '/' + x.role] || 0) + 1, m), {}) };
  });
  console.log(JSON.stringify(r), errs);
  await br.close();
})();
