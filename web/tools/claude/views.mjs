// Usage: PORT=4187 node views.mjs <out-prefix> <W> <H> <query> <views-json>
// views: [{name, pl:{body,alt,pitch,side}, frames}] — puts the ship there, waits that many frames, screenshots.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, W, H, query, viewsJson] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 1500)); });
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?${query}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three, null, { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
const place = fs.readFileSync(new URL('./evals/place.js', import.meta.url).pathname, 'utf8');
await frames(6);
for (const v of JSON.parse(viewsJson)) {
  await page.evaluate((pl) => { window.__pl = pl; }, v.pl);
  const r = await page.evaluate(place);
  await frames(v.frames ?? 10);
  if (v.eval) await page.evaluate(v.eval);
  await frames(2);
  await page.screenshot({ path: `${out}-${v.name}.png`, timeout: 600000 });
  console.log('view', v.name, JSON.stringify(r));
}
console.log('logs:', logs.slice(0, 5).join(' | '));
await browser.close();
