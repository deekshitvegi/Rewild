// Usage: PORT=4187 node openingtest.mjs <outdir> [new|returning]
// The home page's Begin expedition: the opening film over the veil, its bar, Skip once the world is ready, then the game.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, who = 'new'] = process.argv;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
if (who === 'returning') await ctx.addInitScript(() => { localStorage.setItem('expedition-progress-v1', JSON.stringify({ story: ['prologue'] })); });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push('console: ' + m.text().slice(0, 160)); });
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/`, { waitUntil: 'load', timeout: 120000 });
const launcher = page.locator('[data-experience-launcher="true"]:visible').first();
await launcher.waitFor({ state: 'visible', timeout: 300000 });
log('launcher visible');
await launcher.click({ timeout: 60000 });
log('clicked');
const state = () => page.evaluate(() => {
  const f = document.querySelector('.rewild-film');
  const v = f?.querySelector('video');
  return f ? {
    cls: f.className, title: f.querySelector('.rewild-film__title')?.textContent, detail: f.querySelector('.rewild-film__detail')?.textContent,
    percent: f.querySelector('.rewild-film__percent')?.textContent ?? null, skip: f.querySelector('.rewild-film__skip')?.textContent ?? null,
    caption: f.querySelector('.rewild-film__caption')?.textContent ?? null, video: v ? `${v.currentTime.toFixed(1)}/${(v.duration || 0).toFixed(1)}${v.paused ? ' paused' : ''}${v.muted ? ' muted' : ''} ${v.currentSrc.split('/').pop()}` : null,
  } : null;
});
let shot = 0;
for (let i = 0; i < 400; i++) {
  await page.waitForTimeout(1500);
  const s = await state();
  log(JSON.stringify(s));
  if (s && shot === 0 && s.video && parseFloat(s.video) > 2) { await page.screenshot({ path: `${out}/1-film.png`, timeout: 120000 }); shot = 1; }
  if (s && s.caption && shot === 1) { await page.screenshot({ path: `${out}/1b-caption.png`, timeout: 120000 }); shot = 1.5; }
  if (s && s.skip && shot <= 1.5) { await page.screenshot({ path: `${out}/2-ready.png`, timeout: 120000 }); shot = 2; await page.click('.rewild-film__skip'); log('skip clicked'); }
  if (!s && shot >= 1) { await page.waitForTimeout(4000); await page.screenshot({ path: `${out}/3-game.png`, timeout: 120000 }); break; }
}
log('logs: ' + [...new Set(logs)].slice(0, 8).join(' | '));
await browser.close();
