// Usage: PORT=4187 node bench.mjs <label> <W> <H> <query> <setup-json> <groups-json>
// Renders the frozen scene on demand (gl.render + readPixels to wait for it) and times it, with each group hidden in turn.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, label, W, H, query, setup = '[]', groupsJson = '[]'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript({ path: new URL('./glcount-init.js', import.meta.url).pathname });
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?${query}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three, null, { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
for (const [kind, a] of JSON.parse(setup)) {
  if (kind === 'eval') await page.evaluate(a);
  else if (kind === 'evalfile') await page.evaluate(fs.readFileSync(a, 'utf8'));
  else if (kind === 'frames') await frames(a);
  else if (kind === 'press') await page.keyboard.press(a);
}
// Freeze the game: stop R3F's loop, then render by hand.
const bench = (pred, only) => page.evaluate(([pred, only]) => {
  const { gl, scene, camera } = window.__three; const c = gl.getContext(); const px = new Uint8Array(4);
  const f = pred ? new Function('o', 'm', 'u', 'v', `return (${pred});`) : null; const hidden = [];
  if (f) scene.traverseVisible((o) => { if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return; const m = Array.isArray(o.material) ? o.material[0] : o.material; const u = m && m.uniforms ? Object.keys(m.uniforms).join(',') : ''; const g = o.geometry; const v = g ? (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) : 0; if (!!f(o, m, u, v) !== !!only) hidden.push(o); });
  hidden.forEach((o) => { o.visible = false; });
  const times = [];
  for (let i = 0; i < 4; i++) { const t0 = performance.now(); gl.render(scene, camera); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); times.push(performance.now() - t0); }
  hidden.forEach((o) => { o.visible = true; });
  times.shift(); times.sort((a, b) => a - b);
  return { ms: Math.round(times[1]), n: hidden.length, calls: gl.info.render.calls, tris: gl.info.render.triangles };
}, [pred, only]);
const camOk = await page.evaluate(() => { const r = window.__three; return !!r.camera; });
await page.evaluate(() => { const r = window.__three; window.__savedLoop = true; });
const base = await bench(null);
console.log(JSON.stringify({ group: 'ALL', ...base }));
for (const g of JSON.parse(groupsJson)) console.log(JSON.stringify({ group: (g.only ? 'ONLY ' : '') + g.name, ...(await bench(g.match, !!g.only)) }));
console.log(JSON.stringify({ group: 'ALL again', ...(await bench(null)) }));
await page.screenshot({ path: `${label}.png`, timeout: 600000 });
await browser.close();
