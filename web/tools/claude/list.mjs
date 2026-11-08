// Usage: PORT=4187 node list.mjs <W> <H> <query> [setup-json] — prints visible drawables, compact.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, W, H, query, setup = '[]'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?${query}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three, null, { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
for (const [kind, a] of JSON.parse(setup)) {
  if (kind === 'eval') await page.evaluate(a); else if (kind === 'evalfile') await page.evaluate(fs.readFileSync(a, 'utf8')); else if (kind === 'frames') await frames(a);
}
await frames(8);
const res = await page.evaluate(fs.readFileSync(new URL('./evals/drawables.js', import.meta.url).pathname, 'utf8'));
console.log('n', res.n);
for (const d of res.list) console.log(`${d.type} ${d.mat} [${d.u}] v=${d.v} inst=${d.inst} ord=${d.order}${d.transparent ? ' T' : ''} side=${d.side} ${d.path}`);
await browser.close();
