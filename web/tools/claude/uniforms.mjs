// Usage: PORT=4187 node uniforms.mjs <query> <skyview-json> <meshId-or-uniform-name-filter>
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, query, sv, want] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })).newPage();
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?${query}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three, null, { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
await frames(6);
await page.evaluate((s) => { window.__sv = JSON.parse(s); }, sv);
await page.evaluate(fs.readFileSync(new URL('./evals/skyview.js', import.meta.url).pathname, 'utf8'));
await frames(30);
console.log(JSON.stringify(await page.evaluate((want) => {
  const out = []; const r = window.__expedition.runtime;
  window.__three.scene.traverse((o) => { const m = o.material; if (!m || !m.uniforms || !m.uniforms[want]) return;
    const u = {}; for (const [k, v] of Object.entries(m.uniforms)) { const x = v.value; u[k] = typeof x === 'number' ? +x.toFixed(4) : x && x.isVector3 ? [x.x, x.y, x.z].map((n) => +n.toFixed(3)) : x && x.isColor ? [x.r, x.g, x.b].map((n) => +n.toFixed(3)) : undefined; }
    out.push({ id: o.id, visible: o.visible, u }); });
  return { weather: { body: r.weather.body && r.weather.body.id, density: r.weather.density }, out };
}, want), null, 1));
await browser.close();
