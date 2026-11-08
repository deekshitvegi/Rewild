// node cloudlab.mjs <outdir> [W H] [query]: shoot lab/cloud-lab.html (takram clouds at real size) from several views.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, W = '640', H = '360', extra = ''] = process.argv;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
const logs = []; page.on('pageerror', (e) => logs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ' ' + m.text().slice(0, 300)); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/cloud-lab.html?w=${W}&h=${H}${extra}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__frames > 2 && !!window.__lab, null, { timeout: 1800000, polling: 500 });
console.log('up after', Math.round((Date.now() - t0) / 1000), 's');
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__frames; while (window.__frames < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
const shot = async (name, settle) => {
  const a = Date.now(); const f0 = await page.evaluate(() => window.__frames);
  await frames(settle);
  const f1 = await page.evaluate(() => window.__frames);
  const url = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  fs.writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(name, 'ms/frame', Math.round((Date.now() - a) / Math.max(1, f1 - f0)));
};
const S = +(process.env.SETTLE || 16);
await shot('1-ground-west', S);
if (process.env.ONLY) { console.log('logs:', logs.slice(0, 8).join(' | ')); await browser.close(); process.exit(0); }
if (!process.env.SKIP1B) { await page.evaluate(() => window.__lab.view(60, 10, 2)); await shot('1b-ground-east', S); }
await page.evaluate(() => window.__lab.view(200, 32, 2)); await shot('2-ground-up', S);
await page.evaluate(() => window.__lab.view(250, 2, 3200)); await shot('3-air-3km', S);
await page.evaluate(() => { window.__lab.view(245, 4, 2); window.__lab.time('2026-11-05T23:05:00Z'); }); await shot('4-sunset', S);
console.log('logs:', logs.slice(0, 8).join(' | '));
await browser.close();
