// Usage: PORT=4188 node filmcap.mjs <outdir> <W> <H> <fps> <from> <to> <slow> [q=2] [every=1]
// Films the Argo's crossing of the wormhole by Saturn frame by frame on a virtual clock: the page's
// requestAnimationFrame, performance.now and Date.now are replaced, the game runs freely until it is
// ready, then each frame is stepped by hand and read straight off the canvas (JPEG).
// <from>/<to>: seconds into the crossing (runtime.transit.t) to film; <slow>: film seconds per game second.
// Frames are written at <fps> * <slow> per game second; blend them with ffmpeg tmix for motion blur.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, W, H, fpsArg, fromArg, toArg, slowArg, q = '2', everyArg = '1'] = process.argv;
const fps = +fpsArg; const from = +fromArg; const to = +toArg; const slow = +slowArg; const every = +everyArg;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); });
await page.addInitScript(() => {
  // Virtual time: free-running (tracking real time) until __vt.hold(), then only __vt.step(ms) moves it.
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  let now = realNow(); let held = false; let last = realNow(); let id = 0;
  const queue = new Map();
  const run = () => { const cbs = [...queue.values()]; queue.clear(); for (const cb of cbs) { try { cb(now); } catch (e) { console.error(e); } } };
  const tick = () => { if (!held) { const r = realNow(); now += r - last; last = r; run(); } realRaf(tick); };
  realRaf(tick);
  performance.now = () => now;
  const dateBase = Date.now() - now;
  Date.now = () => dateBase + now;
  window.requestAnimationFrame = (cb) => { const i = ++id; queue.set(i, cb); return i; };
  window.cancelAnimationFrame = (i) => { queue.delete(i); };
  window.__vt = { hold: () => { held = true; }, step: (ms) => { now += ms; run(); }, now: () => now };
});
await page.goto(`http://127.0.0.1:${process.env.PORT || 4188}/lab/fly-lab.html?start=projects&landed=1&q=${q}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three && !!window.__compiledAt, null, { timeout: 1800000, polling: 500 });
console.log('ready');
await page.evaluate((m) => { window.__mouth = m; }, process.env.MOUTH || 'wormhole-saturn');
// The Argo, docked, a little way out from the mouth by Saturn, flying in.
await page.evaluate(() => {
  const e = window.__expedition; const r = e.runtime; const ship = r.player.ship; const V = ship.position.constructor;
  r.mothership.docked = true; r.mothership.parked = false;
  const m = e.wormholes.find((w) => w.id === (window.__mouth || 'wormhole-saturn'));
  const dir = new V(1, 0.2, 0.3).normalize();
  r.actions.place(m.position.clone().addScaledVector(dir, m.radius * 1.5), dir.clone().negate(), 1500);
});
// Let the photographs of both sides be taken (real time), then hold the clock.
const wait = (ms) => page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), ms);
await wait(20000);
await page.evaluate(() => window.__vt.hold());
const step = 1000 / (fps * slow);
// Into the throat.
for (let i = 0; i < 2000; i++) {
  const t = await page.evaluate((ms) => { window.__vt.step(ms); const tr = window.__expedition.runtime.transit; return tr ? tr.t : -1; }, 1000 / 30);
  if (t >= 0) { console.log('in the throat after', i, 'steps'); break; }
}
// Up to <from>.
for (let i = 0; i < 1000; i++) {
  const t = await page.evaluate((ms) => { window.__vt.step(ms); return window.__expedition.runtime.transit?.t ?? 99; }, 1000 / 30);
  if (t >= from - 1 / 30) break;
}
// Film it: each frame moves the game 1/(fps*slow) s.
let n = 0;
for (;;) {
  const res = await page.evaluate(({ ms, every }) => {
    window.__vt.step(ms);
    const tr = window.__expedition.runtime.transit;
    const c = window.__three.gl.domElement;
    const url = c.toDataURL('image/jpeg', 0.95);
    return { t: tr ? tr.t : 99, url };
  }, { ms: step, every });
  if (n % every === 0) fs.writeFileSync(`${out}/f${String(n).padStart(5, '0')}.jpg`, Buffer.from(res.url.split(',')[1], 'base64'));
  n++;
  if (n % 20 === 0) console.log('frame', n, 't', res.t.toFixed(3));
  if (res.t >= to) break;
}
console.log('frames', n, 'logs:', logs.slice(0, 6).join(' | '));
await browser.close();
