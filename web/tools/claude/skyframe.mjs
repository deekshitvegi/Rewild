// Usage: PORT=4187 node frame.mjs <out-prefix> <W> <H> <query> <views-json>
// views: [{name, pl:{body,alt,pitch,side,tilt}|null, frames, hud:false}] — places the ship, waits, times a full
// gl.render (best of 3 after one warm-up) and saves the canvas (and a page screenshot when hud:true).
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, W, H, query, viewsJson] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
const logs = [];
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 600)); });
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?${query}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three, null, { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
const place = fs.readFileSync(new URL('./evals/skyview.js', import.meta.url).pathname, 'utf8');
await frames(6);
for (const v of JSON.parse(viewsJson)) {
  let r = null;
  if (v.pl) { await page.evaluate((pl) => { window.__sv = pl; }, v.pl); r = await page.evaluate(place); }
  await frames(v.frames ?? 12);
  const res = await page.evaluate(() => {
    const { gl, scene, camera } = window.__three; const c = gl.getContext(); const px = new Uint8Array(4); const t = [];
    for (let i = 0; i < 4; i++) { const t0 = performance.now(); gl.render(scene, camera); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); t.push(performance.now() - t0); }
    t.shift(); const url = gl.domElement.toDataURL('image/png');
    return { ms: Math.round(Math.min(...t)), calls: gl.info.render.calls, tris: gl.info.render.triangles, url };
  });
  fs.writeFileSync(`${out}-${v.name}.png`, Buffer.from(res.url.split(',')[1], 'base64'));
  if (v.hud) await page.screenshot({ path: `${out}-${v.name}-hud.png`, timeout: 600000 });
  console.log(JSON.stringify({ view: v.name, ms: res.ms, calls: res.calls, tris: res.tris, placed: r }));
}
console.log('logs:', logs.slice(0, 4).join(' | '));
await browser.close();
